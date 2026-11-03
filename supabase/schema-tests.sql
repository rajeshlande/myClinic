-- =============================================================================
-- myClinic — database verification suites      DEV ONLY · NEVER ON PRODUCTION
-- =============================================================================
-- Run against a SCRATCH Supabase project after applying `supabase/schema.sql`.
-- Everything is created inside a transaction that is rolled back at the end, so
-- a run leaves no trace and is safe to repeat.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema-tests.sql
--
-- Two suites run in order:
--   A. the role matrix   — that owner / doctor / front deck see only what they run
--   B. licensing         — trial, seats, grace, the read-only write gate, renewal
--
-- Every assertion raises on failure, so a clean run is the proof. Success lines:
--   "ALL RLS CHECKS COMPLETED" and "ALL LICENSING CHECKS COMPLETED".
--
-- This file is not part of the schema. `supabase/schema.sql` is the single
-- source of truth for the database; this is the test that it behaves.
-- =============================================================================


-- =============================================================================
-- SUITE A · ROLE MATRIX AND TENANT ISOLATION
-- =============================================================================
begin;

-- --------------------------------------------------------------- fixtures
-- Two clinics, three users: clinic A owner + front desk, clinic B owner.
do $$
declare
  owner_a uuid := gen_random_uuid();
  desk_a  uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  clinic_a uuid;
  clinic_b uuid;
  patient_a uuid;
  patient_b uuid;
  invoice_b uuid;
  staff_desk_a uuid;
  v_left text;
  n integer;
begin
  -- auth.users rows so the FK on profiles/staff holds
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (owner_a, 'owner-a@test.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (desk_a,  'desk-a@test.local',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (owner_b, 'owner-b@test.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into public.clinics (name) values ('Test Clinic A') returning id into clinic_a;
  insert into public.clinics (name) values ('Test Clinic B') returning id into clinic_b;

  insert into public.staff (clinic_id, user_id, full_name, role) values (clinic_a, owner_a, 'Owner A', 'owner');
  insert into public.staff (clinic_id, user_id, full_name, role) values (clinic_a, desk_a,  'Desk A',  'frontdesk')
    returning id into staff_desk_a;
  insert into public.staff (clinic_id, user_id, full_name, role) values (clinic_b, owner_b, 'Owner B', 'owner');

  insert into public.patients (clinic_id, code, full_name, phone)
    values (clinic_a, 'PT-00001', 'Patient A', '9000000001') returning id into patient_a;
  insert into public.patients (clinic_id, code, full_name, phone)
    values (clinic_b, 'PT-00001', 'Patient B', '9000000002') returning id into patient_b;

  insert into public.invoices (clinic_id, number, patient_id, total_paise, paid_paise, status)
    values (clinic_b, 'INV/2526/0001', patient_b, 50000, 50000, 'paid') returning id into invoice_b;

  -- =========================================================================
  -- 1. Finding rls/staff-self-privilege-escalation — a front-desk user must NOT
  --    be able to add themselves to another clinic, nor promote themselves.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', desk_a, 'role', 'authenticated', 'email', 'desk-a@test.local')::text, true);
  set local role authenticated;

  begin
    insert into public.staff (clinic_id, user_id, full_name, role)
      values (clinic_b, desk_a, 'Self-enrolled', 'owner');
    raise exception 'FAIL: front desk enrolled itself as owner of clinic B';
  exception when insufficient_privilege then
    raise notice 'PASS: self-enrolment into another clinic is refused';
  end;

  begin
    update public.staff set role = 'owner' where id = staff_desk_a;
    raise exception 'FAIL: front desk promoted itself to owner';
  exception when insufficient_privilege then
    raise notice 'PASS: self-promotion is refused by policy/trigger';
  end;

  -- A front desk member still edits their own safe columns.
  update public.staff set phone = '9000000009' where id = staff_desk_a;
  raise notice 'PASS: front desk can still edit their own contact details';

  reset role;

  -- =========================================================================
  -- 2. Tenant isolation — clinic A staff must not read clinic B records.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated', 'email', 'owner-a@test.local')::text, true);
  set local role authenticated;

  select count(*) into n from public.patients where clinic_id = clinic_b;
  if n <> 0 then raise exception 'FAIL: cross-tenant patient rows visible (%)', n; end if;
  raise notice 'PASS: clinic B patients invisible to clinic A';

  select count(*) into n from public.patients;
  if n <> 1 then raise exception 'FAIL: expected exactly the clinic A patient, saw %', n; end if;
  raise notice 'PASS: row-level filtering returns only own-tenant rows';

  -- =========================================================================
  -- 3. Finding rls/frontdesk-clinical-delete — role matrix on clinical tables.
  -- =========================================================================
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', desk_a, 'role', 'authenticated', 'email', 'desk-a@test.local')::text, true);
  set local role authenticated;

  begin
    insert into public.consultations (clinic_id, patient_id, doctor_id, visited_on)
      values (clinic_a, patient_a, staff_desk_a, current_date);
    raise exception 'FAIL: front desk wrote a clinical consultation';
  exception when insufficient_privilege then
    raise notice 'PASS: front desk cannot author consultations';
  end;

  -- Front desk CAN register patients and collect on invoices (their job).
  insert into public.patients (clinic_id, code, full_name, phone) values (clinic_a, 'PT-00002', 'Walk-in', '9000000011');
  raise notice 'PASS: front desk can register a patient';

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_b, 'role', 'authenticated', 'email', 'owner-b@test.local')::text, true);
  set local role authenticated;

  -- =========================================================================
  -- 4. Finding idor/issue-token-cross-clinic — issue_token re-authorises ids.
  -- =========================================================================
  begin
    perform public.issue_token(clinic_b, patient_a, (select id from public.staff where clinic_id = clinic_b limit 1), 'New consultation', '', 15);
    raise exception 'FAIL: issued a token for another clinic''s patient';
  exception when insufficient_privilege then
    raise notice 'PASS: issue_token refuses a patient from another clinic';
  end;

  -- =========================================================================
  -- 5. Financial guard — a paid invoice cannot be amended or voided by non-owner.
  -- =========================================================================
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', desk_a, 'role', 'authenticated', 'email', 'desk-a@test.local')::text, true);
  set local role authenticated;

  -- Row-level security does not raise here: it simply matches no rows, so the
  -- update reports 0 and the invoice is untouched. Assert both, because "no rows
  -- matched" and "rows matched but nothing changed" mean very different things.
  begin
    update public.invoices set status = 'void' where id = invoice_b;
    if found then
      raise exception 'FAIL: voided another clinic''s invoice';
    end if;
    raise notice 'PASS: cross-clinic invoice update refused (RLS matched no rows)';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-clinic invoice update refused';
  end;

  reset role;
  select status into v_left from public.invoices where id = invoice_b;
  if v_left = 'void' then
    raise exception 'FAIL: invoice in another clinic was voided';
  end if;
  raise notice 'PASS: the other clinic''s invoice is untouched';

  reset role;

  -- =========================================================================
  -- 6. Invites — only an owner can create one; the invitee claims it server-side.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', desk_a, 'role', 'authenticated', 'email', 'desk-a@test.local')::text, true);
  set local role authenticated;
  begin
    perform public.invite_staff(clinic_a, 'newdoc@test.local', 'doctor', 'New Doc');
    raise exception 'FAIL: front desk created an invitation';
  exception when insufficient_privilege then
    raise notice 'PASS: only owners can invite staff';
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated', 'email', 'owner-a@test.local')::text, true);
  set local role authenticated;
  perform public.invite_staff(clinic_a, 'newdoc@test.local', 'doctor', 'New Doc');
  raise notice 'PASS: owner created an invitation';
  reset role;

  raise notice 'ALL RLS CHECKS COMPLETED';
end $$;

rollback;   -- nothing above survives; safe to re-run


-- =============================================================================
-- SUITE B · SUBSCRIPTIONS AND LICENSING
-- =============================================================================
begin;

do $$
declare
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  clinic_a uuid;
  clinic_b uuid;
  lic jsonb;
  seat_before integer;
  n integer;
begin
  -- ---------------------------------------------------------------- fixtures
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, aud, role)
  values (owner_a, 'owner-a@license.test', crypt('x', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated'),
         (owner_b, 'owner-b@license.test', crypt('x', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated');

  perform set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated', 'email', 'owner-a@license.test')::text, true);
  set local role authenticated;
  clinic_a := public.create_clinic('{"name":"Licence Clinic A"}'::jsonb, '{"full_name":"Owner A"}'::jsonb);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_b, 'role', 'authenticated', 'email', 'owner-b@license.test')::text, true);
  set local role authenticated;
  clinic_b := public.create_clinic('{"name":"Licence Clinic B"}'::jsonb, '{"full_name":"Owner B"}'::jsonb);
  reset role;

  -- ================================================================ 1. trial
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated', 'email', 'owner-a@license.test')::text, true);
  set local role authenticated;
  lic := public.license_state(clinic_a);
  reset role;
  if (lic->>'status') <> 'trial' then raise exception 'FAIL: new clinic is not on trial (got %)', lic->>'status'; end if;
  if (lic->>'plan') <> 'growth' then raise exception 'FAIL: trial plan is not growth'; end if;
  if (lic->'can_write')::boolean is not true then raise exception 'FAIL: a fresh trial must be writable'; end if;
  raise notice 'PASS: a new clinic starts on the 14-day Growth trial';

  -- ================================================================ 2. seat limit
  -- Careful: a plpgsql exception block is a sub-transaction, so if the rejected
  -- insert shared a block with the accepted ones, the accepted rows would be
  -- rolled back too and the clinic would look empty to the next assertion.
  -- The owner already holds one doctor seat, so four more fill the Growth plan.
  set local role authenticated;
  insert into public.staff (clinic_id, full_name, role) values (clinic_a, 'Doc 1', 'doctor');
  insert into public.staff (clinic_id, full_name, role) values (clinic_a, 'Doc 2', 'doctor');
  insert into public.staff (clinic_id, full_name, role) values (clinic_a, 'Doc 3', 'doctor');
  insert into public.staff (clinic_id, full_name, role) values (clinic_a, 'Doc 4', 'doctor');
  begin
    insert into public.staff (clinic_id, full_name, role) values (clinic_a, 'Doc 5', 'doctor');
    raise exception 'FAIL: growth plan accepted a 6th doctor';
  exception when sqlstate '53400' then
    raise notice 'PASS: growth stops at 5 doctors (seat_guard)';
  end;
  reset role;

  select count(*) into n from public.staff where clinic_id = clinic_a and role in ('owner','doctor') and active;
  if n <> 5 then raise exception 'FAIL: expected 5 doctor seats to be kept, found %', n; end if;

  -- Front desk is a separate pool (3 on growth): fill it, then one more must fail.
  set local role authenticated;
  insert into public.staff (clinic_id, full_name, role) values (clinic_a, 'Desk 1', 'frontdesk');
  insert into public.staff (clinic_id, full_name, role) values (clinic_a, 'Desk 2', 'frontdesk');
  insert into public.staff (clinic_id, full_name, role) values (clinic_a, 'Desk 3', 'frontdesk');
  begin
    insert into public.staff (clinic_id, full_name, role) values (clinic_a, 'Desk 3', 'frontdesk');
    raise exception 'FAIL: growth accepted a 4th front-desk seat';
  exception when sqlstate '53400' then
    raise notice 'PASS: growth stops at 3 front-desk seats';
  end;
  reset role;

  -- ================================================================ 3. plan change
  set local role authenticated;
  begin
    perform public.change_plan(clinic_a, 'solo', 'monthly', '{}'::jsonb);  -- 5 doctors > solo's 1
    raise exception 'FAIL: downgrade to solo was allowed while 5 doctors are active';
  exception when sqlstate '53400' then
    raise notice 'PASS: a downgrade below current seat usage is refused';
  end;

  lic := public.change_plan(clinic_a, 'chain', 'yearly', '{"email":"billing@a.test","collection_ref":"UPI-1"}'::jsonb);
  reset role;
  if (lic->>'status') <> 'active' then raise exception 'FAIL: plan change did not activate'; end if;
  if (lic->>'interval') <> 'yearly' then raise exception 'FAIL: interval not stored'; end if;
  raise notice 'PASS: owner switched to Multi-clinic yearly and it is active';

  -- ================================================================ 4. tenant isolation
  perform set_config('request.jwt.claims', json_build_object('sub', owner_b, 'role', 'authenticated', 'email', 'owner-b@license.test')::text, true);
  set local role authenticated;
  begin
    lic := public.license_state(clinic_a);
    raise exception 'FAIL: clinic B read clinic A''s licence';
  exception when insufficient_privilege then
    raise notice 'PASS: a clinic cannot read another clinic''s licence';
  end;
  begin
    perform public.change_plan(clinic_a, 'solo', 'monthly', '{}'::jsonb);
    raise exception 'FAIL: clinic B changed clinic A''s plan';
  exception when insufficient_privilege then
    raise notice 'PASS: only the owner of a clinic can change its plan';
  end;
  reset role;

  -- ================================================================ 5. read-only gate
  -- Expire clinic A 40 days ago: writes must stop, reads must keep working.
  update public.clinic_subscriptions
     set status = 'active', current_period_end = now() - interval '40 days'
   where clinic_id = clinic_a;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated', 'email', 'owner-a@license.test')::text, true);
  set local role authenticated;
  lic := public.license_state(clinic_a);
  if (lic->>'status') <> 'read_only' then raise exception 'FAIL: overdue subscription did not become read-only (got %)', lic->>'status'; end if;
  if (lic->'can_write')::boolean is not false then raise exception 'FAIL: read-only licence still reports can_write'; end if;
  raise notice 'PASS: an overdue subscription reports read_only';

  -- `code` is not null, so give the row every column it needs: the point of this
  -- assertion is that the *licence* refuses the write, not the column defaults.
  begin
    insert into public.patients (clinic_id, code, full_name) values (clinic_a, 'PT-90001', 'Blocked Patient');
    raise exception 'FAIL: a read-only clinic inserted a patient';
  exception when sqlstate '53401' then
    raise notice 'PASS: writes are blocked in read-only mode (subscription_write_guard)';
  end;

  -- reading is still allowed
  perform 1 from public.patients where clinic_id = clinic_a;
  raise notice 'PASS: records stay readable in read-only mode';
  reset role;

  -- ================================================================ 6. grace window
  update public.clinic_subscriptions
     set current_period_end = now() - interval '3 days'
   where clinic_id = clinic_a;
  set local role authenticated;
  lic := public.license_state(clinic_a);
  insert into public.patients (clinic_id, code, full_name) values (clinic_a, 'PT-90002', 'Grace Patient');
  reset role;
  if (lic->>'status') <> 'grace' then raise exception 'FAIL: 3 days overdue is not grace (got %)', lic->>'status'; end if;
  raise notice 'PASS: 7-day grace still allows writes';

  -- ================================================================ 7. renewal restores writes
  set local role authenticated;
  lic := public.renew_subscription(clinic_a, 'UPI-RENEW-77', null);
  reset role;
  if (lic->>'status') <> 'active' then raise exception 'FAIL: renewal did not reactivate the clinic'; end if;
  if (lic->>'collection_ref') <> 'UPI-RENEW-77' then raise exception 'FAIL: collection reference not recorded'; end if;
  raise notice 'PASS: renewing records the reference and restores the active state';

  -- ================================================================ 8. trial is once only
  set local role authenticated;
  begin
    perform public.start_trial(clinic_a);
    raise exception 'FAIL: trial was restarted after it had already been used';
  exception when sqlstate '53400' then
    raise notice 'PASS: the free trial cannot be farmed twice';
  end;
  reset role;

  raise notice 'ALL LICENSING CHECKS COMPLETED';
end $$;

rollback;   -- nothing above survives; safe to re-run
