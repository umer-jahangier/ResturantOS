---
phase: 10-purchasing-accounts-payable
plan: 16
subsystem: purchasing
tags: [spring-boot, encryption, aes-gcm, testcontainers, fail-fast, security]

# Dependency graph
requires:
  - phase: 02-authentication-authorization
    provides: "EncryptionService + opt-in EncryptionAutoConfiguration (decision 02-02)"
provides:
  - "purchasing-service refuses to start if restaurantos.encryption.key is unset OR blank"
  - "VendorService.apply can no longer silently null out a submitted bank account"
  - "Real-context proof (ApplicationContextRunner + full PurchasingTestBase) that a vendor bank account is never persisted in plaintext"
affects: [10-09, 10-17, future-purchasing-security-review]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "BeanFactoryPostProcessor as a fail-fast startup guard for a required-but-conditionally-shipped bean, checked against both the raw property AND bean-definition presence"

key-files:
  created:
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/config/EncryptionRequiredConfig.java
    - services/purchasing-service/src/test/java/io/restaurantos/purchasing/VendorEncryptionFailFastIT.java
  modified:
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/service/VendorService.java
    - services/purchasing-service/src/main/resources/application.yml

key-decisions:
  - "EncryptionRequiredConfig implemented as a BeanFactoryPostProcessor (not relying on VendorService's now-required constructor param to fail context startup on its own) because the generic NoSuchBeanDefinitionException that constructor injection alone would eventually produce (a) doesn't name the property, and (b) its timing depends on singleton instantiation order."
  - "EncryptionRequiredConfig checks the raw restaurantos.encryption.key property value via Environment, not just EncryptionService bean presence — @ConditionalOnProperty treats a present-but-blank value as satisfying the condition, so bean-presence-only checking misses the blank-key case."

patterns-established:
  - "Startup-fail-fast guard pattern: BeanFactoryPostProcessor + EnvironmentAware, runs after @Configuration classes register/skip bean definitions but before any singleton instantiates, so the check always wins the race regardless of bean creation order."

# Metrics
duration: 36min
completed: 2026-07-13
---

# Phase 10 Plan 16: VendorService Encryption Fail-Fast Summary

**purchasing-service now refuses to start when `restaurantos.encryption.key` is unset or blank, and `VendorService.apply` can no longer silently null out a submitted bank account — proven against a real Spring context, a raw-JDBC plaintext check, and a negative control.**

## Performance

- **Duration:** 36 min
- **Started:** 2026-07-13T02:57:00+10:00 (approx, first commit 02:57:37+10:00)
- **Completed:** 2026-07-13T03:32:42+10:00
- **Tasks:** 2/2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- Removed the `Optional<EncryptionService>`/`ifPresentOrElse` null-out branch in `VendorService.apply` — `EncryptionService` is now a required constructor dependency, and a submitted bank account is either encrypted or the request fails loudly (exception propagates, is logged with a traceId by `GlobalExceptionHandler`).
- Added `EncryptionRequiredConfig`, a `BeanFactoryPostProcessor` that fails purchasing-service startup with an actionable message ("... requires restaurantos.encryption.key to be set. Refusing to start.") whenever the key is unset OR blank — closing a real gap discovered mid-execution where `@ConditionalOnProperty` treats a blank-but-present property as satisfying the condition.
- Added `VendorEncryptionFailFastIT` with three tests, all against real Spring contexts (no mocked encryption): a minimal `ApplicationContextRunner` proving startup failure + actionable message, a negative control proving the same minimal context starts cleanly with the key set, and a full `PurchasingTestBase`-context test that creates a vendor, reads the raw `bank_account_no` column via `JdbcTemplate`, and asserts it is neither blank nor plaintext but decrypts back correctly.
- Ran a manual negative control (per plan, not automated): temporarily restored the old null-out branch, confirmed both `bankAccountIsNeverPersistedInPlaintext` and the existing `VendorIT.createVendor_encryptsBankAccount` fail (bankAccountLast4 comes back `null` instead of `"3456"`), then reverted.
- Full `mvn verify` on purchasing-service: 38/38 tests green, no regressions.

## Task Commits

1. **Task 1: Make EncryptionService a hard dependency of VendorService** - `a3a5ad8` (fix)
2. **Task 2: VendorEncryptionFailFastIT** - `c99323b` (test)

_No separate metadata commit was requested for this gap-closure plan beyond the two task commits; this SUMMARY and STATE.md update are committed together below per the standard final-commit step._

## Files Created/Modified

- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/service/VendorService.java` - `EncryptionService` is now a required constructor param; the null-out-on-missing-key branch is removed; a bank account is encrypted unconditionally or the request throws.
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/config/EncryptionRequiredConfig.java` (new) - `BeanFactoryPostProcessor` that checks both the raw `restaurantos.encryption.key` property (via `Environment`) and `EncryptionService` bean presence, throwing an actionable `IllegalStateException` if either check fails.
- `services/purchasing-service/src/main/resources/application.yml` - documented the now-mandatory `restaurantos.encryption.key` property and that the service refuses to start without it; dev default left in place (breaking it would break every existing IT).
- `services/purchasing-service/src/test/java/io/restaurantos/purchasing/VendorEncryptionFailFastIT.java` (new) - `contextFailsToStart_whenEncryptionKeyMissing`, `contextStartsCleanly_whenEncryptionKeyPresent` (negative control), `bankAccountIsNeverPersistedInPlaintext`.

## Decisions Made

- **`EncryptionRequiredConfig` as `BeanFactoryPostProcessor` over relying on constructor-injection failure alone.** The plan allowed either approach. Chose the explicit guard because constructor injection alone would eventually make Spring throw `NoSuchBeanDefinitionException`, but (a) that message doesn't name `restaurantos.encryption.key`, and (b) its timing depends on which singleton Spring happens to instantiate first — not guaranteed to be `VendorService`. A `BeanFactoryPostProcessor` runs in the `invokeBeanFactoryPostProcessors` phase, strictly before any singleton (including `EncryptionService` itself) is instantiated, so it reliably wins and always produces the actionable message.
- **Check the raw property value, not just bean presence.** Discovered while writing the IT: `@ConditionalOnProperty(name = "restaurantos.encryption.key")` (no `havingValue`) treats an empty string as "present," so setting the key to `""` still registers the `EncryptionService` bean definition — the bean-presence-only check in the first draft of `EncryptionRequiredConfig` passed, and the real failure surfaced later as `IllegalArgumentException: Empty key` from deep inside `SecretKeySpec`, with no mention of the property. Fixed by also checking `environment.getProperty(KEY_PROPERTY)` for null/blank.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `EncryptionRequiredConfig` didn't catch a blank-but-present encryption key**
- **Found during:** Task 2 (writing `contextFailsToStart_whenEncryptionKeyMissing`, which sets the property to `restaurantos.encryption.key=` per the plan's exact scenario)
- **Issue:** The initial `EncryptionRequiredConfig` only checked `beanFactory.getBeanNamesForType(EncryptionService.class)`. Because `@ConditionalOnProperty` without `havingValue` treats a present empty string as satisfying the condition, `EncryptionAutoConfiguration` still registered the `EncryptionService` bean definition when the key property was blank. The BFPP's bean-presence check therefore passed, and the actual failure only surfaced later, mid-vendor-creation, as an unhelpful `IllegalArgumentException("Empty key")` from `SecretKeySpec` — not an actionable startup failure naming the property.
- **Fix:** `EncryptionRequiredConfig` now implements `EnvironmentAware` and checks `environment.getProperty("restaurantos.encryption.key")` for null/blank in addition to bean presence, throwing the same actionable `IllegalStateException` for either failure mode.
- **Files modified:** `services/purchasing-service/src/main/java/io/restaurantos/purchasing/config/EncryptionRequiredConfig.java`
- **Verification:** `contextFailsToStart_whenEncryptionKeyMissing` (blank key) now passes with the actionable message; `contextStartsCleanly_whenEncryptionKeyPresent` (negative control) confirms the check doesn't false-positive when the key is set.
- **Committed in:** `c99323b` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug, found and fixed while writing this plan's own verification test)
**Impact on plan:** Necessary for the plan's own success criterion ("A vendor create/update can never silently store a null bank account because the encryption key was missing" for BOTH unset and blank keys). No scope creep — fix was entirely within the file this plan owns.

## Issues Encountered

- **Testcontainers Postgres startup timeout (infra, not code).** The Docker Desktop VM on this host is memory-constrained (3.8 GiB total) and had `restaurantos-clickhouse` (~781 MiB) and `restaurantos-rabbitmq` (~1.27 GiB) running alongside other project containers, leaving too little headroom for a new `postgres:16` testcontainer — it repeatedly timed out waiting for "database system is ready to accept connections" after ~163s. Neither container could be gracefully `docker stop`ped (both were zombie/PID-1-signal-unresponsive); `docker stop` on them triggered Docker's forced kill (exit 137) a few seconds later, freeing enough memory for the testcontainer to start in ~2.5s. Both containers were explicitly restarted (`docker start restaurantos-clickhouse restaurantos-rabbitmq`) immediately after the test run and confirmed healthy again before finishing this plan. No other project state was affected.
- **`mvn compile`'s incremental-compile staleness check missed a same-second edit** during the manual negative-control step (restore-null-out-branch → recompile → run → confirm failure → revert → recompile). The second `compile` reported "Nothing to compile" and left the stale (null-out) `.class` file in place, which briefly made `VendorIT` and the restored-correct-code IT both fail for the wrong reason. Resolved by deleting the stale `.class` file and recompiling; not a code defect, purely a local build-cache artifact of doing two edits within the same filesystem-timestamp granularity.
- **No access to the GitNexus MCP tools (`impact`, `detect_changes`) in this execution session** — CLAUDE.md's "MUST run impact analysis / detect_changes" directives could not be run via the MCP tool. Substituted a manual equivalent: `grep`-searched every caller of `VendorService` (`VendorController` plus 4 test files) and confirmed none constructs it directly with the old `Optional<EncryptionService>` signature, so the constructor-injection change is safe. Recommend a human or a session with MCP access run `detect_changes({scope: "compare", base_ref: "main"})` before merging this branch, per CLAUDE.md.

## User Setup Required

None - no external service configuration required. `restaurantos.encryption.key` already had a dev default in `application.yml`; every real environment must continue to set `FIELD_ENCRYPTION_KEY` (unchanged from before this plan — only the failure mode when it's missing has changed, from silent to loud).

## Next Phase Readiness

- ROADMAP SC#1's "vendor bank account stored field-encrypted" clause now holds under failure, not just the happy path: it is impossible to persist a vendor bank account unencrypted, and impossible to lose it silently because the key was missing or blank.
- `VendorController` and other purchasing controllers were left untouched per the scope fence — 10-09's `@PreAuthorize` work is unaffected by this plan.
- Outstanding for a future session: run GitNexus `detect_changes({scope: "compare", base_ref: "main"})` for a machine-verified confirmation that only the expected symbols/flows were touched (see Issues Encountered above).

---
*Phase: 10-purchasing-accounts-payable*
*Completed: 2026-07-13*
