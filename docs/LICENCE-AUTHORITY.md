# Connecting a clinic to the licence authority

`myClinic` can take its subscription from an external licence authority —
[`myClinicLicenseAuthority`](https://github.com/rajeshlande/myClinicLicenseAuthority)
— instead of licensing itself. The authority's operator records payments in a
Control Room, issues a 32-character licence key, and its Supabase Edge Function
signs a **7-day RS256 capability token** for each clinic deployment.

This page is the clinic side of that handshake, and the reasoning behind it.

---

## Who enforces what

Three separate things check the same token. Only one of them can actually stop a
clinic from writing, and it is not the browser.

| Layer | Runs where | Verifies | Can be bypassed by |
| --- | --- | --- | --- |
| 1. Authority | vendor's Supabase Edge Function | licence key, hardware/origin fingerprint, seat cap, contract dates | — (private key never leaves it) |
| 2. **Clinic Edge Function** (`supabase/functions/sync-clinic-license`) | **the clinic's own Supabase project** | RS256 signature with the public key, then writes `apply_authority_license()` | nobody: `service_role` only, and the tenant has no such key |
| 3. Browser | the clinic's SPA | RS256 signature again, with the same public key | someone with DevTools — **which is why it decides nothing** |

Layer 3 exists so the Subscription screen can show a signed fact (tier, contract
date, seat caps) rather than a status string the page invented. Layer 2 is the
enforcement: `public_can_write`, the RLS policies and the write guards all read
`clinic_subscriptions`, and only a `service_role` caller may write the verdict
there. Editing JavaScript in Chrome cannot reach it.

**Consequence worth stating plainly:** the licence key stays in the clinic's Edge
Function secrets. It is never compiled into the bundle. The authority also offers
a browser-only mode that embeds `VITE_LICENSE_KEY`; myClinic deliberately does
not use it.

---

## What you need

| Item | Where it comes from | Where it goes |
| --- | --- | --- |
| `AUTHORITY_VERIFY_URL` | `https://<authority-ref>.supabase.co/functions/v1/verify-license` | Edge Function secret |
| `LICENSE_KEY` | the Control Room, when you provision the subscription | Edge Function secret |
| `LICENSE_PUBLIC_KEY` | `npm run keygen` in the authority repo (`SPKI`, public half) | Edge Function secret **and** the app build variable |
| `MYCLINIC_ORIGINS` *(optional)* | your deployment origin, e.g. `https://clinic.github.io` | Edge Function secret |
| Clinic project ref | Supabase → your clinic project | `npx supabase link` |

The public key is safe in both places — it can only *verify*, never sign.

---

## Step 1 — let the browser verify tokens

The app needs the public key so it can check what the Edge Function hands back.
Add it as a build variable (GitHub → Settings → Secrets and variables → Actions →
Variables):

```dotenv
VITE_LICENSE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...\n-----END PUBLIC KEY-----"
```

Locally, the same line goes in `.env.local`. With no key present the whole
feature is dormant: myClinic licenses itself locally exactly as it did before,
and the Subscription page says so in a card headed **Not in this build**.

This value is baked in **at build time**. Setting it after a deploy changes
nothing, and a Pages deploy only sees it because the workflow forwards it —
`pages.yml` passes `vars.VITE_LICENSE_PUBLIC_KEY` into `npm run build` and then
prints one of these in the run log:

| Log line | Meaning |
| --- | --- |
| *Licence authority configured* | the key reached the bundle; the Subscription screen can connect this clinic |
| *No licence authority* | the variable is unset — the deploy licenses itself locally |
| *Private key in a public variable* | **the job fails.** Everything here ships to every visitor; roll the authority's key pair |
| *Public key did not reach the bundle* | the variable was set but the build ignored it — a real bug, not a configuration mistake |

Optional, if you ever run the authority under a different `iss`:

```dotenv
VITE_LICENSE_ISSUER=myclinic-license-authority
```

---

## Step 2 — deploy the clinic's Edge Function

This is the function in `supabase/functions/sync-clinic-license/`. It is part of
this repository, so it ships with the app.

```bash
npx supabase login
npx supabase link --project-ref <CLINIC_PROJECT_REF>

npx supabase secrets set \
  AUTHORITY_VERIFY_URL="https://<authority-ref>.supabase.co/functions/v1/verify-license" \
  LICENSE_KEY="7A3F91C4082BD6E54A109F83C2D17E6B" \
  LICENSE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----" \
  MYCLINIC_ORIGINS="https://clinic.github.io"

npx supabase functions deploy sync-clinic-license --project-ref <CLINIC_PROJECT_REF>
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by
the platform; you never set them.

What the function does, in order:

1. rejects anything that is not a signed-in **owner** of the clinic being synced
   (checked with the caller's own JWT, so RLS decides — not a header the caller
   controls);
2. optionally rejects an origin that is not on `MYCLINIC_ORIGINS`;
3. calls the authority with `{ license_key, machine_fingerprint: "web:<origin>" }`;
4. verifies the returned token itself — signature, `iss`, `exp`/`iat`, fingerprint,
   licence key and contract date — and refuses anything that does not add up;
5. records the verdict through `apply_authority_license()` with the service role;
6. returns the token, so the browser can verify it too.

---

## Step 3 — connect the clinic

Paste `supabase/schema.sql` again. It is additive and lands the project at schema
**18**, which is what creates `apply_authority_license()` and the binding columns.

Open **Subscription** as the owner. If this build has the public key and the
clinic is not bound yet, the **Licence authority** card offers **Connect to the
licence authority** — that first press is what binds the clinic. Once bound, the
same button reads **Check the licence now**, and the card shows the tier, the
contract date, the seat caps, the deployment fingerprint and when it was last
verified. From then on the clinic phones home on boot whenever six hours have
passed, and only the owner triggers it — every other seat reads what the database
already holds. A refusal is shown on the card in the words of its code, never as
a silent no-op.

---

## What changes once a clinic is bound

- **Renewal, plan change and a second trial stop working in the app.** The three
  database functions raise `license:managed` (`42501`); the app hides the plan
  picker and the payment dialog rather than offering an action that would be
  refused. Money is collected by the authority.
- **The plan comes from the tier.** `solo → solo`, `standard|growth → growth`,
  `chain|enterprise → chain`. An unknown tier is refused outright rather than
  guessed at.
- **Seats follow the tier**: 1/1/1, 5/3/1, or unlimited.
- **Offline behaviour is unchanged and deliberate:**

  | Situation | What the clinic gets |
  | --- | --- |
  | Authority reachable, contract live | `active`, writing allowed |
  | Authority unreachable, token still valid (≤ 7 days) | keeps the last verdict, writing allowed |
  | Authority unreachable, token expired | stays on the last recorded period; the normal grace → read-only decay applies |
  | Contract date passed | `read_only` — reads and exports still work |

- **Unbinding is an operator action**, not a UI one:
  `select public.unbind_authority_license('<clinic-id>', 'why');` — `service_role`
  only, and it is logged in `license_events`.

---

## Optional: a heartbeat that does not need a browser

myClinic syncs on boot. If you want the verdict refreshed even when nobody opens
the app, schedule the Edge Function with `pg_cron` + `pg_net` in the clinic
project. The service role key then has to live in Vault rather than in a policy:

```sql
select vault.create_secret('<clinic-service-role-key>', 'clinic_service_key');

select cron.schedule('myclinic-licence-heartbeat', '0 */6 * * *', $$
  select net.http_post(
    url     := 'https://<clinic-ref>.supabase.co/functions/v1/sync-clinic-license',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'clinic_service_key')
    ),
    body    := jsonb_build_object('clinic_id', '<clinic-id>', 'origin', 'https://clinic.github.io')
  );
$$);
```

Note the trade: the function requires the **caller to be the owner**, and a cron
job has no user, so this only works if you also allow a
`service_role` bearer token through to the RPC path. Either keep the boot-time
sync (recommended, no extra secret) or extend the function to accept a
service-role caller. The boot-time sync is enough for every case where someone
actually uses the clinic, which is the case that matters for enforcement.

---

## "The button is not there"

Four causes, in the order they happen. The card names which one you are in.

| What the card says | Cause | Fix |
| --- | --- | --- |
| Nothing at all, and the page is a **demo workspace** | demo mode has no clinic, no database and no authority | sign in to a live project |
| **Not in this build** | `VITE_LICENSE_PUBLIC_KEY` was not set when the bundle was compiled — the commonest one | set the variable, **rebuild and redeploy**; a reload cannot fix it |
| **Not connected**, no button | you are not the clinic **Owner** | sign in as the owner — binding and syncing are owner-only by design |
| **Not connected**, button present | the press failed | the card prints the refusal code (`origin-not-allowed`, `token-signature`, `authority-unreachable`, …) with its meaning; see below |

A build compiled without the key cannot be repaired from the browser: the app is
told whether an authority exists at build time, which is why the deploy log says
so out loud.

### The variable is set and the card still says *Not in this build*

The deploy log is built to answer this rather than to make you guess. Look for the
*Report Supabase build configuration* step; it prints one of:

```text
VITE_LICENSE_PUBLIC_KEY is present: 450 bytes, starts '-----BEGIN PUBLIC KEY-----', PEM header: 1
VITE_LICENSE_PUBLIC_KEY is EMPTY as far as this build job can see.
```

then the verdict — *Licence authority configured*, *No licence authority*, or a
failing `::error` naming the problem. Work down this list; each line is a real way
for a repository variable to exist and still not reach the bundle:

1. **Did a build run after you added it?** Adding or editing a variable starts
   nothing. Re-run the Pages workflow (Actions → Pages → *Re-run all jobs*) or push
   any commit. The card prints the build it is running (`build v1.21.3 · …`), and
   the landing page footer prints the version — if either predates your change, you
   are looking at an older artifact, not at a broken variable.
2. **Variables tab, not Secrets tab.** The workflow reads
   `${{ vars.VITE_LICENSE_PUBLIC_KEY }}`. A value stored under *Secrets* is
   `secrets.…` and leaves `vars.…` empty. The key is public; it belongs in
   Variables.
3. **Repository scope, not environment scope.** The `build` job declares no
   `environment:`, so a variable scoped to the `github-pages` environment is
   invisible to it. Create it at *Settings → Secrets and variables → Actions →
   Variables* with no environment selected.
4. **The right repository.** A variable on the authority repo does nothing for the
   clinic app, and vice versa.
5. **The spelling.** `VITE_LICENSE_PUBLIC_KEY` — an **S**, not `VITE_LICENCE_…`
   with a C. The prose in these docs says "licence"; the variable does not. The
   deploy log now fails outright if it finds the misspelled one and not the real
   one, because otherwise a variable under the wrong name looks exactly like no
   variable at all.
6. **The value is not empty.** A variable created but never pasted into is an empty
   string, which GitHub reports the same way as absent.
7. **The shape of the value.** It must be the whole PEM, `-----BEGIN PUBLIC KEY-----`
   included. If it is not, the deploy fails the job with *Public key not recognised*
   rather than deploying silently — so a green run means the value was well-formed
   or empty.
8. **A stray `.env.local` in CI.** If the build also reads a committed or generated
   `.env` file, it can override the variable. `vite` gives `import.meta.env` the
   process environment precedence, so this is rare — but delete the file if the
   guard says *did not reach the bundle*.

---

## When it refuses

Every refusal carries a `code`, in the JSON body **and** in an `x-myclinic-code`
response header, and the Edge Function writes one line to its log:

```text
refused 403 origin-not-allowed {"origin":"https://clinic.github.io","allow":["https://clinic.example"]}
```

If you are reading this because the log shows a bare `POST | 403` with an empty
`logs` array: that is the old build, before the function logged its own refusals.

### A 403, specifically

Three gates return 403. Only one of them can fire before sign-in, which makes the
triage short:

| 403 code | Gate | Usual cause |
| --- | --- | --- |
| `origin-not-allowed` | origin vs `MYCLINIC_ORIGINS` — **checked before auth**, so it fires even for a request that carries no user token | the allowlist does not contain the browser's origin |
| `not-member` | the signed-in user has no active seat in this clinic | wrong account, or the clinic id is another clinic's |
| `not-owner` | the seat exists but is not `owner` | a doctor or front-desk account pressed the button |

`auth_user: null` in the platform log fits the first row: the request never got
as far as being attributed to a user, because the origin gate runs first.

**The origin is `scheme://host[:port]` and nothing else.** A Pages site served
from `https://clinic.github.io/myClinic/` sends `window.location.origin` =
`https://clinic.github.io` — no repository path, no trailing slash:

```bash
# right
npx supabase secrets set MYCLINIC_ORIGINS="https://clinic.github.io" --project-ref <CLINIC_PROJECT_REF>
# wrong: the repository path is not part of an origin
npx supabase secrets set MYCLINIC_ORIGINS="https://clinic.github.io/myClinic" --project-ref <CLINIC_PROJECT_REF>
```

Add every address you actually open the app from — the Pages URL, a custom domain,
and `http://localhost:5173` while developing. Comma-separated, no spaces needed.
A fresh `secrets set` takes effect on the next invocation; no redeploy.

**Prove which gate it is**, with the public anon key and no user session:

```bash
curl -i -X POST "https://<CLINIC_PROJECT_REF>.supabase.co/functions/v1/sync-clinic-license" \
  -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>" \
  -H 'Content-Type: application/json' \
  -d '{"clinic_id":"<clinics.id>","origin":"https://clinic.github.io"}'
```

| Answer | Meaning |
| --- | --- |
| `403 origin-not-allowed` | the allowlist does not contain that origin — the `allow` list in the log line shows what it does contain |
| `401 not-signed-in` | the origin is **correct**; the failure is the session, so sign in again and retry from the app |

| Code | What it means | What to do |
| --- | --- | --- |
| `not-configured` | the clinic's Edge Function has no authority secrets | run the `secrets set` step |
| `not-owner` | a non-owner pressed the button | the owner signs in |
| `origin-not-allowed` | the deployment origin is not on `MYCLINIC_ORIGINS` | add it, or fix the Pages URL |
| `authority-refused` | the authority said no: revoked key, suspended or expired subscription, seat cap | check the Control Room; the message carries the authority's own sentence |
| `authority-unreachable` | network or the authority is down | the clinic keeps working on its last valid licence |
| `token-signature` / `token-issuer` | the token was not signed by the authority's key | the public keys on both sides disagree — re-copy `LICENSE_PUBLIC_KEY` |
| `token-fingerprint` | the token was issued for a different deployment address | re-issue in the Control Room, or fix `MYCLINIC_ORIGINS` |
| `token-expired` | the 7-day window closed while offline | open the app with a connection |
| `license:managed` | a local renewal was attempted while bound | renewals happen in the Control Room |

---

## Testing it without the cloud

`npm test` covers the whole verification path against real RS256 signatures —
`tests/authority.test.mjs` mints its own keypair and signs its own tokens, so the
verifier is exercised exactly as it is in production. The database side is
`supabase/schema-tests.sql` **suite L**, which binds a clinic, proves the three
tenant doors are shut, and proves a lapsed contract degrades to read-only.

In the app, the browser layer runs even in the demo workspace's absence: with
`VITE_LICENSE_PUBLIC_KEY` unset, every authority code path returns "not
configured" and the rest of myClinic is untouched.
