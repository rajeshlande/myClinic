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
-- The suites run in order:
--   A. the role matrix   — that owner / doctor / front deck see only what they run
--   B. licensing         — trial, seats, grace, the read-only write gate, renewal
--   C. public booking    — the five anon-granted RPCs, called the way a stranger
--                          with a link calls them, including every refusal
--   D. naming            — clinic_slug, the one rule a clinic name becomes a URL
--   E. the booking link  — provisioning mints a slug, the slug resolves for a
--                          stranger, and only an owner can change it
--   F. who reads what    — the doctor owns the chart, the desk owns the money, and
--                          neither can reach across
--   G. whatsapp          — consent, opt-out and the message log
--   H. sessions          — two sessions a day, days off, the 3–45 day follow-up
--   I. the profile row   — every account has one, and only its owner writes it
--   J. drug directory    — brands, compositions, typo tolerance, read-only rules
--
-- Every assertion raises on failure, so a clean run is the proof. Success lines:
--   "ALL RLS CHECKS COMPLETED", "ALL LICENSING CHECKS COMPLETED",
--   "ALL BOOKING CHECKS COMPLETED", "ALL SLUG CHECKS COMPLETED",
--   "ALL BOOKING LINK CHECKS COMPLETED", "ALL ROLE SPLIT CHECKS COMPLETED",
--   "ALL WHATSAPP CHECKS COMPLETED", "ALL HOURS CHECKS COMPLETED",
--   "ALL PROFILE CHECKS COMPLETED" and "ALL DRUG DIRECTORY CHECKS COMPLETED".
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
    raise exception 'FAIL: front desk enrolled itself as owner of clinic B' using errcode = 'P0002';
  exception when insufficient_privilege then
    raise notice 'PASS: self-enrolment into another clinic is refused';
  end;

  begin
    update public.staff set role = 'owner' where id = staff_desk_a;
    raise exception 'FAIL: front desk promoted itself to owner' using errcode = 'P0002';
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
    raise exception 'FAIL: front desk wrote a clinical consultation' using errcode = 'P0002';
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
    raise exception 'FAIL: issued a token for another clinic''s patient' using errcode = 'P0002';
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
      raise exception 'FAIL: voided another clinic''s invoice' using errcode = 'P0002';
    end if;
    raise notice 'PASS: cross-clinic invoice update refused (RLS matched no rows)';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-clinic invoice update refused';
  end;

  reset role;
  select status into v_left from public.invoices where id = invoice_b;
  if v_left = 'void' then
    raise exception 'FAIL: invoice in another clinic was voided' using errcode = 'P0002';
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
    raise exception 'FAIL: front desk created an invitation' using errcode = 'P0002';
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
  status_before text;
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
    raise exception 'FAIL: growth plan accepted a 6th doctor' using errcode = 'P0002';
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
    raise exception 'FAIL: growth accepted a 4th front-desk seat' using errcode = 'P0002';
  exception when sqlstate '53400' then
    raise notice 'PASS: growth stops at 3 front-desk seats';
  end;
  reset role;

  -- ================================================================ 3. plan change
  set local role authenticated;
  begin
    perform public.change_plan(clinic_a, 'solo', 'monthly', '{}'::jsonb);  -- 5 doctors > solo's 1
    raise exception 'FAIL: downgrade to solo was allowed while 5 doctors are active' using errcode = 'P0002';
  exception when sqlstate '53400' then
    raise notice 'PASS: a downgrade below current seat usage is refused';
  end;

  -- Schema 17: a plan change moves the plan and the interval, never the status.
  -- Before this a tenant could self-activate by "switching plan" with a made-up
  -- collection reference; the money has to arrive through renew_subscription.
  select status into status_before from public.clinic_subscriptions where clinic_id = clinic_a;
  lic := public.change_plan(clinic_a, 'chain', 'yearly', '{"email":"billing@a.test","collection_ref":"UPI-1"}'::jsonb);
  reset role;
  if (lic->>'interval') <> 'yearly' then raise exception 'FAIL: interval not stored'; end if;
  if (lic->>'plan') <> 'chain' then raise exception 'FAIL: plan not stored (got %)', lic->>'plan'; end if;
  if (lic->>'status') is distinct from status_before then
    raise exception 'FAIL: a plan change moved the status from % to %', status_before, lic->>'status';
  end if;
  raise notice 'PASS: owner switched to Multi-clinic yearly; the interval moved and the status did not';

  -- ================================================================ 4. tenant isolation
  perform set_config('request.jwt.claims', json_build_object('sub', owner_b, 'role', 'authenticated', 'email', 'owner-b@license.test')::text, true);
  set local role authenticated;
  begin
    lic := public.license_state(clinic_a);
    raise exception 'FAIL: clinic B read clinic A''s licence' using errcode = 'P0002';
  exception when insufficient_privilege then
    raise notice 'PASS: a clinic cannot read another clinic''s licence';
  end;
  begin
    perform public.change_plan(clinic_a, 'solo', 'monthly', '{}'::jsonb);
    raise exception 'FAIL: clinic B changed clinic A''s plan' using errcode = 'P0002';
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
    raise exception 'FAIL: a read-only clinic inserted a patient' using errcode = 'P0002';
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
    raise exception 'FAIL: trial was restarted after it had already been used' using errcode = 'P0002';
  exception when sqlstate '53400' then
    raise notice 'PASS: the free trial cannot be farmed twice';
  end;
  reset role;

  raise notice 'ALL LICENSING CHECKS COMPLETED';
end $$;

rollback;   -- nothing above survives; safe to re-run

-- =============================================================================
-- SUITE C · PUBLIC BOOKING (schema 8)
-- =============================================================================
-- The only surface a stranger reaches: five security-definer functions granted to
-- `anon`, and no policy anywhere that lets `anon` read a table. This suite calls
-- them the way the booking page does and asserts both the happy path and each
-- refusal, because a booking that silently fails is worse than one that refuses.
begin;

do $$
declare
  clinic_ok uuid;
  clinic_off uuid;
  doc uuid;
  prof jsonb;
  res jsonb;
  busy jsonb;
  ref1 text;
  ref2 text;
  client1 uuid;
  nm text;
  code text;
  n integer;
  d date := current_date + 1;
begin
  insert into public.clinics (name, slug, phone, address)
    values ('Booking Test Clinic', 'booking-test', '9000000011', 'Test address')
    returning id into clinic_ok;
  insert into public.staff (clinic_id, full_name, role, day_start, day_end, slot_minutes, fee_paise)
    values (clinic_ok, 'Dr. Book', 'owner', '09:00', '13:00', 15, 50000)
    returning id into doc;

  insert into public.clinics (name, slug, phone, booking_enabled)
    values ('Closed Clinic', 'closed-clinic', '9000000012', false)
    returning id into clinic_off;

  set local role anon;

  -- ======================================================= 1. the profile
  prof := public.public_clinic_profile('booking-test');
  if (prof->>'enabled') <> 'true' then raise exception 'FAIL: public profile not enabled'; end if;
  if jsonb_array_length(prof->'doctors') <> 1 then raise exception 'FAIL: roster carries % doctors, expected 1', jsonb_array_length(prof->'doctors'); end if;
  if (prof->'doctors'->0->>'day_start') <> '09:00' then raise exception 'FAIL: day_start is not HH24:MI'; end if;
  if (prof->'clinic'->>'booking_horizon_days') is null then raise exception 'FAIL: the horizon is not published'; end if;
  if (public.public_clinic_profile('  Booking-Test ')::jsonb->'clinic'->>'slug') <> 'booking-test' then
    raise exception 'FAIL: the slug lookup is not case/space insensitive' using errcode = 'P0002';
  end if;
  raise notice 'PASS: the public profile publishes the clinic, the horizon and the roster';

  -- A clinic that switched booking off still answers, with its phone and nothing else.
  prof := public.public_clinic_profile('closed-clinic');
  if (prof->>'enabled') <> 'false' then raise exception 'FAIL: a closed clinic reported enabled'; end if;
  if coalesce(prof->'clinic'->>'phone', '') = '' then raise exception 'FAIL: a closed clinic did not hand back its phone'; end if;
  if prof->'doctors' is not null then raise exception 'FAIL: a closed clinic still published its roster'; end if;
  raise notice 'PASS: a closed clinic answers with its phone number only';

  -- ======================================================= 2. the booking
  res := public.public_book('booking-test', doc, d, '10:00', '  Rohit   Patel ', '98200 11223', 'fever');
  ref1 := res->>'ref';
  if ref1 !~ '^BK-[ACDEFGHJKLMNPQRTUVWXY2346789]{6}$' then raise exception 'FAIL: reference % does not look like a booking reference', ref1; end if;
  if (res->>'duplicate') <> 'false' then raise exception 'FAIL: a first booking was flagged duplicate'; end if;
  if (res->>'iso') <> d::text or (res->>'at') <> '10:00' then raise exception 'FAIL: the receipt echoes the wrong slot (% %)', res->>'iso', res->>'at'; end if;
  raise notice 'PASS: a stranger books a slot and gets a reference (%)', ref1;

  -- The patient behind it: created once, name tidied, code in the clinic series.
  reset role;
  select p.full_name, p.code into nm, code
    from public.appointments a join public.patients p on p.id = a.patient_id
   where a.booking_ref = ref1;
  if nm <> 'Rohit Patel' then raise exception 'FAIL: the name was not tidied (got %)', nm; end if;
  if code !~ '^PT-[0-9]{5}$' then raise exception 'FAIL: patient code % is not in the clinic series', code; end if;
  set local role anon;

  -- ======================================================= 3. the same tap twice
  -- Schema 17: the reference belongs to the device that booked. The first booking
  -- above carried no client id, so this retry is a *different* device as far as
  -- the database is concerned and gets nothing back — which is the point.
  client1 := gen_random_uuid();
  res := public.public_book('booking-test', doc, d, '11:15', 'Kabir Rao', '9000000091', 'fever', client1);
  ref2 := res->>'ref';
  res := public.public_book('booking-test', doc, d, '11:15', 'Kabir Rao', '9000000091', 'fever', client1);
  if (res->>'duplicate') <> 'true' or (res->>'ref') <> ref2 then
    raise exception 'FAIL: a double tap from the booking device lost its reference' using errcode = 'P0002';
  end if;
  raise notice 'PASS: the same tap twice from the booking device returns the same reference';

  -- ======================================================= 4. one live booking per phone per day
  -- A phone number is not a credential: the refusal names neither the slot the
  -- patient already holds nor the reference that is on it.
  begin
    perform public.public_book('booking-test', doc, d, '11:00', 'Rohit Patel', '98200 11223', '', gen_random_uuid());
    raise exception 'FAIL: a second live appointment for one phone was accepted' using errcode = 'P0002';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'booking:already' then
      raise exception 'FAIL: the refusal leaked detail (%) — expected booking:already', sqlerrm;
    end if;
    raise notice 'PASS: a second slot for the same phone is refused with no time and no reference';
  end;

  -- ...and a third party cannot collect the first booking's reference either
  begin
    res := public.public_book('booking-test', doc, d, '10:00', 'Mallory', '98200 11223', '', gen_random_uuid());
    raise exception 'FAIL: a stranger was handed the reference for someone else''s appointment' using errcode = 'P0002';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'booking:already' then raise exception 'FAIL: wrong refusal (%)', sqlerrm; end if;
  end;
  raise notice 'PASS: knowing the phone and the slot is not enough to collect the reference';

  -- ======================================================= 5. the slot is gone
  begin
    perform public.public_book('booking-test', doc, d, '10:00', 'Meera Iyer', '9000000022', '');
    raise exception 'FAIL: two patients were booked into one slot' using errcode = 'P0002';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'booking:slot_taken' then raise exception 'FAIL: wrong refusal (%)', sqlerrm; end if;
    raise notice 'PASS: a taken slot refuses a second patient';
  end;

  -- ======================================================= 6. the rest of the refusals
  begin
    perform public.public_book('booking-test', doc, d, '10:07', 'Meera Iyer', '9000000022', '');
    raise exception 'FAIL: a time off the slot grid was accepted' using errcode = 'P0002';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'booking:slot' then raise exception 'FAIL: wrong refusal (%)', sqlerrm; end if;
    raise notice 'PASS: a time that is not on the doctor grid is refused';
  end;

  begin
    perform public.public_book('booking-test', doc, d + 60, '09:00', 'Meera Iyer', '9000000022', '');
    raise exception 'FAIL: a date past the horizon was accepted' using errcode = 'P0002';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'booking:date' then raise exception 'FAIL: wrong refusal (%)', sqlerrm; end if;
    raise notice 'PASS: a date past the booking horizon is refused';
  end;

  begin
    perform public.public_book('booking-test', doc, d, '09:45', 'Meera', '12345', '');
    raise exception 'FAIL: a five-digit phone was accepted' using errcode = 'P0002';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'booking:phone' then raise exception 'FAIL: wrong refusal (%)', sqlerrm; end if;
    raise notice 'PASS: a phone that cannot be a phone is refused';
  end;

  begin
    perform public.public_book('booking-test', doc, d, '09:45', 'M', '9000000022', '');
    raise exception 'FAIL: a one-letter name was accepted' using errcode = 'P0002';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'booking:name' then raise exception 'FAIL: wrong refusal (%)', sqlerrm; end if;
    raise notice 'PASS: a one-letter name is refused';
  end;

  begin
    perform public.public_book('closed-clinic', doc, d, '09:00', 'Meera Iyer', '9000000022', '');
    raise exception 'FAIL: a clinic with booking off accepted an appointment' using errcode = 'P0002';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'booking:closed' then raise exception 'FAIL: wrong refusal (%)', sqlerrm; end if;
    raise notice 'PASS: a closed clinic refuses bookings outright';
  end;

  -- ======================================================= 7. busy minutes leak nothing
  busy := public.public_booking_busy('booking-test', doc);
  if jsonb_array_length(busy->'busy') < 1 then raise exception 'FAIL: the booked minute is not reported as busy'; end if;
  if (busy->'busy'->0) ? 'patient_id' or (busy->'busy'->0) ? 'name' or (busy->'busy'->0) ? 'reason' then
    raise exception 'FAIL: busy minutes carry who the patient is' using errcode = 'P0002';
  end if;
  if jsonb_array_length(public.public_booking_busy('booking-test', gen_random_uuid())->'busy') <> 0 then
    raise exception 'FAIL: busy answered for a doctor who is not in this clinic' using errcode = 'P0002';
  end if;
  raise notice 'PASS: busy minutes are a time and a length, and only for this clinic''s doctors';

  -- ======================================================= 8. lookup
  res := public.public_booking_lookup(lower(ref1));
  if (res->>'found') <> 'true' then raise exception 'FAIL: a reference did not find its booking'; end if;
  if (res->>'patient_first') <> 'Rohit' then raise exception 'FAIL: lookup returned the wrong first name (%)', res->>'patient_first'; end if;
  if (res->>'doctor') <> 'Dr. Book' then raise exception 'FAIL: lookup returned the wrong doctor (%)', res->>'doctor'; end if;
  if (public.public_booking_lookup('BK-NOPE00')->>'found') <> 'false' then raise exception 'FAIL: a bad reference reported found'; end if;
  raise notice 'PASS: a reference finds its own booking and nothing else';

  -- ======================================================= 9. cancel, and the slot comes back
  res := public.public_cancel_booking(ref1);
  if (res->>'cancelled') <> 'true' then raise exception 'FAIL: cancelling a live booking did not work'; end if;
  res := public.public_cancel_booking(ref1);
  if (res->>'cancelled') <> 'false' or (res->>'status') <> 'cancelled' then
    raise exception 'FAIL: cancelling twice reported success again' using errcode = 'P0002';
  end if;
  raise notice 'PASS: a booking cancels once, and a second cancel is a no-op';

  res := public.public_book('booking-test', doc, d, '10:00', 'Kabir Khan', '9000000033', '');
  if (res->>'duplicate') <> 'false' or coalesce(res->>'ref', '') = ref1 then
    raise exception 'FAIL: the cancelled slot could not be re-sold' using errcode = 'P0002';
  end if;
  raise notice 'PASS: a cancelled slot is free for the next patient';

  -- ======================================================= 10. flood guards
  -- A phone gets three online bookings a day. Book-and-cancel is how a patient
  -- reaches that count honestly: the "one live booking per phone" rule above
  -- refuses a second *live* one, so a cancelled booking is the only way through.
  res := public.public_book('booking-test', doc, d, '12:00', 'Flood One', '9000000044', '');
  perform public.public_cancel_booking(res->>'ref');
  res := public.public_book('booking-test', doc, d, '12:15', 'Flood One', '9000000044', '');
  perform public.public_cancel_booking(res->>'ref');
  res := public.public_book('booking-test', doc, d, '12:30', 'Flood One', '9000000044', '');
  perform public.public_cancel_booking(res->>'ref');
  begin
    perform public.public_book('booking-test', doc, d, '12:45', 'Flood One', '9000000044', '');
    raise exception 'FAIL: a fourth booking from one phone was accepted' using errcode = 'P0002';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'booking:toomany' then
      raise exception 'FAIL: wrong refusal (%): %', sqlerrm, sqlerrm using errcode = 'P0002';
    end if;
    raise notice 'PASS: one phone cannot book more than three times a day';
  end;

  -- ======================================================= 11. anon still sees no tables
  select count(*) into n from public.patients;
  if n <> 0 then raise exception 'FAIL: anon read % patient rows', n; end if;
  select count(*) into n from public.appointments;
  if n <> 0 then raise exception 'FAIL: anon read % appointment rows', n; end if;
  select count(*) into n from public.invoices;
  if n <> 0 then raise exception 'FAIL: anon read % invoice rows', n; end if;
  raise notice 'PASS: anon reaches the five functions and no table at all';

  reset role;

  -- ======================================================= 12. the shape of that surface
  -- Two properties, both of which have broken real Supabase projects:
  --   * the RPCs must be security definer, or anon would need table grants to use
  --     them and would then be able to read whatever that grant reached;
  --   * every definer function must pin search_path, or a caller can point the
  --     unqualified names inside it at their own schema.
  select count(*) into n
    from pg_proc f join pg_namespace ns on ns.oid = f.pronamespace
   where ns.nspname = 'public'
     and f.proname in ('public_clinic_profile', 'public_booking_busy', 'public_book',
                       'public_booking_lookup', 'public_cancel_booking')
     and f.prosecdef
     and exists (select 1 from unnest(f.proconfig) c where c like 'search_path=%');
  if n <> 5 then raise exception 'FAIL: % of the five booking RPCs are not definer functions with a pinned search_path', n using errcode = 'P0002'; end if;

  select count(*) into n
    from pg_proc f join pg_namespace ns on ns.oid = f.pronamespace
   where ns.nspname = 'public'
     and f.proname in ('public_clinic_profile', 'public_booking_busy', 'public_book',
                       'public_booking_lookup', 'public_cancel_booking')
     and has_function_privilege('anon', f.oid, 'execute');
  if n <> 5 then raise exception 'FAIL: only % of the five booking RPCs are executable by anon', n using errcode = 'P0002'; end if;

  raise notice 'PASS: five definer functions with a pinned search_path, all callable by anon';

  raise notice 'ALL BOOKING CHECKS COMPLETED';
end $$;

rollback;   -- nothing above survives; safe to re-run


-- =============================================================================
-- SUITE D · NAMING RULES
-- =============================================================================
-- public.clinic_slug() is what a clinic name becomes in a URL, and it was the
-- source of the one syntax error that stopped schema 8 applying at all. It is a
-- pure function, so it can be pinned exactly.
begin;

do $$
declare
  got text;
begin
  got := public.clinic_slug('Sunrise Multispecialty OPD');
  if got <> 'sunrise-multispecialty-opd' then raise exception 'FAIL: clinic_slug lower/hyphenate gave %', got; end if;

  got := public.clinic_slug('  Sunrise Multispecialty OPD!  ');
  if got <> 'sunrise-multispecialty-opd' then raise exception 'FAIL: clinic_slug did not trim spaces and punctuation (%)', got; end if;

  got := public.clinic_slug('--Sharma   Clinic--');
  if got <> 'sharma-clinic' then raise exception 'FAIL: clinic_slug left a hyphen at an end (%)', got; end if;

  got := public.clinic_slug('डॉ. क्लिनिक');
  if got <> 'clinic' then raise exception 'FAIL: a name with no ASCII letters should fall back to clinic (%)', got; end if;

  got := public.clinic_slug('');
  if got <> 'clinic' then raise exception 'FAIL: an empty name should fall back to clinic (%)', got; end if;

  got := public.clinic_slug(null);
  if got <> 'clinic' then raise exception 'FAIL: a null name should fall back to clinic (%)', got; end if;

  if public.clinic_slug('A/B') = public.clinic_slug('A B') then
    raise notice 'PASS: punctuation and spaces collapse to the same URL';
  else
    raise exception 'FAIL: A/B and A B produced different slugs' using errcode = 'P0002';
  end if;

  raise notice 'PASS: clinic_slug is stable, trimmed, ASCII and never empty';
  raise notice 'ALL SLUG CHECKS COMPLETED';
end $$;

rollback;   -- nothing above survives; safe to re-run


-- =============================================================================
-- SUITE E · THE BOOKING LINK
-- =============================================================================
-- The link Settings hands out is `<host>/#/book/<slug>`, and everything after
-- the last slash is the only part the database sees. Schema 8 backfilled slugs
-- for the clinics that already existed but left `create_clinic()` alone, so
-- every clinic onboarded afterwards had `slug is null`: Settings displayed a
-- link built from a name-derived slug, and the patient who opened it got
-- "no clinic is published at this address". Schema 9 closes that loop. This
-- suite follows one link from provisioning to the public profile.
begin;

do $$
declare
  owner_x uuid := gen_random_uuid();
  desk_x  uuid := gen_random_uuid();
  clinic_a uuid;
  clinic_b uuid;
  clinic_c uuid;
  slug_a text;
  slug_b text;
  got text;
  profile jsonb;
  n integer;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (owner_x, 'owner-x@test.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (desk_x,  'desk-x@test.local',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_x, 'role', 'authenticated', 'email', 'owner-x@test.local')::text, true);
  set local role authenticated;

  -- ------------------------------------------------------------------ 1. the
  -- Signing up is the only thing a new clinic owner does before sharing a link.
  -- It has to mint the address there and then; nothing downstream can invent it.
  clinic_a := public.create_clinic(
    jsonb_build_object('name', 'Dr. Mehta Family Clinic'),
    jsonb_build_object('full_name', 'Dr Mehta'));
  reset role;

  select slug into slug_a from public.clinics where id = clinic_a;
  if slug_a is null or btrim(slug_a) = '' then
    raise exception 'FAIL: create_clinic left the new clinic with no slug, so its booking link goes nowhere' using errcode = 'P0002';
  end if;
  if slug_a <> 'dr-mehta-family-clinic' then
    raise exception 'FAIL: create_clinic minted % instead of dr-mehta-family-clinic', slug_a using errcode = 'P0002';
  end if;
  raise notice 'PASS: create_clinic gives a new clinic a slug (%)', slug_a;

  -- ------------------------------------------------------------------ 2. the
  -- Two clinics with the same name is a Tuesday, not an error. The second one
  -- gets its own address rather than a duplicate-key failure during onboarding.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_x, 'role', 'authenticated', 'email', 'owner-x@test.local')::text, true);
  set local role authenticated;
  clinic_b := public.create_clinic(
    jsonb_build_object('name', 'Dr. Mehta Family Clinic'),
    jsonb_build_object('full_name', 'Dr Mehta'));
  clinic_c := public.create_clinic(
    jsonb_build_object('name', '   '),
    jsonb_build_object('full_name', ''));
  reset role;

  select slug into slug_b from public.clinics where id = clinic_b;
  if slug_b = slug_a then
    raise exception 'FAIL: the second clinic with the same name took the first one''s address (%)', slug_b using errcode = 'P0002';
  end if;
  if slug_b <> 'dr-mehta-family-clinic-1' then
    raise exception 'FAIL: the collision produced % instead of dr-mehta-family-clinic-1', slug_b using errcode = 'P0002';
  end if;
  select slug into got from public.clinics where id = clinic_c;
  if got is null or btrim(got) = '' then
    raise exception 'FAIL: a clinic with a blank name got no slug' using errcode = 'P0002';
  end if;
  raise notice 'PASS: a name collision steps aside (% and %)', slug_a, slug_b;

  -- ------------------------------------------------------------------ 3. the
  -- The whole point: a stranger with the link, holding only the anon key, asks
  -- for the profile at the slug create_clinic minted and gets the clinic back.
  set local role anon;
  profile := public.public_clinic_profile(slug_b);
  reset role;

  if profile is null then
    raise exception 'FAIL: the slug from provisioning (%) returns no public profile', slug_b using errcode = 'P0002';
  end if;
  if profile->'clinic'->>'slug' is distinct from slug_b then
    raise exception 'FAIL: the public profile resolves to the wrong clinic (%). URL would show a different clinic', profile->'clinic'->>'slug' using errcode = 'P0002';
  end if;
  raise notice 'PASS: the provisioned slug resolves for an anon visitor';

  -- ------------------------------------------------------------------ 4. the
  -- What the owner types into "Booking address" is not a slug yet: it has
  -- spaces, capitals and punctuation, and possibly a name another clinic holds.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_x, 'role', 'authenticated', 'email', 'owner-x@test.local')::text, true);
  set local role authenticated;

  got := public.set_clinic_slug(clinic_a, '  Dr. Mehta ENT!  ');
  if got <> 'dr-mehta-ent' then
    raise exception 'FAIL: set_clinic_slug did not normalise what the owner typed (%)', got using errcode = 'P0002';
  end if;

  got := public.set_clinic_slug(clinic_a, 'dr-mehta-family-clinic-1');   -- held by clinic_b
  if got = 'dr-mehta-family-clinic-1' then
    raise exception 'FAIL: set_clinic_slug moved a clinic onto an address another clinic answers on' using errcode = 'P0002';
  end if;
  if got <> 'dr-mehta-family-clinic-1-1' then
    raise exception 'FAIL: an owner collision produced % instead of dr-mehta-family-clinic-1-1', got using errcode = 'P0002';
  end if;

  -- Clearing the field must not empty the address: fall back to the clinic name.
  got := public.set_clinic_slug(clinic_a, '   ');
  if got is null or btrim(got) = '' then
    raise exception 'FAIL: clearing the booking address left the clinic with no link' using errcode = 'P0002';
  end if;
  reset role;
  raise notice 'PASS: set_clinic_slug normalises, steps aside and never empties the address';

  -- ------------------------------------------------------------------ 5. the
  -- A front-desk colleague cannot repoint the clinic's public link, and neither
  -- can an anonymous visitor, no matter what they send.
  insert into public.staff (clinic_id, user_id, full_name, role)
    values (clinic_a, desk_x, 'Desk X', 'frontdesk');

  perform set_config('request.jwt.claims', json_build_object('sub', desk_x, 'role', 'authenticated', 'email', 'desk-x@test.local')::text, true);
  set local role authenticated;
  begin
    perform public.set_clinic_slug(clinic_a, 'hijacked');
    raise exception 'FAIL: front desk renamed the clinic''s public booking address' using errcode = 'P0002';
  exception when insufficient_privilege then
    raise notice 'PASS: only an owner can change the booking address';
  end;
  reset role;

  begin
    set local role anon;
    perform public.set_clinic_slug(clinic_a, 'hijacked');
    raise exception 'FAIL: anon could call set_clinic_slug' using errcode = 'P0002';
  exception
    when insufficient_privilege then
      raise notice 'PASS: anon cannot change a booking address';
    when undefined_function then
      raise notice 'PASS: anon cannot change a booking address';
  end;
  reset role;

  -- ------------------------------------------------------------------ 6. the
  -- Property, not an example: whatever the row holds has to be openable as a
  -- URL. A capital letter or a space here is a link that 404s for a patient.
  select count(*) into n from public.clinics
   where slug is not null and (slug !~ '^[a-z0-9][a-z0-9-]*$' or char_length(slug) > 40);
  if n <> 0 then
    raise exception 'FAIL: % clinic slug(s) cannot be put in a URL', n using errcode = 'P0002';
  end if;

  select count(*) into n from public.clinics where slug is null;
  if n <> 0 then
    raise exception 'FAIL: % clinic(s) have no booking address at all', n using errcode = 'P0002';
  end if;
  raise notice 'PASS: every clinic holds a URL-safe slug';

  raise notice 'ALL BOOKING LINK CHECKS COMPLETED';
end $$;

rollback;   -- nothing above survives; safe to re-run


-- =============================================================================
-- SUITE F · WHO READS WHAT
-- =============================================================================
-- The role table the product prints — doctor: consultations, no billing; front
-- desk: billing, no consultations — used to be a claim, not a rule: both policies
-- said "all three roles". Schema 10 splits them. This suite holds each half to it
-- through the API, as each member, including the two ways round it (raising an
-- invoice, marking one paid).
begin;

do $$
declare
  owner_c uuid := gen_random_uuid();
  doctor_c uuid := gen_random_uuid();
  desk_c uuid := gen_random_uuid();
  clinic uuid;
  patient uuid;
  doctor_staff uuid;
  other_clinic uuid;
  who uuid;
  n integer;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (owner_c,  'split-owner@test.local',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (doctor_c, 'split-doctor@test.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (desk_c,   'split-desk@test.local',   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into public.clinics (name) values ('Split Clinic') returning id into clinic;
  insert into public.staff (clinic_id, user_id, full_name, role) values (clinic, owner_c, 'Split Owner', 'owner');
  insert into public.staff (clinic_id, user_id, full_name, role, specialty)
    values (clinic, doctor_c, 'Dr Split', 'doctor', 'General Physician') returning id into doctor_staff;
  insert into public.staff (clinic_id, user_id, full_name, role) values (clinic, desk_c, 'Split Desk', 'frontdesk');
  insert into public.patients (clinic_id, code, full_name, phone)
    values (clinic, 'PT-00001', 'Split Patient', '9000000777') returning id into patient;

  insert into public.consultations (clinic_id, patient_id, doctor_id, visited_on, complaint)
    values (clinic, patient, doctor_staff, current_date, 'fever since Tuesday');
  insert into public.invoices (clinic_id, number, patient_id, total_paise, paid_paise, status)
    values (clinic, 'INV/2526/0001', patient, 50000, 0, 'unpaid');

  -- ------------------------------------------------------- 1. front desk
  -- Books, registers, bills — and cannot read a word of the consultation.
  perform set_config('request.jwt.claims', json_build_object('sub', desk_c, 'role', 'authenticated', 'email', 'split-desk@test.local')::text, true);
  set local role authenticated;

  select count(*) into n from public.consultations;
  if n <> 0 then
    raise exception 'FAIL: front desk read % consultation rows', n using errcode = 'P0002';
  end if;

  select count(*) into n from public.invoices where clinic_id = clinic;
  if n <> 1 then
    raise exception 'FAIL: front desk cannot see its own clinic''s bills (%)', n using errcode = 'P0002';
  end if;

  insert into public.invoices (clinic_id, number, patient_id, total_paise, paid_paise, status)
    values (clinic, 'INV/2526/0002', patient, 20000, 0, 'unpaid');
  raise notice 'PASS: front desk reads and raises bills, and reads no consultation note';
  reset role;

  -- ------------------------------------------------------- 2. the doctor
  -- Owns the chart — and cannot read, raise or settle a bill.
  perform set_config('request.jwt.claims', json_build_object('sub', doctor_c, 'role', 'authenticated', 'email', 'split-doctor@test.local')::text, true);
  set local role authenticated;

  select count(*) into n from public.consultations;
  if n <> 1 then
    raise exception 'FAIL: the doctor cannot read the consultation they wrote (%)', n using errcode = 'P0002';
  end if;

  select count(*) into n from public.invoices where clinic_id = clinic;
  if n <> 0 then
    raise exception 'FAIL: a doctor read % invoice rows', n using errcode = 'P0002';
  end if;

  begin
    insert into public.invoices (clinic_id, number, patient_id, total_paise, paid_paise, status)
      values (clinic, 'INV/2526/0003', patient, 10000, 0, 'unpaid');
    raise exception 'FAIL: a doctor raised an invoice' using errcode = 'P0002';
  exception when insufficient_privilege then
    raise notice 'PASS: a doctor cannot raise a bill';
  end;

  -- An update is not a way round the insert policy: the row is not visible, so
  -- nothing is touched. Checked from the owner's side a moment later.
  update public.invoices set paid_paise = total_paise, status = 'paid' where clinic_id = clinic;
  reset role;

  -- scoped to this suite's clinic: another clinic in the same database may well
  -- have paid invoices of its own, and they are none of this assertion's business
  select count(*) into n from public.invoices where clinic_id = clinic and status = 'paid';
  if n <> 0 then
    raise exception 'FAIL: a doctor marked % invoice(s) paid', n using errcode = 'P0002';
  end if;
  raise notice 'PASS: a doctor cannot settle a bill either';

  -- ------------------------------------------------------- 3. the owner
  -- Holds both halves of the clinic.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_c, 'role', 'authenticated', 'email', 'split-owner@test.local')::text, true);
  set local role authenticated;

  select count(*) into n from public.consultations;
  if n <> 1 then raise exception 'FAIL: the owner cannot read the chart (%)', n using errcode = 'P0002'; end if;
  select count(*) into n from public.invoices where clinic_id = clinic;
  if n <> 2 then raise exception 'FAIL: the owner cannot read both bills (%)', n using errcode = 'P0002'; end if;

  update public.invoices set paid_paise = 50000, status = 'paid'
   where clinic_id = clinic and number = 'INV/2526/0001';
  select count(*) into n from public.invoices where clinic_id = clinic and status = 'paid';
  if n <> 1 then raise exception 'FAIL: the owner could not settle a bill (%)', n using errcode = 'P0002'; end if;
  raise notice 'PASS: the owner holds both halves';
  reset role;

  -- ------------------------------------------------------- 4. the diary is shared
  -- The one record all three need: who is coming in. It must stay readable by
  -- every member, or the queue stops working for whoever is not in this suite.
  insert into public.appointments (clinic_id, patient_id, doctor_id, scheduled_on, scheduled_at)
    values (clinic, patient, doctor_staff, current_date, '11:15');

  foreach who in array array[owner_c, doctor_c, desk_c] loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.appointments where clinic_id = clinic;
    if n <> 1 then
      raise exception 'FAIL: a member of this clinic cannot see today''s diary (%)', n using errcode = 'P0002';
    end if;
    reset role;
  end loop;
  raise notice 'PASS: the diary is readable by owner, doctor and front desk alike';

  -- ------------------------------------------------------- 5. no self-promotion
  -- The split is only worth anything if a seat cannot move itself across it. The
  -- policies refuse the insert; staff_guard() refuses the update. Pinned here so
  -- the trigger cannot be dropped in a later migration without this failing.
  insert into public.clinics (name) values ('Split Clinic · other') returning id into other_clinic;

  perform set_config('request.jwt.claims', json_build_object('sub', desk_c, 'role', 'authenticated', 'email', 'split-desk@test.local')::text, true);
  set local role authenticated;

  begin
    update public.staff set role = 'owner' where user_id = desk_c;
    raise exception 'FAIL: a front-desk seat promoted itself to owner' using errcode = 'P0002';
  exception when insufficient_privilege then
    raise notice 'PASS: a seat cannot promote itself';
  end;

  begin
    insert into public.staff (clinic_id, user_id, full_name, role)
      values (other_clinic, desk_c, 'Split Desk elsewhere', 'owner');
    raise exception 'FAIL: a seat joined a second clinic as its owner' using errcode = 'P0002';
  exception when insufficient_privilege then
    raise notice 'PASS: a seat cannot join another clinic';
  end;

  begin
    insert into public.staff (clinic_id, user_id, full_name, role)
      values (clinic, desk_c, 'Split Desk, second seat', 'doctor');
    raise exception 'FAIL: a seat enrolled itself a second time' using errcode = 'P0002';
  exception when insufficient_privilege then
    raise notice 'PASS: a seat cannot enrol itself';
  end;
  reset role;

  select count(*) into n from public.staff where clinic_id = clinic;
  if n <> 3 then
    raise exception 'FAIL: the clinic ended with % staff rows instead of 3', n using errcode = 'P0002';
  end if;
  select count(*) into n from public.staff where clinic_id = clinic and role = 'owner';
  if n <> 1 then
    raise exception 'FAIL: the clinic has % owners', n using errcode = 'P0002';
  end if;

  raise notice 'ALL ROLE SPLIT CHECKS COMPLETED';
end $$;

rollback;   -- nothing above survives; safe to re-run


-- =============================================================================
-- SUITE G · WHATSAPP CONSENT AND THE MESSAGE LOG
-- =============================================================================
-- The clinic messages patients by hand today. Schema 11 makes "do not message
-- me" a column the composer can refuse on, and widens the send log so the token,
-- the bill and the slip are recorded in the same trail as the reminder. This
-- suite holds the database to both halves: the default is opted-in (no patient
-- silently loses their reminders), an opt-out survives a round trip, and the log
-- takes the three new kinds while still refusing a kind it does not know.
begin;

do $$
declare
  owner_g uuid := gen_random_uuid();
  desk_g  uuid := gen_random_uuid();
  clinic uuid;
  patient uuid;
  n integer;
  flag boolean;
  stamp timestamptz;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (owner_g, 'wa-owner@test.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (desk_g,  'wa-desk@test.local',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into public.clinics (name) values ('WhatsApp Clinic') returning id into clinic;
  insert into public.staff (clinic_id, user_id, full_name, role) values (clinic, owner_g, 'WA Owner', 'owner');
  insert into public.staff (clinic_id, user_id, full_name, role) values (clinic, desk_g, 'WA Desk', 'frontdesk');

  -- ------------------------------------------------- 1. opted in by default
  insert into public.patients (clinic_id, code, full_name, phone)
    values (clinic, 'WA-00001', 'Default Patient', '9000000222') returning id into patient;

  select wa_opt_in into flag from public.patients where id = patient;
  if flag is not true then
    raise exception 'FAIL: a new patient is not messaged by default (%)', flag using errcode = 'P0002';
  end if;
  raise notice 'PASS: a patient is opted in until they say otherwise';

  -- ------------------------------------------------------- 2. the opt-out
  -- The front desk is the seat that answers the phone, so it is the seat that
  -- records the request. It must land, and it must stay landed.
  perform set_config('request.jwt.claims', json_build_object('sub', desk_g, 'role', 'authenticated', 'email', 'wa-desk@test.local')::text, true);
  set local role authenticated;

  update public.patients
     set wa_opt_in = false, wa_opt_out_at = now()
   where id = patient;

  select wa_opt_in, wa_opt_out_at into flag, stamp from public.patients where id = patient;
  if flag is not false or stamp is null then
    raise exception 'FAIL: the opt-out did not stick (%)', flag using errcode = 'P0002';
  end if;
  raise notice 'PASS: the front desk records an opt-out and it sticks';

  -- ----------------------------------------------------- 3. the send log
  -- Token, bill and slip are the three messages the desk now sends; the log
  -- takes them all, with the channel and the status the composer writes.
  insert into public.reminders (clinic_id, patient_id, draft_key, kind, channel, status, body, logged_on)
  values
    (clinic, patient, 'token:appt-1',        'token',        'whatsapp', 'opened', 'Your token today is T-14.', current_date),
    (clinic, patient, 'invoice:inv-1',       'invoice',      'whatsapp', 'sent',   'Bill INV/2526/0001 - balance 500.00', current_date),
    (clinic, patient, 'prescription:visit-1','prescription', 'copy',     'copied', 'Take one tablet twice a day.', current_date);

  select count(*) into n from public.reminders where patient_id = patient;
  if n <> 3 then
    raise exception 'FAIL: the log took % of the 3 message kinds', n using errcode = 'P0002';
  end if;
  raise notice 'PASS: the log records a token, a bill and a slip';
  reset role;

  -- --------------------------------------------- 4. a kind it does not know
  begin
    insert into public.reminders (clinic_id, patient_id, draft_key, kind, status, body)
      values (clinic, patient, 'telegram:1', 'telegram', 'sent', 'nope');
    raise exception 'FAIL: the log accepted an unknown kind' using errcode = 'P0002';
  exception when check_violation then
    raise notice 'PASS: the log refuses a message kind it does not know';
  end;

  -- ------------------------------------- 5. a message body stays printable
  begin
    insert into public.reminders (clinic_id, patient_id, draft_key, kind, status, body)
      values (clinic, patient, 'token:appt-2', 'token', 'sent', repeat('x', 1201));
    raise exception 'FAIL: the log accepted a 1201-character body' using errcode = 'P0002';
  exception when check_violation then
    raise notice 'PASS: a message body is capped at 1200 characters';
  end;

  raise notice 'ALL WHATSAPP CHECKS COMPLETED';
end $$;

rollback;   -- nothing above survives; safe to re-run

-- =============================================================================
-- SUITE H · TWO SESSIONS A DAY, DAYS OFF, AND THE 3–45 DAY FOLLOW-UP
-- =============================================================================
-- Schema 12 splits the clinic day into at most two sessions and gives the clinic
-- and every doctor their own days off. This suite holds the database to the
-- three things that could quietly break a clinic:
--   1. a second session is stored, read back, and offered to the public page;
--   2. the break between sessions is *not* bookable, and a closed day refuses
--      every booking on it — the page and the API must agree;
--   3. a doctor's hours cannot sit outside the clinic's, and follow-up validity
--      is clamped to 3–45 days rather than 0–180.
begin;

do $$
declare
  owner_h uuid := gen_random_uuid();
  clinic uuid;
  doc uuid;
  pat uuid;
  c public.clinics;
  j jsonb;
  workday date;
  i integer;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values (owner_h, 'hours-owner@test.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into public.clinics (name, slug, booking_enabled)
    values ('Hours Clinic', 'hours-clinic', true)
    returning * into c;
  clinic := c.id;

  insert into public.staff (clinic_id, user_id, full_name, role)
    values (clinic, owner_h, 'Hours Owner', 'owner') returning id into doc;

  -- ------------------------------------------------ 1. two sessions land
  update public.clinics
     set sessions = '[{"start":"09:00","end":"13:00"},{"start":"18:00","end":"22:00"}]'::jsonb,
         closed_weekdays = array[0]::smallint[],
         closed_dates = array[current_date + 3]::date[]
   where id = clinic;

  select * into c from public.clinics where id = clinic;
  if jsonb_array_length(c.sessions) <> 2 then
    raise exception 'FAIL: two sessions did not survive the write' using errcode = 'P0002';
  end if;
  if public.sessions_or(c.sessions, c.open_time, c.close_time) <> c.sessions then
    raise exception 'FAIL: sessions_or rewrote a clinic that already has sessions' using errcode = 'P0002';
  end if;
  raise notice 'PASS: a clinic keeps two sessions a day';

  -- ------------------------------------------- 2. the shape is enforced
  begin
    update public.clinics set sessions = '[{"start":"09:00","end":"12:00"},{"start":"10:00","end":"13:00"}]'::jsonb where id = clinic;
    raise exception 'FAIL: overlapping sessions were accepted' using errcode = 'P0002';
  exception when check_violation then
    raise notice 'PASS: overlapping sessions are refused';
  end;

  begin
    update public.clinics set sessions = '[{"start":"09:00","end":"11:00"},{"start":"12:00","end":"14:00"},{"start":"15:00","end":"17:00"}]'::jsonb where id = clinic;
    raise exception 'FAIL: a third session was accepted' using errcode = 'P0002';
  exception when check_violation then
    raise notice 'PASS: a third session is refused — two is the maximum';
  end;

  begin
    update public.clinics set sessions = '[{"start":"18:00","end":"09:00"}]'::jsonb where id = clinic;
    raise exception 'FAIL: a session that ends before it starts was accepted' using errcode = 'P0002';
  exception when check_violation then
    raise notice 'PASS: a backwards session is refused';
  end;

  -- ------------------------------------ 3. legacy rows still answer hours
  -- A clinic created before schema 12 has no sessions; the old pair is the day.
  insert into public.clinics (name, slug, open_time, close_time)
    values ('Legacy Hours', 'legacy-hours', '10:00', '16:00') returning * into c;
  j := public.sessions_or(c.sessions, c.open_time, c.close_time);
  if j->0->>'start' <> '10:00' or j->0->>'end' <> '16:00' then
    raise exception 'FAIL: a clinic with only open/close answered %', j using errcode = 'P0002';
  end if;
  raise notice 'PASS: a clinic saved before schema 12 still answers its hours';

  -- ---------------------------------- 4. a doctor cannot sit outside them
  select * into c from public.clinics where id = clinic;
  update public.staff
     set sessions = '[{"start":"09:00","end":"11:00"}]'::jsonb
   where id = doc;
  raise notice 'PASS: a doctor sits inside the clinic''s first session';

  begin
    update public.staff
       set sessions = '[{"start":"14:00","end":"16:00"}]'::jsonb
     where id = doc;
    raise exception 'FAIL: a doctor was given hours in the clinic''s break' using errcode = 'P0002';
  exception when others then
    if position('staff:hours' in sqlerrm) = 0 then raise; end if;
    raise notice 'PASS: hours in the clinic''s break are refused';
  end;

  update public.staff set sessions = '[{"start":"18:00","end":"21:00"}]'::jsonb where id = doc;
  raise notice 'PASS: the evening doctor may sit only in the evening session';

  -- --------------------------------------- 5. the follow-up window is 3–45
  begin
    update public.clinics set follow_up_days = 0 where id = clinic;
    raise exception 'FAIL: a 0-day follow-up was accepted' using errcode = 'P0002';
  exception when check_violation then
    raise notice 'PASS: follow-up validity below 3 days is refused';
  end;

  begin
    update public.clinics set follow_up_days = 46 where id = clinic;
    raise exception 'FAIL: a 46-day follow-up was accepted' using errcode = 'P0002';
  exception when check_violation then
    raise notice 'PASS: follow-up validity above 45 days is refused';
  end;

  update public.clinics set follow_up_days = 45 where id = clinic;
  update public.clinics set follow_up_days = 3 where id = clinic;
  raise notice 'PASS: 3 and 45 days are both accepted';

  -- ------------------------ 6. the account preference the app has been sending
  insert into public.profiles (id, full_name) values (owner_h, 'Hours Owner')
    on conflict (id) do nothing;
  begin
    update public.profiles set send_review_request = false where id = owner_h;
  exception when undefined_column then
    raise exception 'FAIL: profiles has no send_review_request column — the account screen cannot save' using errcode = 'P0002';
  end;
  raise notice 'PASS: profiles carries send_review_request (the account save bug''s other half)';

  -- ------------------------------------- 7. what the public page is told
  j := public.public_clinic_profile('hours-clinic');
  if jsonb_array_length(j->'clinic'->'sessions') <> 2 then
    raise exception 'FAIL: the public page was not given both sessions' using errcode = 'P0002';
  end if;
  if jsonb_array_length(j->'clinic'->'closed_weekdays') <> 1 then
    raise exception 'FAIL: the public page was not given the closed weekdays' using errcode = 'P0002';
  end if;
  if jsonb_array_length(j->'doctors'->0->'sessions') <> 1 then
    raise exception 'FAIL: the public page was not given the doctor''s sessions' using errcode = 'P0002';
  end if;
  raise notice 'PASS: the public profile carries both sessions and the days off';

  -- A day the clinic is genuinely open: not the closed weekday, not the holiday,
  -- and never a date in the past.
  workday := null;
  for i in 1 .. 9 loop
    if extract(dow from (current_date + i))::int <> 0 and (current_date + i) <> (current_date + 3) then
      workday := current_date + i;
      exit;
    end if;
  end loop;
  if workday is null then
    raise exception 'FAIL: no open day found to book on' using errcode = 'P0002';
  end if;

  -- ------------------------------------------- 8. closed days refuse booking
  -- A Friday (or whichever weekday is closed) must refuse outright.
  reset role;
  begin
    perform public.public_book('hours-clinic', doc, current_date + (7 - extract(dow from current_date)::int) % 7,
                               '18:00', 'Sunday Patient', '9000000333', '');
    raise exception 'FAIL: a booking landed on a closed weekday' using errcode = 'P0002';
  exception when others then
    if position('booking:dayoff' in sqlerrm) = 0 then raise; end if;
    raise notice 'PASS: a closed weekday refuses every booking';
  end;

  begin
    perform public.public_book('hours-clinic', doc, current_date + 3, '18:00', 'Holiday Patient', '9000000334', '');
    raise exception 'FAIL: a booking landed on a clinic holiday' using errcode = 'P0002';
  exception when others then
    if position('booking:dayoff' in sqlerrm) = 0 then raise; end if;
    raise notice 'PASS: a one-off holiday refuses every booking';
  end;

  -- ------------------------------- 9. the break between sessions is shut
  begin
    perform public.public_book('hours-clinic', doc, workday, '15:00', 'Break Patient', '9000000335', '');
    raise exception 'FAIL: a booking was taken in the clinic''s break' using errcode = 'P0002';
  exception when others then
    if position('booking:slot' in sqlerrm) = 0 then raise; end if;
    raise notice 'PASS: the break between the two sessions is not bookable';
  end;

  -- ------------------------------------- 10. a doctor''s own leave closes their day
  update public.staff set closed_weekdays = array[extract(dow from workday)::smallint] where id = doc;
  begin
    perform public.public_book('hours-clinic', doc, workday, '18:00', 'Leave Patient', '9000000336', '');
    raise exception 'FAIL: a booking landed on the doctor''s day off' using errcode = 'P0002';
  exception when others then
    if position('booking:leave' in sqlerrm) = 0 then raise; end if;
    raise notice 'PASS: a doctor''s own day off refuses the booking';
  end;

  -- ------------------------- 11. and an open evening still books normally
  update public.staff set closed_weekdays = '{}'::smallint[] where id = doc;
  j := public.public_book('hours-clinic', doc, workday, '18:00', 'Evening Patient', '9000000337', '');
  if j->>'at' <> '18:00' then
    raise exception 'FAIL: the evening session did not book (%)', j using errcode = 'P0002';
  end if;
  raise notice 'PASS: a slot inside the evening session books';

  raise notice 'ALL HOURS CHECKS COMPLETED';
end $$;

rollback;   -- nothing above survives; safe to re-run

-- =============================================================================
-- SUITE I · THE ACCOUNT'S OWN PROFILE ROW
-- =============================================================================
-- The account screen writes to `public.profiles`, keyed by the auth user's id.
-- An account created before `handle_new_user()` existed had no row, and the app
-- reported its own save as "this record was deleted at the clinic" — a conflict
-- about a row nobody had ever written. Schema 13 backfills the row and the client
-- creates it on sign-in; this suite holds both halves: a user may insert their own
-- row (that is what the self-heal does), may not insert anybody else's, and the
-- columns the screen sends all exist.
begin;

do $$
declare
  owner_i uuid := gen_random_uuid();
  other_i uuid := gen_random_uuid();
  n integer;
  row_full_name text;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (owner_i, 'profile-owner@test.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{"full_name":"Dr Signed Up"}'::jsonb, 'authenticated', 'authenticated'),
    (other_i, 'profile-other@test.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  -- ------------------------------------- 1. sign-up writes the row (trigger)
  select full_name into row_full_name from public.profiles where id = owner_i;
  if row_full_name is distinct from 'Dr Signed Up' then
    raise exception 'FAIL: sign-up did not create a profile row (%)', row_full_name using errcode = 'P0002';
  end if;
  raise notice 'PASS: signing up writes a profile row';

  -- ------------------------- 2. the backfill shape: a missing row is created
  -- Stand in for an account that predates the trigger: remove the row, then run
  -- exactly what schema 13 runs.
  delete from public.profiles where id = other_i;
  insert into public.profiles (id, full_name)
  select u.id, left(coalesce(u.raw_user_meta_data->>'full_name', ''), 80)
    from auth.users u
   where not exists (select 1 from public.profiles p where p.id = u.id)
  on conflict (id) do nothing;

  select count(*) into n from public.profiles where id = other_i;
  if n <> 1 then
    raise exception 'FAIL: the backfill left an account without a profile row' using errcode = 'P0002';
  end if;
  raise notice 'PASS: the backfill gives every existing account a row';

  -- ------------------- 3. the client self-heal: insert your own row, once more
  perform set_config('request.jwt.claims', json_build_object('sub', other_i, 'role', 'authenticated', 'email', 'profile-other@test.local')::text, true);
  set local role authenticated;

  insert into public.profiles (id, full_name) values (other_i, 'Second Try')
    on conflict (id) do nothing;
  select count(*) into n from public.profiles where id = other_i;
  if n <> 1 then
    raise exception 'FAIL: the self-heal left % rows for one account', n using errcode = 'P0002';
  end if;
  raise notice 'PASS: an account can write its own profile row, idempotently';

  -- ------------------------------------------ 4. and cannot write anyone else's
  begin
    insert into public.profiles (id, full_name) values (owner_i, 'Not Mine');
    raise exception 'FAIL: a user wrote another account''s profile' using errcode = 'P0002';
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS: a user cannot write another account''s profile row';
  end;

  reset role;

  -- ------------- 5. the account screen's save lands, columns and all
  perform set_config('request.jwt.claims', json_build_object('sub', other_i, 'role', 'authenticated', 'email', 'profile-other@test.local')::text, true);
  set local role authenticated;
  update public.profiles
     set full_name = 'Dr Live Save', phone = '9820000000', designation = 'MBBS',
         theme = 'dark', density = 'compact', reminders_enabled = true,
         reminder_lead_hours = 24, send_review_request = true, quiet_hours = '21:00-08:00'
   where id = other_i;
  reset role;

  select full_name into row_full_name from public.profiles where id = other_i;
  if row_full_name is distinct from 'Dr Live Save' then
    raise exception 'FAIL: the account save did not land (%)', row_full_name using errcode = 'P0002';
  end if;
  raise notice 'PASS: the whole account payload saves to profiles';

  raise notice 'ALL PROFILE CHECKS COMPLETED';
end $$;

-- =============================================================================
-- SUITE J · THE DRUG DIRECTORY (schema 14)
-- =============================================================================
-- The prescription field asks the database one question — "which brands look
-- like what I typed?" — and the answer decides what a doctor sees while a patient
-- is in the chair. This suite holds the four things that make that safe:
--
--   1. the starter formulary is actually there, so the field is useful on day one;
--   2. ranking puts the obvious brand first (prefix, then typo, then molecule);
--   3. the guards hold — a one-letter term returns nothing, the limit is clamped,
--      and a null term is not an error;
--   4. it is read-only reference data: a signed-in seat may read it and nobody may
--      write to it from the app, and the function is not SECURITY DEFINER.
begin;

do $$
declare
  n integer;
  top_brand text;
  top_form text;
  has_trgm boolean := exists (select 1 from pg_extension where extname = 'pg_trgm');
  definer boolean;
  denied boolean := false;
begin
  -- ------------------------------------------------- 1. the table and the rows
  select count(*) into n from public.medicines;
  if n < 50 then
    raise exception 'FAIL: the drug directory was seeded with only % rows', n using errcode = 'P0002';
  end if;
  raise notice 'PASS: the directory carries the starter formulary (% brands)', n;

  if not has_trgm then
    raise notice 'SKIP: pg_trgm is not installed in this scratch database - fuzzy ranking not asserted';
  else
    select count(*) into n from pg_indexes where tablename = 'medicines' and indexname = 'medicines_brand_gin';
    if n <> 1 then
      raise exception 'FAIL: no GIN trigram index on medicines.brand_name' using errcode = 'P0002';
    end if;
    raise notice 'PASS: the brand name is indexed with gin_trgm_ops';
  end if;

  -- ------------------------------------------------ 2. the obvious brand wins
  select brand_name into top_brand from public.search_medicine_brands('dolo') limit 1;
  if top_brand is distinct from 'Dolo 650' then
    raise exception 'FAIL: searching "dolo" ranked % first', coalesce(top_brand, 'nothing') using errcode = 'P0002';
  end if;
  raise notice 'PASS: a brand prefix ranks its own brand first';

  select brand_name into top_brand from public.search_medicine_brands('Augmentin') limit 1;
  if top_brand is distinct from 'Augmentin 625' then
    raise exception 'FAIL: searching "Augmentin" ranked % first', coalesce(top_brand, 'nothing') using errcode = 'P0002';
  end if;
  raise notice 'PASS: an exact brand name is found and ranked first';

  if has_trgm then
    select brand_name into top_brand from public.search_medicine_brands('augmentn') limit 1;
    if top_brand is distinct from 'Augmentin 625' then
      raise exception 'FAIL: the typo "augmentn" ranked % first', coalesce(top_brand, 'nothing') using errcode = 'P0002';
    end if;
    raise notice 'PASS: a missing letter still finds the brand (augmentn -> Augmentin 625)';

    select brand_name into top_brand from public.search_medicine_brands('amoxycillin') limit 1;
    if top_brand is null then
      raise exception 'FAIL: the misspelled molecule "amoxycillin" found nothing' using errcode = 'P0002';
    end if;
    raise notice 'PASS: a misspelled molecule is matched to a brand (%)', top_brand;
  end if;

  -- --------------------------------------------- 3. the molecule is searchable
  select brand_name, form into top_brand, top_form
    from public.search_medicine_brands('pantoprazole') limit 1;
  if top_brand is null then
    raise exception 'FAIL: searching a molecule found no brand' using errcode = 'P0002';
  end if;
  if top_form is null then
    raise exception 'FAIL: % came back without a form', top_brand using errcode = 'P0002';
  end if;
  raise notice 'PASS: a composition finds its brands, with the form attached (%)', top_brand;

  -- the composition travels with the row, which is the whole point
  select count(*) into n
    from public.search_medicine_brands('paracetamol')
   where composition ilike '%paracetamol%';
  if n <> (select count(*) from public.search_medicine_brands('paracetamol')) then
    raise exception 'FAIL: a paracetamol search returned rows without the molecule' using errcode = 'P0002';
  end if;
  raise notice 'PASS: every row carries its composition back to the client';

  -- multi-word, the way a clinic says it
  select brand_name into top_brand from public.search_medicine_brands('augmentin 625') limit 1;
  if top_brand is distinct from 'Augmentin 625' then
    raise exception 'FAIL: "augmentin 625" ranked % first', coalesce(top_brand, 'nothing') using errcode = 'P0002';
  end if;
  raise notice 'PASS: a multi-word term keeps its words together';

  -- ------------------------------------------------------------ 4. the guards
  select count(*) into n from public.search_medicine_brands('a');
  if n <> 0 then
    raise exception 'FAIL: a one-letter term returned % rows', n using errcode = 'P0002';
  end if;
  select count(*) into n from public.search_medicine_brands(null);
  if n <> 0 then
    raise exception 'FAIL: a null term returned % rows', n using errcode = 'P0002';
  end if;
  select count(*) into n from public.search_medicine_brands('   ');
  if n <> 0 then
    raise exception 'FAIL: a blank term returned % rows', n using errcode = 'P0002';
  end if;
  raise notice 'PASS: shorter than two characters returns nothing, and never an error';

  select count(*) into n from public.search_medicine_brands('para', 1000);
  if n > 25 then
    raise exception 'FAIL: the limit was not clamped (% rows)', n using errcode = 'P0002';
  end if;
  -- A limit of zero is clamped up to one: an empty dropdown for a valid term
  -- would look like "this drug is not in the directory".
  select count(*) into n from public.search_medicine_brands('para', 0);
  if n <> 1 then
    raise exception 'FAIL: a zero limit returned % rows, expected exactly 1', n using errcode = 'P0002';
  end if;
  raise notice 'PASS: the row limit is clamped to 1..25';

  -- ------------------------------------- 5. read-only, and not definer-rights
  select prosecdef into definer
    from pg_proc where proname = 'search_medicine_brands'
   group by prosecdef limit 1;
  if definer then
    raise exception 'FAIL: search_medicine_brands is SECURITY DEFINER' using errcode = 'P0002';
  end if;
  raise notice 'PASS: the search function obeys RLS (invoker, not definer)';

  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.medicines;
  if n < 50 then
    raise exception 'FAIL: a signed-in seat cannot read the directory (% rows)', n using errcode = 'P0002';
  end if;
  raise notice 'PASS: a signed-in seat can read the directory';

  begin
    insert into public.medicines (brand_name, composition) values ('Fake Brand', 'Nothing');
    raise exception 'FAIL: a signed-in seat could write to the drug directory' using errcode = 'P0002';
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then
    raise exception 'FAIL: the directory write was not refused' using errcode = 'P0002';
  end if;
  raise notice 'PASS: nobody signed in can add or edit a directory row';

  reset role;

  -- anon is the one role that never signs in, and it gets nothing
  set local role anon;
  begin
    perform public.search_medicine_brands('dolo');
    raise exception 'FAIL: anon could call the drug search' using errcode = 'P0002';
  exception when insufficient_privilege then
    raise notice 'PASS: anon cannot call the drug search';
  end;
  reset role;

  -- ------------------------------------- 6. re-running the seed is idempotent
  insert into public.medicines (brand_name, composition, form, strength)
  values ('Dolo 650', 'Paracetamol', 'Tablet', '650 mg')
  on conflict do nothing;
  select count(*) into n from public.medicines where lower(brand_name) = 'dolo 650';
  if n <> 1 then
    raise exception 'FAIL: the identity index let a duplicate brand in (% rows)', n using errcode = 'P0002';
  end if;
  raise notice 'PASS: the seed is idempotent - one row per brand, strength and form';

  raise notice 'ALL DRUG DIRECTORY CHECKS COMPLETED';
end $$;

rollback;   -- nothing above survives; safe to re-run

-- =============================================================================
-- SUITE K · DRUG SEARCH AT DIRECTORY SCALE (schema 15)
-- =============================================================================
-- Schema 14's search was correct on 59 rows and half a second per keystroke on
-- 242,000. This suite holds the two things migration 15 bought:
--
--   1. the candidates come from indexes, not from scoring the whole table;
--   2. a one-keystroke typo beats a two-keystroke lookalike, which is the
--      difference between dispensing Augmentin and dispensing Augmentox.
begin;

do $$
declare
  n integer;
  top_brand text;
  top_score real;
  second text;
  has_trgm boolean := exists (select 1 from pg_extension where extname = 'pg_trgm');
  plan text;
begin
  -- ------------------------------------------- 1. the scale machinery is there
  if has_trgm then
    select count(*) into n from pg_indexes
     where tablename = 'medicines' and indexname in ('medicines_brand_gin', 'medicines_brandword_gin', 'medicines_molecule_gin');
    if n <> 3 then
      raise exception 'FAIL: expected 3 GIN trigram indexes on medicines, found %', n using errcode = 'P0002';
    end if;
    raise notice 'PASS: brand, brand word and molecule are each trigram-indexed (GIN)';

    select count(*) into n from pg_indexes
     where tablename = 'medicines' and indexname in ('medicines_brand_trgm', 'medicines_composition_trgm');
    if n <> 0 then
      raise exception 'FAIL: the schema 14 GiST indexes are still present' using errcode = 'P0002';
    end if;
    raise notice 'PASS: the superseded GiST indexes were dropped, not left to rot';

    -- a lower() index is what a lower() query can actually use
    select count(*) into n from pg_indexes
     where tablename = 'medicines' and indexdef like '%gin_trgm_ops%' and indexdef like '%lower(%';
    if n < 2 then
      raise exception 'FAIL: no trigram index is on the lowercased column' using errcode = 'P0002';
    end if;
    raise notice 'PASS: the trigram indexes are on lower(), the form the query uses';
  else
    raise notice 'SKIP: pg_trgm is not installed - index and tie-break checks not asserted';
  end if;

  -- --------------------------------------------- 2. edit distance does its job
  if public.drug_edit_distance('augmentn', 'augmentin') <> 1 then
    raise exception 'FAIL: "augmentn" to "augmentin" is not 1 keystroke' using errcode = 'P0002';
  end if;
  if public.drug_edit_distance('augmentn', 'augmentox') <> 2 then
    raise exception 'FAIL: "augmentn" to "augmentox" is not 2 keystrokes' using errcode = 'P0002';
  end if;
  if public.drug_edit_distance('amoxycillin', 'amoxicillin') <> 1 then
    raise exception 'FAIL: the y/ i spelling of amoxicillin is not 1 keystroke' using errcode = 'P0002';
  end if;
  if public.drug_edit_distance('dolo', 'dolo') <> 0 then
    raise exception 'FAIL: a word is not distance 0 from itself' using errcode = 'P0002';
  end if;
  -- capped, so a nonsense term does not cost a matrix
  if public.drug_edit_distance('zzzzzzzz', 'paracetamol', 2) <> 3 then
    raise exception 'FAIL: the distance cap did not hold' using errcode = 'P0002';
  end if;
  raise notice 'PASS: drug_edit_distance() counts keystrokes and stops at the cap';

  -- ------------------------- 3. a lookalike brand cannot outrank the real one
  -- The case that started this: on 242,000 imported brands, "Augmentox" beat
  -- "Augmentin 625" for the term "augmentn" because both share seven trigrams
  -- and the shorter name won the tie.
  insert into public.medicines (brand_name, composition, form, strength, source)
  values ('Augmentox 625', 'Amoxicillin', 'Tablet', '625 mg', 'import')
  on conflict do nothing;

  select brand_name, score into top_brand, top_score
    from public.search_medicine_brands('augmentn') limit 1;
  if top_brand is distinct from 'Augmentin 625' then
    raise exception 'FAIL: the typo "augmentn" ranked % first, with a lookalike present', coalesce(top_brand, 'nothing') using errcode = 'P0002';
  end if;
  raise notice 'PASS: a one-keystroke typo beats a two-keystroke lookalike (%)', round(top_score::numeric, 3);

  -- and the lookalike is still reachable: it is a real drug, not noise
  select count(*) into n from public.search_medicine_brands('augmentn') where brand_name = 'Augmentox 625';
  if n <> 1 then
    raise exception 'FAIL: the lookalike disappeared from the suggestions entirely' using errcode = 'P0002';
  end if;
  raise notice 'PASS: the lookalike is ranked below, not hidden';

  -- ----------------------------------------- 4. a short term does not fuzz
  -- Two letters cannot be a typo of anything, and fuzzing them used to surface
  -- "Zerodol-P" for "pan" (the "P" scored as a near-miss of "pan").
  select count(*) into n from public.search_medicine_brands('pa');
  if n = 0 then
    raise exception 'FAIL: a two-letter prefix found no brand at all' using errcode = 'P0002';
  end if;
  select count(*) into n from public.search_medicine_brands('pan') where brand_name ilike '%zerodol%';
  if n <> 0 then
    raise exception 'FAIL: "pan" matched a brand only through a one-letter word' using errcode = 'P0002';
  end if;
  raise notice 'PASS: short terms stay on the prefix path instead of fuzzing';

  -- ------------------------------- 5. the planner uses an index, not a scan
  -- The whole point of migration 15: a term with trigrams in it is answered by
  -- the index. If this ever regresses to a sequential scan, the search is back
  -- to scoring every row in the table, which is the half-second the migration
  -- was written to remove.
  -- On a 59-row table the planner is right to scan: the check only means
  -- something once the directory is big enough for the choice to matter.
  if has_trgm and (select count(*) from public.medicines) >= 5000 then
    n := 0;
    for plan in execute 'explain (format text) select id from public.medicines where lower(brand_name) like ''%augmentn%'''
    loop
      if plan ilike '%seq scan on medicines%' then n := n + 1; end if;
    end loop;
    if n > 0 then
      raise exception 'FAIL: a trigram-searchable term fell back to a sequential scan' using errcode = 'P0002';
    end if;
    raise notice 'PASS: a trigram-searchable term is answered from an index';
  else
    raise notice 'SKIP: the planner check runs at directory scale (this scratch database has % rows)', (select count(*) from public.medicines);
  end if;

  -- ------------------------------------------ 6. the guards still hold
  select count(*) into n from public.search_medicine_brands('a');
  if n <> 0 then
    raise exception 'FAIL: a one-letter term returned % rows', n using errcode = 'P0002';
  end if;
  select count(*) into n from public.search_medicine_brands(null);
  if n <> 0 then
    raise exception 'FAIL: a null term returned % rows', n using errcode = 'P0002';
  end if;
  select count(*) into n from public.search_medicine_brands('para', 0);
  if n <> 1 then
    raise exception 'FAIL: a zero limit returned % rows, expected exactly 1', n using errcode = 'P0002';
  end if;
  select count(*) into n from public.search_medicine_brands('para', 1000);
  if n > 25 then
    raise exception 'FAIL: the limit was not clamped (% rows)', n using errcode = 'P0002';
  end if;
  raise notice 'PASS: the schema 14 guards survived the rewrite';

  -- ------------------------- 5b. a half-typed molecule is a prefix, not a typo
  -- "para" is 0.25 similar to "paracetamol" — under every fuzzy threshold — so
  -- this only works because the prefix branch and its index exist.
  select count(*) into n from public.search_medicine_brands('para');
  if n = 0 then
    raise exception 'FAIL: the half-typed molecule "para" found nothing' using errcode = 'P0002';
  end if;
  select count(*) into n from public.search_medicine_brands('amox');
  if n = 0 then
    raise exception 'FAIL: the half-typed molecule "amox" found nothing' using errcode = 'P0002';
  end if;
  raise notice 'PASS: a half-typed molecule still finds its brands';

  -- a wrong first hit and a correct one must not score the same
  select brand_name into second from public.search_medicine_brands('augmentn') offset 1 limit 1;
  if second is not distinct from top_brand then
    raise exception 'FAIL: the search returned the same brand twice' using errcode = 'P0002';
  end if;

  raise notice 'ALL DRUG SEARCH SCALE CHECKS COMPLETED';
end $$;

rollback;   -- nothing above survives; safe to re-run

-- =============================================================================
-- SUITE L · INVESTIGATIONS ADVISED (schema 16)
-- =============================================================================
-- A prescription in India is read against a format, and the one thing the app
-- stored nowhere was the tests the doctor wants done next. This suite holds the
-- column that fixes it: it exists, it defaults to an empty list (so an old row
-- and an old client both keep working), it round-trips, and it refuses a pasted
-- lab report without refusing a normal list.
begin;

do $$
declare
  owner_l uuid := gen_random_uuid();
  clinic uuid;
  doctor_staff uuid;
  patient uuid;
  visit uuid;
  tests text[];
  n integer;
  refused boolean := false;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values (owner_l, 'inv-owner@test.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_l, 'role', 'authenticated', 'email', 'inv-owner@test.local')::text, true);
  set local role authenticated;

  clinic := public.create_clinic('{"name":"Investigations Clinic"}'::jsonb, '{"full_name":"Owner L"}'::jsonb);
  reset role;

  select id into doctor_staff from public.staff where clinic_id = clinic and role = 'owner';
  insert into public.patients (clinic_id, code, full_name) values (clinic, 'PT-00002', 'Inv Patient') returning id into patient;

  -- --------------------------------------------------- 1. the column is there
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'consultations' and column_name = 'investigations';
  if n <> 1 then
    raise exception 'FAIL: consultations.investigations does not exist' using errcode = 'P0002';
  end if;

  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'consultations'
     and column_name = 'investigations' and data_type = 'ARRAY' and is_nullable = 'NO';
  if n <> 1 then
    raise exception 'FAIL: investigations must be a not-null text array' using errcode = 'P0002';
  end if;
  raise notice 'PASS: the consultation carries an investigations list';

  -- -------------------------------- 2. a row written without it still works
  -- An older client (or the sync queue replaying an old change) never sends the
  -- column; the default has to be an empty list, not a null.
  insert into public.consultations (clinic_id, patient_id, doctor_id, visited_on)
    values (clinic, patient, doctor_staff, current_date) returning id into visit;
  select investigations into tests from public.consultations where id = visit;
  if tests is null then
    raise exception 'FAIL: a consultation saved without investigations got a null' using errcode = 'P0002';
  end if;
  if cardinality(tests) <> 0 then
    raise exception 'FAIL: the default list is not empty (%)', tests using errcode = 'P0002';
  end if;
  raise notice 'PASS: an old client that sends no investigations still saves';

  -- --------------------------------------------- 3. the list round-trips as typed
  update public.consultations
     set investigations = array['CBC', 'HbA1c', 'X-ray chest']
   where id = visit;
  select investigations into tests from public.consultations where id = visit;
  if tests <> array['CBC', 'HbA1c', 'X-ray chest']::text[] then
    raise exception 'FAIL: the investigations list came back as %', tests using errcode = 'P0002';
  end if;
  raise notice 'PASS: investigations round-trip in order, three of them';

  -- --------------------------- 4. a pasted lab report is refused, a list is not
  begin
    update public.consultations set investigations = array[repeat('x', 1200)] where id = visit;
    raise exception 'FAIL: a 1,200-character test name was accepted' using errcode = 'P0002';
  exception when check_violation then
    refused := true;
  end;
  if not refused then
    raise exception 'FAIL: the length guard did not fire' using errcode = 'P0002';
  end if;

  -- the same guard must not be so tight that a real list trips it
  update public.consultations
     set investigations = array['CBC with ESR', 'HbA1c (after 3 months)', 'USG abdomen and pelvis', 'X-ray chest PA view', 'TSH']
   where id = visit;
  select cardinality(investigations) into n from public.consultations where id = visit;
  if n <> 5 then
    raise exception 'FAIL: a normal five-test list was refused (%)', n using errcode = 'P0002';
  end if;
  raise notice 'PASS: the guard stops a pasted report, not a clinic list';

  -- ---------------------------------- 5. it obeys the same RLS as the rest of the row
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.consultations where id = visit;
  if n <> 0 then
    raise exception 'FAIL: a stranger read a consultation to see its investigations' using errcode = 'P0002';
  end if;
  raise notice 'PASS: investigations are as private as the consultation they belong to';
  reset role;

  raise notice 'ALL INVESTIGATIONS CHECKS COMPLETED';
end $$;

rollback;   -- nothing above survives; safe to re-run

-- =============================================================================
-- SUITE K · THE AUDIT FIXES (schema 17)
-- =============================================================================
-- Five findings from the first full security audit run. Each assertion here is
-- the attack, run again, expected to fail — the booking reference is not handed
-- to a phone number, a tenant cannot write its own entitlement, the counter
-- helpers need membership, and a row cannot name another clinic's patient.
begin;

do $$
declare
  clinic_a uuid;
  clinic_b uuid;
  doc_a uuid;
  doc_b uuid;
  desk_a uuid;
  desk_user uuid := gen_random_uuid();
  owner_a uuid := gen_random_uuid();
  pat_a uuid;
  pat_b uuid;
  d date := current_date + 1;
  res jsonb;
  ref1 text;
  n integer;
  status_after text;
  refused boolean;
  client_mine uuid := gen_random_uuid();
  client_other uuid := gen_random_uuid();
begin
  insert into auth.users (id, email)
    values (owner_a, 'owner-a-' || owner_a || '@example.test'),
           (desk_user, 'desk-a-' || desk_user || '@example.test')
    on conflict do nothing;
  insert into public.clinics (name, slug, phone, address)
    values ('Audit Clinic A', 'audit-a', '9000000101', 'A address') returning id into clinic_a;
  insert into public.clinics (name, slug, phone, address)
    values ('Audit Clinic B', 'audit-b', '9000000102', 'B address') returning id into clinic_b;

  insert into public.staff (clinic_id, user_id, full_name, role, day_start, day_end)
    values (clinic_a, owner_a, 'Owner A', 'owner', '09:00', '18:00') returning id into doc_a;
  insert into public.staff (clinic_id, user_id, full_name, role, day_start, day_end)
    values (clinic_a, desk_user, 'Desk A', 'frontdesk', '09:00', '18:00') returning id into desk_a;
  insert into public.staff (clinic_id, full_name, role, day_start, day_end)
    values (clinic_b, 'Owner B', 'owner', '09:00', '18:00') returning id into doc_b;

  insert into public.patients (clinic_id, code, full_name, phone)
    values (clinic_a, 'PT-00001', 'Patient Alpha', '9820000001') returning id into pat_a;
  insert into public.patients (clinic_id, code, full_name, phone)
    values (clinic_b, 'PT-00001', 'Patient Beta', '9820000002') returning id into pat_b;

  -- A subscription row exists the moment a clinic is created; give this fixture
  -- one so the renewal assertions have something to renew.
  insert into public.clinic_subscriptions (clinic_id, plan, interval, status, current_period_end)
    values (clinic_a, 'solo', 'monthly', 'trial', now() + interval '7 days')
    on conflict (clinic_id) do nothing;

  -- ================================= 1. the booking reference is not a phone lookup
  set local role anon;
  res := public.public_book('audit-a', doc_a, d, '10:00', 'Patient Alpha', '9820000001', 'fever', client_mine);
  ref1 := res->>'ref';
  if ref1 is null then raise exception 'FAIL: the first booking got no reference' using errcode = 'P0002'; end if;

  -- the same device retries: same reference, flagged duplicate
  res := public.public_book('audit-a', doc_a, d, '10:00', 'Patient Alpha', '9820000001', 'fever', client_mine);
  if (res->>'ref') <> ref1 then raise exception 'FAIL: a retry from the booking device lost its reference' using errcode = 'P0002'; end if;
  if (res->>'duplicate') <> 'true' then raise exception 'FAIL: a retry was not flagged duplicate' using errcode = 'P0002'; end if;
  raise notice 'PASS: the device that booked can collect its own reference again';

  -- another device, same phone, same slot: refused with no time and no reference
  begin
    res := public.public_book('audit-a', doc_a, d, '10:00', 'Mallory', '9820000001', 'fever', client_other);
    raise exception 'FAIL: a stranger collected a reference with nothing but a phone number' using errcode = 'P0002';
  exception when others then
    if sqlerrm <> 'booking:already' then
      raise exception 'FAIL: the refusal leaked detail (%)', sqlerrm using errcode = 'P0002';
    end if;
  end;
  raise notice 'PASS: the refusal names neither the appointment time nor the reference';

  -- and a third device at a different slot learns nothing either
  begin
    res := public.public_book('audit-a', doc_a, d, '11:00', 'Mallory', '9820000001', 'fever', client_other);
    raise exception 'FAIL: a probe at another slot was answered with detail' using errcode = 'P0002';
  exception when others then
    if sqlerrm <> 'booking:already' then
      raise exception 'FAIL: a nearby slot disclosed the appointment time (%)', sqlerrm using errcode = 'P0002';
    end if;
  end;
  reset role;

  -- ==================================== 2. the tenant cannot mint its own licence
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- the operator switch is gone from the tenant's reach
  begin
    perform public.set_license_status(clinic_a, 'active');
    raise exception 'FAIL: a clinic owner still holds the operator switch' using errcode = 'P0002';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'PASS: set_license_status is not executable by the tenant';

  -- a renewal without a collection reference is refused
  begin
    perform public.renew_subscription(clinic_a, '', 12);
    raise exception 'FAIL: a renewal was accepted with no collection reference' using errcode = 'P0002';
  exception when invalid_parameter_value then
    null;
  end;
  raise notice 'PASS: a renewal needs a collection reference';

  -- with one, the clinic is active and the claim is written down
  status_after := public.renew_subscription(clinic_a, 'UPI-UTR-445566', 1) ->> 'status';
  if status_after <> 'active' then
    raise exception 'FAIL: a paid renewal left the clinic at %', status_after using errcode = 'P0002';
  end if;
  select count(*) into n from public.license_events where clinic_id = clinic_a and kind = 'renew';
  if n <> 1 then raise exception 'FAIL: the renewal was not logged (% rows)', n using errcode = 'P0002'; end if;
  raise notice 'PASS: a renewal with a reference activates the clinic and logs the claim';

  -- the term is capped at a year
  begin
    perform public.renew_subscription(clinic_a, 'UPI-UTR-445567', 36);
    raise exception 'FAIL: a 36-month self-renewal was accepted' using errcode = 'P0002';
  exception when invalid_parameter_value then
    null;
  end;
  raise notice 'PASS: a self-renewal is capped at twelve months';

  -- changing plan does not buy time
  status_after := public.change_plan(clinic_a, 'solo', 'monthly', '{}'::jsonb) ->> 'status';
  if status_after <> 'active' then
    raise exception 'FAIL: change_plan moved the status to %', status_after using errcode = 'P0002';
  end if;
  update public.clinic_subscriptions set status = 'read_only' where clinic_id = clinic_a;
  status_after := public.change_plan(clinic_a, 'growth', 'monthly', '{}'::jsonb) ->> 'status';
  if status_after <> 'read_only' then
    raise exception 'FAIL: change_plan reactivated a lapsed clinic (%)', status_after using errcode = 'P0002';
  end if;
  raise notice 'PASS: changing plan leaves the entitlement alone';

  -- Put the clinic back to a paying state: the read-only guard below would block
  -- every write in the rest of this suite, which is not what is under test here.
  reset role;
  update public.clinic_subscriptions
     set status = 'active', current_period_end = now() + interval '30 days'
   where clinic_id = clinic_a;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- a trial is a one-time thing
  begin
    perform public.start_trial(clinic_a);
    raise exception 'FAIL: the trial was restarted after expiry' using errcode = 'P0002';
  exception when sqlstate '53400' then
    null;
  end;
  raise notice 'PASS: a trial cannot be restarted';

  reset role;

  -- ============================ 3. counters need membership; writes need a clinic
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.next_token_no(doc_b, current_date);
    raise exception 'FAIL: another clinic''s token counter was readable' using errcode = 'P0002';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.next_invoice_number(clinic_b, 'LEAK');
    raise exception 'FAIL: another clinic''s invoice counter was readable' using errcode = 'P0002';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'PASS: both counter helpers refuse a caller from another clinic';

  -- ...and the same helper from a member of A (front desk, not the owner) works
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', desk_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.patients where clinic_id = clinic_a and id = pat_a;
  if n <> 1 then raise exception 'FAIL: a member lost access to its own clinic' using errcode = 'P0002'; end if;
  n := public.next_token_no(doc_a, current_date);
  if n < 1 then raise exception 'FAIL: a member cannot allocate a token in its own clinic' using errcode = 'P0002'; end if;
  raise notice 'PASS: a member of the clinic still sees its own rows and its own counters';

  -- a row cannot name another clinic's patient
  refused := false;
  begin
    insert into public.appointments (clinic_id, patient_id, doctor_id, scheduled_on, scheduled_at, source)
      values (clinic_a, pat_b, doc_a, current_date, '16:30', 'walk-in');
  exception when insufficient_privilege then
    refused := true;
  end;
  if not refused then
    raise exception 'FAIL: an appointment was stored against another clinic''s patient' using errcode = 'P0002';
  end if;
  raise notice 'PASS: a cross-clinic patient reference is refused';

  -- the same insert with A's own patient is fine
  insert into public.appointments (clinic_id, patient_id, doctor_id, scheduled_on, scheduled_at, source)
    values (clinic_a, pat_a, doc_a, current_date, '16:45', 'walk-in');
  raise notice 'PASS: the same insert with a same-clinic patient succeeds';
  reset role;

  raise notice 'ALL AUDIT FIX CHECKS COMPLETED';
end $$;

rollback;   -- nothing above survives; safe to re-run
