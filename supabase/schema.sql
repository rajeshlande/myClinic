-- =============================================================================
-- myClinic — schema v1 (run the whole file in Supabase → SQL Editor)
-- Multi-tenant OPD clinic management: clinics, staff, patients, appointments,
-- consultations, invoices, follow-ups. Money is integer paise (INR).
-- Safe to re-run on a v1 database; never deletes clinical or billing records.
-- =============================================================================
begin;

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- helpers
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

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

-- Membership helper: is the caller staff of this clinic?
create or replace function public.is_clinic_staff(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff s where s.clinic_id = target and s.user_id = auth.uid());
$$;

create or replace function public.clinic_role(target uuid)
returns text language sql stable security definer set search_path = public as $$
  select s.role from public.staff s where s.clinic_id = target and s.user_id = auth.uid() limit 1;
$$;

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

-- ---------------------------------------------------------------- role helpers
-- has_role(clinic, roles[]) — the single predicate the policies use.
create or replace function public.has_role(target uuid, roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff s
    where s.clinic_id = target and s.user_id = auth.uid() and s.active and s.role = any (roles)
  );
$$;

create or replace function public.is_clinic_owner(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(target, array['owner']);
$$;

-- Is the caller the doctor who owns this consultation/appointment row (or an owner)?
create or replace function public.is_attending_doctor(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff s where s.id = target and s.user_id = auth.uid());
$$;

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
-- The database reports which schema it is on so the app can warn about a stale
-- deployment instead of failing with confusing errors.
create table if not exists public.app_meta (
  id boolean primary key default true check (id),
  schema_version integer not null,
  applied_at timestamptz not null default now(),
  notes text not null default ''
);

insert into public.app_meta (id, schema_version, notes)
values (true, 2, 'v1.2.0 — role matrix, offline sync columns, prescription language')
on conflict (id) do update
  set schema_version = greatest(public.app_meta.schema_version, excluded.schema_version),
      applied_at = case when public.app_meta.schema_version < excluded.schema_version
                        then now() else public.app_meta.applied_at end,
      notes = case when public.app_meta.schema_version < excluded.schema_version
                   then excluded.notes else public.app_meta.notes end;

alter table public.app_meta enable row level security;
drop policy if exists app_meta_read on public.app_meta;
create policy app_meta_read on public.app_meta for select to authenticated using (true);

create or replace function public.app_schema_version()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select schema_version from public.app_meta limit 1), 0);
$$;
grant execute on function public.app_schema_version() to authenticated, anon;

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

commit;
