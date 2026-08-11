---
phase: 36-purchasing-inventory-wiring
plan: 01
subsystem: testing
tags: [e2e, rls, procure-to-pay, purchasing, inventory, rabbitmq, postgres, harness]

requires:
  - phase: 22-financial-wiring
    provides: the GR/IR posting and the "drive money, don't read code" verification discipline
  - phase: 17b
    provides: FORCE row-level security on purchasing_db and inventory_db
  - phase: 13
    provides: scripts/e2e/_phase13-lib.sh — login, token, curl and assertion apparatus
provides:
  - a sourced live-drive harness with service-role SQL, an RLS canary, queue depth and a jar-freshness gate
  - a full procure-to-pay drive, reusable unchanged as an acceptance gate via PHASE31_GATE=1
  - an evidenced findings register routing every defect to exactly one locked decision
affects: [36-02, 36-03, 36-04, 36-05, 36-06, 36-07, 36-08]

tech-stack:
  added: []
  patterns:
    - "Every SQL assertion connects as the owning SERVICE role and refuses postgres — a superuser is exempt from FORCE RLS and would score a live leak as healthy data"
    - "An RLS canary runs before any SQL evidence is trusted"
    - "Cross-tenant isolation is probed at the API layer as well as the database layer, because a bare findById compiles and is scoped by nothing"
    - "A diagnostic drive never stops at the first failure; a gate flag turns the same script into an acceptance gate"

key-files:
  created:
    - scripts/e2e/_phase31-lib.sh
    - scripts/e2e/phase31-procure-to-pay-e2e.sh
    - .planning/phases/36-purchasing-inventory-wiring/31-01-FINDINGS.md
    - .planning/phases/36-purchasing-inventory-wiring/31-01-drive.log
  modified: []

key-decisions:
  - "The MANAGER 403 does not reproduce — the grants are present in auth_db and on the token. No role may be widened in 36-02."
  - "The purchase-unit conversion arithmetic is CORRECT and hand-checked to the paisa. 36-06 must add the refusal, not touch the arithmetic."
  - "F-31-01, a previously unknown blocker: a goods receipt of more than one line is impossible."

patterns-established:
  - "Freshness gate: no assertion against the live stack is made before scripts/check-stale-jars.sh clears the services this phase reasons about"
  - "Discrimination over diagnosis: when a step fails, the drive immediately runs the variant that separates two candidate causes"

requirements-completed: [PIW-01]

duration: 95min
completed: 2026-08-11
status: complete
---

# Phase 36 Plan 01: Procure-to-pay live drive Summary

**The whole vendor → PO → approve → receive → invoice → match → pay chain was driven for real
against the running stack as both MANAGER and OWNER; it breaks in exactly one place (a multi-line
goods receipt is impossible), the reported MANAGER 403 no longer reproduces, and the 1000× unit
conversion is already correct — but a unit the tenant has never defined is still received at face
value.**

## Performance

- **Duration:** ~95 min
- **Tasks:** 3 of 3
- **Files created:** 4
- **Assertions in the final run:** 47 pass, 2 fail (both the same defect, once per persona)

## Accomplishments

- **A harness that cannot fool itself.** Two blind spots that have already produced false results on
  this project are closed by construction: every SQL helper connects as the owning service role and
  *refuses* `postgres` outright (a superuser bypasses FORCE RLS, so a real cross-tenant leak would
  read as healthy data), and the run is gated on jar-inode freshness (phase 22 spent hours proving a
  defect in a process that had never loaded its fix).
- **The chain was actually driven, twice.** Every step has an HTTP status and a row read back from
  the database. Driving it as both MANAGER and OWNER is what separates "this role may not" from
  "this endpoint is broken for everyone" — and that distinction is what settled the 403 question.
- **One new blocker found that nobody had recorded:** `POST /{poId}/mock-receive` with two lines
  answers 409. `GrnReceiptSimulator` writes one `MockGrnReceipt` per line and stamps the caller's
  single `Idempotency-Key` on all of them, colliding with `uq_mock_grn_idem UNIQUE (tenant_id,
  idempotency_key)`. Sending the same receipt one line at a time succeeds — so receiving is not
  broken, receiving *more than one line* is, which is a different repair entirely.
- **The reported defects were reproduced precisely.** A PO for an ingredient inventory has never seen
  is accepted, reaches `FULLY_RECEIVED`, produces no stock, no movement and no ledger entry, and
  dead-letters ~20s later into a queue with no consumer and no monitor. A hand-typed line with unit
  `FURLONG` turned 7 furlongs into 7 kilograms of Basmati Rice.
- **Three things were found already fixed and recorded as such**, so a later plan does not repair
  them again: the conversion arithmetic, one journal entry per receipt (26 movements → 26 entries
  across 26 distinct source ids), and application-layer tenant isolation on both read paths probed.

## Task Commits

1. **Task 1: The harness** — `cb65573` (test)
2. **Task 2: The drive** — `b56b920` (test)
3. **Task 3: The findings register** — this plan's metadata commit

## Files Created

- `scripts/e2e/_phase31-lib.sh` — sourced library: service-role SQL for purchasing/inventory/finance/auth
  with the tenant GUC set on the same connection as the statement, a superuser refusal, an RLS canary,
  RabbitMQ queue/DLQ depth, a scoped jar-freshness gate, tenant lookup and a self-test.
- `scripts/e2e/phase31-procure-to-pay-e2e.sh` — the full chain twice over, four deliberate probes,
  the master-data CRUD matrix, ledger read-back and queue-consumer census. Exits 0 as a diagnostic;
  `PHASE31_GATE=1` makes it an acceptance gate.
- `.planning/phases/36-purchasing-inventory-wiring/31-01-FINDINGS.md` — six findings, six
  confirmed-closed items, four handoffs, and the per-decision inbox for plans 36-02 … 36-07.
- `.planning/phases/36-purchasing-inventory-wiring/31-01-drive.log` — the raw run.

## The interface later plans depend on

Plans 36-06, 36-07 and 36-08 invoke these by name:

| Name | Contract |
|---|---|
| `. scripts/e2e/_phase31-lib.sh` | idempotent; sources `_phase13-lib.sh`; safe under `set -euo pipefail` |
| `phase31_freshness_gate` | 0 when auth/purchasing/inventory/finance/gateway run their on-disk jars |
| `phase31_rls_canary <tenant> <other>` | 0 when the harness's own SQL obeys the tenant policy |
| `purchasing_sql <tenant> <sql>` · `inventory_sql` · `finance_sql` · `auth_sql` | tuple-only; refuses a superuser role |
| `queue_depth <q>` · `dlq_depth <q>` | ready-message count, or `n/a` |
| `tenant_id_for <slug>` | tenant uuid |
| `phase31_selftest` | prints resolved origin, roles, freshness and canary verdicts |
| `PHASE31_GATE=1` | the drive exits non-zero while any assertion fails |

## Verdict per locked decision

| Decision | Plan | Verdict |
|---|---|---|
| D-36-02 purchasing permissions | 36-02 | **403 does not reproduce.** Do not widen any role. Remaining: the reachability test, the negative case, and feature-disabled vs permission-denied on screen. |
| D-36-03 approval limits in the UI | 36-03 | Limits work but only because a script wrote them. Full scope stands. |
| D-36-04 PO line must name a real ingredient | 36-04 | F-31-02, F-31-03 confirmed, plus the new blocker F-31-01. |
| D-36-05 one conversion resolver, refusing | 36-06 | Arithmetic **correct** — do not touch. The **refusal** is missing. |
| D-36-06 master data complete CRUD | 36-05 | Ingredients/categories/locations complete. **Units of measure are create-only.** |
| D-36-01 seed and credentials honest | 36-07 | Purchasing is reachable. The seed's RLS warning is stale and must be corrected. |

## Decisions Made

- **Named the MANAGER 403 as permission-grant drift that has already been repaired**, rather than
  leaving it open or widening a role to be safe. Four candidate causes were each excluded with the
  query that excludes it. 13-02 split a permission deliberately and 19b minted a new code rather
  than reuse one a waiter held; adding a grant here to make a symptom disappear would undo that.
- **Recorded the conversion arithmetic as confirmed-closed with a hand-checked case** rather than
  letting 36-06 re-derive it. 2 packs × 500 G against a KG-stocked ingredient produced exactly
  +4.0 KG including the hand-typed line, and moving-average cost blended to 115,000.0000 paisa/KG,
  which is the number arithmetic predicts to the paisa.
- **Routed F-31-05 and F-31-06 to handoff rather than absorbing them.** A finance queue with no
  consumer and a fleet-wide error-envelope weakness are real, and neither is a purchasing repair.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Bash brace expansion silently emptied every request body**

- **Found during:** Task 2, first run of the drive
- **Issue:** Each JSON body is built by `python3 -c` whose source contains `{'a': 1, 'b': 2}`. Bash
  brace-expands that *before* python sees it, so the program became `print(json.dumps('a': 1))`, the
  body went out empty, and eight endpoints answered `400 BAD_REQUEST — Request body is missing or
  malformed`. That reads exactly like a product defect and is not one. `_phase13-lib.sh` carries a
  comment about the same bash behaviour biting the harness in 13-02.
- **Fix:** `set +B` at the top of the drive, with the reasoning written down so the next reader does
  not re-derive it.
- **Verification:** the same eight endpoints answered 200 on the next run.
- **Committed in:** `b56b920`

**2. [Rule 1 — Bug] `docker exec -i` drained the caller's stdin and produced a false all-clear**

- **Found during:** Task 2, cross-tenant probe
- **Issue:** the SQL helper uses `docker exec -i`, which attaches the caller's stdin to the
  container. Called from inside `while read ... < <(...)`, it ate the loop's input, so the loop over
  tenants ran once and the probe reported *"no foreign tenant holds a vendor"* when three do. A false
  negative on an isolation check is the worst possible direction for that lie.
- **Fix:** `< /dev/null` on the `docker exec`, with the reason recorded in the library.
- **Verification:** the probe now finds and attempts Saffron Grill's purchase order and ingredient;
  both are refused with 404.
- **Committed in:** `b56b920`

**3. [Rule 3 — Blocking] Probe 4 targeted an endpoint that does not exist**

- **Found during:** Task 2
- **Issue:** the cross-tenant probe fetched a foreign vendor by id. `VendorController` exposes list,
  create and update only — no `GET /{id}` — so the probe answered 405 and proved nothing about
  isolation while looking like a pass.
- **Fix:** retargeted at `GET /purchase-orders/{id}`, which is a real read path, and kept the
  ingredient probe alongside it so both services are covered.
- **Committed in:** `b56b920`

**4. [Rule 3 — Blocking] Three database read-backs named columns that do not exist**

- **Found during:** Task 2
- **Issue:** the drive read `journal_entry_lines`, `vendor_invoices.match_status` and
  `ap_payments.invoice_id`. The real names are `journal_lines` (joined on `je_id`),
  `vendor_invoices.status`, and `ap_payment_allocations.invoice_id`. Each printed a psql error
  where evidence was supposed to be.
- **Fix:** corrected against the live schema; the ledger read-back now reports 1300 / 1700 / 2100
  movement and a per-source journal-entry census.
- **Committed in:** `b56b920`

**5. [Rule 3 — Blocking] The drive sent an invalid enum and read the 409 as a product defect**

- **Found during:** Task 2
- **Issue:** the harness posted `"source":"drive"` to the vendor price endpoint. `source` is
  constrained to `CATALOG, CONTRACT, INVOICE, MANUAL`. The harness was wrong — but the response said
  only *"This conflicts with existing data"* with an empty `details` array, which is itself worth
  recording, and is now **F-31-06** (routed to handoff, not fixed here).
- **Fix:** the harness sends `MANUAL`; the opacity is recorded as a finding rather than repaired,
  because this plan repairs nothing.
- **Committed in:** `b56b920`

**Total deviations:** 5 auto-fixed (3 × Rule 3 blocking, 1 × Rule 1 bug, 1 × Rule 3 with a finding
raised instead of a fix). **Impact:** all five were harness defects, not product changes. No
production code was touched, which is this plan's central prohibition.

## Issues Encountered

- **The plan's own verification command is stale.** Task 3's `<automated>` block greps findings for
  `D-31-0[1-6]`, but the phase was renumbered from 31 to 36 and the locked decisions are `D-36-01 …
  D-36-06`. The check was re-run with the corrected prefix and passes: 6 findings, all routed.
  The artefact filenames stay at `31-` because the plan's `files_modified`, its verifier and plans
  36-06/07/08 all name them that way; renaming them mid-phase would break three later plans for
  cosmetic consistency.
- **The dead-letter delay is ~20 seconds, not instant.** An early run slept 8 seconds after the
  ghost-ingredient probe and recorded "it did not even dead-letter" — a worse and false finding. The
  consumer retries at 2s/4s/8s first. The sleep is now 25s.
- **`hr-service` and `pos-service` are running stale jars.** Neither is in this phase's reasoning, so
  the gate reports and does not block on them. Recorded because a reader of the log will see the
  script's own `ERROR: at least one service is running code that is not what is on disk`.

## User Setup Required

None.

## Self-Check: PASSED

- `scripts/e2e/_phase31-lib.sh` — FOUND
- `scripts/e2e/phase31-procure-to-pay-e2e.sh` — FOUND
- `.planning/phases/36-purchasing-inventory-wiring/31-01-FINDINGS.md` — FOUND
- `.planning/phases/36-purchasing-inventory-wiring/31-01-drive.log` — FOUND
- commit `cb65573` — FOUND
- commit `b56b920` — FOUND
- `bash -c '. scripts/e2e/_phase31-lib.sh && phase31_selftest'` — exit 0
- `bash scripts/e2e/phase31-procure-to-pay-e2e.sh` — exit 0, 47 pass / 2 fail, log written
