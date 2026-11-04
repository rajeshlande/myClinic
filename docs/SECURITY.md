# Security

This page records the security posture of myClinic: the audit that was run, what
it found, and what changed. It is written for whoever next touches the database
layer.

> Re-run the audit with the Cloudflare `security-audit` skill before shipping a
> schema change. Findings below refer to v1.1.0; all confirmed items are fixed in
> v1.2.0.

## How to verify the fixes

```bash
# 1. apply supabase/schema.sql to a SCRATCH project, then:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema-tests.sql
# → a clean run means every RLS and licensing assertion passed (it prints
#   ALL RLS CHECKS COMPLETED / ALL LICENSING CHECKS COMPLETED); all fixtures
#   are rolled back, so the scratch project is left exactly as it was

# 2. the client-side role matrix and sync engine:
npm test
```

## Audit report (v1.1.0)

**Target** `/home/user/myclinic` @ v1.1.0 working tree · **Profile** `quick` · **Policy** `sandboxed-source-and-local-only`

**Coverage**: 12 units in `coverage-ledger.json` — 8 covered, 3 blocked on hosted configuration, 1 not applicable. No prior run exists for this repository, so this is **partial coverage by construction**, not a clean bill of health.

**Execution**: no target code was executed. PostgreSQL/Supabase is unavailable in this sandbox, so the SQL candidates are source-traced and their reproduction steps are the exact statements an operator runs. `supabase/schema-tests.sql` is the runnable proof for the RLS findings once a scratch project exists.

## Summary

| # | Finding | Verdict | Severity |
|---|---|---|---|
| 1 | Any signed-in user can self-assign the owner role of an existing clinic via the staff table | confirmed | **critical** |
| 2 | Offline store persists the whole clinic (including PHI) to localStorage with no expiry, scope or wipe | confirmed | **high** |
| 3 | Role model is not enforced: front desk can delete patients, consultations and invoices | confirmed | **high** |
| 4 | issue_token() does not verify that the patient and doctor belong to the caller's clinic | confirmed | **medium** |
| 5 | Any authenticated user may create unlimited clinics and becomes their owner | confirmed | **medium** |
| 6 | Auth hardening (email confirmation, rate limits, MFA, session lifetime) is configured outside the repo | needs_validation | — |
| 7 | Patient data retention, PITR backups and staff access to backups are not defined in-repo | needs_validation | — |

The dominant issue is that **membership and role were client-asserted** rather than granted: one staff-policy gap chained into full cross-tenant access to patient and billing data. The other confirmed findings are consequences of the same design — roles enforced only in the UI, ids trusted inside SECURITY DEFINER functions, and a device cache that was neither scoped nor expired.

## Confirmed findings

### 1. Any signed-in user can self-assign the owner role of an existing clinic via the staff table

`rls/staff-self-privilege-escalation` · severity **critical** (likelihood high, impact critical) · confidence high

The `staff_insert` policy lets an authenticated user insert a staff row whenever `user_id = auth.uid()`, regardless of clinic. The `staff_update` policy similarly allows a member to update their own row. A front-desk user (or any authenticated account that knows a clinic UUID) can insert themselves into another clinic as `owner`, or update their own existing row from `frontdesk` to `owner`, and then read and write every clinical record in that clinic through the per-clinic policies that trust `clinic_role(clinic_id) = 'owner'`.

**Root cause** — Membership is self-asserted. The insert check treats 'this row is mine' as equivalent to 'I may join this clinic', and the update check never constrains the `role` or `clinic_id` columns, so privilege is a client-supplied field.

**Intended behaviour** — Membership must be granted by an existing owner (or by the service role), and a staff member must never be able to change their own role. Only `create_clinic()` may create the first owner row.

**Trace**

- `supabase/schema.sql:239` (entrypoint, staff_insert policy) — WITH CHECK (user_id = auth.uid() OR clinic_role(clinic_id) = 'owner') accepts any clinic id as long as the row claims the caller's own user id.
- `supabase/schema.sql:243` (propagation, staff_update policy) — USING/WITH CHECK allow a member to update their own row, including the role column, with no column-level restriction.
- `supabase/schema.sql:265` (sink, per-table delete policy) — Every clinical table authorises destructive operations on clinic_role(clinic_id) in ('owner','doctor'), so the escalated role yields full read/write/delete over another clinic's patients, consultations and invoices.

**Reproduction (operator, scratch project)**

_A front-desk user of clinic A, who also holds an account, wants to read and delete records of clinic B._

1. Sign in as a low-privilege user with the published anon key.
2. Insert a staff row for the target clinic with user_id set to the caller's own id and role 'owner'.
3. Re-read the invoices/patients tables; the per-clinic policies now authorise the caller for that clinic.

```js
supabase.from('staff').insert({ clinic_id: '<clinic-B-uuid>', user_id: '<my-uid>', full_name: 'x', role: 'owner' })
supabase.from('staff').update({ role: 'owner' }).eq('id', '<my-staff-row-in-clinic-A>')
supabase.from('invoices').select('*')
```

**Fix applied** — Remove self-service membership entirely: owners insert/update staff rows through a SECURITY DEFINER function that verifies the caller is an owner of that clinic and refuses to change the caller's own role or the clinic_id of an existing row. Add a trigger that rejects role escalation on self-update, and require invitations to be accepted by the invited user.

### 2. Offline store persists the whole clinic (including PHI) to localStorage with no expiry, scope or wipe

`offline/phi-unbounded-localstorage` · severity **high** (likelihood medium, impact high) · confidence high

The store persists every table to `localStorage['myclinic.demo.v1']` and the planned offline queue will persist real clinical records likewise. localStorage is readable by any script on the origin (including any third-party script later added), survives logout, has no TTL, and is not cleared when a user signs out or switches accounts. On a shared reception machine the next user can read the previous clinic's patients from devtools or from a stale app state.

**Root cause** — Persistence is a single unnamespaced JSON blob keyed by a constant, with no per-user/per-clinic key, no expiry, and no purge on sign-out.

**Intended behaviour** — Cached clinical data must be scoped to the signed-in user and clinic, expire (e.g. 24 h), be purged on sign-out and role change, and be resettable by an owner.

**Trace**

- `src/lib/store.jsx:21` (entrypoint, writeDemo) — Whole workspace serialised under a constant key.
- `src/lib/store.jsx:7` (sink, DEMO_KEY) — Single constant key shared by every account on the device; no purge on auth state change.

**Reproduction (operator, scratch project)**

_A locum doctor on the reception PC opens devtools._

1. Sign in, then sign out.
2. Read localStorage in devtools, or reopen the app on a shared machine.

```js
localStorage.getItem('myclinic.demo.v1')
```

**Fix applied** — Namespace the cache per user and clinic, add a timestamp with TTL enforcement, purge on sign-out and on role/clinic change, and offer an owner-triggered 'clear offline data' action.

### 3. Role model is not enforced: front desk can delete patients, consultations and invoices

`rls/frontdesk-clinical-delete` · severity **high** (likelihood medium, impact high) · confidence high

All four clinical tables share a delete policy of `clinic_role(clinic_id) in ('owner','doctor')`, but there is no compensating restriction on update or insert, and no server-side notion of what a front-desk user may do. Because the roles are enforced only by these coarse predicates, any member — including front desk — can update clinical content (diagnoses, prescriptions, invoice totals) and can move money fields. The intended role matrix is only implemented in the UI, which is not a security boundary.

**Root cause** — Authorization is a UI-level role check plus four coarse RLS predicates; the database has no per-role column policy, so 'front desk cannot edit clinical notes / cannot void invoices' is not enforced.

**Intended behaviour** — Front desk: patients, appointments, tokens, invoice creation and payment collection. Doctor: consultations, prescriptions, follow-ups. Owner: everything including team and settings. Financial voids and deletions require owner.

**Trace**

- `supabase/schema.sql:263` (entrypoint, per-table update policy) — UPDATE is allowed for any staff member on consultations and invoices.
- `src/pages/Billing.jsx:1` (sink, client role gate) — Billing screens hide actions by role in the UI only; the API accepts the call regardless.

**Reproduction (operator, scratch project)**

_Front-desk member edits a diagnosis and marks an unpaid invoice as paid._

1. Sign in as front desk.
2. PATCH the consultation or invoice row through the REST API.

```js
supabase.from('consultations').update({ diagnoses: ['x'], advice: 'y' }).eq('id', '<consult-id>')
supabase.from('invoices').update({ status: 'paid', paid_paise: 0 }).eq('id', '<invoice-id>')
```

**Fix applied** — Replace the shared policies with per-role policies (owner/doctor/frontdesk) and constrain clinical columns to clinical roles; keep payment collection for front desk but reserve voids, deletes and amount edits after payment to owner. Mirror the matrix in a single client module so UI and docs agree.

### 4. issue_token() does not verify that the patient and doctor belong to the caller's clinic

`idor/issue-token-cross-clinic` · severity **medium** (likelihood low, impact medium) · confidence high

`issue_token(p_clinic, p_patient, p_doctor, ...)` checks membership of `p_clinic` but then inserts an appointment referencing `p_patient` and `p_doctor` without checking that those ids belong to `p_clinic`. A member of clinic A can create an appointment in clinic A pointing at clinic B's patient, and the token numbering loop then reads clinic B's appointment data through the doctor's day (`next_token_no` is SECURITY DEFINER over all rows).

**Root cause** — Two of the three foreign keys are treated as trusted inputs; the membership check covers only the clinic argument.

**Intended behaviour** — Every row referenced by an insert must be re-derived inside the SECURITY DEFINER function and re-checked against the clinic under which the caller is authorised.

**Trace**

- `supabase/schema.sql:342` (entrypoint, issue_token) — Membership is checked for p_clinic only.
- `supabase/schema.sql:347` (propagation, issue_token) — The function then reads staff.day_start/day_end for p_doctor and inserts a row with p_patient, without clinic checks.
- `supabase/schema.sql:316` (sink, next_token_no) — SECURITY DEFINER token counter is scoped only by doctor id, so cross-clinic doctors leak numbering state.

**Reproduction (operator, scratch project)**

_Clinic A's receptionist links clinic B's patient into a local appointment to read their name back._

1. Sign in as clinic A staff.
2. Call issue_token with a patient id from clinic B.
3. Read the returned appointment row, which now contains clinic B's patient id and the appointment is visible in clinic A.

```js
supabase.rpc('issue_token', { p_clinic: '<clinic-A>', p_patient: '<clinic-B-patient>', p_doctor: '<clinic-A-doctor>' })
```

**Fix applied** — Re-derive every referenced row inside the function with a clinic predicate, and raise if any row is missing. Add a composite-FK backstop so a patient/doctor from another clinic cannot be referenced at all.

### 5. Any authenticated user may create unlimited clinics and becomes their owner

`rls/clinic-insert-open` · severity **medium** (likelihood medium, impact medium) · confidence high

`clinics_insert` is `with check (true)`, so any authenticated session can insert a clinic row directly instead of going through `create_clinic()`. The row is then owned by the caller (staff insert policy aside), enabling tenant sprawl and, combined with the staff-insert flaw, arbitrary claim of clinics.

**Root cause** — The write path that should be exclusively served by the `create_clinic()` SECURITY DEFINER RPC is also exposed as a direct table insert with no predicate.

**Intended behaviour** — Clinics may only be created through `create_clinic()`, which creates the clinic and its owner membership atomically and enforces plan/seat limits.

**Trace**

- `supabase/schema.sql:233` (entrypoint, clinics_insert policy) — WITH CHECK (true) admits every authenticated insert.
- `supabase/schema.sql:303` (sink, create_clinic()) — The intended, atomic creation path is bypassable, so its validation and membership wiring are not enforced.

**Reproduction (operator, scratch project)**

_A signed-in user with no clinic creates clinics in a loop._

1. Sign in.
2. POST a clinic row to /rest/v1/clinics with the anon key and the user's JWT.

```js
supabase.from('clinics').insert({ name: 'x', plan: 'chain' })
```

**Fix applied** — Drop the direct insert policy; make `create_clinic()` the only creation path and have it enforce ownership and plan limits.

## Remediation status

| Finding | Status | Where |
|---|---|---|
| `rls/staff-self-privilege-escalation` | Fixed | RLS v2: `staff_insert`/`staff_update` require `is_clinic_owner()`; `staff_guard()` trigger refuses self role/clinic/user/active changes; new `invites` + `invite_staff()`/`accept_invite()` path |
| `rls/clinic-insert-open` | Fixed | `clinics_insert` policy dropped; creation only through `create_clinic()` |
| `rls/frontdesk-clinical-delete` | Fixed | Per-role policies for patients/appointments/consultations/invoices; `invoice_guard()` reserves voids and paid-invoice edits for owners |
| `idor/issue-token-cross-clinic` | Fixed | `issue_token()` re-resolves patient and doctor under `p_clinic`, locks the doctor-day with `pg_advisory_xact_lock` |
| `offline/phi-unbounded-localstorage` | Fixed | `src/lib/offline.js`: per-user+clinic cache key, 24 h TTL, purge on sign-out, outbox separate per user |
| `rls/role-matrix-not-enforced` | Fixed (schema 10, v1.11.6) | The policies let every seat read every table: `consultations_read` accepted `'frontdesk'` and `invoices_read`/`_write`/`_update` accepted `'doctor'`, so the API granted what the Team page said it did not. Schema 10 narrows both to the roles the product prints (owner+doctor for notes, owner+front desk for money). `supabase/schema-tests.sql` suite F signs in as each seat and checks read/raise/settle; `tests/rbac.test.mjs` fails the build if the SQL role lists and `ROLE_MATRIX` drift apart again |

## Hardening beyond the findings

- Outbox replay is idempotent (client id + `client_id` uniqueness check), so a retried create cannot duplicate a patient.
- Money and status fields are never merged automatically; one conflict holds back every locally changed money field so a human resolves a coherent financial state.
- `invoice_guard()` makes `void` terminal, so an offline edit cannot resurrect a cancelled bill.
- The client mirrors the database role matrix (`src/lib/permissions.js`), so UI refusals and RLS agree by construction — asserted in `tests/logic.test.mjs`.
- The service worker still never caches `/rest/v1/` or `/auth/v1/` responses (re-verified).
