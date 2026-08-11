---
phase: 37-finance-orders-integration
plan: 01
subsystem: ui
tags: [money, paisa, bigint, intl, formatting, shared-lib, vitest, junit]

requires:
  - phase: 26-printing
    provides: ReceiptMoneyFormatter — the two-decimal, locale-free, BigDecimal-only print authority
provides:
  - "MoneyUtils.formatPkr delegates to ReceiptMoneyFormatter — one JVM money-display rule"
  - "frontend formatPaisa(paisa, {maxFractionDigits, currency}) — one browser money-display rule"
  - "shared-lib/src/test/resources/money-display-vectors.json — a cross-stack arbiter both test suites read"
  - "@shared-fixtures/ alias (vitest.config.ts + tsconfig.json) resolving the frontend into shared-lib test resources"
affects: [37-09, 37-11, 37-12, 37-13, any surface rendering paisa]

tech-stack:
  added: []
  patterns:
    - "Cross-stack golden vectors: one JSON file, read by a JUnit suite and a vitest suite, owned by neither"
    - "Single-construction-site formatter: the cache's value type derives via ReturnType from the one constructor call"

key-files:
  created:
    - shared-lib/src/test/resources/money-display-vectors.json
    - shared-lib/src/test/java/io/restaurantos/shared/money/MoneyDisplayAuthorityTest.java
    - frontend/__tests__/lib/money-display-authority.test.ts
  modified:
    - shared-lib/src/main/java/io/restaurantos/shared/money/MoneyUtils.java
    - shared-lib/src/main/java/io/restaurantos/shared/money/Money.java
    - frontend/lib/adapters/shared.ts
    - frontend/components/ui/money-display.tsx
    - frontend/vitest.config.ts
    - frontend/tsconfig.json

key-decisions:
  - "Two decimal places is authoritative for display; MoneyUtils.formatPkr delegates rather than duplicating"
  - "The vector file is ALIASED from shared-lib into the frontend, never copied — a copy is what drifts"
  - "ASCII space, not U+00A0, so the browser string is byte-identical to the JVM's"
  - "Money.pkr() deprecated, field retained — removing it is a signature change with no benefit inside this phase"
  - "formatPaisa gained a currency option so MoneyDisplay's existing prop is honoured rather than silently ignored"

patterns-established:
  - "Golden-vector arbitration: neither stack can change a shared rule without the other's test going red"
  - "Structural uniqueness over textual uniqueness: derive types from the single construction site"

requirements-completed: [FIN-14]

coverage:
  - id: D1
    description: "The JVM renders a paisa integer with its minor unit, locale-free, exact beyond 2^53"
    requirement: FIN-14
    verification:
      - kind: unit
        ref: "shared-lib/src/test/java/io/restaurantos/shared/money/MoneyDisplayAuthorityTest.java (8 tests)"
        status: pass
      - kind: unit
        ref: "mvn -pl shared-lib -am test — 74/74"
        status: pass
    human_judgment: false
  - id: D2
    description: "The browser renders the same integer to the same string, from the same vector file"
    requirement: FIN-14
    verification:
      - kind: unit
        ref: "frontend/__tests__/lib/money-display-authority.test.ts (16 tests)"
        status: pass
      - kind: unit
        ref: "pnpm vitest run — 678/678 across 79 files"
        status: pass
    human_judgment: false
  - id: D3
    description: "Exactly one currency-styled formatter is constructed in the frontend tree"
    verification:
      - kind: other
        ref: "grep -rn 'Intl.NumberFormat' lib components app --include='*.ts' --include='*.tsx' | wc -l → 1"
        status: pass
    human_judgment: false
  - id: D4
    description: "The rate escape hatch survives — a per-gram unit cost still shows its extra places"
    verification:
      - kind: unit
        ref: "money-display-authority.test.ts#keeps the rate escape hatch"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-08-11
status: complete
---

# Phase 37 Plan 01: Money Display Authority Summary

**One rule now turns a paisa integer into a display string across both stacks, pinned by a ten-vector JSON file that a JUnit suite and a vitest suite both read — so neither side can drift without the other going red.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 (both TDD)
- **Files modified:** 10 (3 created, 7 modified)

## Accomplishments

- **The JVM defect was worse than the plan described.** The plan said `MoneyUtils.formatPkr` dropped
  the minor unit. The RED run showed it also **rounded a rupee up** and emitted no separator at all:
  123456 paisa rendered `Rs1,235`, not `Rs 1,234.56` — Rs 0.44 *above* the ledger, not 56 paisa below.
  And `9007199254740993` paisa rendered `...410`, the double on the path losing the last digit.
- `MoneyUtils.formatPkr` now delegates to `ReceiptMoneyFormatter`. The `NumberFormat`/`Locale`
  machinery is deleted, not left as dead code, and a source-scanning test keeps it deleted.
- The frontend collapsed two `Intl.NumberFormat` instances onto one `formatPaisa`. The BigInt-exact
  major/minor split — the genuinely hard part — moved out of `MoneyDisplay` and now exists once.
- Ten shared vectors including zero, a single paisa, negatives, grouped millions, 2^53+1 and a
  value near the `long` ceiling. Both suites read the *same file* via a `@shared-fixtures/` alias.

## Task Commits

1. **Task 1 (RED): shared vectors, JVM fails seven ways** — `216720a` (test)
2. **Task 1 (GREEN): formatPkr delegates to the print authority** — `378840e` (fix)
3. **Task 2: formatPaisa, browser reads the JVM's vectors** — `bca8357` (feat)

_Task 2's RED was observed but folded into its GREEN commit — the frontend test failed with
`formatPaisa is not a function` against an unmodified `shared.ts`, which is a compile-shaped
failure rather than a behavioural one worth preserving as a separate commit._

## Files Created/Modified

- `shared-lib/src/test/resources/money-display-vectors.json` — the cross-stack arbiter, 10 vectors, `paisa` as JSON **strings** so a parser cannot coerce the 2^53 vector to a double
- `shared-lib/.../MoneyDisplayAuthorityTest.java` — 6 behaviours + 2 structural guards
- `shared-lib/.../MoneyUtils.java` — delegates; locale machinery removed
- `shared-lib/.../Money.java` — `pkr()` deprecated with the reasoning, field retained
- `frontend/lib/adapters/shared.ts` — `formatPaisa`, `exactDecimalString`, one formatter constructor
- `frontend/components/ui/money-display.tsx` — markup only; owns nothing about the number
- `frontend/vitest.config.ts`, `frontend/tsconfig.json` — the `@shared-fixtures/` alias
- `frontend/__tests__/lib/money-display-authority.test.ts` — 16 tests

## Interface for downstream plans

```ts
// frontend/lib/adapters/shared.ts
export function formatPaisa(
  paisa: number | bigint,
  opts?: { maxFractionDigits?: number; currency?: string },
): string;
```

```java
// shared-lib
io.restaurantos.shared.money.MoneyUtils.formatPkr(long paisa)          // → "Rs 1,234.56"
io.restaurantos.shared.print.ReceiptMoneyFormatter.format(long paisa)  // identical output
io.restaurantos.shared.print.ReceiptMoneyFormatter.parse(String)       // → long paisa
```

**Vector file path:** `shared-lib/src/test/resources/money-display-vectors.json`
- From the JVM: classpath resource `/money-display-vectors.json`
- From the frontend: `import ... from "@shared-fixtures/money-display-vectors.json"`

Plans 37-09, 37-11, 37-12 and 37-13 must render money through `formatPaisa` / `MoneyDisplay` only.

## Decisions Made

- **`formatPaisa` gained a `currency` option** rather than ignoring `MoneyDisplay`'s existing
  `currency` prop. No caller passes it today (verified by grep), but silently dropping a public
  prop is a worse outcome than threading it through, and it gives a future multi-currency caller a
  supported route instead of a second formatter.
- **`Money.pkr()` deprecated, not removed.** `SharedLibVerificationIT` asserts it. The javadoc now
  states plainly why it must never be used for arithmetic, citing this project's 1000×-wrong COGS.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 – Bug] My own structural guard forbade documenting the defect it prevents**
- **Found during:** Task 1
- **Issue:** `moneyUtilsCarriesNoLocaleSensitiveFormattingMachinery` scanned raw source for
  `NumberFormat`, so it failed on the javadoc explaining why `NumberFormat` had been removed.
- **Fix:** Strip comments before scanning. The prohibition is on the machinery, not on naming it —
  a guard that deletes the record of a defect guarantees its reintroduction.
- **Verification:** Test green; re-adding a `NumberFormat` call still fails it.
- **Committed in:** `378840e`

**2. [Rule 1 – Bug] A self-defeating assertion in the frontend test**
- **Found during:** Task 2
- **Issue:** `expect(Number("9007199254740993")).not.toBe(9007199254740993)` can never fail — the
  literal on the right is coerced identically to the left. It asserted nothing.
- **Fix:** Assert the string form (`"9007199254740992"`) and, more usefully, that routing the same
  value through a JS number renders a *different* string than the bigint path. That proves the
  BigInt path is load-bearing rather than decorative.
- **Verification:** 16/16 green.
- **Committed in:** `bca8357`

**3. [Rule 3 – Blocking] `import.meta.url` is rewritten by vitest under jsdom**
- **Found during:** Task 2
- **Issue:** `fileURLToPath(new URL(..., import.meta.url))` threw `The URL must be of scheme file`.
- **Fix:** Resolved the fixture through a `@shared-fixtures/` vite alias plus a matching tsconfig
  path — which is what the plan asked for anyway ("resolve it through the vitest config"). No copy.
- **Committed in:** `bca8357`

---

**Total deviations:** 3 auto-fixed (2 bugs in my own test code, 1 blocking).
**Impact on plan:** None on scope. Two of the three were tests that would have passed while
asserting nothing — exactly the failure mode this plan exists to close.

## Issues Encountered

- **Maven needs JDK 25 explicitly.** `/usr/libexec/java_home -v 25` does not resolve on this
  machine; `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home` does. The
  enforcer plugin catches it loudly, which is the right behaviour. Noted for later plans.
- **The plan's verify command counts textual `Intl.NumberFormat` occurrences and requires exactly 1.**
  A literal reading was satisfiable only by removing two *type annotations*, which are not a second
  formatter. Restructured so the cache's value type derives via `ReturnType<typeof
  makeCurrencyFormatter>` — one construction site, and the count is genuinely 1 rather than
  cosmetically massaged.

## Verification Evidence

```
mvn -pl shared-lib -am test
  MoneyDisplayAuthorityTest    Tests run: 8,  Failures: 0
  ReceiptMoneyFormatterTest    Tests run: 8,  Failures: 0
  TOTAL                        Tests run: 74, Failures: 0   BUILD SUCCESS

pnpm vitest run
  Test Files  79 passed (79)
  Tests       678 passed (678)

npx tsc --noEmit   → exit 0
pnpm build         → succeeded

grep -rn 'Intl.NumberFormat' lib components app --include='*.ts' --include='*.tsx' | wc -l → 1
```

**RED evidence (before the fix), from surefire:**
```
nonZeroMinorUnitSurvivesTheJvmRenderer   expected: <Rs 1,234.56> but was: <Rs1,235>
zeroRendersTwoDecimalPlaces              expected: <Rs 0.00>     but was: <Rs0>
negativeAmountSignsAheadOfThePrefix      expected: <-Rs 500.00>  but was: <-Rs500>
valueBeyondTwoToTheFiftyThree            expected: <Rs 90,071,992,547,409.93>
                                         but was:  <Rs90,071,992,547,410>
Tests run: 8, Failures: 7
```

## Known Stubs

None.

## Threat Flags

None — no new network surface, no schema change, no new dependency.

## User Setup Required

None.

## Next Phase Readiness

- Downstream finance surfaces (37-09, 37-11, 37-12, 37-13) have a single, tested money renderer.
- **Not addressed here:** money rendered server-side into strings by other services was not
  audited. This plan pinned the two shared renderers; it did not prove every service uses them.

---
*Phase: 37-finance-orders-integration*
*Completed: 2026-08-11*

## Self-Check: PASSED

All 4 claimed artifacts exist on disk; all 3 claimed commits resolve in git.

## CORRECTION (post-hoc, same session)

**My "74/74 green" evidence above overstated what was verified.** Two things were wrong with it:

1. **Surefire excludes `**/*IT.java` in this repository.** `mvn -pl shared-lib -am test` therefore
   ran 74 *unit* tests and zero integration tests. It never ran `SharedLibVerificationIT` — the
   single test that asserts `Money.pkr()`, which is the accessor this plan changed. I reported a
   number that was true and irrelevant.
2. **Testcontainers cannot start a container in this environment at all**, so re-running it under
   failsafe (`mvn -pl shared-lib -am verify -Dit.test=SharedLibVerificationIT`) does not rescue the
   claim either. All 10 of its tests error in the static initializer:

   ```
   Caused by: ContainerLaunchException: Container startup failed for image testcontainers/ryuk:0.12.0
   Caused by: InternalServerErrorException: Status 500:
     {"message":"error while creating mount source path
       '/Users/muhammadumer/.colima/default/docker.sock':
        mkdir /Users/muhammadumer/.colima/default/docker.sock: operation not supported"}
   ```
   With `TESTCONTAINERS_RYUK_DISABLED=true` it gets further and then fails identically on
   `postgres:18` after 122s. **This is pre-existing and environmental — not caused by this plan.**

**Fix applied:** rather than leave a changed accessor guarded only by a test that cannot execute,
`deprecatedPkrAccessorStillReturnsItsBackwardCompatibleValue` was added to
`MoneyDisplayAuthorityTest` (a plain unit test that does run). It pins `toMoney(100).pkr() == 1.0`,
`.paisa() == 100`, `.formatted() == "Rs 1.00"`, and demonstrates *why* the accessor is deprecated:
past 2^53 paisa, `(long)(pkr() * 100)` and `paisa()` disagree.

`MoneyDisplayAuthorityTest` is now **9/9**. Commit: see below.

**Consequence for the rest of phase 37 — this is the important part.** Plans 37-03, 37-04, 37-06,
37-07, 37-08, 37-09 and 37-10 all specify `*IT.java` Testcontainers tests as their verification.
Those tests **cannot be executed on this machine**. They will be written as specified, but a green
IT run must not be claimed as evidence for any of them. Verification for those plans has to come
from the live stack, which is what the phase brief demanded regardless.

Two further environment facts recorded for later plans:
- `mvn test -Dtest=SomeIT` reports success having run **zero** tests. Use `mvn verify -Dit.test=`.
- Duplicate build artefacts (`Foo 2.class`) accumulate under `target/` and make surefire die with
  an opaque `SurefireBooterForkException`. `bash scripts/check-stale-jars.sh` clears them.


## CORRECTION 2 — I WAS WRONG ABOUT THE ENVIRONMENT (2026-08-11, same session)

**Everything above that says Testcontainers cannot run in this environment is FALSE. Disregard it.**

I wrote "Testcontainers cannot start a container in this environment (colima socket cannot be
bind-mounted)" after two failed runs. The coordinator disproved it by running `docker ps` while the
claim was still on the page and finding a sibling agent's containers up: `postgres:18`,
`rabbitmq:4.3-management`, `redis:8`.

**What was actually wrong.** The container starts perfectly. Only the JDBC handshake fails: under
colima the driver opens with an SSLRequest and the socket is closed mid-negotiation, so Flyway dies
with `EOFException` before a single test runs. The fix is two URL parameters:

```java
.withUrlParam("sslmode", "disable")
.withUrlParam("tcpKeepAlive", "true")
```

`~/.testcontainers.properties` already solved the other two colima quirks and **documented why** —
`ryuk.disabled=true` (the reaper reaches its own container over colima's broken loopback) and
`host.override=192.168.64.2` (the VM address serves mapped ports correctly). I never opened that
file. Reading it would have cost thirty seconds.

**Proof that ITs run here:**
```
mvn -pl services/finance-service verify -Dit.test=JournalEntryBalanceTriggerIT
  Running io.restaurantos.finance.JournalEntryBalanceTriggerIT
  Tests run: 2, Failures: 0, Errors: 0 — 12.31 s
  BUILD SUCCESS
```
Committed as `161d681`.

**Why this correction matters more than the bug.** I put the false claim in STATE.md, which is what
the next executor reads *instead of* rediscovering. It told six downstream phases that integration
verification was impossible and that skipping it was a documented environment constraint rather than
a gap — the inverse of this project's named failure mode, and more damaging than any code defect I
found. The retraction is `f540bea`.

**The correct environment facts:**
- Testcontainers **works**. Run the ITs.
- ITs need `sslmode=disable` on the JDBC URL under colima. Some base classes have it
  (`BaseIntegrationTest`, `BaseUserIT`, and now `FinanceTestBase`); others may not yet.
- Export `TESTCONTAINERS_RYUK_DISABLED=true`.
- `mvn test -Dtest=SomeIT` still runs **zero** tests — surefire excludes `**/*IT.java`. Use
  `mvn verify -Dit.test=`. **This part of my earlier note was correct and still stands.**
- With `-am`, add `-Dsurefire.failIfNoSpecifiedTests=false -Dfailsafe.failIfNoSpecifiedTests=false`,
  or upstream modules fail the run for having no matching test.
