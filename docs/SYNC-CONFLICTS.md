# Sync conflicts — what each one means and how to clear it

**v1.13.1 · schema 13.** Settings → Offline & sync lists anything the database
refused or that needs a person to decide. Every conflict is one of four shapes, and
only one of them is ever about your account.

---

## The four kinds

| What the screen says | What actually happened | What to press |
| --- | --- | --- |
| **Both sides changed *field*** | You edited a record offline and someone else changed the same field at the clinic. Nothing is lost yet: both values are shown. | Choose per field, then **Apply choices** |
| **Your account profile row is not in the database** | Your account has no row in `profiles` — usually an account created before the database had the sign-up trigger. Nobody deleted anything. *(fixed properly in 1.13.1)* | **Recreate my profile** |
| **This record was deleted at the clinic** | A patient / appointment / invoice you edited offline was deleted at the clinic. Your edit has nothing to attach to. | **Discard my change** (or re-create the record on its own screen) |
| **The clinic database rejected this change** | The database refused the write — a missing column (schema behind), a seat that is not allowed, a value out of range. The reason is printed. | Fix the cause, then **Try again** |

## The profile conflict (1.13.0 and earlier)

Saving your name or preferences produced this:

> **This record was deleted at the clinic** — `profiles` — Your offline edit cannot
> be applied. Discard it, or recreate the record.

### Why it happened

The account screen writes to `public.profiles`, keyed by your auth user id. An
account created **before** the database had `handle_new_user()` (or one whose row
was never written) has no row there. The queue read "no row" as "deleted by someone
else" and parked your edit instead of writing it. There was never a deletion.

### How to clear it

**On 1.13.1 or later** — open Settings → Offline & sync → **Review**, then press
**Recreate my profile**. The row is written with the values shown, and the conflict
goes away.

**On 1.13.0 or earlier** — press **Discard my change**, then run
`supabase/schema.sql` (schema 13 backfills the row) and save again from
Settings → My account. Nothing clinical is involved: the payload is your name,
phone, designation and preferences.

**From the database console**, if you would rather do it by hand:

```sql
insert into public.profiles (id, full_name)
select u.id, coalesce(u.raw_user_meta_data->>'full_name', '')
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;
```

That is exactly what the schema-13 migration runs, and what the app now does on
every sign-in.

## Why a missing profile cannot recur

- **On load**: `loadLive()` writes the signed-in user's own row when the select
  comes back empty (`createOwnProfile()`).
- **On save**: `updateNow('profile', …)` creates the row when it is missing, so
  Settings → My account always lands.
- **In the queue**: `UPSERT_ON_MISSING = ['profiles']` — an offline edit to your
  profile is a first write, not a deletion (`src/lib/offline.js`).
- **In the database**: schema 13 backfills every account that has no row.

## What is deliberately *not* automatic

A patient, appointment, invoice or consultation that was deleted at the clinic is
**not** recreated by an offline edit. Resurrecting a clinical record because a phone
was offline is worse than asking: those conflicts keep the "deleted at the clinic"
wording, show the record id, and ask for a person.

## Checking a conflict without touching it

Settings → About & version → **Recent problems** keeps the last few failures with
the database's own words and a **Copy** button. Settings → Offline & sync shows what
is queued (`Pending changes`) and what needs a decision (`Conflicts`); cached data is
per user, per clinic, expires after 24 hours and is wiped on sign-out.
