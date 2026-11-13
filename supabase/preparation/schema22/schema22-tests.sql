-- SCRATCH DATABASE ONLY. Fixtures and tests roll back. JWT signatures are not
-- tested here: local auth stubs deliberately only exercise database predicates.
begin;
create function pg_temp.expect_denied(stmt text, wanted text default '42501')
returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate=wanted then return; end if;
    raise exception 'unexpected SQLSTATE %, expected % for %: %',sqlstate,wanted,stmt,sqlerrm;
  end;
  raise exception 'expected denial % but statement succeeded: %',wanted,stmt;
end $$;
grant execute on function pg_temp.expect_denied(text,text) to authenticated,anon;

do $tests$
declare
 ca uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid();
 ua uuid:=gen_random_uuid(); ud uuid:=gen_random_uuid(); uf uuid:=gen_random_uuid(); ub uuid:=gen_random_uuid();
 wa uuid:=gen_random_uuid(); wb uuid:=gen_random_uuid();
 sa uuid; sd uuid; sf uuid; sb uuid; pa uuid; pb uuid; ba uuid; bb uuid; extra_branch uuid;
 r record; role_name text; usr uuid; j jsonb; basej jsonb; rowj jsonb; expr text;
 n integer; total integer:=0; stmt text; bad jsonb; foreign_rpc text;
begin
  -- Fail if any table is missing either independent restrictive policy.
  for r in select oid,relname from pg_class where relnamespace='public'::regnamespace and relkind='r' loop
    select count(*) into n from pg_policy where polrelid=r.oid and not polpermissive
      and polname in ('tenant_issuer_restrictive','tenant_membership_restrictive');
    if n<>2 then raise exception 'missing tenant/issuer policy on %',r.relname; end if;
  end loop;
  if position('target is distinct from (j->>''clinic_id'')::uuid' in pg_get_functiondef('public.tenant_context_valid(uuid)'::regprocedure))=0 then
    raise exception 'missing explicit clinic-claim binding';
  end if;

  if public.app_schema_version()<>22 then raise exception 'expected schema 22'; end if;
  if (select tenant_access_enabled from public.schema_meta) then raise exception 'installation must default OFF'; end if;
  insert into public.central_identities(user_sub) values(ua),(ud),(uf),(ub);
  insert into public.clinics(id,name,slug) values(ca,'Schema22 A','schema22-a'),(cb,'Schema22 B','schema22-b');
  insert into public.tenant_sync_state(workspace_id,clinic_id,last_sequence) values(wa,ca,0),(wb,cb,0);
  insert into public.clinic_memberships(clinic_id,user_sub,workspace_id,tenant_slug,member_role)
  values(ca,ua,wa,'schema22-a','owner'),(ca,ud,wa,'schema22-a','doctor'),
        (ca,uf,wa,'schema22-a','frontdesk'),(cb,ub,wb,'schema22-b','owner');
  insert into public.staff(clinic_id,user_id,full_name,role) values(ca,ua,'Owner A','owner') returning id into sa;
  insert into public.staff(clinic_id,user_id,full_name,role) values(ca,ud,'Doctor A','doctor') returning id into sd;
  insert into public.staff(clinic_id,user_id,full_name,role) values(ca,uf,'Desk A','frontdesk') returning id into sf;
  insert into public.staff(clinic_id,user_id,full_name,role) values(cb,ub,'Owner B','owner') returning id into sb;
  insert into public.profiles(id,default_clinic_id) values(ua,ca),(ud,ca),(uf,ca),(ub,cb);
  select id into ba from public.branches where clinic_id=ca limit 1;
  select id into bb from public.branches where clinic_id=cb limit 1;
  insert into public.branches(clinic_id,name,code) values(ca,'Other A branch','OTHER') returning id into extra_branch;
  insert into public.clinic_subscriptions(clinic_id,status,current_period_end) values(ca,'active',now()+interval '30 days'),(cb,'active',now()+interval '30 days')
    on conflict(clinic_id) do update set status='active',current_period_end=excluded.current_period_end;
  update public.clinic_subscriptions set plan='chain' where clinic_id in(ca,cb);
  insert into public.patients(clinic_id,code,full_name) values(ca,'PT-A','Patient A') returning id into pa;
  insert into public.patients(clinic_id,code,full_name) values(cb,'PT-B','Patient B') returning id into pb;
  insert into public.appointments(clinic_id,patient_id,doctor_id,scheduled_on,scheduled_at,branch_id)
    values(ca,pa,sd,current_date,'10:00',ba),(cb,pb,sb,current_date,'10:00',bb);
  insert into public.consultations(clinic_id,patient_id,doctor_id,visited_on,branch_id)
    values(ca,pa,sd,current_date,ba),(cb,pb,sb,current_date,bb);
  insert into public.invoices(clinic_id,patient_id,number,branch_id)
    values(ca,pa,'TEST-A',ba),(cb,pb,'TEST-B',bb);
  insert into public.day_closes(clinic_id,closed_on,closed_by,branch_id)
    values(ca,current_date,sa,ba),(cb,current_date,sb,bb);
  insert into public.reminders(clinic_id,patient_id,draft_key,kind)
    values(ca,pa,'test-a','appointment'),(cb,pb,'test-b','appointment');
  insert into public.license_events(clinic_id,actor,kind) values(ca,ua,'status'),(cb,ub,'status');
  insert into public.invites(clinic_id,email,role) values(cb,'b@example.invalid','doctor');
  insert into public.appointments(clinic_id,patient_id,doctor_id,scheduled_on,scheduled_at,branch_id)
    values(ca,pa,sa,current_date,'10:30',extra_branch);
  insert into public.consultations(clinic_id,patient_id,doctor_id,visited_on,branch_id)
    values(ca,pa,sa,current_date,extra_branch);
  insert into public.invoices(clinic_id,patient_id,number,branch_id)
    values(ca,pa,'OTHER-A',extra_branch);


  basej:=jsonb_build_object('iss','https://inaqzvzfongngahxptzw.supabase.co/functions/v1/oidc',
    'sub',ua,'role','authenticated','aud','authenticated','clinic_id',ca,'workspace_id',wa,
    'tenant_slug','schema22-a','member_role','owner','jti',gen_random_uuid(),
    'iat',floor(extract(epoch from now())),'exp',floor(extract(epoch from now()))+900);
  perform set_config('request.jwt.claims',basej::text,true);
  set local role authenticated;
  if public.tenant_context_valid(ca) then raise exception 'activation gate bypass'; end if;
  select count(*) into n from public.patients;
  if n<>0 then raise exception 'disabled access still reads PHI'; end if;
  reset role;
  update public.schema_meta set tenant_access_enabled=true;

  -- Every clinical table and operation, for every existing role, against B.
  foreach role_name in array array['owner','doctor','frontdesk'] loop
    usr:=case role_name when 'owner' then ua when 'doctor' then ud else uf end;
    j:=basej||jsonb_build_object('sub',usr,'member_role',role_name);
    perform set_config('request.jwt.claims',j::text,true);
    for r in select c.relname tbl from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'
      and (c.relname='clinics' or exists(select from pg_attribute a where a.attrelid=c.oid and a.attname='clinic_id' and not a.attisdropped))
    loop
      expr:=case when r.tbl='clinics' then 'id' else 'clinic_id' end;
      execute format('select to_jsonb(t) from public.%I t where %I=$1 limit 1',r.tbl,expr) into rowj using cb;
      if rowj is null then raise exception 'missing foreign-tenant fixture for %',r.tbl; end if;
      if rowj ? 'id' and r.tbl<>'clinics' then rowj:=rowj||jsonb_build_object('id',gen_random_uuid()); end if;
      set local role authenticated;
      if has_table_privilege(current_user,format('public.%I',r.tbl),'SELECT') then
        execute format('select count(*) from public.%I where %I=$1',r.tbl,expr) into n using cb;
        if n<>0 then raise exception 'cross-tenant SELECT: % %',role_name,r.tbl; end if;
      else perform pg_temp.expect_denied(format('select * from public.%I',r.tbl)); end if;
      if has_table_privilege(current_user,format('public.%I',r.tbl),'UPDATE') then
        execute format('update public.%I set %I=%I where %I=$1',r.tbl,expr,expr,expr) using cb;
        get diagnostics n=row_count;
        if n<>0 then raise exception 'cross-tenant UPDATE: % %',role_name,r.tbl; end if;
      else perform pg_temp.expect_denied(format('update public.%I set %I=%I',r.tbl,expr,expr)); end if;
      if has_table_privilege(current_user,format('public.%I',r.tbl),'DELETE') then
        execute format('delete from public.%I where %I=$1',r.tbl,expr) using cb;
        get diagnostics n=row_count;
        if n<>0 then raise exception 'cross-tenant DELETE: % %',role_name,r.tbl; end if;
      else perform pg_temp.expect_denied(format('delete from public.%I',r.tbl)); end if;
      perform pg_temp.expect_denied(format('insert into public.%I select * from jsonb_populate_record(null::public.%I,%L::jsonb)',r.tbl,r.tbl,rowj));
      reset role;
      total:=total+4;
    end loop;
    set local role authenticated;
    if not public.is_clinic_staff(ca) then raise exception 'own membership failed for %',role_name; end if;
    if public.is_clinic_staff(cb) then raise exception 'foreign clinic helper leak'; end if;
    select count(*) into n from public.patients where clinic_id=ca;
    if n<>1 then raise exception 'own patients unavailable for %',role_name; end if;
    select count(*) into n from public.profiles;
    if n<>1 then raise exception 'profile self isolation failed'; end if;
    select count(*) into n from public.appointments where clinic_id=ca;
    if n<>(case when role_name='owner' then 2 else 1 end) then raise exception 'appointment branch isolation failed for %',role_name; end if;
    if role_name<>'frontdesk' then
      select count(*) into n from public.consultations where clinic_id=ca;
      if n<>(case when role_name='owner' then 2 else 1 end) then raise exception 'consultation branch isolation failed'; end if;
    end if;
    if role_name<>'doctor' then
      select count(*) into n from public.invoices where clinic_id=ca;
      if n<>(case when role_name='owner' then 2 else 1 end) then raise exception 'invoice branch isolation failed'; end if;
    end if;
    if role_name='frontdesk' then
      select count(*) into n from public.consultations;
      if n<>0 then raise exception 'front desk clinical chart leak'; end if;
    end if;
    if role_name<>'owner' then
      if public.can_access_branch(ca,extra_branch) then raise exception 'unassigned branch accessible'; end if;
      perform pg_temp.expect_denied(format('select public.set_active_branch(%L)',extra_branch));
      perform pg_temp.expect_denied('select public.set_branch_scope(''all'')');
    end if;
    if role_name='doctor' then
      select count(*) into n from public.invoices;
      if n<>0 then raise exception 'doctor finance leak'; end if;
    end if;
    perform pg_temp.expect_denied(format('select public.next_patient_code(%L)',cb));
    perform pg_temp.expect_denied(format('select public.next_invoice_number(%L,''INV'')',cb));
    perform pg_temp.expect_denied(format('select public.next_token_no(%L,current_date)',sb));
    perform pg_temp.expect_denied(format('select public.license_state(%L)',cb));
    perform pg_temp.expect_denied(format('select public.issue_token(%L,%L,%L)',cb,pb,sb));
    perform pg_temp.expect_denied(format('select public.create_branch(%L,''Bad branch'')',cb));
    perform pg_temp.expect_denied(format('select public.set_staff_branches(%L,array[%L::uuid])',sb,bb));
    perform pg_temp.expect_denied(format('select public.set_active_branch(%L)',bb));
    reset role;
  end loop;

  -- Exact claim failures including the native Central/clinical Auth issuers.
  for bad in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('iss','https://inaqzvzfongngahxptzw.supabase.co/auth/v1'),
    jsonb_build_object('iss','https://nosqdnmnztsikfygyiqa.supabase.co/auth/v1'),
    jsonb_build_object('sub',ub),jsonb_build_object('clinic_id',cb),
    jsonb_build_object('workspace_id',wb),jsonb_build_object('tenant_slug','schema22-b'),
    jsonb_build_object('member_role','doctor'),jsonb_build_object('role','anon'),
    jsonb_build_object('aud','wrong'),jsonb_build_object('jti',''),
    jsonb_build_object('exp',floor(extract(epoch from now()))-1),
    jsonb_build_object('exp',floor(extract(epoch from now()))+901),
    jsonb_build_object('iat',floor(extract(epoch from now()))+60),
    jsonb_build_object('sub','not-a-uuid'),jsonb_build_object('exp','bad')
  )) loop
    perform set_config('request.jwt.claims',(basej||bad)::text,true);
    set local role authenticated;
    if public.tenant_context_valid(ca) then raise exception 'bad claim accepted: %',bad; end if;
    select count(*) into n from public.patients;
    if n<>0 then raise exception 'bad claims read PHI: %',bad; end if;
    reset role;
  end loop;

  perform set_config('request.jwt.claims',basej::text,true);
  update public.clinic_memberships set status='inactive' where clinic_id=ca and user_sub=ua;
  set local role authenticated;
  if public.is_clinic_staff(ca) then raise exception 'inactive membership accepted'; end if;
  reset role;
  update public.clinic_memberships set status='active' where clinic_id=ca and user_sub=ua;
  update public.central_identities set active=false where user_sub=ua;
  set local role authenticated;
  if public.is_clinic_staff(ca) then raise exception 'inactive identity accepted'; end if;
  reset role;
  update public.central_identities set active=true where user_sub=ua;

  -- Positive writes and tenant-bound references. Owner can write A, not link B.
  set local role authenticated;
  insert into public.patients(clinic_id,code,full_name) values(ca,'PT-NEW','New own patient');
  perform pg_temp.expect_denied(format('insert into public.appointments(clinic_id,patient_id,doctor_id,scheduled_on,scheduled_at,branch_id) values(%L,%L,%L,current_date,''11:00'',%L)',ca,pb,sd,ba));
  perform pg_temp.expect_denied(format('update public.staff set role=''doctor'' where id=%L',sa));
  perform pg_temp.expect_denied(format('update public.clinics set slug=''changed'' where id=%L',ca));
  perform pg_temp.expect_denied(format('update public.profiles set default_clinic_id=%L where id=%L',cb,ua));
  perform pg_temp.expect_denied('insert into public.central_identities(user_sub) values(gen_random_uuid())');
  perform pg_temp.expect_denied(format('update public.clinic_memberships set member_role=''owner'' where user_sub=%L',ud));
  perform public.set_branch_scope('all');
  perform public.next_patient_code(ca);
  perform public.next_invoice_number(ca,'TEST');
  perform public.next_token_no(sd,current_date);
  perform public.license_state(ca);
  perform public.create_branch(ca,'RPC branch');
  perform public.set_active_branch(ba);
  perform public.issue_token(ca,pa,sd);
  reset role;

  perform pg_temp.expect_denied(format('insert into public.appointments(clinic_id,patient_id,doctor_id,scheduled_on,scheduled_at,branch_id) values(%L,%L,%L,current_date,''11:00'',%L)',ca,pb,sd,ba),'23503');

  -- Preserve licence read-only enforcement, without hiding existing data.
  update public.clinic_subscriptions set status='read_only' where clinic_id=ca;
  set local role authenticated;
  perform pg_temp.expect_denied(format('insert into public.patients(clinic_id,code,full_name) values(%L,''NO-WRITE'',''Denied'')',ca),'53401');
  select count(*) into n from public.patients where clinic_id=ca;
  if n<1 then raise exception 'read-only licence hid readable clinical data'; end if;
  reset role;
  update public.clinic_subscriptions set status='active' where clinic_id=ca;

  -- No anonymous tables or application RPCs, even PUBLIC-inherited execute.
  set local role anon;
  for r in select relname tbl from pg_class where relnamespace='public'::regnamespace and relkind='r' loop
    if has_table_privilege(current_user,format('public.%I',r.tbl),'SELECT') then raise exception 'anon table grant: %',r.tbl; end if;
  end loop;
  perform pg_temp.expect_denied('select public.public_clinic_profile(''schema22-a'')');
  perform pg_temp.expect_denied('select public.ensure_default_branch(gen_random_uuid())');
  reset role;
  set local role authenticated;
  perform pg_temp.expect_denied('select public.create_clinic(''{}''::jsonb,''{}''::jsonb)');
  perform pg_temp.expect_denied('select public.accept_invite(null)');
  perform pg_temp.expect_denied(format('select public.start_trial(%L)',ca));
  perform pg_temp.expect_denied(format('select public.change_plan(%L,''growth'')',ca));
  perform pg_temp.expect_denied(format('select public.ensure_default_branch(%L)',cb));
  reset role;

  raise notice 'SCHEMA22: % cross-tenant table/operation/role checks passed',total;
  raise notice 'SCHEMA22: positive access, negative claims, mirror revocation, role separation, RPC denylist, composite FK and activation gate passed';
end $tests$;
rollback;
