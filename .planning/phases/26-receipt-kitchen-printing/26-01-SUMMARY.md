---
phase: 26
plan: "01"
subsystem: print
status: complete
tags: [print, receipt, money, contract, fbr, shared-lib, frontend]
requires: []
provides:
  - "`io.restaurantos.shared.print.PrintDocument` — the one printable document; receipt and kitchen ticket are two VALUES of it"
  - "`ReceiptMoneyFormatter` — the single paisa→string conversion site named by D-26-04"
  - "`ReceiptAmount` — the only money shape a print document may contain"
  - "`contracts/print/golden-receipt-document.json` — the wire contract, one copy, at the repo root"
  - "the frontend zod schema / adapter / domain model trio for the document"
affects:
  - shared-lib (new `print` package; purely additive)
  - frontend (new lib/ files; vitest include widened by one glob)
tech-stack:
  added: []
  patterns:
    [
      single-conversion-site,
      value-plus-rendering-pair,
      golden-fixture-as-cross-language-contract,
      construction-time-rejection,
      declared-nullable-region,
    ]
key-files:
  created:
    - shared-lib/src/main/java/io/restaurantos/shared/print/PrintDocument.java
    - shared-lib/src/main/java/io/restaurantos/shared/print/ReceiptAmount.java
    - shared-lib/src/main/java/io/restaurantos/shared/print/ReceiptMoneyFormatter.java
    - shared-lib/src/test/java/io/restaurantos/shared/print/PrintDocumentContractTest.java
    - shared-lib/src/test/java/io/restaurantos/shared/print/ReceiptMoneyFormatterTest.java
    - contracts/print/golden-receipt-document.json
    - contracts/print/README.md
    - frontend/lib/api-client/schemas/print.schema.ts
    - frontend/lib/models/print.model.ts
    - frontend/lib/adapters/print.adapter.ts
    - frontend/lib/adapters/__tests__/print.adapter.test.ts
  modified:
    - frontend/vitest.config.ts
decisions:
  - "The print formatter is a second implementation on purpose — MoneyUtils.formatPkr sets maximumFractionDigits(0) and would round a bill to the whole rupee"
  - "The rendered string and the integer paisa travel together in ReceiptAmount, so no renderer ever does arithmetic and three independent guards can prove they agree"
  - "Currency prefix `Rs ` with an ASCII space, never Intl's U+00A0 — that character has no home in a thermal codepage"
  - "The kitchen-ticket restriction is enforced in the compact constructor, so an assembler cannot quietly send the kitchen the customer's tenders"
  - "qrSizeMm is BigDecimal, not int and not a floating-point type: the DI spec's 1.0 inch is 25.4 mm"
  - "The golden fixture lives at the repository root because Maven and two vitest projects read it; a module-local copy is the drift it exists to prevent"
metrics:
  duration: ~55m
  completed: 2026-08-11
commits:
  - 0c45449 feat(26-01) — the formatter and ReceiptAmount
  - a9e62dd feat(26-01) — the PrintDocument schema and the golden fixture
  - 5f69df9 feat(26-01) — the TypeScript mirror
---

# Phase 26 Plan 01: Print Document Contract Summary

One Java record describes every printable document in the product, one function turns integer
paisa into the string a customer reads, and a single checked-in JSON fixture proves the Java and
TypeScript definitions agree.

## What was built

### `ReceiptMoneyFormatter` — the one conversion site (D-26-04)

`format(long paisa)` and `format(long paisa, String currencyPrefix)` return e.g. `Rs 1,234.56`.
`DEFAULT_CURRENCY_PREFIX` is `"Rs "` — the symbol the JDK's `en-PK` currency instance and the
frontend's `Intl.NumberFormat` both resolve, with a plain ASCII space rather than the U+00A0 that
`Intl` emits, because that character may not exist in a thermal printer's codepage.

Implementation notes that matter downstream:

- **`BigDecimal` at an explicit scale of two, with `RoundingMode.UNNECESSARY`.** An integer paisa
  shifted two places is exact by construction; if it ever isn't, it throws rather than rounds.
- **Grouping and the decimal point are assembled by hand**, not by `NumberFormat`/`DecimalFormat`.
  Every JDK formatter takes the JVM default locale when you omit one, and a German-locale till
  would silently render `Rs 1.234,56`. There is a test that sets `Locale.GERMANY` and asserts the
  output does not move.
- **It is NOT `MoneyUtils.formatPkr`**, which calls `setMaximumFractionDigits(0)`. Reusing it
  would have printed 123456 paisa as a whole-rupee figure, putting the paper permanently 56 paisa
  away from the ledger. The javadoc records this so nobody "simplifies the duplication away".
- **`parse(String)` is the companion**, prefix- and grouping-agnostic, so the round-trip assertion
  is expressible without a second copy of the format rules. `Long.MIN_VALUE` survives it: the sign
  is carried through the `movePointRight` rather than applied after, so the intermediate never
  exceeds `Long.MAX_VALUE`.

### `ReceiptAmount` — the only money shape in a print document

```java
public record ReceiptAmount(long paisa, String formatted)
// factories: of(paisa), of(paisa, currencyPrefix), zero()
```

### `PrintDocument` — the schema (exact component names, for 26-03/04/05/07)

```java
public record PrintDocument(
    String schemaVersion,          // constant PrintDocument.SCHEMA_VERSION = "1.0"
    DocumentType type,             // CUSTOMER_RECEIPT | KITCHEN_TICKET
    Provenance provenance,         // SERVER | CLIENT_OFFLINE
    UUID tenantId, UUID branchId, UUID orderId, String orderNo,
    Issue issue, Header header, List<Line> lines,
    Totals totals,                 // null on a kitchen ticket
    List<TaxLine> taxBreakdown,    // empty on a kitchen ticket
    List<Tender> tenders,          // empty on a kitchen ticket
    Fiscal fiscal,                 // null on a kitchen ticket
    Drawer drawer,                 // null on a kitchen ticket
    Cut cut, Footer footer)
```

Nested records, with their exact component names:

| Record    | Components                                                                                  |
| --------- | ------------------------------------------------------------------------------------------- |
| `Issue`   | `long sequenceNumber, boolean reprint, Instant issuedAt, Instant originalIssuedAt`            |
| `Header`  | `String branchName, List<String> addressLines, String phone, String ntn, String strn, UUID logoFileId` |
| `Line`    | `String name, int quantity, ReceiptAmount unitPrice, ReceiptAmount lineTotal, List<String> modifiers, String note, String stationCode` |
| `Totals`  | `ReceiptAmount subtotal, discount, serviceCharge, tax, grandTotal`                            |
| `TaxLine` | `String rateCode, String label, String ratePercent, ReceiptAmount amount`                     |
| `Tender`  | `String method, ReceiptAmount amountApplied, amountTendered, change, String referenceNo`      |
| `Fiscal`  | `String fbrInvoiceNumber, String qrPayload, BigDecimal qrSizeMm, UUID logoAssetId, String noticeLine` |
| `Drawer`  | `boolean kick, Integer connectorPin, Integer pulseMs`                                         |
| `Cut`     | `CutMode mode` — `NONE \| PARTIAL \| FULL`                                                    |
| `Footer`  | `List<String> lines`                                                                          |

Enforced at construction, not logged:

- Required non-null: `schemaVersion`, `type`, `provenance`, `tenantId`, `branchId`, `orderId`,
  `issue`, `cut`, and `Issue.issuedAt`.
- `Issue` with `reprint == true` and no `originalIssuedAt` is rejected — a reprint that cannot say
  what it is a reprint of is indistinguishable from an original (definition-of-done item 3).
- A `KITCHEN_TICKET` carrying totals, a tax breakdown, tenders, a fiscal region or a drawer
  instruction throws `IllegalArgumentException`. A kitchen ticket printing what the customer paid
  is a privacy defect; a kitchen printer opening the till is worse.
- `List` components are defensively copied and null-normalised to empty.

`Fiscal` is declared now and entirely nullable (D-26-03). `qrPayload` is an opaque string and the
document carries no image, because the DI spec fixes the symbol version (2.0, 25×25) and physical
size and never says what the symbol encodes.

### The golden fixture — `contracts/print/golden-receipt-document.json`

At the repository root, outside every module, because three build systems read it. Generated by
`PrintDocumentContractTest`, checked in, and regenerated deliberately with:

```bash
mvn -pl shared-lib test -Dtest=PrintDocumentContractTest -Dprint.fixture.regenerate=true
```

It deliberately exercises the hard cases: a `Rs 80.33 × 2 = Rs 160.66` line (the non-zero paisa
remainder), a discount, a service charge, two tax rate codes, two tenders of which one is cash
with `Rs 156.53` change, a populated FBR region, and a non-ASCII character in the footer. The
numbers balance: `237066 − 10000 + 22706 + 34575 = 284347`, and the tenders applied sum to exactly
that.

### The TypeScript mirror

`apiPrintDocumentSchema` uses `z.strictObject` throughout — an unknown key is an **error**, not
stripped. No `z.coerce` anywhere. `apiReceiptAmountSchema` carries a `superRefine` that re-parses
`formatted` via `parsePrintedAmountToPaisa` and rejects on disagreement, with the offending field
named by the zod issue path (`totals.grandTotal`). The adapter moves strings and integers and does
no arithmetic on any money field.

## Real command output

```
$ mvn -pl shared-lib test
Tests run: 66, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS

  io.restaurantos.shared.print.ReceiptMoneyFormatterTest   Tests run: 8,  Failures: 0, Errors: 0
  io.restaurantos.shared.print.PrintDocumentContractTest   Tests run: 11, Failures: 0, Errors: 0

$ # task 1 gates
formatPkr non-comment hits: 0
double/float non-comment hits: 0

$ # task 2 gate
TASK-2 VERIFY: PASS      (escpos/escape-literal grep on PrintDocument.java returns 0)

$ npm run test:run -- lib/adapters/__tests__/print.adapter.test.ts
 Test Files  1 passed (1)
      Tests  6 passed (6)

$ npm run test:run          # whole frontend suite, no regression from the vitest glob widening
 Test Files  75 passed (75)
      Tests  641 passed (641)

$ npm run typecheck
(clean)

$ find . -name golden-receipt-document.json -not -path './node_modules/*' -not -path '*/node_modules/*'
./contracts/print/golden-receipt-document.json
fixture copies: 1
TASK-3 VERIFY (verbatim): PASS
```

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 — Blocking] The plan's mandated test path was not discoverable by vitest**

- **Found during:** Task 3.
- **Issue:** `frontend/vitest.config.ts`'s `include` covered `__tests__/**` and
  `components/**/__tests__/**`. The plan fixes the test at
  `lib/adapters/__tests__/print.adapter.test.ts`, which neither glob matches — vitest would have
  reported "no test files found" and the acceptance criterion could not have passed. Worse, a test
  file that no glob discovers is a test file that silently never runs.
- **Fix:** added `"lib/**/__tests__/**/*.{test,spec}.{ts,tsx}"`, with a comment recording the same
  reasoning as the existing `components/**` widening directly above it.
- **Files modified:** `frontend/vitest.config.ts`.
- **Commit:** 5f69df9. Full suite re-run afterwards: 75 files / 641 tests, all passing.

**2. [Rule 1 — Bug] Fixture regeneration was order-dependent between tests**

- **Found during:** Task 2. Four tests read the fixture; the regeneration lived inside one of them,
  and JUnit does not promise an order, so the first run failed with `NoSuchFileException` on a
  clean checkout.
- **Fix:** moved regeneration into `@BeforeAll`. Verified by deleting the fixture and regenerating
  from scratch.
- **Commit:** a9e62dd.

**3. [Rule 3 — Blocking] `import.meta.url` is not a `file:` URL under vitest + jsdom**

- **Found during:** Task 3. `fileURLToPath(new URL(..., import.meta.url))` threw
  `TypeError: The URL must be of scheme file` — vitest rewrites `import.meta.url` to an http URL
  in the jsdom environment.
- **Fix:** the test walks **up** from `process.cwd()` looking for
  `contracts/print/golden-receipt-document.json`, exactly as shared-lib's contract test does. Not a
  fixed count of `..` segments (breaks silently if the test moves) and — per the plan's explicit
  instruction — **not** a copy of the fixture into `frontend/`.

### Small faithfulness choices worth recording

- `taxBreakdown` was added to the kitchen-ticket rejection set alongside the four the plan names.
  A tax breakdown is the same money the four exclusions exist to keep off a kitchen printer.
- `orderNo`, `header` and `footer` are nullable in the TypeScript mirror because the Java compact
  constructor does not require them. The mirror is faithful to the record rather than tighter than
  it; renderers in 26-05/26-07 must handle the nulls.

## Hardware sign-off (U3)

**Nothing in this plan requires a physical printer.** It is pure data modelling and is fully
verified on a laptop with no peripherals attached.

## Notes for the plans that build on this

- Import `io.restaurantos.shared.print.*`; construct amounts with `ReceiptAmount.of(paisa)` and
  **never** with the canonical constructor (which exists public only for Jackson).
- Do not call `MoneyUtils.formatPkr` anywhere under `print/` — a grep gate in this plan's
  acceptance criteria asserts zero occurrences, and it will keep being run.
- Jackson: `new SharedAutoConfiguration().sharedObjectMapper()` is what the contract test uses, so
  that is the configuration the fixture's field ordering and date format reflect.
- 26-04's ESC/POS renderer and 26-05's HTML renderer should both read
  `contracts/print/golden-receipt-document.json` from disk by walking up from cwd. There is one
  copy and the `find` gate keeps it that way.

## Known stubs

None. Every field declared is populated in the fixture and exercised by a test, except the
deliberately-nullable `Fiscal` components, which are declared-now/populated-in-Phase-27 by D-26-03
and are exercised in both their populated and absent forms.

## Threat flags

None. The change surface is additive: 11 new files and one 5-line addition to
`frontend/vitest.config.ts`. No existing symbol's signature moved, which matters because shared-lib
is on the compile classpath of all 20 modules. (Verified with `git diff --stat` against the phase
base rather than with `detect_changes()`, which was unavailable in this execution context; the
GitNexus index is also stale at `5fba4a9`.)
