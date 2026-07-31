---
phase: 12-reporting-dashboards-nlq
plan: 05
status: complete
completed: 2026-07-18
wave: 3
executed_by: delegated executor (code), finished + verified in the orchestrator main loop
---

# 12-05 SUMMARY — Named reports + FBR Tax Summary

## What was built
- `ReportCatalog` — 7 reports backed by real ETL facts (sales-by-day/item/hour/order-type,
  discount-summary, till-sessions, purchases-by-po). Deliberately NOT the spec's "40 reports"; a
  report with no backing data is omitted. `purchases-by-vendor` renamed `purchases-by-po`
  (purchase_tax_facts has no vendor_id — documented 12-02 gap).
- `ReportService` — structural tenant/branch safety: tenant_id from TenantContext only (never a
  request field); non-OWNER cannot read another branch; OWNER may run tenant-wide.
- `FbrTaxSummaryService` — output tax (sales facts) − input tax (purchase_tax_facts) = net payable,
  never clamped (a negative net payable is a legitimate refundable credit).
- `ReportController` — @PreAuthorize reporting.report.view / reporting.report.fbr.

## Verification — `mvn -pl services/reporting-service verify` → BUILD SUCCESS (20 tests)
BusinessDayTest 6, EtlPipelineIT 6, **ReportServiceIT 4** (tenant + branch isolation on real
ClickHouse+Postgres), **FbrTaxSummaryIT 4** (output−input=net payable exact to the paisa; negative
net payable; tenant B never leaks into tenant A; NTN/STRN header from the internal Feign client).

## Two bugs found by running the ITs
1. **FBR nested-aggregate (ClickHouse Code 184)** — real prod bug. `sum(input_tax_paisa) AS
   input_tax_paisa` shadowed the column, so `sum(total_paisa - input_tax_paisa)` became
   `sum(... - sum(...))`. Aliased to `input_tax_total_paisa`.
2. **Date-seed off-by-one (test bug)** — the ITs seeded business_date via
   `java.sql.Date.valueOf(localDate)`, which clickhouse-jdbc 0.8.6 stores a DAY EARLY on this
   Australia/Sydney JVM (midnight local → prior UTC date), so LocalDate-bound report queries matched
   nothing. Proven with a throwaway diagnostic (LocalDate→2026-03-10, java.sql.Date→2026-03-09).
   Production was already correct (SalesFactWriter + report queries both use LocalDate); only the
   seeds were wrong. Fixed the seeds; a brief java.sql.Date "fix" to prod was reverted (it would have
   made prod match the buggy test and miss real facts).

## Findings / open items
- **No P95 latency target exists** anywhere in REQUIREMENTS.md or the spec (ROADMAP SC-1 references
  one). Not invented. report_run_log records real durationMs; 12-10 should propose a target from data.
- COGS/margin remain NULL (Phase 8 unbuilt) — rendered honestly, never 0 (proven by
  salesByItem_cogsIsNull).
- No FBR/IRIS e-filing integration exists or was built — this is an internal bookkeeping report.

## Commits
- `b026831` report catalog + ReportService (tenant-safe parameterised queries)
- `2a1c80f` FBR Tax Summary (output vs input vs unclamped net payable)
- `be3c224` REST controller + green report/FBR ITs + the two fixes above
