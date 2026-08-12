# Migration version register

**Claim a version HERE before you create the file.** Do not infer the next number from your own
worktree.

## Why this file exists

On 2026-08-12, ~17 sessions worked in parallel git worktrees off `phase-13-access-repair`. Three of
them independently created a **`V27`** for `pos-service`:

```
main                     V27__tenant_tax_policy.sql              <- applied to shared pos_db
eloquent-napier-4baf6b   V27__order_discount_source.sql
wizardly-lamport-e131f3  V27__order_discount_value_bounded.sql
```

Each was correct in its own worktree and each was tested against a clean Testcontainers database
where 27 was free. Against the shared database, Flyway finds version 27 already recorded with a
different checksum and **refuses to start the service** — for whichever runs second, and again for
the third.

The coordinator then reassigned one of them to `V28` — **straight into a fourth claim**, because
`practical-borg-3dc2b3` was already sitting on `V28__hash_legacy_idempotency_fingerprints.sql`. So
the reassignment moved the collision rather than resolving it.

As the agent who caught it put it: *three agents each picked "the next number after the last one in
MY worktree", and every one of them was right locally and wrong globally. It will recur on every
migration until the number is assigned centrally rather than inferred.*

**A version number is a shared resource. Inferring one from a private view cannot be made safe by
being careful.**

## How to claim

1. Read the tables below.
2. Take the next free number for your service and **add a row before creating the file**.
3. If you cannot edit this file (you are in a worktree on another branch), **ask the coordinating
   session** and it will assign one.
4. Never renumber a version that has been APPLIED to a shared database — its checksum is recorded
   and renaming orphans it.

## pos-service (Flyway)

| Version | Description | Owner / worktree | State |
|---|---|---|---|
| V25 | modifier catalogue | main | applied |
| V26 | print agent devices | main | applied |
| V27 | tenant tax policy | main | **applied to shared `pos_db`** — do not renumber |
| V28 | hash legacy idempotency fingerprints | `practical-borg-3dc2b3` (void reason length) | **claimed, NOT merged — see the gap warning below** |
| V29 | order discount value bounded | `wizardly-lamport-e131f3` (PERCENT/FLAT bound) | claimed |
| V30 | order discount source (MANUAL/PROMOTION) | `eloquent-napier-4baf6b` (promotions) | **assigned 2026-08-12** — reassigned from V27, then from V28 after BOTH collided |
| V31+ | — | free | |

### THE V28 GAP — a live hazard, not bookkeeping

As of 2026-08-12, `main`/`prod`/`phase-13-access-repair` carry **V27, V29 and V30 but NOT V28**.
V28 (`V28__hash_legacy_idempotency_fingerprints.sql`) is a **pos-service** migration and it is the
only thing still sitting on the one unmerged branch, `claude/practical-borg-3dc2b3`.

**Flyway `out-of-order` is not configured anywhere in this repo, so it defaults to FALSE.** Spring
Boot also defaults `validate-on-migrate` to true. So the sequence matters:

```
live pos_db today          = version 27      (V29 and V30 are in the code, NOT yet applied)
next restart on a main jar = applies 29, 30  -> schema reaches 30
merging practical-borg later then introduces V28, BELOW the applied maximum
  -> validation fails, and pos-service refuses to start for everyone
```

**There is still a window, and it closes at the next pos-service restart.** Two safe routes:

1. **Merge `claude/practical-borg-3dc2b3` BEFORE the fleet next restarts**, so 28, 29 and 30 all
   apply together in order. Task #37 carries the conflict resolutions.
2. **Renumber V28 → V31 when merging.** Safe here *specifically because V28 has never been applied*
   — the live database is at 27 — so the "never renumber an applied version" rule above does not
   bite. Verify against `flyway_schema_history` before assuming that is still true, and rebuild with
   `clean` afterwards (see the stale-`target/` trap below).

Do not simply merge it after a restart and hope. That is the one ordering that breaks the service.

## Other services

No contention observed yet. The same rule applies — claim here first.

| Service | Tool | Highest known | Notes |
|---|---|---|---|
| kitchen-service | Flyway | — | |
| finance-service | Flyway | — | |
| inventory-service | Flyway | — | |
| purchasing-service | Flyway | — | |
| auth-service | Liquibase | 090+ | changeset ids, not versions; same rule |
| user-service | Liquibase | 013 | |
| hr-service | Liquibase | 035 | |
| audit-service | Liquibase | **030** | `030-audit-events-rls.xml` applied. Partitioned: policy must be per-partition AND applied at creation — a parent-only policy leaks and its test stays green. |
| crm-service | Liquibase | — | |
| platform-admin-service | Liquibase | **040** | `040-platform-db-rls-posture.xml` claimed 2026-08-12 (`main`, platform_db RLS posture). Existing: 010, 020, 030, seeds 900/901/910. RLS is DELIBERATELY ABSENT here — read that file's header before adding any policy; a `tenant_isolation` policy makes the console read 0 rows. |
| file-service | Liquibase | — | |
| **ClickHouse** | `deploy/clickhouse/` | **V005** | `V005__discount_source.sql` held by `eloquent-napier-4baf6b`. A shared resource with the identical inference trap — claim here. |

## Renumbering is not finished until someone rebuilds with `clean`

`mvn package` does not clean. After renaming a migration, `target/classes/db/migration/` still holds
the **old filename**, and the packaged jar ships **both**. Flyway then finds the old version with a
checksum that does not match the one recorded in the shared database and refuses to boot — the exact
failure the renumber was performed to prevent, arriving through the back door of a stale build
directory.

Caught on 2026-08-12 by the promotions session, on its own jar, before handing it over:

```
target/classes/db/migration/  ->  V27__order_discount_source.sql  (stale, renamed away)
                                  V28__order_discount_source.sql  (new)
jar contained BOTH
```

**A word-boundary grep does NOT find the filename you are renaming.** `_` is a word character, so
there is no boundary between the `8` and the `_` in `V28__order_discount_source.sql` — `\bV28\b`
matches every prose mention and silently skips the file itself. Sweep for **both** `\bV28\b` and
`V28__`. Caught on the third rename of the same file, in a decision document, after two clean sweeps.

**After any rename, rebuild with `clean` and verify the jar's contents**, e.g.
`unzip -l <jar> | grep -oE 'V[0-9]+__[a-z_]+\.sql' | sort -V`. Confirm the old name is absent, not
merely that the new one is present.

## Two traps worth knowing before you write one

**A data-repair `UPDATE` inside a migration cannot see FORCE-RLS rows, while the DDL beside it
can.** Liquibase/Flyway runs as the table owner on a connection with no `app.current_tenant_id`, and
under `FORCE ROW LEVEL SECURITY` the owner is subject to the policy — so the `UPDATE` matches zero
rows while `ALTER TABLE` still applies to every row. `V22__order_discount_reason.sql`'s header
records a migration that shipped in exactly that shape and stopped the service booting. Prefer a
`NOT VALID` constraint plus a documented, credentialed repair step over a repair inside the
migration. Do **not** reach for `DISABLE ROW LEVEL SECURITY` or `NO FORCE` to force it through.

**Applying a migration from a worktree to the shared database breaks the main checkout.** Spring
Boot's Flyway defaults to `validate-on-migrate: true`, so once the shared database records a version
the main tree cannot resolve locally, the main service refuses to start. Coordinate the file landing
in both places at the same time.
