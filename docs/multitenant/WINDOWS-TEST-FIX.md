# Windows checkout and local-calendar correction

Reported local result:1060 tests,1057 pass,3 fail; security command/build pass. This was not a Supabase connectivity failure.

## Causes and correction

1. Windows CRLF checkout changed the byte-pinned contract. Converting canonical LF bytes to CRLF reproduces the reported SHA256 exactly: `1afc64514e0635163a14922947a1cb17b29dcc59aea63296f47432bedcd8e772`. Added `.gitattributes` with text=auto/eol=lf; the reviewed contract file and expected digest remain unchanged.
2. A queue source assertion expected LF literally. It now permits CRLF too, without changing the asserted fields/order or queue behaviour.
3. followUpDateFor converted local midnight to UTC when formatting the date. In India that gives the previous day. It now reuses dates.mjs addDays/today to keep local calendar semantics. This is a real application date fix, not a suppressed test. Doctor-provided follow-up date still wins.

Added isolated subprocess regression checks under Asia/Kolkata, UTC and America/New_York plus checkout-policy assertion. Full suite with TZ=Asia/Kolkata:1064/1064 PASS; contributing/security/build/Pages PASS. This Linux environment did not run native Windows; timezone subprocesses and exact CRLF digest reproduction are the evidence, not a Windows execution claim. Native browser suite was not rerun for this calendar/checkout correction.

## Update an existing local branch from the corrected bundle

Keep your local edits safe first; do not reset or delete .env.local:

```powershell
git status
git fetch ./myclinic-multitenant-windows-fix.bundle refs/heads/v2/account-trust-validation
git merge --ff-only FETCH_HEAD
```

If merge refuses due to edits/divergence, stop and review; do not force-reset.

Already checked-out unchanged files might retain CRLF even after adding attributes. Normalize ONLY the contract's line endings, keeping its JSON content intact:

```powershell
node -e "const fs=require('node:fs');const p='contract/tier-contract.json';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n'),'utf8')"
(Get-FileHash ./contract/tier-contract.json -Algorithm SHA256).Hash
npm test
npm run test:security
npm run build
```

Expected SHA256 (case-insensitive): `36c6af2bfe0ba7b82d9f9d240ef3aff1330539e82b1538169a0b66d1b2a96ea1`. If different, stop: do not replace the expected checksum to make the test pass. Inspect local content changes.

No live database/schema/Auth/env/flag changes, no v2 activation or hosted trust claim. The branch remains staged v2 preparation on app1.43.0/schema21. The security script prints scratch SQL guidance; its success does not mean those database checks ran. Do not execute the printed schema21 install against the new clinical22 project or the populated original as a troubleshooting step.
