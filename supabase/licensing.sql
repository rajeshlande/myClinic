-- ============================================================================
-- myClinic — subscription licensing (schema v3)
-- Run AFTER supabase/schema.sql. Idempotent: safe to re-run.
--
-- Model
--   clinic_subscriptions  one row per clinic: plan, status, trial and period
--                         end dates, interval, and who pays
--   app_meta.schema_version   bumped to 3 by this file
--
-- Nothing here trusts the client. A clinic cannot write unless its
-- subscription is trial / active / grace, and seat limits are enforced by a
-- trigger on staff — so an offline client that skipped the banner still gets
-- rejected by the database.
-- ============================================================================

-- ---------------------------------------------------------------- plan limits
-- One place to change a limit. The client mirrors this in src/lib/license.mjs.
create or replace function public.plan_seat_limit(p_plan text, p_kind text)
returns integer language sql immutable as $$
  select case p_plan
    when 'solo'   then case p_kind when 'doctors' then 1   when 'frontdesk' then 1  when 'branches' then 1 end
    when 'growth' then case p_kind when 'doctors' then 5   when 'frontdesk' then 3  when 'branches' then 1 end
    when 'chain'  then null            -- unlimited
  end;
$$;

create or replace function public.plan_price_paise(p_plan text, p_interval text default 'monthly')
returns bigint language sql immutable as $$
  select case
    when p_plan = 'solo'   then case when p_interval = 'yearly' then 9590400  else 99900 end
    when p_plan = 'growth' then case when p_interval = 'yearly' then 23990400 else 249900 end
    when p_plan = 'chain'  then case when p_interval = 'yearly' then 57590400 else 599900 end
  end;
$$;

-- ---------------------------------------------------------------- the table
create table if not exists public.clinic_subscriptions (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  plan text not null default 'growth' check (plan in ('solo','growth','chain')),
  status text not null default 'trial' check (status in ('trial','active','grace','read_only','expired')),
  interval text not null default 'monthly' check (interval in ('monthly','yearly')),
  trial_started_at timestamptz not null default now(),
  trial_ends_at timestamptz not null default (now() + interval '14 days'),
  current_period_start timestamptz,
  current_period_end timestamptz,
  -- who sold/collects it; the app never stores card data
  billing_name text not null default '' check (char_length(billing_name) <= 120),
  billing_email text not null default '' check (char_length(billing_email) <= 160),
  billing_phone text not null default '' check (char_length(billing_phone) <= 24),
  billing_gstin text not null default '' check (char_length(billing_gstin) <= 20),
  collection_ref text not null default '' check (char_length(collection_ref) <= 120),
  notes text not null default '' check (char_length(notes) <= 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists clinic_subscriptions_touch on public.clinic_subscriptions;
create trigger clinic_subscriptions_touch before update on public.clinic_subscriptions
  for each row execute function public.touch_updated_at();

alter table public.clinic_subscriptions enable row level security;

-- Any staff member may read the licence (the UI needs to show the banner);
-- only the owner may change it, and only through the RPCs below.
drop policy if exists clinic_subscriptions_read on public.clinic_subscriptions;
create policy clinic_subscriptions_read on public.clinic_subscriptions for select to authenticated
  using (public.is_clinic_staff(clinic_id));

drop policy if exists clinic_subscriptions_owner_write on public.clinic_subscriptions;
create policy clinic_subscriptions_owner_write on public.clinic_subscriptions for update to authenticated
  using (public.is_clinic_owner(clinic_id))
  with check (public.is_clinic_owner(clinic_id));

-- ---------------------------------------------------------------- state
-- Returns the licence view the client renders. Everything is derived from the
-- row, so a client cannot claim a plan it does not pay for.
create or replace function public.license_state(p_clinic uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.clinic_subscriptions;
  v_status text;
  v_ends timestamptz;
  v_days integer;
  v_doctors integer;
  v_frontdesk integer;
begin
  if not public.is_clinic_staff(p_clinic) then
    raise exception 'not a member of this clinic' using errcode = '42501';
  end if;

  select * into s from public.clinic_subscriptions where clinic_id = p_clinic;
  if not found then
    -- Legacy clinics created before v3: give them a fresh trial rather than
    -- locking them out of their own data.
    insert into public.clinic_subscriptions (clinic_id) values (p_clinic) returning * into s;
  end if;

  v_status := s.status;
  v_ends := case when s.status = 'trial' then s.trial_ends_at else s.current_period_end end;
  v_days := case when v_ends is null then null else ceil(extract(epoch from (v_ends - now())) / 86400)::int end;

  -- A stale 'active' row whose period has passed is downgraded on read.
  if v_status = 'active' and v_ends is not null and v_ends < now() then
    v_status := case when now() - v_ends <= interval '7 days' then 'grace' else 'read_only' end;
  elsif v_status = 'trial' and v_ends is not null and v_ends < now() then
    v_status := 'read_only';
  end if;

  select count(*) filter (where role in ('owner','doctor')),
         count(*) filter (where role = 'frontdesk')
    into v_doctors, v_frontdesk
    from public.staff where clinic_id = p_clinic and active;

  return jsonb_build_object(
    'clinic_id', p_clinic,
    'plan', s.plan,
    'status', v_status,
    'interval', s.interval,
    'days_left', v_days,
    'ends_at', v_ends,
    'trial_ends_at', s.trial_ends_at,
    'current_period_end', s.current_period_end,
    'billing_email', s.billing_email,
    'collection_ref', s.collection_ref,
    'limits', jsonb_build_object(
      'doctors', public.plan_seat_limit(s.plan, 'doctors'),
      'frontdesk', public.plan_seat_limit(s.plan, 'frontdesk'),
      'branches', public.plan_seat_limit(s.plan, 'branches')
    ),
    'usage', jsonb_build_object(
      'doctors', coalesce(v_doctors, 0),
      'frontdesk', coalesce(v_frontdesk, 0),
      'branches', 1
    ),
    'can_write', v_status in ('trial','active','grace')
  );
end $$;

grant execute on function public.license_state(uuid) to authenticated;

-- Cheap boolean for RLS policies and triggers.
create or replace function public.clinic_can_write(p_clinic uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when s.status = 'trial'   then s.trial_ends_at > now()
      when s.status = 'active'  then coalesce(s.current_period_end, now()) + interval '7 days' > now()
      when s.status = 'grace'   then coalesce(s.current_period_end, now()) + interval '7 days' > now()
      else false
    end
    from public.clinic_subscriptions s where s.clinic_id = p_clinic
  ), true);   -- no row yet = legacy clinic = allowed (license_state() creates one)
$$;

-- ---------------------------------------------------------------- seat limits
create or replace function public.seat_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_kind text := case when new.role = 'frontdesk' then 'frontdesk' else 'doctors' end;
  v_limit integer;
  v_used integer;
  v_plan text;
begin
  if coalesce(new.active, true) = false then return new; end if;

  select s.plan into v_plan from public.clinic_subscriptions s where s.clinic_id = new.clinic_id;
  v_plan := coalesce(v_plan, 'growth');
  v_limit := public.plan_seat_limit(v_plan, v_kind);
  if v_limit is null then return new; end if;               -- unlimited plan

  select count(*) into v_used
    from public.staff
   where clinic_id = new.clinic_id
     and active
     and id is distinct from new.id
     and (case when v_kind = 'frontdesk' then role = 'frontdesk' else role in ('owner','doctor') end);

  if v_used + 1 > v_limit then
    raise exception 'the % plan includes % % seat(s) and they are all in use — upgrade the plan to add another',
      v_plan, v_limit, v_kind using errcode = '53400';
  end if;
  return new;
end $$;

drop trigger if exists staff_seat_guard on public.staff;
create trigger staff_seat_guard before insert or update of role, active on public.staff
  for each row execute function public.seat_guard();

-- ---------------------------------------------------------------- lifecycle RPCs
-- Start (or restart) the free trial. Once per clinic, enforced server-side.
create or replace function public.start_trial(p_clinic uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.clinic_subscriptions;
begin
  if not public.is_clinic_owner(p_clinic) then
    raise exception 'only a clinic owner can change the subscription' using errcode = '42501';
  end if;

  select * into s from public.clinic_subscriptions where clinic_id = p_clinic;
  if found and (s.trial_started_at is not null and s.trial_ends_at > now() or s.status in ('active','grace')) then
    raise exception 'a trial has already been used for this clinic' using errcode = '53400';
  end if;

  insert into public.clinic_subscriptions (clinic_id, plan, status, trial_started_at, trial_ends_at)
  values (p_clinic, 'growth', 'trial', now(), now() + interval '14 days')
  on conflict (clinic_id) do update
    set plan = 'growth', status = 'trial',
        trial_started_at = now(), trial_ends_at = now() + interval '14 days';

  return public.license_state(p_clinic);
end $$;

grant execute on function public.start_trial(uuid) to authenticated;

-- Owner changes plan / billing interval. Downgrades below current usage are
-- refused so nobody strands their own staff.
create or replace function public.change_plan(
  p_clinic uuid,
  p_plan text,
  p_interval text default 'monthly',
  p_billing jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_doctors integer;
  v_frontdesk integer;
  v_limit integer;
begin
  if not public.is_clinic_owner(p_clinic) then
    raise exception 'only a clinic owner can change the subscription' using errcode = '42501';
  end if;
  if p_plan not in ('solo','growth','chain') then
    raise exception 'unknown plan %', p_plan using errcode = '22023';
  end if;
  if p_interval not in ('monthly','yearly') then
    raise exception 'interval must be monthly or yearly' using errcode = '22023';
  end if;

  select count(*) filter (where role in ('owner','doctor')), count(*) filter (where role = 'frontdesk')
    into v_doctors, v_frontdesk from public.staff where clinic_id = p_clinic and active;

  v_limit := public.plan_seat_limit(p_plan, 'doctors');
  if v_limit is not null and v_doctors > v_limit then
    raise exception 'this clinic has % doctors; the % plan allows %', v_doctors, p_plan, v_limit
      using errcode = '53400';
  end if;
  v_limit := public.plan_seat_limit(p_plan, 'frontdesk');
  if v_limit is not null and v_frontdesk > v_limit then
    raise exception 'this clinic has % front-desk seats; the % plan allows %', v_frontdesk, p_plan, v_limit
      using errcode = '53400';
  end if;

  insert into public.clinic_subscriptions as s (
    clinic_id, plan, status, interval, current_period_start, current_period_end,
    billing_name, billing_email, billing_phone, billing_gstin
  ) values (
    p_clinic, p_plan, 'active', p_interval, now(),
    now() + case when p_interval = 'yearly' then interval '365 days' else interval '30 days' end,
    coalesce(p_billing->>'name',''), coalesce(p_billing->>'email',''),
    coalesce(p_billing->>'phone',''), coalesce(p_billing->>'gstin','')
  )
  on conflict (clinic_id) do update set
    plan = excluded.plan,
    status = 'active',
    interval = excluded.interval,
    current_period_start = now(),
    current_period_end = excluded.current_period_end,
    billing_name  = coalesce(nullif(excluded.billing_name,''),  s.billing_name),
    billing_email = coalesce(nullif(excluded.billing_email,''), s.billing_email),
    billing_phone = coalesce(nullif(excluded.billing_phone,''), s.billing_phone),
    billing_gstin = coalesce(nullif(excluded.billing_gstin,''), s.billing_gstin),
    collection_ref = coalesce(nullif(p_billing->>'collection_ref',''), s.collection_ref),
    notes = coalesce(nullif(p_billing->>'notes',''), s.notes);

  return public.license_state(p_clinic);
end $$;

grant execute on function public.change_plan(uuid, text, text, jsonb) to authenticated;

-- Payment received: renew from today (or extend the current period if it is
-- still running). This is what a UPI/bank-transfer collection calls.
create or replace function public.renew_subscription(
  p_clinic uuid,
  p_reference text default '',
  p_months integer default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.clinic_subscriptions; v_from timestamptz; v_add interval;
begin
  if not public.is_clinic_owner(p_clinic) then
    raise exception 'only a clinic owner can change the subscription' using errcode = '42501';
  end if;
  if p_months is not null and (p_months < 1 or p_months > 36) then
    raise exception 'months must be between 1 and 36' using errcode = '22023';
  end if;

  select * into s from public.clinic_subscriptions where clinic_id = p_clinic;
  if not found then raise exception 'no subscription for this clinic' using errcode = '02000'; end if;

  v_from := greatest(coalesce(s.current_period_end, now()), now());
  v_add := coalesce(make_interval(months => p_months),
                    case when s.interval = 'yearly' then interval '365 days' else interval '30 days' end);

  update public.clinic_subscriptions
     set status = 'active',
         current_period_start = coalesce(current_period_start, now()),
         current_period_end = v_from + v_add,
         collection_ref = coalesce(nullif(p_reference, ''), collection_ref)
   where clinic_id = p_clinic;

  return public.license_state(p_clinic);
end $$;

grant execute on function public.renew_subscription(uuid, text, integer) to authenticated;

-- Operator/support switch (also used by the payment webhook later).
create or replace function public.set_license_status(p_clinic uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_clinic_owner(p_clinic) then
    raise exception 'only a clinic owner can change the subscription' using errcode = '42501';
  end if;
  if p_status not in ('trial','active','grace','read_only','expired') then
    raise exception 'unknown status %', p_status using errcode = '22023';
  end if;
  update public.clinic_subscriptions set status = p_status where clinic_id = p_clinic;
  return public.license_state(p_clinic);
end $$;

grant execute on function public.set_license_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------- new clinics
-- Every new clinic starts on the 14-day Growth trial. create_clinic() is
-- redefined here (not in schema.sql) so the licensing file stays additive.
create or replace function public.create_clinic(p_clinic jsonb, p_owner jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_clinic uuid;
  owner_name text := coalesce(p_owner->>'full_name', 'Clinic owner');
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  insert into public.clinics (name, clinic_type, phone, email, address, consultation_fee_paise, follow_up_fee_paise, slot_minutes)
  values (
    coalesce(p_clinic->>'name', 'My clinic'),
    coalesce(p_clinic->>'clinic_type', 'General Practice'),
    coalesce(p_clinic->>'phone', ''),
    coalesce(p_clinic->>'email', ''),
    coalesce(p_clinic->>'address', ''),
    coalesce((p_clinic->>'consultation_fee_paise')::bigint, 50000),
    coalesce((p_clinic->>'follow_up_fee_paise')::bigint, 25000),
    coalesce((p_clinic->>'slot_minutes')::int, 15)
  ) returning id into new_clinic;

  insert into public.clinic_subscriptions (clinic_id, plan, status, trial_started_at, trial_ends_at)
  values (new_clinic, coalesce(p_clinic->>'plan', 'growth'), 'trial', now(), now() + interval '14 days')
  on conflict (clinic_id) do nothing;

  insert into public.staff (clinic_id, user_id, full_name, role, specialty, qualification, phone, email)
  values (new_clinic, auth.uid(), owner_name, 'owner',
    coalesce(p_owner->>'specialty', 'General Physician'),
    coalesce(p_owner->>'qualification', 'MBBS'),
    coalesce(p_owner->>'phone', ''),
    coalesce(p_owner->>'email', ''));

  update public.profiles set default_clinic_id = new_clinic where id = auth.uid();
  return new_clinic;
end $$;

grant execute on function public.create_clinic(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------- write gate
-- One trigger per clinical table: a read-only clinic can read and export, but
-- cannot create or change records. Exception: the owner may still edit the
-- clinic row itself (phone, address) so a lapsed clinic can fix its details.
create or replace function public.subscription_write_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_clinic uuid;
begin
  v_clinic := coalesce(
    case when tg_op = 'DELETE' then (to_jsonb(old)->>'clinic_id')::uuid else (to_jsonb(new)->>'clinic_id')::uuid end,
    null
  );
  if v_clinic is null then return coalesce(new, old); end if;
  if auth.uid() is null then return coalesce(new, old); end if;   -- migrations / service role
  if not public.clinic_can_write(v_clinic) then
    raise exception 'subscription is read-only: renew the plan to make changes (your data is still readable and exportable)'
      using errcode = '53401';
  end if;
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['patients','appointments','consultations','invoices'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_subscription_guard', t);
    execute format(
      'create trigger %I before insert or update or delete on public.%I for each row execute function public.subscription_write_guard()',
      t || '_subscription_guard', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------- schema bump
insert into public.app_meta (schema_version, notes)
select 3, 'subscription licensing'
where not exists (select 1 from public.app_meta where schema_version >= 3);

update public.app_meta
   set schema_version = 3, applied_at = now(), notes = 'subscription licensing'
 where schema_version < 3;

select public.app_schema_version() as schema_version;
