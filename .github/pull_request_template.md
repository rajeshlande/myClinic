## What changed

<!-- One paragraph. Link the issue if there is one. -->

## Checklist

- [ ] `npm test` passes (39 tests — add one if you changed domain logic)
- [ ] `npm run verify` passes (tests + build + GitHub Pages readiness)
- [ ] No patient data, secrets or `.env` values in the diff
- [ ] If I changed `supabase/schema.sql`: bumped `SCHEMA_VERSION` in `src/lib/version.js`,
      kept the file re-runnable, and updated `supabase/schema-tests.sql` for any new policy
- [ ] If I changed a role rule: updated **both** the policy and `src/lib/permissions.js`
- [ ] Checked at 360 px, 390 px and desktop widths
