# Subscriptions: local plans, and Central Auto-Sync

myClinic sells itself in two ways, and both end on the same screen
(**Settings → Subscription**). What differs is who decides the plan.

| | Local (default) | Central Auto-Sync |
|---|---|---|
| Configured by | nothing — it is the default | `VITE_CENTRAL_SUPABASE_URL` + `VITE_CENTRAL_SUPABASE_ANON_KEY` |
| Who sets the plan | the clinic owner, on this screen | the central project |
| Secrets | none | one **publishable** key, which is public by design |
| Server code | Postgres functions in `supabase/schema.sql` | one public RPC, `public.sync_clinic_subscription` |
| Offline behaviour | the database's own 7-day grace | the sealed lease, until `expires_at` **and** `grace_until` |

Unset the two variables and the deployment behaves exactly as a local one.

## What the screen shows

One card, three facts, whichever mode is in use:

```
Plan         Start date        End date
Growth       01 Nov 2026       30 Nov 2026
```

- **Start date** is `clinic_subscriptions.current_period_start`, which Central
  writes from the contract's own start. It is printed verbatim or shown as `—`;
  it is never derived from the end date, because a start date guessed wrong on a
  billing screen is worse than a blank one. (A trial is the one exception: its
  start *is* exactly `trial_ends_at − 14 days`, so the card computes it.)
- **End date** is `current_period_end` for a local plan, and Central's
  `expires_at` when Central is in charge.
- The price and the monthly/yearly toggle are printed **only** when the clinic
  licenses itself. A centrally issued plan has commercial terms the central
  project owns, and this build has no business quoting them.

Central's answer also carries the match mode, the last sync time, the offline
grace date and the sentence explaining what happens when the network is gone —
all of it on the same card, none of it repeated elsewhere.

## The RPC, and what it must return

```
POST ${VITE_CENTRAL_SUPABASE_URL}/rest/v1/rpc/sync_clinic_subscription
{ "p_email": "<owner email, lowercase>", "p_origin": "<this origin>", "p_device_id": "<per-browser id>" }
```

The answer decides whether the clinic may write. These columns matter:

| Column | Used for |
|---|---|
| `allowed` | `true` = licence granted; anything else is a refusal |
| `status` | the label on the badge (`active`, `paused`, …) |
| `tier` | mapped to a plan by `CENTRAL_TIER_TO_PLAN` |
| `expires_at` | the contract end, and the end date on the card |
| `grace_until` | how long an offline device may keep writing |
| `started_at` | the contract start, and the start date on the card |
| `match_mode` | *(optional)* how Central recognised the clinic |

`started_at` is read as `answer.started_at ?? answer.current_period_start`, so
either column name works. Return `null` — or omit it — and the card prints `—`.

The browser sends only those three arguments and one credential: the central
project's publishable key, as `apikey`. There is no second Supabase client, so
this clinic's session token can never travel to another project. A `sb_secret_…`
key, or a JWT decoding to `service_role`, disables Auto-Sync with an error rather
than shipping.

## The seal

Every granted answer is cached in `localStorage` under
`myclinic.central.subscription.v2.<clinicId>`, sealed with SHA-256 over the
pepper, the clinic id, the origin, the owner email, the device id and:

```
allowed | status | tier | plan | expires_at | grace_until
```

Those six are the fields that decide whether a clinic may write. Editing the plan
or either date in DevTools breaks the seal, the cache is deleted, and the clinic
becomes read-only rather than promoting itself.

`started_at` is deliberately **outside** the seal (`CENTRAL_UNSEALED_FIELDS`). A
start date grants nothing — it is a line on a card — and sealing it would mean
bumping the seal version, which would cost every device its cached lease on
upgrade for no security in return.

The seal is tamper-**evident**, not tamper-**proof**: the pepper ships in the
bundle, obfuscated. Enforcement stays in Postgres and in the central project.

## Refusals

`SUBSCRIPTION_PAUSED`, `SUBSCRIPTION_EXPIRED`, `SUBSCRIPTION_NOT_FOUND`,
`SEAT_LIMIT_REACHED` and `ORIGIN_MISMATCH` each delete the cache in the same call
and record their own code as the subscription's `collection_ref`, so a support
call has the real reason in it. A 4xx from PostgREST, or a 5xx, is *not* a
verdict on the clinic: the sealed lease stays in force until its dates pass.

## What is left of the old licence key

Nothing in the app. The RS256 licence-authority client (`authority.mjs`,
`authority-sync.mjs`), its panel on the Subscription screen, `npm run check:key`
and the `VITE_LICENSE_PUBLIC_KEY` plumbing were removed in 1.24.0.

The database keeps what schema 18 created — `authority_*` columns,
`apply_authority_license()` (`service_role` only), and the rule that a bound
clinic cannot renew, change plan or restart a trial locally. That rule is what
the Postgres refusal `license:managed` says, and the app now translates it to
"managed centrally". Removing a column is a data-loss operation, so the columns
stay until a migration deliberately drops them.
