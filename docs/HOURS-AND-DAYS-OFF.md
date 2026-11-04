# Hours, days off and the 3–45 day follow-up

**v1.13.0 · schema 12.** What a clinic day is, where it is edited, where it is
enforced, and what happens to a database that has not been migrated yet.

---

## The model

A clinic day is **one or two sessions**, each a start and an end:

```text
09:00–13:00   morning session
13:00–18:00   shut  ← never offered as a slot
18:00–22:00   evening session
```

A doctor's hours are **their own list**, and every one of their sessions must sit
inside one of the clinic's. That is the rule the product means by *"a doctor can
set their time as per only one can be set"*: the morning doctor works 9–1, the
evening doctor works 6–10, and neither is bookable in the other's half of the day
or in the break between them.

Days off come in two shapes, on the clinic and on each person:

| Shape | Example | Stored as |
| --- | --- | --- |
| A weekday, every week | closed on Sundays | `closed_weekdays smallint[]`, `0 = Sunday` |
| A one-off date | Diwali, a conference, a family function | `closed_dates date[]` |

The clinic being shut closes the diary for **everyone**. A doctor's own day off
closes **only their column** — the other doctor's book is untouched.

Follow-up validity is a whole number of days between **3 and 45** (it was 0–180).

## Where it lives

| Layer | File | What it holds |
| --- | --- | --- |
| Pure rules | `src/lib/hours.mjs` | normalising, validating, session arithmetic, closures, the follow-up window |
| Slot engine | `src/lib/schedule.mjs` | `availableSlots()` walks the sessions and returns nothing on a closed day, with a reason |
| Editing | `src/components/HoursEditor.jsx` | the two editors both screens share |
| Clinic settings | `src/pages/Settings.jsx` → Clinic profile | sessions, closed days, follow-up days |
| A person's hours | `src/pages/Team.jsx` → doctor form | their sessions inside the clinic's, their own days off |
| Public booking | `src/pages/PublicBooking.jsx`, `src/lib/public-booking.mjs` | the patient is offered exactly what the desk is |
| Database | `supabase/schema.sql` §12 | columns, checks, `sessions_valid`, `sessions_has_slot`, `closed_on`, `staff_hours_guard`, the RPCs |

## Where it is enforced

Four places, deliberately, because a hidden button is not a rule:

1. **The screen.** `validateSessions()` and `validateDoctorSessions()` refuse the
   save with a sentence — "Dr Rao's hours: 2:00 PM – 4:00 PM is outside the
   clinic's hours (9:00 AM – 1:00 PM · 6:00 PM – 10:00 PM)".
2. **The slot engine.** `availableSlots()` returns no slots on a closed day and
   attaches `closed` and `reason`, so the desk reads "Closed on Sundays" instead of
   an empty column.
3. **The trigger.** `staff_hours_guard` refuses a `staff` row whose sessions escape
   the clinic's (`staff:hours`, `P0001`), because the API is reachable without the
   screen.
4. **The public RPC.** `public_book()` refuses `booking:dayoff` (clinic shut),
   `booking:leave` (the doctor is off) and `booking:slot` (a time in the break), so
   a patient with a stale page cannot take a slot the clinic does not have.

## Columns (schema 12)

```sql
clinics.sessions         jsonb     not null default '[]'   -- [{"start":"09:00","end":"13:00"}, …] max 2
clinics.closed_weekdays  smallint[] not null default '{}'  -- 0 = Sunday
clinics.closed_dates     date[]    not null default '{}'
staff.sessions           jsonb     not null default '[]'   -- empty = inherit the clinic
staff.closed_weekdays    smallint[] not null default '{}'
staff.closed_dates       date[]    not null default '{}'
profiles.send_review_request boolean not null default true -- the column the account save was missing
clinics.follow_up_days   integer    check between 3 and 45  -- was 0 and 180
```

## Upgrading a live database

Re-run `supabase/schema.sql` in the Supabase SQL editor. The schema-12 block:

- adds the columns with defaults (no rewrite of existing rows);
- **backfills** `sessions` from the old `open_time`/`close_time` and `day_start`/
  `day_end`, so every clinic and doctor keeps exactly the hours it had;
- **clamps** `follow_up_days` into 3–45 *before* adding the constraint, so the
  migration cannot fail on a row that already exists (0 → 3, 180 → 45);
- leaves `open_time`/`close_time` and `day_start`/`day_end` written by the app as the
  outer edges of the day, so a cached older build still draws a sane diary.

It is additive and idempotent: a database already on 12 skips the block, and no
clinical or billing row is ever dropped.

## What is verified

`supabase/schema-tests.sql` suite H (21 assertions) runs against a real Postgres:
two sessions survive a round trip, a third and an overlap are refused, a legacy
clinic still answers its hours, a doctor cannot sit in the break, follow-up 0 and 46
are refused while 3 and 45 are accepted, `send_review_request` exists, the public
profile carries both sessions and the closures, and `public_book` refuses a closed
weekday, a holiday, a doctor's leave and a slot in the break — while still booking a
real evening slot.

`tests/hours.test.mjs` (21 tests) covers the same rules in JavaScript, and
`tests/errors.test.mjs` pins the account-save payload and the sentence each refusal
produces.
