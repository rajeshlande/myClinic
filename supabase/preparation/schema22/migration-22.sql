-- §22 · Central-authenticated shared clinical database
-- NEW/EMPTY CLINICAL PROJECT ONLY on first application. Never apply to Master.
-- This section runs inside the consolidated file's transaction.
-- Browser access is deliberately disabled until the separate OIDC cutover.

do $preflight$
begin
  if public.app_schema_version() < 22 and (
    exists(select from public.clinics) or exists(select from public.staff)
    or exists(select from public.profiles) or exists(select from auth.users)
  ) then
    raise exception 'Schema 22 first install requires an empty clinical project, including local Auth users. Existing-data migration is not supported by this file.';
  end if;
end $preflight$;

create table if not exists public.schema_meta (
  id boolean primary key default true check(id),
  schema_version integer not null default 22 check(schema_version = 22),
  issuer text not null check(issuer = 'https://inaqzvzfongngahxptzw.supabase.co/functions/v1/oidc'),
  clinical_url text not null check(clinical_url = 'https://kvxmcdezpozkvdmvmicr.supabase.co'),
  jwks_uri text,
  kid_watermark text,
  tenant_access_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.schema_meta(id,issuer,clinical_url)
values(true,'https://inaqzvzfongngahxptzw.supabase.co/functions/v1/oidc','https://kvxmcdezpozkvdmvmicr.supabase.co')
on conflict(id) do nothing;

-- Central identities are provisioned by the server, NOT clinical auth.users.
create table if not exists public.central_identities (
  user_sub uuid primary key,
  issuer text not null default 'https://inaqzvzfongngahxptzw.supabase.co/functions/v1/oidc'
    check(issuer = 'https://inaqzvzfongngahxptzw.supabase.co/functions/v1/oidc'),
  active boolean not null default true,
  synced_at timestamptz not null default now()
);
create table if not exists public.clinic_memberships (
  clinic_id uuid not null references public.clinics(id),
  user_sub uuid not null references public.central_identities(user_sub),
  workspace_id uuid not null,
  tenant_slug text not null check(tenant_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  member_role text not null check(member_role in ('owner','doctor','frontdesk')),
  status text not null default 'active' check(status in ('active','inactive')),
  synced_at timestamptz not null default now(),
  primary key(clinic_id,user_sub),
  unique(workspace_id,user_sub)
);
create index if not exists clinic_memberships_user_idx on public.clinic_memberships(user_sub,clinic_id);

-- Replace local Auth FK dependencies, without creating duplicate local users.
-- These constraints alone are removed; tables, rows and columns are preserved.
alter table public.staff drop constraint if exists staff_user_id_fkey;
alter table public.invites drop constraint if exists invites_invited_by_fkey;
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.license_events drop constraint if exists license_events_actor_fkey;
do $identity_fks$
declare r record;
begin
  for r in select * from (values
    ('staff','user_id'),('invites','invited_by'),('profiles','id'),('license_events','actor')
  ) as x(tbl,col) loop
    if not exists(select from pg_constraint where conrelid=format('public.%I',r.tbl)::regclass and conname=r.tbl||'_central_identity_fk') then
      execute format('alter table public.%I add constraint %I foreign key (%I) references public.central_identities(user_sub)',r.tbl,r.tbl||'_central_identity_fk',r.col);
    end if;
  end loop;
end $identity_fks$;

-- A child assignment gets an explicit tenant discriminator as well.
alter table public.staff_branches add column if not exists clinic_id uuid references public.clinics(id);
update public.staff_branches sb set clinic_id=s.clinic_id from public.staff s
where sb.staff_id=s.id and sb.clinic_id is null;
alter table public.staff_branches alter column clinic_id set not null;
create unique index if not exists staff_central_user_per_clinic on public.staff(clinic_id,user_id) where user_id is not null;
create or replace function public.tenant_staff_branch_fill()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare actual uuid;
begin
  select clinic_id into actual from public.staff where id=new.staff_id;
  if actual is null or (new.clinic_id is not null and new.clinic_id is distinct from actual) then
    raise exception 'invalid staff assignment tenant' using errcode='23503';
  end if;
  new.clinic_id:=actual;
  return new;
end $$;
drop trigger if exists aa_tenant_staff_branch_fill on public.staff_branches;
create trigger aa_tenant_staff_branch_fill before insert or update on public.staff_branches
for each row execute function public.tenant_staff_branch_fill();


-- Composite FKs bind every clinical UUID reference to its clinic.
-- Existing single-column FKs (and their original lifecycle behaviour) remain.
do $tenant_fks$
declare r record; target_table text; cname text;
begin
  for r in select c.relname tbl from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r'
    and exists(select from pg_attribute a where a.attrelid=c.oid and a.attname='clinic_id' and not a.attisdropped)
    and exists(select from pg_attribute a where a.attrelid=c.oid and a.attname='id' and not a.attisdropped)
  loop
    execute format('create unique index if not exists %I on public.%I(clinic_id,id)',r.tbl||'_tenant_id_unique',r.tbl);
  end loop;
  for r in
    select src.relname tbl,a.attname col,dst.relname target
    from pg_constraint fk join pg_class src on src.oid=fk.conrelid
    join pg_class dst on dst.oid=fk.confrelid
    join pg_attribute a on a.attrelid=src.oid and a.attnum=fk.conkey[1]
    where fk.contype='f' and cardinality(fk.conkey)=1
      and src.relnamespace='public'::regnamespace and dst.relnamespace='public'::regnamespace
      and exists(select from pg_attribute x where x.attrelid=src.oid and x.attname='clinic_id' and not x.attisdropped)
      and exists(select from pg_attribute x where x.attrelid=dst.oid and x.attname='clinic_id' and not x.attisdropped)
      and exists(select from pg_attribute x where x.attrelid=dst.oid and x.attname='id' and not x.attisdropped)
  loop
    cname:=r.tbl||'_'||r.col||'_tenant_fk';
    if not exists(select from pg_constraint where conrelid=format('public.%I',r.tbl)::regclass and conname=cname) then
      execute format('alter table public.%I add constraint %I foreign key(clinic_id,%I) references public.%I(clinic_id,id) deferrable initially immediate',r.tbl,cname,r.col,r.target);
    end if;
  end loop;
end $tenant_fks$;

create or replace function public.tenant_context_valid(target uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare j jsonb:=auth.jwt(); meta public.schema_meta; ts numeric:=extract(epoch from now());
begin
  select * into meta from public.schema_meta where id;
  if not found or not meta.tenant_access_enabled then return false; end if;
  if j->>'iss' is distinct from meta.issuer or j->>'role' is distinct from 'authenticated'
    or j->>'aud' is distinct from 'authenticated' or target is distinct from (j->>'clinic_id')::uuid
    or nullif(j->>'jti','') is null or nullif(j->>'sub','') is null
    or nullif(j->>'workspace_id','') is null or nullif(j->>'tenant_slug','') is null
    or j->>'member_role' not in ('owner','doctor','frontdesk') then return false; end if;
  if j->>'exp' is null or j->>'iat' is null or (j->>'exp')::numeric<=ts
    or (j->>'iat')::numeric>ts+30 or (j->>'exp')::numeric<=(j->>'iat')::numeric
    or (j->>'exp')::numeric-(j->>'iat')::numeric>900 then return false; end if;
  return exists(
    select from public.clinic_memberships m
    join public.central_identities i on i.user_sub=m.user_sub
    join public.clinics c on c.id=m.clinic_id
    where m.clinic_id=target and m.user_sub=(j->>'sub')::uuid
      and i.active and i.issuer=meta.issuer and m.status='active'
      and m.member_role=j->>'member_role' and m.workspace_id=(j->>'workspace_id')::uuid
      and m.tenant_slug=j->>'tenant_slug' and c.slug=m.tenant_slug
  );
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $fn$;

-- Preserve the licence verdict calculation, but do not reveal it cross-tenant.
CREATE OR REPLACE FUNCTION public.clinic_can_write(p_clinic uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select public.tenant_context_valid(p_clinic) and coalesce((
      select case
        when s.status = 'trial'   then s.trial_ends_at > now()
        when s.status = 'active'  then coalesce(s.current_period_end, now()) + interval '7 days' > now()
        when s.status = 'grace'   then coalesce(s.current_period_end, now()) + interval '7 days' > now()
        else false
      end
      from public.clinic_subscriptions s where s.clinic_id = p_clinic
    ), true);   -- no row yet = legacy clinic = allowed (license_state() creates one)
  $function$;

-- All existing role checks now bind BOTH the mirror and the clinical staff row.
create or replace function public.has_role(target uuid,roles text[])
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if not public.tenant_context_valid(target) then return false; end if;
  return exists(select from public.staff s where s.clinic_id=target and s.user_id=auth.uid()
    and s.active and s.role=auth.jwt()->>'member_role' and s.role=any(roles));
end $$;
create or replace function public.is_clinic_staff(target uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select public.has_role(target,array['owner','doctor','frontdesk']);
$$;
create or replace function public.clinic_role(target uuid)
returns text language sql stable security definer set search_path=pg_catalog,public as $$
  select case when public.is_clinic_staff(target) then auth.jwt()->>'member_role' end;
$$;
create or replace function public.is_clinic_owner(target uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select public.has_role(target,array['owner']);
$$;
create or replace function public.user_branch_ids(p_clinic uuid)
returns setof uuid language sql stable security definer set search_path=pg_catalog,public as $$
  select b.id from public.branches b where b.clinic_id=p_clinic and b.active
  and public.is_clinic_staff(p_clinic) and (
    public.is_clinic_owner(p_clinic) or exists(
      select from public.staff_branches sb join public.staff s on s.id=sb.staff_id
      where sb.clinic_id=p_clinic and sb.branch_id=b.id and sb.active
        and s.user_id=auth.uid() and s.active and s.clinic_id=p_clinic));
$$;
create or replace function public.can_access_branch(p_clinic uuid,p_branch uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select public.is_clinic_staff(p_clinic) and (
    (p_branch is null and public.is_clinic_owner(p_clinic))
    or p_branch in (select public.user_branch_ids(p_clinic)));
$$;
create or replace function public.current_branch_id(p_clinic uuid)
returns uuid language sql stable security definer set search_path=pg_catalog,public as $$
  select case when public.is_clinic_staff(p_clinic) then coalesce(
    (select p.active_branch_id from public.profiles p where p.id=auth.uid()
      and p.active_branch_id in(select public.user_branch_ids(p_clinic))),
    (select u from public.user_branch_ids(p_clinic) u order by u limit 1)) end;
$$;
create or replace function public.set_branch_scope(p_scope text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare target uuid:=(auth.jwt()->>'clinic_id')::uuid;
begin
  if p_scope not in ('all','branch') or not public.is_clinic_staff(target)
    or (p_scope='all' and not public.is_clinic_owner(target)) then
    raise exception 'invalid branch scope or tenant membership' using errcode='42501';
  end if;
  update public.profiles set branch_scope=p_scope where id=auth.uid();
end $$;

-- Retain the walk-in RPC, fixing the inherited time-only generate_series
-- call: PostgreSQL supplies timestamp, not time, overloads.
CREATE OR REPLACE FUNCTION public.issue_token(p_clinic uuid, p_patient uuid, p_doctor uuid, p_kind text DEFAULT 'New consultation'::text, p_reason text DEFAULT ''::text, p_duration integer DEFAULT 15)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  tok integer;
  slot time;
  staff_row public.staff;
  patient_ok uuid;
  row_out public.appointments;
begin
  if not public.has_role(p_clinic, array['owner','doctor','frontdesk']) then
    raise exception 'not a member of this clinic' using errcode = '42501';
  end if;

  -- The patient must belong to this clinic.
  select id into patient_ok from public.patients where id = p_patient and clinic_id = p_clinic;
  if patient_ok is null then
    raise exception 'patient does not belong to this clinic' using errcode = '42501';
  end if;

  -- The doctor must belong to this clinic and be active.
  select * into staff_row from public.staff
    where id = p_doctor and clinic_id = p_clinic and active;
  if staff_row.id is null then
    raise exception 'doctor does not belong to this clinic' using errcode = '42501';
  end if;

  -- Serialise per doctor per day: the advisory lock removes the read-then-insert race.
  perform pg_advisory_xact_lock(hashtext(p_doctor::text || current_date::text));

  select coalesce(max(token_no), 0) + 1 into tok from public.appointments
    where doctor_id = p_doctor and scheduled_on = current_date;

  select t::time into slot from generate_series(
      current_date + staff_row.day_start,
      current_date + staff_row.day_end - interval '15 min',
      interval '15 min') t
    where not exists (
      select 1 from public.appointments a
      where a.doctor_id = p_doctor and a.scheduled_on = current_date and a.scheduled_at = t::time
    )
    order by t limit 1;
  slot := coalesce(slot, current_time);

  insert into public.appointments
    (clinic_id, patient_id, doctor_id, scheduled_on, scheduled_at, duration_minutes, kind, reason, source, status, token_no)
  values (p_clinic, p_patient, p_doctor, current_date, slot, coalesce(p_duration, 15),
          coalesce(p_kind, 'New consultation'), coalesce(p_reason, ''), 'walk-in', 'checked-in', tok)
  returning * into row_out;

  return row_out;
end $function$;

CREATE OR REPLACE FUNCTION public.subscription_write_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  declare v_clinic uuid;
  begin
    v_clinic := coalesce(
      case when tg_op = 'DELETE' then (to_jsonb(old)->>'clinic_id')::uuid else (to_jsonb(new)->>'clinic_id')::uuid end,
      null
    );
    if v_clinic is null then return coalesce(new, old); end if;
    if auth.uid() is null then return coalesce(new, old); end if;   -- migrations / service role
    if not public.is_clinic_staff(v_clinic) then
      raise exception 'invalid tenant membership' using errcode='42501';
    end if;
    if not public.clinic_can_write(v_clinic) then
      raise exception 'subscription is read-only: renew the plan to make changes (your data is still readable and exportable)'
        using errcode = '53401';
    end if;
    return coalesce(new, old);
  end $function$;

-- Guard writes made through SECURITY DEFINER paths too. Not a substitute for RLS.
create or replace function public.tenant_write_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare target uuid; rowj jsonb;
begin
  rowj:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  target:=case when tg_table_name='clinics' then (rowj->>'id')::uuid else (rowj->>'clinic_id')::uuid end;
  if current_setting('role',true) in ('authenticated','anon') then
    if not public.is_clinic_staff(target) then
      raise exception 'invalid tenant context' using errcode='42501';
    end if;
    if tg_table_name='clinics' and tg_op='UPDATE' and
      (rowj->>'id' is distinct from to_jsonb(old)->>'id' or rowj->>'slug' is distinct from to_jsonb(old)->>'slug') then
      raise exception 'clinic identity is managed by Central' using errcode='42501';
    end if;
    if tg_table_name='staff' then
      if tg_op in ('INSERT','DELETE') then
        raise exception 'staff identity is provisioned by Central' using errcode='42501';
      end if;
      if new.clinic_id is distinct from old.clinic_id or new.user_id is distinct from old.user_id
        or new.role is distinct from old.role or new.active is distinct from old.active then
        raise exception 'staff security fields are managed by Central' using errcode='42501';
      end if;
    end if;
    if tg_table_name in ('appointments','consultations','invoices','day_closes')
      and not public.can_access_branch(target,(rowj->>'branch_id')::uuid) then
      raise exception 'branch access denied' using errcode='42501';
    end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;

create or replace function public.tenant_profile_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare target uuid:=(auth.jwt()->>'clinic_id')::uuid;
begin
  if current_setting('role',true) in ('authenticated','anon') then
    if not public.is_clinic_staff(target) or new.id is distinct from auth.uid()
      or (new.default_clinic_id is not null and new.default_clinic_id is distinct from target)
      or (new.active_branch_id is not null and not public.can_access_branch(target,new.active_branch_id))
      or (new.branch_scope='all' and not public.is_clinic_owner(target)) then
      raise exception 'invalid tenant profile pointers' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists zz_tenant_profile_guard on public.profiles;
create trigger zz_tenant_profile_guard before insert or update on public.profiles
for each row execute function public.tenant_profile_guard();

-- Preserve the existing permissive role matrix, AND it with an independent
-- restrictive tenant/membership policy and a separately pinned issuer policy.
do $policies$
declare r record; expr text;
begin
  for r in select c.relname tbl from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r'
  loop
    execute format('alter table public.%I enable row level security',r.tbl);
    execute format('drop policy if exists tenant_issuer_restrictive on public.%I',r.tbl);
    execute format('create policy tenant_issuer_restrictive on public.%I as restrictive for all to authenticated using ((auth.jwt()->>''iss'') = ''https://inaqzvzfongngahxptzw.supabase.co/functions/v1/oidc'') with check ((auth.jwt()->>''iss'') = ''https://inaqzvzfongngahxptzw.supabase.co/functions/v1/oidc'')',r.tbl);
    if r.tbl='clinics' then expr:='public.tenant_context_valid(id)';
    elsif exists(select from pg_attribute where attrelid=format('public.%I',r.tbl)::regclass and attname='clinic_id' and not attisdropped) then
      expr:='public.tenant_context_valid(clinic_id)';
    else expr:='public.tenant_context_valid((auth.jwt()->>''clinic_id'')::uuid)'; end if;
    execute format('drop policy if exists tenant_membership_restrictive on public.%I',r.tbl);
    execute format('create policy tenant_membership_restrictive on public.%I as restrictive for all to authenticated using (%s) with check (%s)',r.tbl,expr,expr);
    if r.tbl='clinics' or exists(select from pg_attribute where attrelid=format('public.%I',r.tbl)::regclass and attname='clinic_id' and not attisdropped) then
      execute format('drop trigger if exists zz_tenant_write_guard on public.%I',r.tbl);
      execute format('create trigger zz_tenant_write_guard before insert or update or delete on public.%I for each row execute function public.tenant_write_guard()',r.tbl);
    end if;
  end loop;
end $policies$;

-- The membership mirror is server-written, clients only see their current row.
drop policy if exists membership_self_read on public.clinic_memberships;
create policy membership_self_read on public.clinic_memberships for select to authenticated
using(user_sub=auth.uid() and status='active');
drop policy if exists identity_self_read on public.central_identities;
create policy identity_self_read on public.central_identities for select to authenticated
using(user_sub=auth.uid() and active);
drop policy if exists schema_meta_read on public.schema_meta;
create policy schema_meta_read on public.schema_meta for select to authenticated using(true);

-- Default-deny the entire client surface, including inherited PUBLIC execute.
-- Extension-owned functions are excluded (pgcrypto/pg_trgm/fuzzystrmatch).
do $grants$
declare r record;
begin
  for r in select p.oid::regprocedure signature from pg_proc p
    where p.pronamespace='public'::regnamespace and p.prokind='f'
    and not exists(select from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
  loop
    execute format('revoke all on function %s from public,anon,authenticated',r.signature);
    execute format('grant execute on function %s to service_role',r.signature);
  end loop;
end $grants$;
revoke create on schema public from public,anon,authenticated;
revoke all on all tables in schema public from public,anon,authenticated;
revoke all on all sequences in schema public from public,anon,authenticated;
grant usage on schema public to authenticated,service_role;
grant all on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke all on tables from anon,authenticated;
alter default privileges in schema public revoke all on sequences from anon,authenticated;

-- Clinical CRUD remains governed by the original per-role/branch policy matrix.
grant select,insert,update,delete on public.patients,public.appointments,public.consultations,public.invoices,public.day_closes,public.reminders to authenticated;
grant select,update on public.clinics,public.staff to authenticated;
grant select,insert,update,delete on public.branches,public.staff_branches to authenticated;
grant select,insert,update on public.profiles to authenticated;
grant select on public.clinic_subscriptions,public.license_events,public.app_meta,public.schema_migrations,public.schema_meta,public.clinic_memberships,public.central_identities to authenticated;
-- No client grants for invites or medicines. Invites are Central-owned; the
-- medicine dataset belongs outside this project's Free-tier database budget.

grant execute on function public.tenant_context_valid(uuid),public.has_role(uuid,text[]),public.is_clinic_staff(uuid),public.is_clinic_owner(uuid),public.clinic_role(uuid),public.user_branch_ids(uuid),public.can_access_branch(uuid,uuid),public.current_branch_id(uuid),public.clinic_can_write(uuid),public.plan_seat_limit(text,text),public.app_schema_version(),public.app_migrations() to authenticated;
grant execute on function public.license_state(uuid),public.next_patient_code(uuid),public.next_invoice_number(uuid,text),public.next_token_no(uuid,date),public.issue_token(uuid,uuid,uuid,text,text,integer),public.create_branch(uuid,text),public.set_staff_branches(uuid,uuid[]),public.set_active_branch(uuid),public.set_branch_scope(text) to authenticated;
-- Deliberately NOT granted: create_clinic, accept_invite, invite_staff,
-- set_clinic_slug, local subscription mutations, public booking RPCs, internal
-- provisioning helpers or trigger functions. Booking must use the Central
-- server-only fold; the legacy anonymous booking API is disabled on P2.

insert into public.schema_migrations(version,name,app_version,summary)
values(22,'central-tenant-boundary','2.0.0','Central identities and membership mirror, issuer pin, restrictive tenant RLS, tenant-bound FKs and explicit RPC allowlist; activation remains gated')
on conflict(version) do nothing;
update public.app_meta set schema_version=22,applied_at=now(),notes='Central tenant boundary installed; activation is controlled separately in schema_meta'
where schema_version<22;
