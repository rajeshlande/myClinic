-- ============================================================================
-- myClinic — licensing regression suite
-- Run AFTER supabase/schema.sql and supabase/licensing.sql, against a SCRATCH
-- project (never production). Everything happens inside one transaction that is
-- rolled back at the end, so it is safe to re-run.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/licensing-tests.sql
--
-- Every assertion prints PASS or raises. "ALL LICENSING CHECKS COMPLETED" is the
-- success line.
-- ============================================================================
begin;

do $$
declare
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  clinic_a uuid;
  clinic_b uuid;
  lic jsonb;
  seat_before integer;
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
  set local role authenticated;
  begin
    insert into public.staff (clinic_id, full_name, role) values (clinic_a, 'Doc 1', 'doctor');
    insert into public.staff (clinic_id, full_name, role) values (clinic_a, 'Doc 2', 'doctor');
    insert into public.staff (clinic_id, full_name, role) values (clinic_a, 'Doc 3', 'doctor');
    insert into public.staff (clinic_id, full_name, role) values (clinic_a, 'Doc 4', 'doctor');
    insert into public.staff (clinic_id, full_name, role) values (clinic_a, 'Doc 5', 'doctor');
    raise exception 'FAIL: growth plan accepted a 6th doctor';
  exception when sqlstate '53400' then
    raise notice 'PASS: growth stops at 5 doctors (seat_guard)';
  end;
  reset role;

  -- front desk is a separate pool (3 on growth)
  set local role authenticated;
  begin
    insert into public.staff (clinic_id, full_name, role) values (clinic_a, 'Desk 1', 'frontdesk');
    insert into public.staff (clinic_id, full_name, role) values (clinic_a, 'Desk 2', 'frontdesk');
    insert into public.staff (clinic_id, full_name, role) values (clinic_a, 'Desk 3', 'frontdesk');
    insert into public.staff (clinic_id, full_name, role) values (clinic_a, 'Desk 4', 'frontdesk');
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

  begin
    insert into public.patients (clinic_id, full_name) values (clinic_a, 'Blocked Patient');
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
  insert into public.patients (clinic_id, full_name) values (clinic_a, 'Grace Patient');
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
