---
phase: 12-reporting-dashboards-nlq
plan: 02
subsystem: database
tags: [clickhouse, analytics, ddl, security, readonly-user, nlq, olap]

# Dependency graph
requires:
  - phase: 07-point-of-sale-kitchen-display
    provides: ORDER_CLOSED / TILL_CLOSED real event payloads (PosClosePayloads.java, TillServiceImpl)
  - phase: 10-purchasing-accounts-payable
    provides: VENDOR_INVOICE_MATCHED real event payload (VendorInvoiceService.publishMatched)
provides:
  - "clickhouse_analytics database with 4 tenant/branch-leading fact tables: sales_order_facts, sales_item_facts, purchase_tax_facts, till_session_facts"
  - "nlq_readonly ClickHouse user: table-scoped SELECT-only, 5s execution cap, 10k row cap, zero settings-override surface — empirically proven"
  - "deploy/clickhouse/apply.sh — idempotent, re-runnable schema applier, also self-heals the container's SQL-driven access-control gap"
  - "Verified ClickHouse 25.9 CREATE SETTINGS PROFILE / CREATE USER grammar (12-RESEARCH Open Question 1, closed)"
affects: [12-03 (ETL consumers write into these exact tables), 12-05 (named reports read these), 12-06 (dashboard tiles), 12-07 (NLQ AST validator's table allowlist + the nlq_readonly execution user)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ClickHouse DDL is NOT Flyway-managed — hand-authored, idempotent V*.sql files applied by a bash+curl HTTP-interface script (deploy/clickhouse/apply.sh), since Flyway has no ClickHouse dialect"
    - "ClickHouse users.d/ config override sorted to load AFTER the docker-entrypoint-generated default-user.xml (last-file-wins XML merge) to flip access_management on without touching docker-compose.yml"

key-files:
  created:
    - deploy/clickhouse/V001__analytics_facts.sql
    - deploy/clickhouse/V002__nlq_readonly_user.sql
    - deploy/clickhouse/apply.sh
    - deploy/clickhouse/README.md
    - deploy/clickhouse/zz-access-management.xml
  modified: []

key-decisions:
  - "purchase_tax_facts and till_session_facts column lists were REDUCED from the plan's context-block prose to only the fields the real event payloads actually publish (VendorInvoiceService.publishMatched's Map has invoiceId/poId/amountPaisa/inputTaxPaisa/matchStatus only — no vendorId/invoiceNo/invoiceDate/subtotalPaisa; TillServiceImpl.closeTill's Map has tillSessionId/expectedCashPaisa/countedCashPaisa/variancePaisa/cashierId only). tenant_id/branch_id/event_id come from the EventEnvelope wrapper, not the payload."
  - "purchase_tax_facts.purchase_order_id is NON-nullable (plan context assumed Nullable) — VendorInvoice.purchaseOrderId is a NOT NULL Postgres column and 'poId' is always present in the published payload."
  - "SQL-driven access control (access_management) is OFF by default on the stock clickhouse/clickhouse-server:25.9 image for the entrypoint-generated default user — a real, empirically-confirmed finding, not assumed from docs. Fixed via a users.d/ override file (zz-access-management.xml, sorted to load after the entrypoint's own default-user.xml) that apply.sh docker-cp's in and restarts the container for — entirely within deploy/clickhouse/, never touching deploy/docker-compose.yml or deploy/init/*."
  - "ClickHouse 25.9's CREATE SETTINGS PROFILE grammar requires an explicit bound after MAX/MIN (`max_execution_time = 5 MAX 5`) — the bare `<value> MAX` form from 12-RESEARCH's docs-derived sketch is a SYNTAX_ERROR on this version, confirmed live."
  - "CONST on `readonly` blocks ALL client-supplied SETTINGS clauses outright (not just the constrained ones) — confirmed a client attempting to set even an unconstrained setting like max_block_size is rejected with 'Cannot modify ... setting in readonly mode'. Stronger defense-in-depth than the plan required (no settings-override surface at all, not just a capped one)."

patterns-established:
  - "Any future ClickHouse migration file goes in deploy/clickhouse/ as V<NNN>__description.sql, applied via apply.sh; apply.sh already handles multi-statement splitting (ClickHouse's HTTP interface rejects semicolon-separated multi-statement bodies) and password placeholder substitution."

# Metrics
duration: ~35min
completed: 2026-07-16
---

# Phase 12 Plan 02: ClickHouse Analytics Schema + nlq_readonly User Summary

**Four tenant/branch-leading ReplacingMergeTree fact tables and a table-scoped, 5s/10k-row-capped `nlq_readonly` ClickHouse user, both applied and empirically proven against the live ClickHouse 25.9 container — including discovering and fixing that the stock image ships SQL-driven access control disabled.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-16
- **Tasks:** 3/3
- **Files modified:** 5 created (V001, V002, apply.sh, README.md, zz-access-management.xml)

## Accomplishments

- `clickhouse_analytics.sales_order_facts`, `sales_item_facts`, `purchase_tax_facts`, `till_session_facts` created live, all with `tenant_id, branch_id` leading `ORDER BY` and `PARTITION BY toYYYYMM(business_date)`.
- Discovered (not assumed) that the stock `clickhouse-server:25.9` image disables SQL-driven access control for the default user — fixed with a `users.d/` config override, applied by `apply.sh` via `docker cp` + restart, entirely within `deploy/clickhouse/`.
- Empirically determined the ClickHouse 25.9 `CREATE SETTINGS PROFILE` / `CREATE USER ... SETTINGS PROFILE` grammar by trial against the live server (closing 12-RESEARCH Open Question 1) — the docs-derived bare `MAX` form is a syntax error; `MAX <n>` with an explicit bound is required.
- `nlq_readonly` user created and proven, with verbatim server output, to: SELECT successfully, reject INSERT/DROP/CREATE, reject reads of ungranted tables (`system.users`), reject a 20,000-row result set at the 10,000-row cap, reject ANY client-supplied `SETTINGS` clause (not just over-the-cap ones), and time out a genuinely compute-bound query at exactly the 5-second ceiling (`elapsed 5000.2ms, maximum: 5000ms`).
- `apply.sh` run twice against the live container, both times exit 0 (idempotent); a third run with `CLICKHOUSE_READONLY_PASSWORD=` unset fails fast (exit 1) even though `deploy/.env` sets a value — confirmed the calling environment always wins over `.env`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Author the analytics fact-table DDL** - `7778826` (feat)
2. **Task 2: Author the nlq_readonly settings profile, user and grants** - `90fe9f1` (feat)
3. **Task 3: Idempotent applier script + apply everything to the live container** - `0d199ec` (feat)

**Plan metadata:** (this commit, docs)

## Files Created/Modified

- `deploy/clickhouse/V001__analytics_facts.sql` — the four fact tables, `CREATE TABLE IF NOT EXISTS`, re-runnable.
- `deploy/clickhouse/V002__nlq_readonly_user.sql` — `nlq_readonly_profile` settings profile, `nlq_readonly` user (`CREATE USER OR REPLACE`), 4 per-table `GRANT SELECT` statements.
- `deploy/clickhouse/apply.sh` — bash+curl idempotent applier; handles `.env` sourcing with calling-environment precedence, fail-fast on missing readonly password, per-statement HTTP posting (ClickHouse rejects multi-statement bodies), and self-heals the container's `access_management` gap.
- `deploy/clickhouse/README.md` — usage, file-naming convention, boundary with `deploy/init/clickhouse-init.sql`.
- `deploy/clickhouse/zz-access-management.xml` — `users.d/` override enabling SQL-driven access control; deployed via `docker cp` by `apply.sh`, never referenced by `deploy/docker-compose.yml`.

## Exact Column Lists (pinned for 12-03 ETL and 12-07 NLQ schema prompt)

**`sales_order_facts`** (`ORDER BY (tenant_id, branch_id, business_date, order_id)`):
`tenant_id UUID, branch_id UUID, business_date Date, order_id UUID, order_no String, order_type LowCardinality(String), customer_id Nullable(UUID), subtotal_paisa Int64, discount_paisa Int64, service_charge_paisa Int64, tax_paisa Int64, total_paisa Int64, till_session_id UUID, cashier_id UUID, closed_at DateTime64(3,'UTC'), event_id UUID`

**`sales_item_facts`** (`ORDER BY (tenant_id, branch_id, business_date, order_id, line_no)`):
`tenant_id UUID, branch_id UUID, business_date Date, order_id UUID, line_no UInt16, menu_item_id UUID, item_name String, qty Int32, unit_price_paisa Int64, line_total_paisa Int64, cogs_paisa Nullable(Int64), gross_margin_paisa Nullable(Int64), category_name Nullable(String), closed_at DateTime64(3,'UTC'), event_id UUID`
(cogs/margin/category are Phase-8-deferred NULLs — reports must render "—", never 0)

**`purchase_tax_facts`** (`ORDER BY (tenant_id, branch_id, business_date, invoice_id)`) — REDUCED from plan prose to match the real published payload:
`tenant_id UUID, branch_id UUID, business_date Date, invoice_id UUID, purchase_order_id UUID, input_tax_paisa Int64, total_paisa Int64, match_status LowCardinality(String), matched_at DateTime64(3,'UTC'), event_id UUID`
(no vendor_id/invoice_no/invoice_date/subtotal_paisa — not present in `VendorInvoiceService.publishMatched`'s payload map)

**`till_session_facts`** (`ORDER BY (tenant_id, branch_id, business_date, till_session_id)`) — REDUCED from plan prose to match the real published payload:
`tenant_id UUID, branch_id UUID, business_date Date, till_session_id UUID, cashier_id UUID, expected_cash_paisa Int64, counted_cash_paisa Int64, variance_paisa Int64, closed_at DateTime64(3,'UTC'), event_id UUID`

## Verified ClickHouse 25.9 SETTINGS PROFILE / CREATE USER Grammar (Open Question 1, CLOSED)

```sql
CREATE SETTINGS PROFILE IF NOT EXISTS nlq_readonly_profile SETTINGS
    readonly = 1 CONST,
    max_execution_time = 5 MAX 5,
    max_result_rows = 10000 MAX 10000,
    result_overflow_mode = 'throw' CONST;

CREATE USER OR REPLACE nlq_readonly
    IDENTIFIED WITH plaintext_password BY '<password>'
    SETTINGS PROFILE 'nlq_readonly_profile';
```

Key empirical findings not obvious from the docs:
- The bare form `<setting> = <value> MAX` (no explicit bound) is a **syntax error** on 25.9: `Code: 62. DB::Exception: Syntax error ... Expected one of: token, Equals, literal, ...`. `MAX`/`MIN` require an explicit numeric bound (`MAX 5`).
- `CONST` on `readonly` blocks **every** client-supplied `SETTINGS` clause outright, not just settings that have their own `MAX`/`MIN` constraint — confirmed by a request to set the *unrelated, unconstrained* `max_block_size` also being rejected with `Cannot modify 'max_block_size' setting in readonly mode. (READONLY)`. This is stronger than the plan required (zero settings-override surface, not just a capped one).
- `SHOW CREATE SETTINGS PROFILE nlq_readonly_profile` echoes back:
  `` CREATE SETTINGS PROFILE `nlq_readonly_profile` SETTINGS readonly = 1 CONST, max_execution_time = 5. MAX 5., max_result_rows = 10000 MAX 10000, result_overflow_mode = \'throw\' CONST ``

## Verbatim Rejection Messages (the 5 negative security checks — real server output)

Run as `curl -s "http://localhost:8123/?user=nlq_readonly&password=$CLICKHOUSE_READONLY_PASSWORD" --data-binary "<query>"`:

1. **Read works** (`SELECT count() FROM clickhouse_analytics.sales_order_facts`): `0`

2. **INSERT rejected** (`INSERT INTO clickhouse_analytics.sales_order_facts (tenant_id) VALUES (generateUUIDv4())`):
   ```
   Code: 497. DB::Exception: nlq_readonly: Not enough privileges. To execute this query, it's
   necessary to have the grant INSERT(tenant_id) ON clickhouse_analytics.sales_order_facts.
   (ACCESS_DENIED) (version 25.9.7.56 (official build))
   ```

3. **DROP rejected** (`DROP TABLE clickhouse_analytics.sales_order_facts`):
   ```
   Code: 497. DB::Exception: nlq_readonly: Not enough privileges. To execute this query, it's
   necessary to have the grant DROP TABLE ON clickhouse_analytics.sales_order_facts.
   (ACCESS_DENIED) (version 25.9.7.56 (official build))
   ```
   Confirmed via `SHOW TABLES FROM clickhouse_analytics` (as `default`) immediately after — all 4 tables still present.

4. **CREATE rejected** (`CREATE TABLE clickhouse_analytics.pwned (x Int8) ENGINE=Memory`):
   ```
   Code: 497. DB::Exception: nlq_readonly: Not enough privileges. To execute this query, it's
   necessary to have the grant CREATE TABLE ON clickhouse_analytics.pwned.
   (ACCESS_DENIED) (version 25.9.7.56 (official build))
   ```

5. **Ungranted table rejected** (`SELECT * FROM system.users`):
   ```
   Code: 497. DB::Exception: nlq_readonly: Not enough privileges. To execute this query, it's
   necessary to have the grant SELECT(name, id, storage, auth_type, ...) ON system.users.
   (ACCESS_DENIED) (version 25.9.7.56 (official build))
   ```

6. **Row cap is REAL** (`SELECT number FROM numbers(20000)`):
   ```
   Code: 396. DB::Exception: Limit for result exceeded, max rows: 10.00 thousand, current rows:
   20.00 thousand. (TOO_MANY_ROWS_OR_BYTES) (version 25.9.7.56 (official build))
   ```

7. **Settings self-raise rejected** (`SELECT 1 SETTINGS max_execution_time = 600`):
   ```
   Code: 164. DB::Exception: Cannot modify 'max_execution_time' setting in readonly mode.
   (READONLY) (version 25.9.7.56 (official build))
   ```

8. **(bonus, went beyond the plan's checklist) 5-second timeout is REAL wall-clock, not just a config value** — a genuinely compute-bound query (`SELECT count() FROM numbers(200000000000) WHERE NOT ((number*number*number*7+13) % 97 = 0)`) was actually executed and killed:
   ```
   Code: 159. DB::Exception: Timeout exceeded: elapsed 5000.206751 ms, maximum: 5000 ms.
   (TIMEOUT_EXCEEDED) (version 25.9.7.56 (official build))
   ```
   (`time curl ...` measured 5.035s wall clock.)

## Decisions Made

- Column lists for `purchase_tax_facts` and `till_session_facts` were reduced from the plan's context-block prose to match ONLY the fields present in the real, currently-publishing event payloads (`VendorInvoiceService.publishMatched`, `TillServiceImpl.closeTill`) — per the plan's own explicit instruction and the established codebase pattern (decisions 10-13-A/10-14-A) of trusting real source over plan prose. `tenant_id`/`branch_id`/`event_id` are sourced from the `EventEnvelope` wrapper, not the payload body, for every table.
- SQL-driven access control (`access_management`) is OFF by default on the stock image for the entrypoint-generated default user — a real, empirically-confirmed environmental finding (not assumed from ClickHouse docs). Fixed with a `users.d/` config override file that sorts alphabetically after the entrypoint's own `default-user.xml` (ClickHouse's XML merge is last-file-wins per scalar element) — deployed by `apply.sh` via `docker cp` + container restart, never touching `deploy/docker-compose.yml` or `deploy/init/*` (both owned by the concurrent 12-01 plan).
- `MAX <n>` (explicit bound) is required by ClickHouse 25.9's grammar; the bare `<value> MAX` sketch from 12-RESEARCH is a syntax error on this version. `CONST` additionally blocks ALL client `SETTINGS` clauses, not just the constrained setting itself — stronger defense-in-depth than strictly required, kept as-is since it's a security improvement with no functional downside for a read-only NLQ execution user.
- `apply.sh` preserves calling-environment variable values (even empty-string) over `deploy/.env` — needed so the fail-fast test (`CLICKHOUSE_READONLY_PASSWORD= bash apply.sh`) actually exercises the fail-fast path rather than being silently overridden by `.env`'s populated value.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Stock ClickHouse 25.9 image ships SQL-driven access control disabled**
- **Found during:** Task 2 (verifying the CREATE SETTINGS PROFILE/CREATE USER grammar against the live container, as the plan explicitly required)
- **Issue:** `SHOW ACCESS` as the `default` user returned `Code: 497 ... Not enough privileges ... SHOW ACCESS ON *.*` — `access_management` is 0 by default, meaning `CREATE USER`/`CREATE SETTINGS PROFILE`/`GRANT` would all fail identically, blocking Task 2/3 entirely.
- **Fix:** Added `deploy/clickhouse/zz-access-management.xml`, a `users.d/` config override enabling `access_management=1` for the default user; `apply.sh` `docker cp`s it into the running container and restarts the container if not already applied. Confirmed via `SHOW ACCESS` after the fix returning the full grant list instead of an error.
- **Files modified:** `deploy/clickhouse/zz-access-management.xml` (new), `deploy/clickhouse/apply.sh`
- **Verification:** `SHOW ACCESS` succeeds post-fix; `CREATE SETTINGS PROFILE`/`CREATE USER`/`GRANT` all succeed; re-running `apply.sh` a second time does NOT restart the container again (idempotency check reads the deployed file's actual value, not just presence).
- **Committed in:** `90fe9f1` (Task 2 commit)

**2. [Rule 3 - Blocking] `.env` silently overrode an explicit empty-string environment override**
- **Found during:** Task 3, running the plan's own required verify step `CLICKHOUSE_READONLY_PASSWORD= bash deploy/clickhouse/apply.sh` (expected exit non-zero)
- **Issue:** First implementation used `set -a; source deploy/.env; set +a`, which re-assigned `CLICKHOUSE_READONLY_PASSWORD` from `.env`'s populated value even though the caller had explicitly set it to empty — the fail-fast check never fired; the script exited 0 and would have silently created (or attempted to create) a user with `.env`'s password instead of failing as required.
- **Fix:** Capture pre-`.env` values (via `${VAR+x}` set-detection, distinguishing "explicitly set to empty" from "never set") before sourcing `deploy/.env`, then restore them afterward — calling-environment values always win.
- **Files modified:** `deploy/clickhouse/apply.sh`
- **Verification:** `CLICKHOUSE_READONLY_PASSWORD= bash deploy/clickhouse/apply.sh` now exits 1 with the fail-fast message; a normal run (no override) still succeeds and picks up `.env`'s value.
- **Committed in:** `0d199ec` (Task 3 commit)

**3. [Rule 1 - Bug] ClickHouse HTTP interface rejects multi-statement request bodies**
- **Found during:** Task 3, first `apply.sh` run — V001 (5 statements) and V002 (6 statements) each POSTed as one HTTP body failed with `Code: 62 ... Multi-statements are not allowed`.
- **Issue:** The initial `apply_sql` design POSTed each entire file as a single request; ClickHouse's HTTP interface only accepts one statement per request (no `multiquery` option on HTTP, unlike `clickhouse-client`).
- **Fix:** `apply.sh` now strips `--` comments and splits each expanded file into individual `;`-terminated statements before POSTing each one separately.
- **Files modified:** `deploy/clickhouse/apply.sh`
- **Verification:** Both V001 and V002 apply cleanly end to end; re-run twice, both exit 0.
- **Committed in:** `0d199ec` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 bug)
**Impact on plan:** All three were necessary to satisfy the plan's own must-haves (a live, empirically-proven apply against the real container) — no scope creep, no architectural changes.

## Issues Encountered

- Initial idempotency-check `grep` for the access-management override's applied state matched the OLD value (`0`) quoted inside the file's own doc comment as well as the real applied value (`1`), causing an unnecessary container restart on every run. Fixed by taking the last grep match (`tail -n1`) — the real `<users><default>` element is always the last occurrence, after the comment block closes. Verified: a second `apply.sh` run no longer restarts the container.

## User Setup Required

None — no external service configuration required. `deploy/.env` already carries the necessary `CLICKHOUSE_READONLY_PASSWORD` for local dev; production deployment need only ensure that variable is set before running `apply.sh`.

## Next Phase Readiness

- The four fact tables and their exact column lists are pinned above for 12-03 (ETL consumers write into these tables byte-for-byte) and 12-07 (NLQ AST validator's stage-3 table allowlist + the schema prompt fed to Claude).
- The `nlq_readonly` user is live, its credentials come from `deploy/.env`'s `CLICKHOUSE_READONLY_PASSWORD`, and its constraints are proven, not assumed — 12-07's ClickHouse executor can connect with confidence that even a validator bypass cannot write, drop, or read beyond the four granted tables, cannot exceed 5s/10k rows, and cannot self-raise any setting.
- `deploy/clickhouse/apply.sh` is safe to run in any environment (dev, CI, staging) — it self-heals the access-control gap only when it finds a local `restaurantos-clickhouse` container, and is a no-op success on environments where SQL-driven ACL is already enabled (e.g. a managed/remote ClickHouse instance).
- No blockers. The one thing future plans should know: `purchase_tax_facts` has no `vendor_id`/`invoice_no`/`invoice_date` columns (not in the real event payload) — any report needing those must Feign-call purchasing-service or accept the gap, same class of limitation as 10-12-C/10-13-C's "no received-to-date" findings.

---
*Phase: 12-reporting-dashboards-nlq*
*Completed: 2026-07-16*
