-- ============================================================================
-- myClinic · schema v4 · clinic branding
--
-- Adds the two logo slots and the print toggle to an existing database.
-- `schema.sql` already contains these columns, so a fresh install needs only
-- that file — run this one only if your clinic table predates v1.5.0.
--
--   supabase/schema.sql        -- fresh install (includes branding)
--   supabase/branding.sql      -- upgrade an existing install
--
-- Safe to run more than once.
-- ============================================================================

-- ------------------------------------------------------------------ columns
alter table public.clinics
  add column if not exists logo_square_url text,
  add column if not exists logo_wide_url text,
  add column if not exists logo_on_documents boolean not null default true;

-- Logos are stored as data URLs: no storage bucket, no CORS, no second fetch
-- when a clinic prints on a weak connection. The caps keep the clinic row (and
-- therefore the offline snapshot) small.
alter table public.clinics drop constraint if exists clinics_logo_square_size;
alter table public.clinics add constraint clinics_logo_square_size
  check (logo_square_url is null
    or (logo_square_url like 'data:image/%' and char_length(logo_square_url) <= 700000));

alter table public.clinics drop constraint if exists clinics_logo_wide_size;
alter table public.clinics add constraint clinics_logo_wide_size
  check (logo_wide_url is null
    or (logo_wide_url like 'data:image/%' and char_length(logo_wide_url) <= 900000));

-- ------------------------------------------------------------- schema level
-- Bumping app_meta is what makes the app show "database needs an upgrade".
insert into public.app_meta (schema_version, notes)
select 4, 'clinic branding'
where not exists (select 1 from public.app_meta where schema_version >= 4);

update public.app_meta
   set schema_version = 4, applied_at = now(), notes = 'clinic branding'
 where schema_version < 4;

select public.app_schema_version() as schema_version;

-- ------------------------------------------------- verification (rolled back)
begin;
do $$
declare
  v_clinic uuid;
  v_state text;
begin
  select id into v_clinic from public.clinics limit 1;
  if v_clinic is null then
    raise notice 'No clinics yet — skipping branding checks.';
    return;
  end if;

  -- Data URLs are accepted …
  update public.clinics
     set logo_square_url = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
         logo_on_documents = false
   where id = v_clinic
   returning license_state into v_state;

  -- … and anything that is not an image data URL is refused by the constraint.
  begin
    update public.clinics set logo_wide_url = 'https://example.com/logo.png' where id = v_clinic;
    raise exception 'SECURITY: a remote URL was accepted as a logo';
  exception when check_violation then
    raise notice 'ok · non data-URL logo rejected';
  end;

  raise notice 'ok · branding columns accept data URLs and respect the print toggle';
  raise exception 'rollback branding verification';
exception when others then
  if sqlerrm = 'rollback branding verification' then
    raise notice 'branding verification complete';
  else
    raise;
  end if;
end $$;
rollback;
