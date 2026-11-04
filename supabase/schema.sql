-- =============================================================================
-- myClinic — database schema
--
--   ██  THIS IS THE ONLY SQL FILE THE APP NEEDS.
--
--   Run it whole, top to bottom, in Supabase → SQL Editor.
--   Or:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
--
-- It is idempotent and additive: safe to re-run on any version, from a blank
-- project to the current one. It never drops a table, never deletes a clinical
-- or billing record, and never rewrites a row you have already changed.
--
-- ── What is inside ───────────────────────────────────────────────────────────
--   §0  version + migration registry     how the database learns where it is
--   §1  core tables                      clinics, staff, patients, appointments…
--   §2  row-level security               the role matrix, enforced by Postgres
--   §3  subscriptions and licensing      trial → active → grace → read-only
--   §4  clinic branding                  logos on documents and messages
--   §5  helper functions                 tokens, invoice numbers, provisioning
--   §6  prescription numbering           RX series + safety acknowledgement log
--   §7  day close + reminder log         cash reconciliation + what was sent
--
-- ── Versioning ───────────────────────────────────────────────────────────────
--   `public.app_schema_version()` reports this schema. The app compares it with
--   SCHEMA_VERSION in src/lib/version.js and warns when the database is behind.
--
--   The migration registry (`schema_migrations`, see §0) records every release
--   that touched the database. Each migration below is written to be skipped
--   when it has already been applied — so a half-upgraded database finishes the
--   upgrade on the next run instead of failing.
--
--   Released schema versions
--     1  core clinic management          v1.0.0
--     2  role matrix, offline sync       v1.2.0
--     3  subscriptions and licensing     v1.3.0
--     4  clinic branding (logos)         v1.5.0
--     5  UPI collection                  v1.7.0
--     6  prescription numbering          v1.8.0
--     7  day close + reminder log        v1.10.0
--
-- To add a migration: append a numbered block inside its migration's guard,
-- add its id to `migrations` in §0, and bump SCHEMA_VERSION in the app.
-- =============================================================================
begin;

create extension if not exists "pgcrypto";

-- =============================================================================
-- §0 · VERSION + MIGRATION REGISTRY
-- =============================================================================
-- A single row table: `schema_version` is the number the app reads, and
-- `schema_migrations` is the audit trail of what produced it.
create table if not exists public.app_meta (
  id boolean primary key default true check (id),
  schema_version integer not null,
  applied_at timestamptz not null default now(),
  notes text not null default ''
);

create table if not exists public.schema_migrations (
  version integer primary key,
  name text not null,
  applied_at timestamptz not null default now(),
  app_version text not null default '',
  summary text not null default ''
);

-- A blank project starts at version 1; an existing project keeps whatever
-- version it has already reached.
insert into public.app_meta (schema_version, notes)
select 1, 'initial schema'
where not exists (select 1 from public.app_meta);

-- The registry is the source of truth for "which releases has this database
-- seen". `on conflict do nothing` means re-running never rewrites history.
insert into public.schema_migrations (version, name, app_version, summary) values
  (1, 'core',           '1.0.0', 'clinics, staff, profiles, patients, appointments, consultations, invoices'),
  (2, 'roles-offline',  '1.2.0', 'row-level security role matrix, offline sync, token queue'),
  (3, 'licensing',      '1.3.0', 'subscriptions, seats, grace period, read-only write gate'),
  (4, 'branding',       '1.5.0', 'square and wide clinic logos, print toggle'),
  (5, 'upi-collection', '1.7.0', 'clinic UPI VPA, payment reference and paid-on date')
on conflict (version) do nothing;

-- Report where the database is. Called by the app on boot; also handy by hand.
create or replace function public.app_schema_version()
returns integer language sql stable as $$
  select schema_version from public.app_meta limit 1;
$$;

-- Newest migration first, for the Settings → About screen and support calls.
create or replace function public.app_migrations()
returns table (version integer, name text, app_version text, applied_at timestamptz, summary text)
language sql stable as $$
  select version, name, app_version, applied_at, summary
  from public.schema_migrations order by version desc;
$$;

grant execute on function public.app_schema_version() to authenticated, anon;
grant execute on function public.app_migrations() to authenticated;

-- =============================================================================
-- §1 · CORE TABLES
-- =============================================================================

-- ---------------------------------------------------------------- helpers
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- One clinic name → one URL segment: lower-case ASCII, hyphenated, with the
-- hyphens the regexp leaves at either end trimmed off, and 'clinic' when nothing
-- survives (a name written entirely in a script with no ASCII letters).
--
-- Two forms to avoid here, both of which look right and are not:
--   btrim(x both '-' from y)  — `btrim` has no BOTH/FROM form, that is `trim`
--   leaving end hyphens        — '--clinic--' reads as a broken link in an email
--
-- Kept out of the migration that first needed it so a clinic created or renamed
-- later gets the same rule, and so the test suite can call it directly.
create or replace function public.clinic_slug(p_name text)
returns text language sql immutable set search_path = public as $$
  select coalesce(
    nullif(btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'), '-'), ''),
    'clinic');
$$;

-- ---------------------------------------------------------------- clinics
create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  slug text unique,
  clinic_type text not null default 'General Practice',
  phone text not null default '' check (char_length(phone) <= 24),
  email text not null default '' check (char_length(email) <= 120),
  address text not null default '' check (char_length(address) <= 400),
  gstin text not null default '' check (char_length(gstin) <= 20),
  consultation_fee_paise bigint not null default 50000 check (consultation_fee_paise between 0 and 99999999),
  follow_up_fee_paise bigint not null default 25000 check (follow_up_fee_paise between 0 and 99999999),
  follow_up_days integer not null default 15 check (follow_up_days between 0 and 180),
  slot_minutes integer not null default 15 check (slot_minutes in (5,10,15,20,30,45,60)),
  open_time time not null default '09:00',
  close_time time not null default '20:00',
  gst_enabled boolean not null default true,
  gst_rate numeric(5,2) not null default 0 check (gst_rate between 0 and 28),
  invoice_prefix text not null default 'INV' check (char_length(invoice_prefix) between 1 and 8),
  brand_color text not null default '#0f766e' check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  -- Branding. Data URLs, so a logo needs no storage bucket, no CORS and no
  -- second fetch on clinic wifi. The size guard keeps a clinic row small enough
  -- for the offline snapshot (a 512px PNG lands around 40-60 KB).
  logo_square_url text check (logo_square_url is null or (logo_square_url like 'data:image/%' and char_length(logo_square_url) <= 700000)),
  logo_wide_url   text check (logo_wide_url   is null or (logo_wide_url   like 'data:image/%' and char_length(logo_wide_url)   <= 900000)),
  logo_on_documents boolean not null default true,
  -- UPI collection. The VPA is what an unpaid invoice's QR code points at, so the
  -- patient pays the clinic directly and the money never passes through the app.
  upi_id text not null default '' check (char_length(upi_id) <= 64),
  upi_payee_name text not null default '' check (char_length(upi_payee_name) <= 60),
  upi_qr_on_invoices boolean not null default true,
  plan text not null default 'growth' check (plan in ('solo','growth','chain')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists clinics_touch on public.clinics;
create trigger clinics_touch before update on public.clinics for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- staff
create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null check (char_length(trim(full_name)) between 1 and 80),
  role text not null default 'doctor' check (role in ('owner','doctor','frontdesk')),
  specialty text not null default '' check (char_length(specialty) <= 80),
  qualification text not null default '' check (char_length(qualification) <= 120),
  registration_no text not null default '' check (char_length(registration_no) <= 40),
  phone text not null default '' check (char_length(phone) <= 24),
  email text not null default '' check (char_length(email) <= 120),
  color text not null default '#0f766e' check (color ~ '^#[0-9a-fA-F]{6}$'),
  day_start time not null default '09:00',
  day_end time not null default '13:00',
  slot_minutes integer not null default 15 check (slot_minutes in (5,10,15,20,30,45,60)),
  fee_paise bigint not null default 50000 check (fee_paise between 0 and 99999999),
  follow_up_fee_paise bigint not null default 25000 check (follow_up_fee_paise between 0 and 99999999),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists staff_one_owner_per_clinic on public.staff(clinic_id) where role = 'owner';
create index if not exists staff_clinic_idx on public.staff(clinic_id);
create index if not exists staff_user_idx on public.staff(user_id);
drop trigger if exists staff_touch on public.staff;
create trigger staff_touch before update on public.staff for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- role helpers
-- Defined before every table and policy that uses them: a policy may only call a
-- function that already exists. (Earlier revisions defined these 250 lines below
-- the `invites` policies that call them, which made a *fresh* install fail part
-- way through — the upgrade path worked only because the functions were present
-- from a previous run.)
create or replace function public.has_role(target uuid, roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff s
    where s.clinic_id = target and s.user_id = auth.uid() and s.active and s.role = any (roles)
  );
$$;

create or replace function public.is_clinic_staff(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff s
    where s.clinic_id = target and s.user_id = auth.uid() and s.active
  );
$$;

create or replace function public.clinic_role(target uuid)
returns text language sql stable security definer set search_path = public as $$
  select s.role from public.staff s
  where s.clinic_id = target and s.user_id = auth.uid() and s.active
  limit 1;
$$;

create or replace function public.is_clinic_owner(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(target, array['owner']);
$$;

-- ---------------------------------------------------------------- invitations
-- Membership is granted, never self-asserted (see security audit run 1):
-- an owner creates an invite for an email; the invited user claims it by
-- signing up/signing in with that email. No staff row is written by the client.
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 120),
  role text not null default 'frontdesk' check (role in ('doctor','frontdesk')),
  full_name text not null default '' check (char_length(full_name) <= 80),
  specialty text not null default '',
  qualification text not null default '',
  phone text not null default '',
  invited_by uuid references auth.users(id) on delete set null,
  token uuid not null default gen_random_uuid(),
  accepted_at timestamptz,
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now()
);
create index if not exists invites_clinic_idx on public.invites(clinic_id);
create unique index if not exists invites_one_pending_per_email
  on public.invites(clinic_id, lower(email)) where accepted_at is null;

alter table public.invites enable row level security;

drop policy if exists invites_owner_read on public.invites;
create policy invites_owner_read on public.invites for select to authenticated
  using (public.is_clinic_owner(clinic_id));

-- The invitee may see their own pending invite (matched on the verified email).
drop policy if exists invites_invitee_read on public.invites;
create policy invites_invitee_read on public.invites for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists invites_owner_write on public.invites;
create policy invites_owner_write on public.invites for insert to authenticated
  with check (public.is_clinic_owner(clinic_id) and invited_by = auth.uid());

drop policy if exists invites_owner_delete on public.invites;
create policy invites_owner_delete on public.invites for delete to authenticated
  using (public.is_clinic_owner(clinic_id));

create or replace function public.invite_staff(
  p_clinic uuid, p_email text, p_role text default 'frontdesk', p_name text default ''
) returns public.invites
language plpgsql security definer set search_path = public as $$
declare row_out public.invites;
begin
  if not public.is_clinic_owner(p_clinic) then
    raise exception 'only a clinic owner can invite staff' using errcode = '42501';
  end if;
  if p_role not in ('doctor','frontdesk') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  insert into public.invites (clinic_id, email, role, full_name, invited_by)
  values (p_clinic, lower(trim(p_email)), p_role, coalesce(p_name, ''), auth.uid())
  on conflict do nothing
  returning * into row_out;

  if row_out.id is null then
    select * into row_out from public.invites
      where clinic_id = p_clinic and lower(email) = lower(trim(p_email)) and accepted_at is null;
  end if;
  return row_out;
end $$;

-- The signed-in user claims any pending invite addressed to their verified email.
create or replace function public.accept_invite(p_token uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv public.invites; email_now text;
begin
  email_now := lower(coalesce(auth.jwt() ->> 'email', ''));
  if email_now = '' then raise exception 'not authenticated' using errcode = '42501'; end if;

  select * into inv from public.invites
    where lower(email) = email_now
      and accepted_at is null
      and expires_at > now()
      and (p_token is null or token = p_token)
    order by created_at desc
    limit 1;

  if inv.id is null then raise exception 'no pending invitation for this email' using errcode = '42501'; end if;

  insert into public.staff (clinic_id, user_id, full_name, role, specialty, qualification, phone, email)
  values (inv.clinic_id, auth.uid(),
          coalesce(nullif(inv.full_name, ''), split_part(email_now, '@', 1)),
          inv.role, inv.specialty, inv.qualification, inv.phone, email_now)
  on conflict do nothing;

  update public.invites set accepted_at = now() where id = inv.id;
  update public.profiles set default_clinic_id = inv.clinic_id where id = auth.uid() and default_clinic_id is null;
  return inv.clinic_id;
end $$;

grant execute on function public.invite_staff(uuid, text, text, text) to authenticated;
grant execute on function public.accept_invite(uuid) to authenticated;

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 80),
  phone text not null default '' check (char_length(phone) <= 24),
  designation text not null default '' check (char_length(designation) <= 80),
  theme text not null default 'system' check (theme in ('light','dark','system')),
  density text not null default 'comfortable' check (density in ('comfortable','compact')),
  reminders_enabled boolean not null default true,
  reminder_lead_hours integer not null default 24 check (reminder_lead_hours in (1,2,4,12,24,48)),
  quiet_hours text not null default '21:00-08:00' check (char_length(quiet_hours) <= 20),
  default_clinic_id uuid references public.clinics(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- patients
create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  code text not null check (char_length(code) between 2 and 24),
  full_name text not null check (char_length(trim(full_name)) between 1 and 120),
  phone text not null default '' check (char_length(phone) <= 24),
  email text not null default '' check (char_length(email) <= 120),
  gender text not null default 'Other' check (gender in ('Female','Male','Other')),
  dob date,
  age_years integer check (age_years between 0 and 130),
  blood_group text not null default '' check (blood_group in ('','A+','A-','B+','B-','AB+','AB-','O+','O-')),
  address text not null default '' check (char_length(address) <= 300),
  city text not null default '' check (char_length(city) <= 80),
  emergency_contact text not null default '' check (char_length(emergency_contact) <= 120),
  tags text[] not null default '{}',
  allergies text not null default '' check (char_length(allergies) <= 500),
  notes text not null default '' check (char_length(notes) <= 2000),
  archived boolean not null default false,
  client_id uuid,
  client_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, code)
);
create index if not exists patients_clinic_idx on public.patients(clinic_id);
create index if not exists patients_clinic_name_idx on public.patients(clinic_id, lower(full_name));
create index if not exists patients_phone_idx on public.patients(clinic_id, phone);
drop trigger if exists patients_touch on public.patients;
create trigger patients_touch before update on public.patients for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- appointments
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  doctor_id uuid not null references public.staff(id) on delete restrict,
  scheduled_on date not null default current_date,
  scheduled_at time not null,
  duration_minutes integer not null default 15 check (duration_minutes between 5 and 240),
  kind text not null default 'New consultation',
  status text not null default 'booked' check (status in ('booked','checked-in','in-consult','completed','cancelled','no-show')),
  reason text not null default '' check (char_length(reason) <= 300),
  notes text not null default '' check (char_length(notes) <= 1000),
  source text not null default 'walk-in' check (source in ('walk-in','phone','online','referral')),
  token_no integer check (token_no is null or token_no between 1 and 999),
  client_id uuid,               -- offline-generated id, used for idempotent replay
  client_updated_at timestamptz, -- last local edit; powers opt-in conflict detection
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (doctor_id, scheduled_on, scheduled_at)
);
-- Token queue: one live token per doctor per day. Tokens restart every morning.
create unique index if not exists appointments_token_per_doctor_day
  on public.appointments(doctor_id, scheduled_on, token_no) where token_no is not null;
create index if not exists appointments_token_queue_idx
  on public.appointments(clinic_id, scheduled_on, status) where token_no is not null;
create index if not exists appointments_clinic_day_idx on public.appointments(clinic_id, scheduled_on);
create index if not exists appointments_patient_idx on public.appointments(patient_id);
create index if not exists appointments_doctor_idx on public.appointments(doctor_id);
drop trigger if exists appointments_touch on public.appointments;
create trigger appointments_touch before update on public.appointments for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- consultations
create table if not exists public.consultations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  doctor_id uuid not null references public.staff(id) on delete restrict,
  appointment_id uuid references public.appointments(id) on delete set null,
  visited_on date not null default current_date,
  vitals jsonb not null default '{}'::jsonb,
  complaint text not null default '' check (char_length(complaint) <= 2000),
  examination text not null default '' check (char_length(examination) <= 2000),
  diagnoses text[] not null default '{}',
  advice text not null default '' check (char_length(advice) <= 4000),
  prescription jsonb not null default '[]'::jsonb,
  follow_up_on date,
  follow_up_done boolean not null default false,
  rx_language text not null default 'en' check (rx_language in ('en','hi','mr','ta','te','bn','gu','kn','ml','pa')),
  client_id uuid,
  client_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists consultations_clinic_day_idx on public.consultations(clinic_id, visited_on);
create index if not exists consultations_patient_idx on public.consultations(patient_id);
create index if not exists consultations_followup_idx on public.consultations(clinic_id, follow_up_on) where follow_up_done = false;
drop trigger if exists consultations_touch on public.consultations;
create trigger consultations_touch before update on public.consultations for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- invoices
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  number text not null check (char_length(number) between 3 and 32),
  patient_id uuid not null references public.patients(id) on delete restrict,
  doctor_id uuid references public.staff(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  issued_on date not null default current_date,
  lines jsonb not null default '[]'::jsonb,
  subtotal_paise bigint not null default 0 check (subtotal_paise >= 0),
  discount_paise bigint not null default 0 check (discount_paise >= 0),
  tax_paise bigint not null default 0 check (tax_paise >= 0),
  total_paise bigint not null default 0 check (total_paise >= 0),
  paid_paise bigint not null default 0 check (paid_paise >= 0),
  method text not null default 'cash' check (method in ('cash','upi','card','insurance','credit')),
  -- Collection trail on the invoice itself: when the last payment landed and the
  -- reference the front desk was given (UPI UTR, card last-4, receipt number).
  paid_on date,
  payment_ref text not null default '' check (char_length(payment_ref) <= 60),
  status text not null default 'unpaid' check (status in ('draft','unpaid','partial','paid','void')),
  notes text not null default '' check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, number),
  check (paid_paise <= total_paise)
);
create index if not exists invoices_clinic_day_idx on public.invoices(clinic_id, issued_on);
create index if not exists invoices_patient_idx on public.invoices(patient_id);
create index if not exists invoices_status_idx on public.invoices(clinic_id, status);
drop trigger if exists invoices_touch on public.invoices;
create trigger invoices_touch before update on public.invoices for each row execute function public.touch_updated_at();

-- =============================================================================
-- RLS — v2 role matrix
-- Principle: membership is granted, never self-asserted; role is server-owned;
-- every policy names the roles it exists for.
--   owner    : everything, including team, settings, voids and destructive deletes
--   doctor   : clinical records, prescriptions, follow-ups; reads billing
--   frontdesk: patients, appointments, tokens, invoices and payment collection
-- =============================================================================
alter table public.clinics enable row level security;
alter table public.staff enable row level security;
alter table public.profiles enable row level security;
alter table public.patients enable row level security;
alter table public.appointments enable row level security;
alter table public.consultations enable row level security;
alter table public.invoices enable row level security;

-- ---------------------------------------------------------------- clinics
drop policy if exists clinics_read on public.clinics;
create policy clinics_read on public.clinics for select to authenticated
  using (public.is_clinic_staff(id));

-- Creation happens only through create_clinic() (security definer, atomic).
drop policy if exists clinics_insert on public.clinics;

drop policy if exists clinics_owner_write on public.clinics;
create policy clinics_owner_write on public.clinics for update to authenticated
  using (public.is_clinic_owner(id)) with check (public.is_clinic_owner(id));

-- ---------------------------------------------------------------- staff
-- Members can read the roster of their clinic (and their own row everywhere).
drop policy if exists staff_read on public.staff;
create policy staff_read on public.staff for select to authenticated
  using (public.is_clinic_staff(clinic_id) or user_id = auth.uid());

-- Only an owner may add staff. The owner row itself is created by create_clinic().
-- A user may still claim an invite that was addressed to their email (see accept_invite()).
drop policy if exists staff_insert on public.staff;
create policy staff_insert on public.staff for insert to authenticated
  with check (
    public.is_clinic_owner(clinic_id)
    and role <> 'owner'                       -- owner transfer has its own function
    and user_id is distinct from auth.uid()   -- no self-enrolment
  );

-- Only an owner may change someone else; nobody may change their own role or clinic.
drop policy if exists staff_update on public.staff;
create policy staff_update on public.staff for update to authenticated
  using (public.is_clinic_owner(clinic_id))
  with check (
    public.is_clinic_owner(clinic_id)
    and role <> 'owner'
  );

-- A member may edit only their own non-security profile columns (name, phone, colour...).
-- Enforced by the trigger below so the policy can stay simple.
drop policy if exists staff_self_update on public.staff;
create policy staff_self_update on public.staff for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists staff_delete on public.staff;
create policy staff_delete on public.staff for delete to authenticated
  using (public.is_clinic_owner(clinic_id) and role <> 'owner');

-- Column-level guard: even with a permissive policy, a member cannot promote
-- themselves, move clinics, or unlink someone else's account.
create or replace function public.staff_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;                -- service_role / migrations
  if public.is_clinic_owner(old.clinic_id) then return new; end if;  -- owners keep full control

  if new.role is distinct from old.role then
    raise exception 'only a clinic owner can change a role' using errcode = '42501';
  end if;
  if new.clinic_id is distinct from old.clinic_id then
    raise exception 'a staff row cannot be moved between clinics' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'only a clinic owner can relink an account' using errcode = '42501';
  end if;
  if new.active is distinct from old.active then
    raise exception 'only a clinic owner can (de)activate staff' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists staff_guard_trg on public.staff;
create trigger staff_guard_trg before update on public.staff
  for each row execute function public.staff_guard();

-- ---------------------------------------------------------------- profiles
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------- patients
-- Front desk and above run the register; doctors and owners read it.
drop policy if exists patients_read on public.patients;
create policy patients_read on public.patients for select to authenticated
  using (public.has_role(clinic_id, array['owner','doctor','frontdesk']));

drop policy if exists patients_write on public.patients;
create policy patients_write on public.patients for insert to authenticated
  with check (public.has_role(clinic_id, array['owner','doctor','frontdesk']));

drop policy if exists patients_update on public.patients;
create policy patients_update on public.patients for update to authenticated
  using (public.has_role(clinic_id, array['owner','doctor','frontdesk']))
  with check (public.has_role(clinic_id, array['owner','doctor','frontdesk']));

drop policy if exists patients_delete on public.patients;
create policy patients_delete on public.patients for delete to authenticated
  using (public.is_clinic_owner(clinic_id));

-- ---------------------------------------------------------------- appointments
drop policy if exists appointments_read on public.appointments;
create policy appointments_read on public.appointments for select to authenticated
  using (public.has_role(clinic_id, array['owner','doctor','frontdesk']));

drop policy if exists appointments_write on public.appointments;
create policy appointments_write on public.appointments for insert to authenticated
  with check (public.has_role(clinic_id, array['owner','doctor','frontdesk']));

drop policy if exists appointments_update on public.appointments;
create policy appointments_update on public.appointments for update to authenticated
  using (public.has_role(clinic_id, array['owner','doctor','frontdesk']))
  with check (public.has_role(clinic_id, array['owner','doctor','frontdesk']));

drop policy if exists appointments_delete on public.appointments;
create policy appointments_delete on public.appointments for delete to authenticated
  using (public.has_role(clinic_id, array['owner','frontdesk']));

-- ---------------------------------------------------------------- consultations
-- Clinical content is authored by doctors. Front desk may read the queue state it
-- needs (it never needs diagnoses) but cannot write clinical rows.
drop policy if exists consultations_read on public.consultations;
create policy consultations_read on public.consultations for select to authenticated
  using (public.has_role(clinic_id, array['owner','doctor','frontdesk']));

drop policy if exists consultations_write on public.consultations;
create policy consultations_write on public.consultations for insert to authenticated
  with check (public.has_role(clinic_id, array['owner','doctor']));

drop policy if exists consultations_update on public.consultations;
create policy consultations_update on public.consultations for update to authenticated
  using (public.has_role(clinic_id, array['owner','doctor']))
  with check (public.has_role(clinic_id, array['owner','doctor']));

drop policy if exists consultations_delete on public.consultations;
create policy consultations_delete on public.consultations for delete to authenticated
  using (public.is_clinic_owner(clinic_id));

-- ---------------------------------------------------------------- invoices
-- Front desk collects money. Changing an amount after it is paid, or voiding,
-- is an owner operation (see invoice_guard()).
drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices for select to authenticated
  using (public.has_role(clinic_id, array['owner','doctor','frontdesk']));

drop policy if exists invoices_write on public.invoices;
create policy invoices_write on public.invoices for insert to authenticated
  with check (public.has_role(clinic_id, array['owner','doctor','frontdesk']));

drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices for update to authenticated
  using (public.has_role(clinic_id, array['owner','doctor','frontdesk']))
  with check (public.has_role(clinic_id, array['owner','doctor','frontdesk']));

drop policy if exists invoices_delete on public.invoices;
create policy invoices_delete on public.invoices for delete to authenticated
  using (public.is_clinic_owner(clinic_id));

-- Financial guard: a paid invoice may only be amended by an owner, and only the
-- owner may void one. Money fields must stay internally consistent.
create or replace function public.invoice_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if public.is_clinic_owner(new.clinic_id) then return new; end if;

  -- Void is terminal: an offline edit must never resurrect a cancelled bill.
  if old.status = 'void' then
    raise exception 'this invoice is void; only an owner can change it' using errcode = '42501';
  end if;
  if old.status = 'paid' and new.status = 'void' then
    raise exception 'only a clinic owner can void a paid invoice' using errcode = '42501';
  end if;
  if old.status = 'paid' and (new.total_paise is distinct from old.total_paise
      or new.paid_paise is distinct from old.paid_paise
      or new.lines is distinct from old.lines) then
    raise exception 'only a clinic owner can change a paid invoice' using errcode = '42501';
  end if;
  if new.paid_paise > new.total_paise then
    raise exception 'paid amount cannot exceed the total' using errcode = '23514';
  end if;
  if new.patient_id is distinct from old.patient_id or new.clinic_id is distinct from old.clinic_id then
    raise exception 'an invoice cannot be re-pointed' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists invoice_guard_trg on public.invoices;
create trigger invoice_guard_trg before update on public.invoices
  for each row execute function public.invoice_guard();

-- ---------------------------------------------------------------- versioning
-- The app_meta table, the migration registry and app_schema_version() live in
-- §0 at the top of this file, so the version is readable before anything else
-- runs. Only the RLS policy belongs here, next to the other policies.
alter table public.app_meta enable row level security;
drop policy if exists app_meta_read on public.app_meta;
create policy app_meta_read on public.app_meta for select to authenticated using (true);

alter table public.schema_migrations enable row level security;
drop policy if exists schema_migrations_read on public.schema_migrations;
create policy schema_migrations_read on public.schema_migrations for select to authenticated using (true);

-- =============================================================================
-- §3 · SUBSCRIPTIONS AND LICENSING                   migration 3 · app v1.3.0
-- =============================================================================
-- Model
--   clinic_subscriptions  one row per clinic: plan, status, trial and period end
--                         dates, interval, and who pays
--   license_state()       the view the app renders (status, days_left, can_write)
--
-- Nothing here trusts the client. A clinic cannot write unless its subscription
-- is trial / active / grace, and seat limits are enforced by a trigger on staff
-- — so an offline client that skipped the banner still gets rejected here.
--
-- Guarded: once the database has reached version 3 this whole block is skipped,
-- which is what makes this file safe to re-run on a live database. Everything
-- inside the guard is itself `if not exists` / `create or replace`, so a
-- half-applied migration finishes on the next run.
-- =============================================================================
do $migration$
begin
  if public.app_schema_version() >= 3 then
    raise notice 'schema 3 (licensing) already applied - skipping';
    return;
  end if;
  raise notice 'applying schema 3 (licensing)';

  execute $sql$
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
  -- volatile, not stable: this function may INSERT a default subscription for a
  -- clinic created before licensing existed. A `stable` function cannot write,
  -- and Postgres rejects the whole call the moment the INSERT is reached — which
  -- made the first read of state fail on a legacy clinic.
  create or replace function public.license_state(p_clinic uuid)
  returns jsonb language plpgsql volatile security definer set search_path = public as $$
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
  $sql$;

  insert into public.schema_migrations (version, name, app_version, summary)
  values (3, 'licensing', '1.3.0', 'subscriptions, seats, grace period, read-only write gate')
  on conflict (version) do nothing;

  update public.app_meta
     set schema_version = 3, applied_at = now(), notes = 'subscription licensing'
   where schema_version < 3;
end $migration$;

-- =============================================================================
-- §4 · CLINIC BRANDING                               migration 4 · app v1.5.0
-- =============================================================================
-- Logos are stored as data URLs on the clinic row: no storage bucket, no CORS,
-- and a logo prints on clinic wifi that is down. The caps keep the row - and so
-- the offline snapshot that carries it - small.
-- =============================================================================
do $migration$
begin
  if public.app_schema_version() >= 4 then
    raise notice 'schema 4 (branding) already applied - skipping';
    return;
  end if;
  raise notice 'applying schema 4 (branding)';

  execute $sql$
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
  $sql$;

  insert into public.schema_migrations (version, name, app_version, summary)
  values (4, 'branding', '1.5.0', 'square and wide clinic logos, print toggle')
  on conflict (version) do nothing;

  update public.app_meta
     set schema_version = 4, applied_at = now(), notes = 'clinic branding'
   where schema_version < 4;
end $migration$;

-- =============================================================================
-- Schema 5 — UPI collection
--
-- Two small, additive changes so an unpaid invoice can be settled on the spot:
--
--   clinics.upi_id           the VPA the invoice QR code encodes
--   invoices.paid_on         the day the last payment was recorded
--   invoices.payment_ref     UPI UTR / card last-4 / receipt number
--
-- No new table: a payment only ever reduces an invoice balance here, and the
-- invoice row already travels to every device in the offline snapshot. Keeping
-- the trail on that row means a payment recorded on the front desk laptop shows
-- up on paper and on the doctor's phone with no extra sync surface.
-- =============================================================================
do $migration$
begin
  if public.app_schema_version() >= 5 then
    raise notice 'schema 5 (upi collection) already applied - skipping';
    return;
  end if;
  raise notice 'applying schema 5 (upi collection)';

  execute $sql$
  -- ------------------------------------------------------------------ columns
  alter table public.clinics
    add column if not exists upi_id text not null default '',
    add column if not exists upi_payee_name text not null default '',
    add column if not exists upi_qr_on_invoices boolean not null default true;

  alter table public.invoices
    add column if not exists paid_on date,
    add column if not exists payment_ref text not null default '';

  -- ------------------------------------------------------------------ guards
  -- A VPA that cannot be parsed is worse than none: it prints a QR that fails in
  -- the patient's app. Empty string means "not configured yet" and passes.
  alter table public.clinics drop constraint if exists clinics_upi_id_shape;
  alter table public.clinics add constraint clinics_upi_id_shape
    check (upi_id = '' or upi_id ~ '^[a-z0-9][a-z0-9._-]{0,63}@[a-z][a-z0-9]{1,31}$');

  alter table public.clinics drop constraint if exists clinics_upi_id_len;
  alter table public.clinics add constraint clinics_upi_id_len
    check (char_length(upi_id) <= 64);

  alter table public.clinics drop constraint if exists clinics_upi_payee_len;
  alter table public.clinics add constraint clinics_upi_payee_len
    check (char_length(upi_payee_name) <= 60);

  alter table public.invoices drop constraint if exists invoices_payment_ref_len;
  alter table public.invoices add constraint invoices_payment_ref_len
    check (char_length(payment_ref) <= 60);
  $sql$;

  insert into public.schema_migrations (version, name, app_version, summary)
  values (5, 'upi-collection', '1.7.0', 'clinic UPI VPA, payment reference and paid-on date')
  on conflict (version) do nothing;

  update public.app_meta
     set schema_version = 5, applied_at = now(), notes = 'upi collection'
   where schema_version < 5;
end $migration$;

-- =============================================================================
-- §6 · PRESCRIPTION NUMBERING & SAFETY LOG        migration 6 · app v1.8.0
-- =============================================================================
-- A prescription is an independent document: it gets its own RX/<fy>/<seq>
-- series so that a consultation re-billed twice still has one prescription, and
-- a reprinted prescription carries an auditable identity. `rx_safety` stores
-- what the safety engine found and which high-severity findings the prescriber
-- explicitly accepted - the defence a doctor needs if a case is questioned.
-- =============================================================================
do $migration$
begin
  if public.app_schema_version() >= 6 then
    raise notice 'schema 6 (prescription numbering) already applied - skipping';
    return;
  end if;
  raise notice 'applying schema 6 (prescription numbering)';

  execute $sql$
  -- ------------------------------------------------------------------ columns
  alter table public.consultations
    add column if not exists rx_number text not null default '',
    add column if not exists rx_version integer not null default 1,
    add column if not exists rx_safety jsonb not null default '{}'::jsonb;

  -- ------------------------------------------------------------------ guards
  -- Only the shape the app mints: RX/<fy>/<4-digit sequence>, or empty for rows
  -- written before this migration existed.
  alter table public.consultations drop constraint if exists consultations_rx_number_shape;
  alter table public.consultations add constraint consultations_rx_number_shape
    check (rx_number = '' or rx_number ~ '^RX/[0-9]{2}-[0-9]{2}/[0-9]{4,6}$');

  alter table public.consultations drop constraint if exists consultations_rx_version_positive;
  alter table public.consultations add constraint consultations_rx_version_positive
    check (rx_version >= 1);

  -- ------------------------------------------------------------------ index
  -- Unique per clinic, ignoring the empty pre-migration rows, so two devices
  -- offline cannot mint the same prescription number.
  create unique index if not exists consultations_rx_number_unique
    on public.consultations (clinic_id, rx_number)
    where rx_number <> '';
  $sql$;

  insert into public.schema_migrations (version, name, app_version, summary)
  values (6, 'prescription-numbering', '1.8.0', 'RX/<fy>/<seq> number, version and safety acknowledgement log')
  on conflict (version) do nothing;

  update public.app_meta
     set schema_version = 6, applied_at = now(), notes = 'prescription numbering'
   where schema_version < 6;
end $migration$;

-- =============================================================================
-- §7 · DAY CLOSE & REMINDER LOG                     migration 7 · app v1.10.0
-- =============================================================================
-- Two records the clinic needs in order to finish a day inside the app:
--
--   day_closes  one row per clinic per day. The totals are a snapshot taken at
--               closing time, not a query re-run later — a printed day sheet and
--               the app must agree even after tomorrow's invoices arrive. The
--               counted cash and the variance sit beside the snapshot because
--               that difference is the thing an accountant asks about.
--
--   reminders   what the front desk actually did about a recall: the draft it
--               worked from (`draft_key`), the channel, and a status that never
--               claims more than it can prove — copied, opened, sent, skipped.
--               It is append-only evidence, so a patient is not messaged twice.
--
-- Neither table may ever be needed for the app to open: the client reads them
-- tolerantly, so a database at schema 6 still runs every other screen.
-- =============================================================================
do $migration$
begin
  if public.app_schema_version() >= 7 then
    raise notice 'schema 7 (day close) already applied - skipping';
    return;
  end if;
  raise notice 'applying schema 7 (day close and reminder log)';

  execute $sql$
  -- ---------------------------------------------------------------- day close
  create table if not exists public.day_closes (
    id uuid primary key default gen_random_uuid(),
    clinic_id uuid not null references public.clinics(id) on delete cascade,
    closed_on date not null,
    -- The frozen day: money, visits, payment split. jsonb so a new figure can be
    -- added to the sheet without a migration.
    totals jsonb not null default '{}'::jsonb,
    expected_cash_paise bigint not null default 0 check (expected_cash_paise >= 0),
    counted_cash_paise bigint check (counted_cash_paise is null or counted_cash_paise >= 0),
    variance_paise bigint,
    note text not null default '' check (char_length(note) <= 500),
    status text not null default 'closed' check (status in ('closed','reopened')),
    closed_by uuid references public.staff(id) on delete set null,
    closed_at timestamptz not null default now(),
    client_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    -- One close per day. Re-closing updates that row instead of stacking a second.
    unique (clinic_id, closed_on)
  );
  create index if not exists day_closes_clinic_idx on public.day_closes(clinic_id, closed_on desc);
  drop trigger if exists day_closes_touch on public.day_closes;
  create trigger day_closes_touch before update on public.day_closes for each row execute function public.touch_updated_at();

  -- ---------------------------------------------------------------- reminders
  create table if not exists public.reminders (
    id uuid primary key default gen_random_uuid(),
    clinic_id uuid not null references public.clinics(id) on delete cascade,
    patient_id uuid references public.patients(id) on delete cascade,
    -- "appointment:<uuid>" / "follow-up:<uuid>" / "balance:<invoice uuid>".
    -- One idempotency key per thing being chased.
    draft_key text not null check (char_length(draft_key) between 3 and 120),
    kind text not null check (kind in ('appointment','follow-up','balance')),
    ref_id uuid,
    channel text not null default 'whatsapp' check (channel in ('whatsapp','sms','call','copy')),
    -- Deliberately conservative: "sent" is a person saying they sent it.
    status text not null default 'copied' check (status in ('copied','opened','sent','skipped')),
    body text not null default '' check (char_length(body) <= 1200),
    logged_on date not null default current_date,
    sent_at timestamptz,
    sent_by uuid references public.staff(id) on delete set null,
    client_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index if not exists reminders_clinic_day_idx on public.reminders(clinic_id, logged_on desc);
  create index if not exists reminders_key_idx on public.reminders(clinic_id, draft_key, logged_on desc);
  drop trigger if exists reminders_touch on public.reminders;
  create trigger reminders_touch before update on public.reminders for each row execute function public.touch_updated_at();

  -- ---------------------------------------------------------------- RLS
  alter table public.day_closes enable row level security;
  alter table public.reminders enable row level security;

  -- The day sheet is money: everyone in the clinic may read it, the owner and the
  -- front desk write it. A close is never deleted — it is reopened, which keeps
  -- the audit trail honest.
  drop policy if exists day_closes_read on public.day_closes;
  create policy day_closes_read on public.day_closes for select to authenticated
    using (public.has_role(clinic_id, array['owner','doctor','frontdesk']));

  drop policy if exists day_closes_write on public.day_closes;
  create policy day_closes_write on public.day_closes for insert to authenticated
    with check (public.has_role(clinic_id, array['owner','frontdesk']));

  drop policy if exists day_closes_update on public.day_closes;
  create policy day_closes_update on public.day_closes for update to authenticated
    using (public.has_role(clinic_id, array['owner','frontdesk']))
    with check (public.has_role(clinic_id, array['owner','frontdesk']));

  -- Everyone who speaks to a patient may log a reminder; only an owner may erase
  -- one from the log.
  drop policy if exists reminders_read on public.reminders;
  create policy reminders_read on public.reminders for select to authenticated
    using (public.has_role(clinic_id, array['owner','doctor','frontdesk']));

  drop policy if exists reminders_write on public.reminders;
  create policy reminders_write on public.reminders for insert to authenticated
    with check (public.has_role(clinic_id, array['owner','doctor','frontdesk']));

  drop policy if exists reminders_update on public.reminders;
  create policy reminders_update on public.reminders for update to authenticated
    using (public.has_role(clinic_id, array['owner','frontdesk']))
    with check (public.has_role(clinic_id, array['owner','frontdesk']));

  drop policy if exists reminders_delete on public.reminders;
  create policy reminders_delete on public.reminders for delete to authenticated
    using (public.is_clinic_owner(clinic_id));
  $sql$;

  insert into public.schema_migrations (version, name, app_version, summary)
  values (7, 'day-close', '1.10.0', 'day close snapshot with cash reconciliation, reminder send log')
  on conflict (version) do nothing;

  update public.app_meta
     set schema_version = 7, applied_at = now(), notes = 'day close and reminder log'
   where schema_version < 7;
end $migration$;

-- ---------------------------------------------------------------- onboarding
-- Creates a profile row for every new auth user.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Atomic clinic creation: clinic + owner staff row in one transaction.
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

  insert into public.staff (clinic_id, user_id, full_name, role, specialty, qualification, phone, email)
  values (new_clinic, auth.uid(), owner_name, 'owner',
    coalesce(p_owner->>'specialty', 'General Physician'),
    coalesce(p_owner->>'qualification', 'MBBS'),
    coalesce(p_owner->>'phone', ''),
    coalesce(p_owner->>'email', ''));

  update public.profiles set default_clinic_id = new_clinic where id = auth.uid();
  return new_clinic;
end $$;

-- Next sequence values (server-side, race-safe).
create or replace function public.next_patient_code(p_clinic uuid)
returns text language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.has_role(p_clinic, array['owner','doctor','frontdesk']) then
    raise exception 'not a member of this clinic' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('code:' || p_clinic::text));
  select count(*) + 1 into n from public.patients where clinic_id = p_clinic;
  return 'PT-' || lpad(n::text, 5, '0');
end $$;

-- Next token for a doctor today (race-safe: call inside an insert transaction).
create or replace function public.next_token_no(p_doctor uuid, p_on date default current_date)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(max(token_no), 0) + 1 from public.appointments
  where doctor_id = p_doctor and scheduled_on = p_on;
$$;

-- Issue a walk-in token atomically: creates the patient's same-day appointment
-- with the next free token and returns the row. Every referenced id is
-- re-resolved under the caller's clinic (see security audit run 1, finding
-- idor/issue-token-cross-clinic), and the doctor's day is row-locked so two
-- desks can never mint the same number.
create or replace function public.issue_token(
  p_clinic uuid, p_patient uuid, p_doctor uuid,
  p_kind text default 'New consultation',
  p_reason text default '',
  p_duration integer default 15
) returns public.appointments
language plpgsql security definer set search_path = public as $$
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

  select t into slot from generate_series(
      staff_row.day_start,
      staff_row.day_end - interval '15 min',
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
end $$;

grant execute on function public.next_token_no(uuid, date) to authenticated;
grant execute on function public.issue_token(uuid, uuid, uuid, text, text, integer) to authenticated;

create or replace function public.next_invoice_number(p_clinic uuid, p_prefix text)
returns text language plpgsql stable security definer set search_path = public as $$
declare n bigint;
begin
  select count(*) + 1 into n from public.invoices where clinic_id = p_clinic;
  return p_prefix || '/2526/' || lpad(n::text, 4, '0');
end $$;

grant execute on function public.is_clinic_staff(uuid) to authenticated;
grant execute on function public.clinic_role(uuid) to authenticated;
grant execute on function public.create_clinic(jsonb, jsonb) to authenticated;
grant execute on function public.next_patient_code(uuid) to authenticated;
grant execute on function public.next_invoice_number(uuid, text) to authenticated;

-- =============================================================================
-- §8 · PUBLIC BOOKING                                migration 8 · app v1.11.0
-- =============================================================================
-- A patient with a link and no account books one appointment, then cancels it with
-- the reference they were given.
--
-- The whole surface is five security-definer functions. There is no policy that
-- lets `anon` touch a table: what crosses the wire is the clinic's public profile,
-- which minutes of a doctor's day are *busy* (a time and a length — never who),
-- and the single row a reference points at. A stranger can never enumerate
-- patients, invoices or consultations, because no function returns a set of them.
--
-- Three rules only the database can keep:
--   one live appointment per (doctor, date, time)     partial unique index below
--   no two patients winning the last slot             advisory lock in public_book
--   no flood from one phone or one clinic             counted in public_book
--
-- Slots are still computed by the client from `availableSlots` — the same function
-- the front desk uses — so an online booking and a walk-in cannot disagree about
-- what is free, and the checks here are the backstop rather than the rulebook.
-- =============================================================================
do $migration$
begin
  -- The version number alone is not proof: a paste that stopped half-way (or a
  -- fragment run by hand) can leave app_meta at 8 with the functions missing.
  -- Re-applying is idempotent, so ask for the objects as well.
  if public.app_schema_version() >= 8
     and exists (select 1 from pg_proc f join pg_namespace ns on ns.oid = f.pronamespace
                  where ns.nspname = 'public' and f.proname = 'public_book') then
    raise notice 'schema 8 (public booking) already applied - skipping';
    return;
  end if;
  raise notice 'applying schema 8 (public booking)';

  execute $sql$

  -- ------------------------------------------------------- clinics: switches
  -- Defaults are on: an existing clinic that upgrades gets a working booking page
  -- at /#/book/<slug> the moment it is deployed, with the diary opened 14 days.
  alter table public.clinics add column if not exists booking_enabled boolean not null default true;
  alter table public.clinics add column if not exists booking_horizon_days integer not null default 14;
  alter table public.clinics add column if not exists booking_note text not null default '';

  do $constraints$
  begin
    if not exists (select 1 from pg_constraint where conname = 'clinics_booking_horizon_range') then
      alter table public.clinics
        add constraint clinics_booking_horizon_range check (booking_horizon_days between 1 and 60);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'clinics_booking_note_len') then
      alter table public.clinics
        add constraint clinics_booking_note_len check (char_length(booking_note) <= 120);
    end if;
  end $constraints$;

  -- Every clinic needs an address to be reachable at all. Existing rows may have a
  -- null slug (the column was added for branding in migration 4 and never filled),
  -- so derive one from the name and step around collisions rather than failing.
  do $slugs$
  declare
    r record;
    base text;
    candidate text;
    n integer;
  begin
    for r in select id, name, slug from public.clinics where slug is null or btrim(slug) = '' loop
      base := left(public.clinic_slug(r.name), 32);
      candidate := base;
      n := 0;
      while exists (select 1 from public.clinics c where c.slug = candidate and c.id <> r.id) loop
        n := n + 1;
        candidate := base || '-' || n;
      end loop;
      update public.clinics set slug = candidate where id = r.id;
    end loop;
  end $slugs$;

  -- --------------------------------------------------- appointments: the ref
  -- booking_ref is what the patient keeps. Unique per clinic so a reference can
  -- never point at two appointments; nullable because every desk booking made
  -- before today has none.
  alter table public.appointments add column if not exists booking_ref text;
  alter table public.appointments add column if not exists cancelled_at timestamptz;
  create unique index if not exists appointments_booking_ref_key
    on public.appointments (clinic_id, booking_ref) where booking_ref is not null;

  -- A cancellation has to release its slot. Until now the full unique constraint
  -- meant a cancelled 10:30 could never be re-booked without deleting history —
  -- the desk's own re-book screen had the same problem — while the client
  -- scheduler already treats cancelled rows as free (DEAD_STATUSES). Dropping the
  -- constraint for a partial index is strictly weaker: no row that satisfied the
  -- old rule can violate the new one.
  alter table public.appointments drop constraint if exists appointments_doctor_id_scheduled_on_scheduled_at_key;
  create unique index if not exists appointments_slot_unique
    on public.appointments (doctor_id, scheduled_on, scheduled_at) where status <> 'cancelled';

  -- Public bookings look a patient up by phone digits, not by the formatter's
  -- spacing, so ' 98200 11223' and '+919820011223' are the same person.
  create index if not exists patients_phone_digits_idx
    on public.patients (clinic_id, regexp_replace(phone, '[^0-9]', '', 'g'));

  -- --------------------------------------------------------- public profile
  create or replace function public.public_clinic_profile(p_slug text)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
  declare
    c public.clinics;
    roster jsonb;
  begin
    select * into c from public.clinics where slug = lower(btrim(p_slug));
    if not found then
      return null;
    end if;

    -- A clinic that has closed online booking still answers — with its phone
    -- number and nothing else — so a link on an old poster stays useful.
    if not c.booking_enabled then
      return jsonb_build_object(
        'enabled', false,
        'clinic', jsonb_build_object('name', c.name, 'phone', c.phone, 'address', c.address));
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id,
             'full_name', s.full_name,
             'specialty', s.specialty,
             'qualification', s.qualification,
             'fee_paise', s.fee_paise,
             'follow_up_fee_paise', s.follow_up_fee_paise,
             'day_start', to_char(s.day_start, 'HH24:MI'),
             'day_end', to_char(s.day_end, 'HH24:MI'),
             'slot_minutes', s.slot_minutes,
             'color', s.color) order by s.full_name), '[]'::jsonb)
      into roster
      from public.staff s
     where s.clinic_id = c.id and s.active and s.role in ('owner', 'doctor');

    return jsonb_build_object(
      'enabled', true,
      'clinic', jsonb_build_object(
        'name', c.name, 'slug', c.slug, 'clinic_type', c.clinic_type,
        'address', c.address, 'phone', c.phone, 'brand_color', c.brand_color,
        'booking_note', c.booking_note, 'booking_horizon_days', c.booking_horizon_days),
      'doctors', roster);
  end $$;

  -- ------------------------------------------------------------ busy minutes
  -- Times and lengths only. This is the one read that spans the diary, so it is
  -- deliberately blind: no patient id, no name, no reason, no status detail
  -- beyond "this minute is gone".
  create or replace function public.public_booking_busy(p_slug text, p_doctor uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
  declare
    c public.clinics;
    busy jsonb;
  begin
    select * into c from public.clinics where slug = lower(btrim(p_slug)) and booking_enabled;
    if not found then
      return jsonb_build_object('busy', '[]'::jsonb);
    end if;
    if not exists (select 1 from public.staff s
                    where s.id = p_doctor and s.clinic_id = c.id and s.active and s.role in ('owner', 'doctor')) then
      return jsonb_build_object('busy', '[]'::jsonb);
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'iso', a.scheduled_on,
             'at', to_char(a.scheduled_at, 'HH24:MI'),
             'minutes', a.duration_minutes) order by a.scheduled_on, a.scheduled_at), '[]'::jsonb)
      into busy
      from public.appointments a
     where a.doctor_id = p_doctor
       and a.status <> 'cancelled'
       and a.scheduled_on between current_date and current_date + c.booking_horizon_days;

    return jsonb_build_object('busy', busy);
  end $$;

  -- ---------------------------------------------------------------- book it
  create or replace function public.public_book(
    p_slug text,
    p_doctor uuid,
    p_date date,
    p_time time,
    p_name text,
    p_phone text,
    p_reason text default '')
  returns jsonb language plpgsql security definer set search_path = public as $$
  declare
    alphabet constant text := 'ACDEFGHJKLMNPQRTUVWXY2346789';
    c public.clinics;
    d public.staff;
    pat public.patients;
    appt public.appointments;
    existing public.appointments;
    digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
    clean_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
    ref text := 'BK-';
    -- Not `code`: a plpgsql variable with a column's name makes every reference
    -- in a query ambiguous, and this one is read while generating the next one.
    patient_code text;
    seq bigint;
    i integer;
    recent integer;
  begin
    select * into c from public.clinics where slug = lower(btrim(p_slug));
    if not found or not c.booking_enabled then
      raise exception 'booking:closed' using errcode = 'P0001';
    end if;

    select * into d from public.staff
     where id = p_doctor and clinic_id = c.id and active and role in ('owner', 'doctor');
    if not found then
      raise exception 'booking:doctor' using errcode = 'P0001';
    end if;

    if char_length(clean_name) < 2 or char_length(clean_name) > 80 then
      raise exception 'booking:name' using errcode = 'P0001';
    end if;
    if char_length(digits) not in (10, 11, 12) then
      raise exception 'booking:phone' using errcode = 'P0001';
    end if;
    if p_date < current_date or p_date > current_date + c.booking_horizon_days then
      raise exception 'booking:date' using errcode = 'P0001';
    end if;
    if p_time < d.day_start
       or p_time + make_interval(mins => d.slot_minutes) > d.day_end
       or mod(round(extract(epoch from (p_time - d.day_start)) / 60)::int, d.slot_minutes) <> 0 then
      raise exception 'booking:slot' using errcode = 'P0001';
    end if;
    -- Same half-hour rule the page applies: no slot that starts in the next 30 min.
    if p_date = current_date and p_time < localtime + interval '30 minutes' then
      raise exception 'booking:past' using errcode = 'P0001';
    end if;

    -- One slot at a time. The lock is taken on the pair that can collide, so two
    -- patients tapping 10:30 at 11pm are serialised and the second gets
    -- 'slot_taken' instead of a duplicate row.
    perform pg_advisory_xact_lock(hashtextextended(d.id::text || ':' || p_date::text, 0));

    -- Already booked with this doctor that day? Sending the same tap twice must
    -- not book twice, and a second appointment at a different time is almost
    -- always a mistake — hand back the one they have.
    select a.* into existing
      from public.appointments a
      join public.patients p on p.id = a.patient_id
     where a.doctor_id = d.id and a.scheduled_on = p_date and a.status = 'booked'
       and p.clinic_id = c.id and regexp_replace(p.phone, '[^0-9]', '', 'g') = digits
     order by a.scheduled_at
     limit 1;
    if found then
      if existing.scheduled_at = p_time and existing.booking_ref is not null then
        return jsonb_build_object(
          'ref', existing.booking_ref, 'iso', existing.scheduled_on,
          'at', to_char(existing.scheduled_at, 'HH24:MI'),
          'doctor', d.full_name, 'clinic', c.name,
          'minutes', existing.duration_minutes, 'duplicate', true);
      end if;
      -- RAISE cannot carry both a format string and USING MESSAGE, so the time
      -- travels as an argument: 'booking:already:16:30'.
      raise exception 'booking:already:%', to_char(existing.scheduled_at, 'HH24:MI')
        using errcode = 'P0001';
    end if;

    -- Flood guards: a phone gets three online bookings a day, a clinic forty an
    -- hour. Both are far above real use and cheap enough to count.
    select count(*) into recent
      from public.appointments a
      join public.patients p on p.id = a.patient_id
     where p.clinic_id = c.id and a.source = 'online'
       and regexp_replace(p.phone, '[^0-9]', '', 'g') = digits
       and a.created_at::date = current_date;
    if recent >= 3 then
      raise exception 'booking:toomany' using errcode = 'P0001';
    end if;

    select count(*) into recent
      from public.appointments a
     where a.clinic_id = c.id and a.source = 'online'
       and a.created_at > now() - interval '1 hour';
    if recent >= 40 then
      raise exception 'booking:busy' using errcode = 'P0001';
    end if;

    -- The slot itself. Inside the lock, so this read cannot go stale before the
    -- insert below; the unique index is the second half of the same guarantee.
    if exists (select 1 from public.appointments a
                where a.doctor_id = d.id and a.scheduled_on = p_date
                  and a.status <> 'cancelled'
                  and a.scheduled_at < p_time + make_interval(mins => d.slot_minutes)
                  and a.scheduled_at + make_interval(mins => a.duration_minutes) > p_time) then
      raise exception 'booking:slot_taken' using errcode = 'P0001';
    end if;

    -- Patient: matched on phone digits, created only if nobody answers to them.
    -- The clinic-wide lock keeps two simultaneous new patients from taking the
    -- same code.
    perform pg_advisory_xact_lock(hashtextextended('patient:' || c.id::text, 0));
    select * into pat from public.patients p
     where p.clinic_id = c.id and regexp_replace(p.phone, '[^0-9]', '', 'g') = digits
     order by p.created_at
     limit 1;

    if not found then
      select coalesce(max(nullif(regexp_replace(p.code, '[^0-9]', '', 'g'), '')::bigint), 0) + 1
        into seq
        from public.patients p
       where p.clinic_id = c.id and p.code ~ '^PT-[0-9]+$';
      patient_code := 'PT-' || lpad(coalesce(seq, 1)::text, 5, '0');
      insert into public.patients (clinic_id, code, full_name, phone, notes)
      values (c.id, patient_code, clean_name, btrim(p_phone), 'Registered from the online booking page.')
      returning * into pat;
    end if;

    for i in 1..6 loop
      ref := ref || substr(alphabet, 1 + floor(random() * char_length(alphabet))::int, 1);
    end loop;

    begin
      insert into public.appointments
        (clinic_id, patient_id, doctor_id, scheduled_on, scheduled_at, duration_minutes,
         kind, status, reason, source, booking_ref)
      values
        (c.id, pat.id, d.id, p_date, p_time, d.slot_minutes,
         'New consultation', 'booked', left(coalesce(p_reason, ''), 120), 'online', ref)
      returning * into appt;
    exception when unique_violation then
      raise exception 'booking:slot_taken' using errcode = 'P0001';
    end;

    return jsonb_build_object(
      'ref', appt.booking_ref, 'iso', appt.scheduled_on,
      'at', to_char(appt.scheduled_at, 'HH24:MI'),
      'doctor', d.full_name, 'clinic', c.name,
      'minutes', appt.duration_minutes, 'duplicate', false);
  end $$;

  -- ------------------------------------------------------------------ lookup
  create or replace function public.public_booking_lookup(p_ref text)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
  declare
    a public.appointments;
    c public.clinics;
    d public.staff;
    p public.patients;
  begin
    select * into a from public.appointments where booking_ref = upper(btrim(p_ref)) limit 1;
    if not found then
      return jsonb_build_object('found', false);
    end if;

    select * into c from public.clinics where id = a.clinic_id;
    select * into d from public.staff where id = a.doctor_id;
    select * into p from public.patients where id = a.patient_id;

    return jsonb_build_object(
      'found', true,
      'ref', a.booking_ref,
      'iso', a.scheduled_on,
      'at', to_char(a.scheduled_at, 'HH24:MI'),
      'status', a.status,
      'doctor', coalesce(d.full_name, 'the doctor'),
      'clinic', coalesce(c.name, 'the clinic'),
      'phone', coalesce(c.phone, ''),
      'address', coalesce(c.address, ''),
      'patient_first', split_part(coalesce(p.full_name, ''), ' ', 1));
  end $$;

  -- ------------------------------------------------------------------ cancel
  -- The reference is the credential. Cancelling releases the slot (the partial
  -- unique index above makes that real) and keeps the row: a clinic that sees
  -- cancellations needs the history more than the patient needs the tidiness.
  create or replace function public.public_cancel_booking(p_ref text)
  returns jsonb language plpgsql security definer set search_path = public as $$
  declare
    a public.appointments;
  begin
    select * into a from public.appointments where booking_ref = upper(btrim(p_ref)) for update;
    if not found then
      return jsonb_build_object('cancelled', false, 'status', 'missing');
    end if;
    if a.status <> 'booked' then
      return jsonb_build_object('cancelled', false, 'status', a.status);
    end if;
    if a.scheduled_on < current_date then
      return jsonb_build_object('cancelled', false, 'status', 'past');
    end if;

    update public.appointments
       set status = 'cancelled', cancelled_at = now(), updated_at = now()
     where id = a.id;

    return jsonb_build_object('cancelled', true, 'status', 'cancelled');
  end $$;

  -- ------------------------------------------------------------------ grants
  -- Execute is revoked from PUBLIC and handed to anon explicitly: the public
  -- pages are the only callers that are not signed in, and nothing else is.
  revoke all on function public.public_clinic_profile(text) from public;
  revoke all on function public.public_booking_busy(text, uuid) from public;
  revoke all on function public.public_book(text, uuid, date, time, text, text, text) from public;
  revoke all on function public.public_booking_lookup(text) from public;
  revoke all on function public.public_cancel_booking(text) from public;

  grant execute on function public.public_clinic_profile(text) to anon, authenticated;
  grant execute on function public.public_booking_busy(text, uuid) to anon, authenticated;
  grant execute on function public.public_book(text, uuid, date, time, text, text, text) to anon, authenticated;
  grant execute on function public.public_booking_lookup(text) to anon, authenticated;
  grant execute on function public.public_cancel_booking(text) to anon, authenticated;
  $sql$;

  insert into public.schema_migrations (version, name, app_version, summary)
  values (8, 'public-booking', '1.11.0', 'public booking page: five anon-granted RPCs, booking references, slot release on cancel')
  on conflict (version) do nothing;

  update public.app_meta
     set schema_version = 8, applied_at = now(), notes = 'public booking'
   where schema_version < 8;
end $migration$;

commit;
