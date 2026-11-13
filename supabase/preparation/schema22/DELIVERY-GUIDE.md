# myClinic schema 22 — consolidated SQL delivery

## What is ready

`myclinic-schema-22.sql` is a complete, consolidated **new/empty clinical database** installation: all schema 1–21 definitions followed by the implemented schema 22 migration, inside one transaction. It is not just a version marker or a fragment requiring you to assemble previous migrations.

**Prepared and locally SQL-tested; not live-Supabase verified or production signed off.** No live database, TPA integration, signing keys, Edge Functions, membership sync or application deployment has been changed.

| Role | Confirmed project |
|---|---|
| Clinical destination | `https://kvxmcdezpozkvdmvmicr.supabase.co` |
| Master/Central — do not paste this SQL here | `https://inaqzvzfongngahxptzw.supabase.co` |
| Planned tenant-token issuer | `https://inaqzvzfongngahxptzw.supabase.co/functions/v1/oidc` |

The issuer is configuration, not evidence that the endpoint exists. PostgreSQL cannot verify which Supabase Dashboard tab you chose; confirm the destination yourself.

## Included in schema 22

- `central_identities`: server-provisioned Central UUID identities, with an exact issuer pin.
- `clinic_memberships`: mandatory server-written mirror of Central membership, clinic, workspace, slug, active status and role.
- `schema_meta`: schema version, issuer, clinical URL, optional JWKS URI / kid watermark, and **tenant_access_enabled = false by default**.
- Replacement of the four local `auth.users` foreign keys with explicit Central identity foreign keys. No duplicate users are created in clinical Auth.
- Restrictive tenant/membership and separate issuer policies on every public application table, ANDed with the existing role matrix.
- Claim checks for issuer, authenticated role/audience, UUID identity, clinic/workspace/slug, member role, jti, expiry and a maximum 900-second lifetime.
- Role helpers requiring both an active mirror membership and a matching active clinical staff row.
- Same-clinic composite foreign keys for related clinical rows, including staff/branch assignments.
- Guards preventing clinic users from modifying staff identity/role/active status or clinic identity/slug; Central owns those fields.
- Explicit browser RPC allowlist. Internal provisioning and trigger helpers no longer inherit PUBLIC execute access.
- Existing owner/doctor/front-desk and branch boundaries retained, with default-deny behaviour when authentication is unavailable.
- Existing licence calculation retained; its helper is tenant-scoped and read-only write enforcement is tested.
- Walk-in RPC timestamp fix: PostgreSQL does not implement the inherited time-only `generate_series` call.
- Migration registry entry 22 and `app_schema_version()` reporting 22 after successful installation.

## Deliberate API changes — read before connecting an app

This is the new v2 clinical database boundary, **not a drop-in database upgrade for the v1.43.0 frontend**.

1. Anonymous clients have **no clinical table or application RPC access**. The five legacy public-booking RPCs are not browser-callable on this project. Central's planned booking fold must use a trusted server-only clinical client and validated input.
2. `create_clinic`, invitations/acceptance, clinic slug changes, local subscription mutations and internal provisioning helpers are not browser-callable. Central provisioning/membership services must perform the required server-side operations.
3. Staff security fields cannot be changed by the clinical frontend; edit source-of-truth memberships in Central and sync the mirror and staff together.
4. `medicines` remains an empty legacy compatibility table with no browser grants. **Do not import the 240k-row drug dataset here.** Its planned source remains outside the shared clinical Free-tier database.
5. Profiles remain per Central user, not per clinical Auth account. Profile writes can only point to the current token's clinic and an assigned branch. Workspace selection must refresh those pointers during app cutover.
6. Clinical tenant tokens must have string `aud = authenticated`, UUID `sub`, UUID `clinic_id`, UUID `workspace_id`, matching `tenant_slug` and `member_role`, `role = authenticated`, nonempty `jti`, `iat` and `exp` (lifetime <= 900 seconds). RS256 signature, `kid`, discovery and JWKS trust must be enforced by the real TPA integration; the SQL does not validate cryptographic signatures itself.

## Installation safety

**Never paste this into Master/Central, or into a project serving the current v1.43.0 app.**

On first installation, the file refuses existing clinics, staff, profiles **or local Auth users**. A refusal rolls back the complete installation transaction. It does not migrate an existing populated clinical database.

Before pasting:

- Confirm `kvxmcdezpozkvdmvmicr` is genuinely the new/empty clinical destination and is not serving the current app.
- Keep an export/backup of anything you need; do not delete data just to bypass the empty-project check.
- Read the deliberate API changes above.
- Use the **whole `myclinic-schema-22.sql` file**, not the development migration fragment or local test stubs.

You may stage this schema in the confirmed new/empty destination with access still disabled. That is separate from the coordinated application/authentication cutover. There is no need to paste it into the working schema21 database.

After installation, run in the clinical SQL Editor:

```sql
select public.app_schema_version() as schema_version;
select schema_version, issuer, clinical_url, tenant_access_enabled
from public.schema_meta;
```

Expected: schema version **22**, the issuer and clinical URL above, and **tenant_access_enabled = false**. These are SQL Editor/admin checks; the browser cannot bootstrap itself by reading disabled tenant metadata.

If an error occurs, stop and share the error. Do not run only the final registry update. SQL Editor session behaviour and real Supabase grants must still be validated against your account.

## What must happen before enabling tenant access

This delivery intentionally does **not** provide a one-line activation shortcut. Keep `tenant_access_enabled` false until all of the following are proven:

1. Central schema/workspace directory, invite-only Auth and server-side provisioning are deployed.
2. Central's dedicated tenant-token signer, OIDC discovery and JWKS work; a separate tenant signing keypair is used, not the existing licence-lease key. Signing keys/service-role credentials stay server-only.
3. Clinical Custom OIDC/TPA trusts the exact issuer; verify non-null `resolved_jwks` and `resolved_at`, then prove valid/invalid token requests through real PostgREST. Native Central/clinical Auth issuers are not accepted as tenant issuers.
4. Local clinical signups are disabled in the Dashboard/Management API. This SQL cannot change Supabase Auth service configuration.
5. Provision identities, clinics, authoritative licence state, memberships, staff and branches consistently. Write the membership mirror and matching staff state atomically where possible. Role changes/revocation must sync promptly; deactivate identities/memberships rather than deleting clinical history.
6. Live tenant/role/branch/RPC isolation tests pass, including more than one workspace for the same Central user. Local fixtures do not replace this gate.
7. App v2 boot, dynamic clinical client, logout and IndexedDB migration are wired and tested; public booking uses the server-side fold.
8. External backups, tested restore, Free-tier keep-alive, capacity checks and governance acceptance are complete before real PHI.

Only then should the trusted deployment operator explicitly enable the metadata flag. Updating that flag is not a substitute for any of these gates. Re-running the complete SQL preserves its current value and other metadata.

## Version handling

- **Prepared database file:** schema 22; migration registry identifies the target application as v2.0.0.
- **Current repository/application:** APP_VERSION 1.43.0 and SCHEMA_VERSION 21 remain unchanged. Repository `supabase/schema.sql` remains schema21 plus the earlier planned comment; the new consolidated delivery is separate.
- At app cutover, integrate the tested migration into the repository's single schema source and coordinate `SCHEMA_VERSION`, setup guide, security script, changelog, package/lock/app version and release checks. Do not merely increment a number now or repoint the legacy app to this database.
- No commit, tag, push, deployment or release was made by preparing this file.

## Local verification performed

PostgreSQL 17 with scratch Supabase-role/auth-function stubs:

- Fresh consolidated install: PASS.
- **168 cross-tenant table/operation/role checks:** 14 clinic-scoped tables x 4 operations x 3 roles.
- Supplemental positive reads/writes/RPCs, role and actual branch-row isolation, native issuer rejection, malformed/mismatched/expired claims, inactive identity/membership, read-only licence and anonymous/RPC denial tests: PASS.
- Cross-clinic reference rejected by RLS for clients and by composite FK even when executed as the local database owner: PASS.
- Complete reapplication after committed sentinel data: PASS; clinic/identity rows and metadata preserved.
- Mutations dropping issuer policy, dropping membership policy, and removing explicit clinic-claim binding: rejected. These are explicit structural ratchets alongside behavioural tests, not a proof that every redundant predicate independently causes a leak.
- Nonempty schema21 project refused, transaction rolled back, still reports 21: PASS.

Evidence and reusable local verifier: `schema22-preparation/verification-results.json`, `schema22-tests.sql`, `verify-local.py`, and the accompanying logs. `local-auth-stubs.sql` is for disposable local databases **only**; never paste it into Supabase.

Limitations: no live Supabase/PostgREST/JWT-signature/Realtime/storage test, browser end-to-end test, production load test, restore drill, Node22 CI or compliance sign-off was performed by this SQL delivery. Existing schema21 SQL tests remain historical baseline tests; the v2-specific SQL suite tests the new boundary rather than pretending legacy local-auth provisioning still works.

## Destination correction after installation

The owner confirmed the actual new clinical project is `kvxmcdezpozkvdmvmicr`. An earlier installation stored the old project URL in metadata. For that installation only, apply `schema22-clinical-url-fix.sql` in the NEW project before re-running the corrected consolidated file. The patch changes the URL constraint and metadata atomically and refuses enabled tenant access. The original `nosqdnmnztsikfygyiqa` schema21 project and its users/data must remain untouched. Metadata cannot verify which project tab is open; check the actual project URL before running SQL.

## Later local sync addendum (not applied live)

The consolidated delivery now includes `schema22-preparation/tenant-sync-22.sql`: server-only snapshot receiver, provisioning, payload-hash/sequence watermark and revocation support. Its table is excluded from browser access. The full local clinical isolation suite now performs180 rather than168 cross-tenant operation/role checks, including that additional server-only table. See `myClinicLicenseAuthority/docs/TENANT-SYNC.md` for the matching Master addendum, worker and limitations. Rebuilding the file does not modify your installed database; no further SQL paste or activation is requested at this local development step.
