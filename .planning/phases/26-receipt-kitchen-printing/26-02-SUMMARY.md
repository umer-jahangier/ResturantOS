---
phase: 26
plan: "02"
subsystem: print-config
status: complete
tags: [print, config, branch, rls, validation, user-service, frontend]
requires: []
provides:
  - "a typed, validated printer registry stored in `branches.receipt_config`"
  - "GET/PUT `/api/v1/branches/{branchId}/receipt-config`, gated on `rbac.manage | branch.manage`"
  - "a completeness report naming every declared kitchen station no printer routes"
  - "the frontend four-layer data stack plus TanStack hooks for the 26-10 configuration UI"
affects:
  - user-service (new controller/service/DTOs; BranchService and BranchRepository extended)
  - the legacy branch write path (a non-null `receiptConfig` is now refused)
  - frontend lib/ (new schema, model, adapter, repository, hooks)
tech-stack:
  added: []
  patterns:
    [
      existing-column-not-a-new-table,
      declarative-cross-field-constraints,
      completeness-report-over-silence,
      close-the-legacy-door,
      failure-is-not-absence,
    ]
key-files:
  created:
    - services/user-service/src/main/java/io/restaurantos/user/dto/ReceiptConfigDtos.java
    - services/user-service/src/main/java/io/restaurantos/user/service/ReceiptConfigService.java
    - services/user-service/src/main/java/io/restaurantos/user/controller/ReceiptConfigController.java
    - services/user-service/src/main/java/io/restaurantos/user/exception/ReceiptConfigExceptionHandler.java
    - services/user-service/src/test/java/io/restaurantos/user/ReceiptConfigIT.java
    - frontend/lib/api-client/schemas/receipt-config.schema.ts
    - frontend/lib/models/receipt-config.model.ts
    - frontend/lib/adapters/receipt-config.adapter.ts
    - frontend/lib/repositories/receipt-config.repository.ts
    - frontend/lib/hooks/settings/use-receipt-config.ts
    - frontend/lib/adapters/__tests__/receipt-config.adapter.test.ts
  modified:
    - services/user-service/src/main/java/io/restaurantos/user/service/BranchService.java
    - services/user-service/src/main/java/io/restaurantos/user/repository/BranchRepository.java
decisions:
  - "The registry lives in branches.receipt_config — the column that already existed — so Phase 17 has one place to migrate from, not two"
  - "Kitchen stations are DECLARED in the config rather than fetched from pos-service, so the completeness report needs no cross-service call at write time"
  - "The legacy bare-string write path is CLOSED with a 400, not left open beside the new endpoint"
  - "Cross-field rules are class-level Bean Validation constraints so the 400 carries a field path a form can attach to an input"
  - "Both endpoints carry branch-management authority, stricter than BranchController's read, because the body is the branch's internal network topology"
  - "The read hook has no fallback to an empty configuration; a failed read must not look like an unconfigured branch"
metrics:
  duration: ~1h50m
  completed: 2026-08-11
commits:
  - b5bb6db feat(26-02) — DTOs, service, controller, handler, IT, legacy-door closure
  - f799900 feat(26-02) — the frontend data layer
---

# Phase 26 Plan 02: Receipt Configuration Summary

A branch's printer registry now has a typed home, a validating endpoint pair, and a frontend data
layer that cannot report a failed read as "no printers configured".

## Where the registry lives, and the Phase 17 migration path — verbatim

**The registry lives in `branches.receipt_config`**, the `jsonb` column declared at
`BranchEntity.java:59`. When Phase 17's tenant-configuration spine lands, the migration is a read
of this column per branch and a write into whatever the spine defines, plus repointing
`ReceiptConfigService`'s two operations. **No consumer in Phase 26 reads the column directly** —
they all go through `ReceiptConfigService` on the server and `ReceiptConfigRepository` on the
client, which is what makes that migration a two-file change rather than a search across the fleet.

## The two endpoints

| Method | Path                                          | Authority                                     |
| ------ | --------------------------------------------- | --------------------------------------------- |
| GET    | `/api/v1/branches/{branchId}/receipt-config`   | `hasAnyAuthority('rbac.manage','branch.manage')` |
| PUT    | `/api/v1/branches/{branchId}/receipt-config`   | `hasAnyAuthority('rbac.manage','branch.manage')` |

Both return `ApiResponse<ReceiptConfigResponse>` where `ReceiptConfigResponse = { config,
completeness }`. The gateway's existing `Path=/api/v1/branches/**` predicate already routes them;
**no gateway change was made and `JwtGlobalFilter`'s diff is empty** (asserted).

## `PrinterEntry` — the exact field names 26-04, 26-06, 26-07, 26-09 and 26-10 read

```java
record PrinterEntry(
    String  id,                 // stable, referenced by print jobs and by routing
    UUID    terminalId,         // NULL = the branch default for this role (D-26-05)
    PrinterRole role,           // RECEIPT | KITCHEN
    String  stationCode,        // KITCHEN only; rejected on a RECEIPT entry
    Transport transport,        // TCP | SYSTEM
    String  host,               // required when transport == TCP
    Integer port,               // required when transport == TCP, 1..65535
    String  systemPrinterName,  // required when transport == SYSTEM
    Integer widthMm,            // 20..210
    Integer columns,            // 16..255 — MEASURED, never a compiled constant
    boolean columnsMeasured,    // false until the calibration print confirms it
    String  codepage,
    CutMode cut,                // NONE | PARTIAL | FULL
    Integer drawerPin,          // 2 or 5 only (ESC/POS §7.2); rejected on a KITCHEN entry
    Integer drawerPulseMs)      // 10..500
```

Surrounding records: `ReceiptConfig(agent, printers, header, footer, fbr, kitchenStations)`,
`AgentEndpoint(baseUrl, lanUrl)`, `HeaderConfig(logoFileId, lines)`, `FooterConfig(lines)`,
`FbrPrintPreferences(printLogo, qrSizeMm)`, `CompletenessReport(complete, unroutedStations,
warnings)`.

`ReceiptConfig.kitchenStations` is the station codes the branch **operates**. Declaring them here
rather than fetching them from pos-service is what makes the completeness report answerable without
a cross-service call at write time — and lets a branch say "we run HOT and COLD" before any menu
item has been assigned.

## What is rejected, and what is merely reported

**Rejected with a 400 naming the field:** a TCP entry with no host or a port outside 1..65535; a
SYSTEM entry with no printer name; a drawer pin outside `{2, 5}`; a pulse outside 10..500 ms; a cut
mode outside the closed set; a station code on a RECEIPT printer; a drawer pin on a KITCHEN
printer; two entries claiming the same role + terminal + station (the message names both ids); a
duplicate printer id.

**Saved and reported, not rejected:** a declared kitchen station that no printer routes. Halfway
through onboarding is a legitimate place for a branch to be. The response says
`complete: false, unroutedStations: ["COLD"]`, plus warnings for an absent agent, an absent receipt
printer, and every printer whose column count is still unmeasured. Silence here is how a kitchen
ticket gets enqueued for a destination that does not exist.

## The legacy door, closed

`BranchService.create` and `BranchService.update` now refuse a **non-null** `receiptConfig` with a
400 whose message names the new endpoint. A null stays a null, so every branch update that exists
today is unaffected — asserted by a test that renames a branch and gets a 200.

The plan's grep was re-run before the change, and it found one thing the plan's narrower grep had
not: `receiptConfig` **does** appear in `frontend/lib/api-client/schemas/settings.schema.ts`. It
appears only in `apiBranchSchema`, the **read** shape. `apiUpdateBranchSchema`, the write shape,
has no such field. So no shipped caller sends it and the refusal breaks nothing. The DTO field
itself was deliberately left in place — `BranchResponse` returns it and the point was to make the
write refuse, not to churn the read contract.

## Real command output

```
$ mvn -pl services/user-service -am verify -Dit.test=ReceiptConfigIT
Tests run: 15, Failures: 0, Errors: 0, Skipped: 0 -- in io.restaurantos.user.ReceiptConfigIT
BUILD SUCCESS

$ mvn -pl services/user-service -am verify          # everything, nothing excluded
Tests run: 66, Failures: 0, Errors: 0, Skipped: 0   (shared-lib unit)
Tests run: 11, Failures: 0, Errors: 0, Skipped: 0   (shared-lib IT)
Tests run: 16, Failures: 0, Errors: 0, Skipped: 0   (user-service unit)
Tests run: 15 ReceiptConfigIT
Tests run: 22 UserAdminIT
Tests run:  4 BranchRlsIT
Tests run:  4 BranchInternalIT
Tests run:  3 UserAdminDelegationIT
Tests run: 48, Failures: 0, Errors: 0, Skipped: 0   (user-service IT total)
BUILD SUCCESS

$ git diff --quiet -- gateway/src/main/java/io/restaurantos/gateway/filter/JwtGlobalFilter.java
gateway filter untouched

$ npm run test:run -- lib/adapters/__tests__/receipt-config.adapter.test.ts
 Test Files  1 passed (1)
      Tests  8 passed (8)

$ npm run test:run          # whole frontend suite
 Test Files  76 passed (76)
      Tests  649 passed (649)

$ npm run typecheck
(clean)

$ npm run lint
✖ 10 problems (0 errors, 10 warnings)   # unchanged pre-existing baseline
```

## Deviations from Plan

### 1. [Rule 2 — Security] The cross-tenant test FAILED at 200, and the fix is a real one

`ReceiptConfigIT.anotherTenantsBranch_isNotFound` returned **200 with another tenant's branch**.
Two things coincide:

- Testcontainers runs Postgres as a **superuser**, which bypasses even `FORCE ROW LEVEL SECURITY`
  — and `branches` does have it (migration `011-enable-rls-branches`).
- Hibernate's `@Filter(name = "tenantFilter")` is declared on the **`TenantAuditableEntity` mapped
  superclass**, which Hibernate does not propagate to `BranchEntity`. So
  `TenantFilterInterceptor.enableFilter("tenantFilter")` has nothing to attach to for this entity.

`BranchService.get` therefore had **no tenant predicate at all** — neither in the query nor,
in the harness, in an enforceable policy. 26-CONTEXT explicitly requires both.

**Fix:** added `BranchRepository.findByIdAndTenantIdAndDeletedAtIsNull` and
`BranchService.getForCurrentTenant`, used by `ReceiptConfigService`. Deliberately a **new** method
rather than narrowing `get`: `get` is on the branch read path, the internal provisioning path and
the compensating-deactivation path, and two of those run with the tenant taken from a request body
rather than a token. Narrowing it belongs to a plan that can exercise all three. Logged as
**deferred item D-1** with the platform-wide question it raises.

**Note on what this test does and does not prove:** because the harness runs as a superuser, this
asserts the *application-level* scoping only. The RLS half is proven where 17b established it.
`ReceiptConfigIT`'s class javadoc says so rather than implying more.

### 2. [Rule 1 — Bug] The malformed-body handler was reading the wrong Jackson

`cutMode_isAClosedSet` failed: the response said `"(body)"` rather than naming `cut`. Cause:
**Spring Boot 4.0.7 converts HTTP bodies with Jackson 3 (`tools.jackson.*`)** while this project's
shared `ObjectMapper` bean is Jackson 2 (`com.fasterxml.jackson.databind`), and both jars are on
every classpath. The handler's `instanceof MismatchedInputException` never matched because the
exception came from the other Jackson. `ReceiptConfigExceptionHandler` now reads both; the response
for an unknown cut mode is now `printers.[0].cut — Cannot deserialize value of type CutMode from
String "GUILLOTINE": not one of the values accepted for Enum class: [NONE, PARTIAL, FULL]`.
Logged as **deferred item D-3**.

### 3. [Rule 3 — Blocking] The plan's verify command cannot run this test

The plan's `<verify>` is `mvn -pl services/user-service -am test -Dtest='ReceiptConfigIT,Branch*'`.
`user-service`'s surefire configuration **excludes `**/*IT.java`**, so the `test` phase runs none
of those classes and surefire fails with "No tests were executed". The equivalent that actually
runs them is failsafe:

```bash
mvn -pl services/user-service -am verify -Dit.test=ReceiptConfigIT \
    -Dfailsafe.failIfNoSpecifiedTests=false -Dsurefire.failIfNoSpecifiedTests=false
```

The full `mvn -pl services/user-service -am verify` output above is the stronger evidence and is
what was actually used to accept the plan.

### 4. Scope note: `BranchService.java` and `BranchRepository.java`

The frontmatter `files_modified` lists neither, but task 2's `<files>` explicitly names
`BranchService.java` and instructs the legacy-door change. `BranchRepository.java` was added for
deviation 1. Both are recorded here rather than left as a surprise.

## Hardware sign-off (U3)

1. **The real columns-per-line for the model Floating Terrace buys.** Research §7.5: this is a
   function of model, configured print width, font and codepage together, and vendor datasheets are
   unreliable on it. The field exists, defaults conservatively, stores a `columnsMeasured: false`
   flag and emits a warning until the calibration print in 26-10 confirms it.
2. **Whether the printer's own DIP or memory switches contradict the stored width.** Nothing in
   software can detect this.

Everything else in this plan is verified by integration test with no peripheral attached.

## Known stubs

None. Every declared field is exercised by `ReceiptConfigIT` or by the adapter suite.

## Threat flags

| Flag                                | File                                    | Description                                                                                                                                                                       |
| ----------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| threat_flag: missing-tenant-predicate | `services/user-service/.../BranchService.java` | `get()` still has no tenant predicate and relies solely on an RLS policy that the mapped-superclass `@Filter` does not back up. Out of scope here; see deferred item D-1. |
| threat_flag: authority-mismatch      | `services/user-service/.../ReceiptConfigController.java` | The read is gated on `branch.manage`, which a cashier does not hold — but 26-09's client bridge runs as a cashier and needs the agent URL. See deferred item D-2. |

## Notes for the plans that build on this

- Read the registry through `ReceiptConfigService` (server) or `ReceiptConfigRepository` (client).
  **Nothing should touch `branches.receipt_config` directly** — that is the whole basis of the
  Phase 17 migration path above.
- `PrinterEntry.columns` is authoritative for layout and `columnsMeasured` tells you whether to
  trust it. A renderer that hardcodes 48 columns defeats the point of storing it.
- `CompletenessReport.unroutedStations` must reach the operator's screen. 26-10 owns that.
- **26-09 will hit a 403.** The read endpoint requires `branch.manage`; the POS tab runs as a
  cashier. Plan for a slimmed cashier-readable projection or a session-bootstrap field.
