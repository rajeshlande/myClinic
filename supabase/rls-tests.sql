-- =============================================================================
-- myClinic — RLS regression tests
--
-- Run this against a SCRATCH Supabase project (never production) after applying
-- schema.sql. It creates two dummy tenants, three dummy users, and then asserts
-- that the role matrix actually holds — including the two escalation paths that
-- were found in security audit run 1.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rls-tests.sql
--
-- Every assertion raises an exception on failure, so a clean run with no error
-- means every check passed. All the data it creates is rolled back at the end.
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

  begin
    update public.invoices set status = 'void' where id = invoice_b;
    raise exception 'FAIL: voided another clinic''s invoice';
  exception when insufficient_privilege or no_data_found then
    raise notice 'PASS: cross-clinic invoice update refused';
  end;

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
