# Security policy

myClinic stores patient health information. Treat every report as sensitive.

## Reporting a vulnerability

**Do not open a public issue for anything that exposes patient data.**

Use GitHub's private *Report a vulnerability* flow on the **Security** tab, or email the
maintainers. Include:

- the affected version (`Settings → About & version`) and whether you were on the demo
  workspace or a live Supabase project;
- a minimal reproduction against a **scratch** project;
- the impact you believe it has, and whether you were able to read or change data
  belonging to another clinic.

We aim to acknowledge within 3 working days. Please give us a chance to ship a fix
before publishing.

## What we already know

The v1.1.0 audit and its five fixed findings are documented in
[docs/SECURITY.md](docs/SECURITY.md). Two items there are *deliberately* open because
they depend on your Supabase project configuration:

- backup / PITR retention and who can restore;
- Auth policy (email confirmation, rate limits, MFA availability).

Please check those against your own project before reporting them as new.

## Verifying the current state

```bash
npm run test:security                 # prints the procedure + boundary checklist
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rls-tests.sql
```

The RLS suite creates two dummy tenants and asserts the role matrix, tenant isolation,
token issuance and invoice guards; it rolls back everything it created.

## Scope

In scope: anything in this repository, plus the default configuration it ships.

Out of scope: findings that require a compromised device or browser extension, social
engineering of clinic staff, denial of service through raw volume, and issues that only
exist because an operator published a `service_role` key (that key must never leave the
Supabase dashboard).
