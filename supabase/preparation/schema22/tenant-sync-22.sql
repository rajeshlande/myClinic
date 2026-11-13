-- STAGED CLINICAL22 sync addendum. NEW clinical kvxmcdezpozkvdmvmicr ONLY.
-- Does not enable tenant access, create local Auth users or delete records.
begin;
do $$ begin
 if public.app_schema_version()<>22 or not exists(select from public.schema_meta where id and clinical_url='https://kvxmcdezpozkvdmvmicr.supabase.co' and not tenant_access_enabled) then
   raise exception 'Expected corrected clinical22 with tenant access OFF'; end if;
end $$;
create table if not exists public.tenant_sync_state (
 workspace_id uuid primary key,
 clinic_id uuid not null unique references public.clinics(id),
 last_sequence bigint not null check(last_sequence>=0),
 snapshot_hash text not null default '',
 synced_at timestamptz not null default now()
);
alter table public.tenant_sync_state add column if not exists snapshot_hash text not null default '';
alter table public.tenant_sync_state enable row level security;
alter table public.tenant_sync_state force row level security;
revoke all on public.tenant_sync_state from public,anon,authenticated,service_role;
grant select,insert,update on public.tenant_sync_state to service_role;
drop policy if exists tenant_issuer_restrictive on public.tenant_sync_state;
create policy tenant_issuer_restrictive on public.tenant_sync_state as restrictive for all to authenticated using(false) with check(false);
drop policy if exists tenant_membership_restrictive on public.tenant_sync_state;
create policy tenant_membership_restrictive on public.tenant_sync_state as restrictive for all to authenticated using(false) with check(false);

create or replace function public.apply_tenant_snapshot(p_snapshot jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare w jsonb:=p_snapshot->'workspace'; lic jsonb:=p_snapshot->'licence'; item jsonb;
 ws uuid:=(w->>'id')::uuid; cid uuid:=(w->>'clinic_id')::uuid; seq bigint:=(p_snapshot->>'sequence')::bigint;
 previous public.tenant_sync_state; payload_hash text:=encode(sha256(convert_to(p_snapshot::text,'UTF8')),'hex'); sid uuid; active_member boolean; member_sub uuid; role_name text;
begin
 if p_snapshot->>'issuer' is distinct from 'https://inaqzvzfongngahxptzw.supabase.co/functions/v1/oidc'
 or p_snapshot->>'clinical_url' is distinct from 'https://kvxmcdezpozkvdmvmicr.supabase.co'
 or ws is null or cid is null or seq is null or seq<=0
 or jsonb_typeof(p_snapshot->'members') is distinct from 'array'
 or jsonb_array_length(p_snapshot->'members')>500
 or w->>'status' is null or w->>'status' not in ('active','inactive') or w->>'tenant_slug' is null
 or w->>'tenant_slug' !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
 or w->>'tenant_slug' in ('already','failed','closed','invalid','slot_taken') then
   raise exception 'invalid tenant snapshot' using errcode='42501'; end if;
 if (select count(distinct x->>'user_sub') from jsonb_array_elements(p_snapshot->'members') x)<>jsonb_array_length(p_snapshot->'members') then
   raise exception 'duplicate or missing snapshot identities'; end if;
 -- The released clinical staff model has exactly one owner row, even if inactive.
 -- Never silently demote an owner to make an incompatible snapshot fit.
 if (select count(*) from jsonb_array_elements(p_snapshot->'members') x where x->>'member_role'='owner')>1 then
   raise exception 'clinical model supports only one owner row per clinic'; end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text,19));
 select * into previous from public.tenant_sync_state where workspace_id=ws for update;
 if found then
   if previous.clinic_id<>cid then raise exception 'workspace clinic mapping changed' using errcode='42501'; end if;
   if seq<previous.last_sequence then return jsonb_build_object('status','superseded','sequence',previous.last_sequence::text); end if;
   if seq=previous.last_sequence then
     if previous.snapshot_hash<>payload_hash then raise exception 'sequence reused with different payload' using errcode='42501'; end if;
     return jsonb_build_object('status','already_applied','sequence',seq::text);
   end if;
 else
   if exists(select from public.clinics where id=cid) then raise exception 'refusing to claim unmanaged existing clinic'; end if;
   insert into public.clinics(id,name,slug) values(cid,left(w->>'tenant_slug',120),w->>'tenant_slug');
   insert into public.tenant_sync_state(workspace_id,clinic_id,last_sequence) values(ws,cid,0);
 end if;
 update public.clinics set slug=w->>'tenant_slug' where id=cid and slug is distinct from w->>'tenant_slug';
 perform public.apply_authority_license(cid,lic->>'subscription_id',lic->>'tier','workspace:'||ws::text,
   (lic->>'expires_at')::timestamptz,now()+interval '15 minutes','https://inaqzvzfongngahxptzw.supabase.co');
 if lic->>'status' is distinct from 'active' or (lic->>'is_active')::boolean is distinct from true then
   update public.clinic_subscriptions set status='read_only' where clinic_id=cid;
 end if;
 -- Missing members are revoked, not deleted. This handles trusted server-side
 -- source cleanup while preserving staff and clinical FK history.
 update public.clinic_memberships m set status='inactive',synced_at=now() where m.clinic_id=cid
   and not exists(select from jsonb_array_elements(p_snapshot->'members') x where (x->>'user_sub')::uuid=m.user_sub);
 update public.staff s set active=false where s.clinic_id=cid and s.user_id is not null and s.active
   and not exists(select from jsonb_array_elements(p_snapshot->'members') x where (x->>'user_sub')::uuid=s.user_id);
 -- Deactivations/non-owners first, then owner, to permit explicit role transfers
 -- when the source actually demotes the old owner before promoting another.
 for item in select x from jsonb_array_elements(p_snapshot->'members') x
   order by case when x->>'status'='inactive' then 0 when x->>'member_role'<>'owner' then 1 else 2 end loop
   member_sub:=(item->>'user_sub')::uuid; role_name:=item->>'member_role';
   if member_sub is null or role_name is null or role_name not in ('owner','doctor','frontdesk')
     or item->>'status' is null or item->>'status' not in ('active','inactive') then raise exception 'invalid member'; end if;
   active_member:=(item->>'status'='active' and w->>'status'='active');
   -- Never reactivate a globally disabled identity as a side-effect of a workspace sync.
   insert into public.central_identities(user_sub) values(member_sub) on conflict(user_sub) do nothing;
   insert into public.clinic_memberships(clinic_id,user_sub,workspace_id,tenant_slug,member_role,status)
   values(cid,member_sub,ws,w->>'tenant_slug',role_name,case when active_member then 'active' else 'inactive' end)
   on conflict(clinic_id,user_sub) do update set workspace_id=excluded.workspace_id,tenant_slug=excluded.tenant_slug,
     member_role=excluded.member_role,status=excluded.status,synced_at=now();
   select s.id into sid from public.staff s where s.clinic_id=cid and s.user_id=member_sub;
   if found then
     if role_name<>'owner' and (select count(*) from public.staff_branches where staff_id=sid and active)>1 then
       raise exception 'non-owner needs an explicit single-branch assignment before sync';
     end if;
     update public.staff set role=role_name,active=active_member where id=sid
       and (role is distinct from role_name or active is distinct from active_member);
   else
     insert into public.staff(clinic_id,user_id,full_name,role,active)
     values(cid,member_sub,left(coalesce(nullif(btrim(item->>'display_name'),''),'Clinic member'),80),role_name,active_member);
   end if;
   insert into public.profiles(id,default_clinic_id,branch_scope)
   values(member_sub,cid,case when role_name='owner' then 'all' else 'branch' end)
   on conflict(id) do nothing;
 end loop;
 update public.tenant_sync_state set last_sequence=seq,snapshot_hash=payload_hash,synced_at=now() where workspace_id=ws;
 return jsonb_build_object('status','applied','sequence',seq::text);
end $$;
revoke all on function public.apply_tenant_snapshot(jsonb) from public,anon,authenticated;
grant execute on function public.apply_tenant_snapshot(jsonb) to service_role;
commit;
