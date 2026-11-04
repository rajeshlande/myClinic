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
-- Four suites run in order:
--   A. the role matrix   — that owner / doctor / front deck see only what they run
--   B. licensing         — trial, seats, grace, the read-only write gate, renewal
--   C. public booking    — the five anon-granted RPCs, called the way a stranger
--                          with a link calls them, including every refusal
--   D. naming            — clinic_slug, the one rule a clinic name becomes a URL
--   E. the booking link  — provisioning mints a slug, the slug resolves for a
--                          stranger, and only an owner can change it
--   F. who reads what    — the doctor owns the chart, the desk owns the money, and
--                          neither can reach across
--
-- Every assertion raises on failure, so a clean run is the proof. Success lines:
--   "ALL RLS CHECKS COMPLETED", "ALL LICENSING CHECKS COMPLETED",
--   "ALL BOOKING CHECKS COMPLETED", "ALL SLUG CHECKS COMPLETED" and
--   "ALL BOOKING LINK CHECKS COMPLETED" and "ALL ROLE SPLIT CHECKS COMPLETED".
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
  res := public.public_book('booking-test', doc, d, '10:00', 'Rohit Patel', '9820011223', 'fever');
  if (res->>'duplicate') <> 'true' or (res->>'ref') <> ref1 then
    raise exception 'FAIL: sending the same tap twice booked a second appointment' using errcode = 'P0002';
  end if;
  raise notice 'PASS: the same tap twice returns the same reference instead of booking again';

  -- ======================================================= 4. one live booking per phone per day
  begin
    perform public.public_book('booking-test', doc, d, '11:00', 'Rohit Patel', '98200 11223', '');
    raise exception 'FAIL: a second live appointment for one phone was accepted' using errcode = 'P0002';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'booking:already:10:00' then raise exception 'FAIL: wrong refusal (%), expected booking:already:10:00', sqlerrm; end if;
    raise notice 'PASS: a second slot for the same phone is refused with the time they already hold';
  end;

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
