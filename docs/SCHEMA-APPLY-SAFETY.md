# Before you paste `schema.sql`

The Supabase SQL editor shows this before it runs `supabase/schema.sql`:

> **This query includes destructive operations.** It may permanently change or
> remove data, tables, schemas, or other objects.
>
> **This query runs an `UPDATE` without a `WHERE` clause.** It may update every
> row in the target table.

Both sentences are true statements about *what SQL can do*. Neither is a finding
about this file. The editor reads keywords — `drop`, `update … set` — and a
script that re-creates 51 policies and 20 constraints on every run contains a lot
of both. This page is the inventory, so you can decide for yourself rather than
taking the warning's word for it.

## What the file contains

| Shape | Count | Destroys data? |
| --- | --- | --- |
| `drop policy if exists` | 51 | No — the policy is re-created immediately after |
| `drop constraint if exists` | 20 | No — the constraint is re-created immediately after |
| `drop trigger if exists` | 16 | No — the trigger is re-created immediately after |
| `drop index if exists` | 2 | No — re-created |
| `drop function if exists` | 1 | No — the signature changed in schema 8, and the new one is defined right below |
| `create table` | 15 | — |
| `add column if not exists` | 33 | — |
| `create or replace function` | 61 | — |
| `delete from` | **0** | — |
| `truncate` | **0** | — |
| `drop table` / `drop column` / `drop schema` | **0** | — |

Every `drop` in the file says `if exists`, drops a *rule* rather than a *row*
(policy, trigger, constraint, index, function), and is followed by the
replacement. That is precisely what makes the file safe to paste twice: it
rebuilds the same objects instead of stacking a second copy of them.

## The one `UPDATE` without a `WHERE`

Line 2416, inside the schema-12 migration:

```sql
alter table public.clinics drop constraint if exists clinics_follow_up_days_check;
-- unconditional-update: clamp every clinic's follow-up window into 3-45 …
update public.clinics set follow_up_days = least(45, greatest(3, follow_up_days));
alter table public.clinics add constraint clinics_follow_up_days_check
  check (follow_up_days between 3 and 45);
```

It is deliberate, and it is the safe way round: schema 12 narrowed the allowed
window from 0–180 days to 3–45, and adding that `CHECK` to a table holding a
clinic on 60 days would fail. Clamping first means the constraint cannot be
rejected. It touches **one integer** per clinic (`clinics.follow_up_days`),
writes no other column, and never deletes a row.

It is also unreachable on a database that is already migrated: every migration
sits behind `if exists (select 1 from schema_migrations where version = N)`, and
an applied migration returns before reaching its body.

## Measured, not asserted

Re-running the whole file against a schema-18 database holding real rows, in a
throwaway Postgres 17 instance (`supabase/schema-tests.sql`'s harness):

```text
--- before:   schema 18 · registry 18 · 2 clinics · 2 patients · 1 consultation · 1 invoice
--- re-applying the entire file
    NOTICE: schema 12 (sessions and days off) already applied - skipping
    … the same notice for every migration from 3 to 18
--- after:    schema 18 · registry 18 · 2 clinics · 2 patients · 1 consultation · 1 invoice

--- tables whose contents changed
 tbl | rows_before | rows_after | changed
-----+-------------+------------+---------
(0 rows)
```

Not a row was added, altered or removed; no table appeared or disappeared;
`clinics.follow_up_days` still read 15 afterwards.

## What to actually be careful about

1. **Run the whole file, not a fragment.** Migration bodies are guarded; a `do`
   block lifted out of context is not.
2. **Point it at the clinic's project.** It assumes it owns the `public` schema —
   tables named `clinics`, `patients`, `staff`. Pasting it into a project that
   already uses those names for something else would alter *those* tables.
3. **Take a backup before an upgrade that adds constraints** (schema 12 above is
   the one that rewrites a column). On the free plan that means `pg_dump`; on Pro,
   a PITR restore point.
4. **Verify afterwards**, always the same three answers:

   ```sql
   select * from public.app_meta;                    -- schema_version = 18
   select count(*) from public.schema_migrations;    -- 18
   select public.app_schema_version();               -- 18
   ```

5. **The editor's warning stays on screen every time** — it cannot be satisfied,
   only understood. `npm run check:contributing` fails the build if a
   `delete from`, a `truncate`, a `drop table|column|schema|type` or an
   unexplained `update` without `where` ever appears in this file, so the two
   warnings cannot quietly become accurate.

## Related

- [`SUPABASE-SETUP.md`](SUPABASE-SETUP.md) — every migration and what it added
- [`SUBSCRIPTION.md`](SUBSCRIPTION.md) — how plans are set, locally and centrally
- `supabase/schema-tests.sql` — the 14 rolled-back suites that prove the file
  behaves, including the tenancy doors schema 18 closed
