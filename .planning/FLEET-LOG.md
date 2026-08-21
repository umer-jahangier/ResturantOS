# Fleet log — 17 parallel sessions, 2026-08-11/12

What ~17 agent sessions working in parallel git worktrees off `phase-13-access-repair` learned the
hard way. **Everything here cost someone a wrong conclusion.** None of it is derivable from the code
or the git history, which is the only reason it is written down.

Companion files: [`MIGRATION-REGISTER.md`](MIGRATION-REGISTER.md) (claim a version before you create
the file), [`decisions/D-TAX-DISCOUNT.md`](decisions/D-TAX-DISCOUNT.md) (the tax ruling),
`decisions/D-LOYALTY-LEDGER-SHAPE.md` (on `claude/eloquent-napier-4baf6b`, pending integration).

---

## 1. The defect class this codebase actually has

**Structurally present, behaviourally absent.** The wiring is there, it reads correctly, and it never
executes. Found 8+ times in two days:

| Thing | Looked like | Actually |
|---|---|---|
| `TenantFilterInterceptor` | registered fleet-wide | inert — RLS was the only tenant boundary |
| 33 tables' RLS | `ENABLE ROW LEVEL SECURITY` present | not `FORCE`, and the app connects as the table **owner** — Postgres exempts an owner from its own policies unless FORCE is set |
| `OrderPricingCalculator.perLineTax` | always computed tax on the net | its only caller passed a hard-coded `0L`, so the net path never once ran |
| CRM promotions | full discount pipeline | never once reduced a bill |
| A positive-control test | green | had been **skipping** since the day it was written |

The pattern is why a green suite means very little here. **Prefer an experiment that tries to break
the thing over a test that asserts it works.** The method that repeatedly worked: re-introduce the
bug, run the suite, watch it go red, revert, confirm `git diff HEAD` empty, re-run green. Two sessions
independently used it to discover their proposed new test was redundant.

## 2. Instruments that lied

Each of these produced a confident, wrong answer:

- **`| tail` masks the exit code.** A Maven run died on the `RequireJavaVersion` enforcer *before a
  single test executed* and the shell reported **exit 0**. A session trusting that reports a green
  suite that never ran. Check `${PIPESTATUS[0]}`.
- **The JDK.** Project targets Java 25, Maven here runs 26, and `/usr/libexec/java_home -v 25` finds
  nothing. It is at `/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home` and must be
  passed explicitly.
- **`mvn package` does not clean.** After renaming a migration, `target/classes/db/migration/` still
  holds the **old filename** and the jar ships both. Flyway then refuses to boot on a checksum
  mismatch — the exact failure the renumber was performed to prevent.
- **A word-boundary grep does not match the file you are renaming.** `_` is a word character, so
  `\bV28\b` matches every prose mention of V28 and silently skips
  `V28__order_discount_source.sql`. Sweep for both `\bV28\b` **and** `V28__`.
- **`-Dtest=SomethingIT` does NOT run zero tests** — it overrides surefire excludes, and a
  non-matching pattern fails loudly rather than passing vacuously. This was broadcast fleet-wide as
  a hazard, challenged by an agent, verified, and found **wrong on both counts**. Retracted.
- **A compile check against the working tree proves nothing about a path-scoped commit.** See §3.
- **`grep` over a multi-line assertion reports the LAST file, not all of them.** A session filtered
  vitest output through `grep` to list off-contract files and reported **five**. There were
  **twenty-nine**: each of the five names was merely the alphabetically-last entry of a multi-line
  assertion, and the grep saw only that line. The suite had run correctly and produced the truth.
  **This is a fifth variant of the green-suite trap, and the usual countermeasure does not catch
  it** — the run was real, a positive test count was present and honest, and the *reading* was the
  lie. Demanding `Tests run: N` proves the suite executed; it says nothing about whether the summary
  someone extracted from it is complete. Read the raw assertion, or count what you claim to have
  counted.
- **A contrast gate that only measures one surface passes on the others.** The theme gate asserted
  every pairing against the PAGE background and never against a Card, so `--border-interactive` sat
  at **2.95:1** on cards in dark mode — under SC 1.4.11's 3:1 floor — from the day dark surfaces were
  introduced. Re-measured against the pre-existing cyan tokens at **2.94:1**, so it long predated the
  palette work that found it. A gate is only evidence for the combinations it actually enumerates.
- **A clean `tsc --noEmit` can mean the exclude got too broad.** After excluding duplicate files,
  falsify it: `tsc --listFilesOnly` and diff against `git ls-files` — the set of tracked sources not
  compiled must be empty.
- **`System.setProperty("TESTCONTAINERS_RYUK_DISABLED","true")` in a static block DOES NOTHING.**
  I broadcast it as the fix. It is decorative, and so are the copies in `PosTestBase`,
  `HrTestBase`, `KitchenTestBase`, `FinanceTestBase`, `AutoPostingITBase` and the audit ITs — those
  modules are green because of their **pom**, not that line. Measured on one IT class, same commit:

  | mechanism | Ryuk attempts | result |
  |---|---|---|
  | env var exported in the shell | 0 | pass |
  | failsafe `<environmentVariables>` in the module pom | 0 | pass |
  | `System.setProperty(…)` in a static block | 1 | ERROR |
  | `mvn -Dryuk.disabled=true` | 1 | ERROR |
  | `testcontainers.properties` on the test classpath | 1 | ERROR |

  Testcontainers 1.21.4 resolves `ryuk.disabled` from the environment and `~/.testcontainers.properties`
  only — and `~/.testcontainers.properties` here **already** says `ryuk.disabled=true` and is not
  honoured by the failsafe fork. There is **no parent-pom entry**: five service poms each carry
  their own, and auth-service and shared-lib never got one. That is the whole defect.

  **FIXED 2026-08-12 in the ROOT pom** (`<pluginManagement>` → failsafe → `<environmentVariables>`),
  so all 18 modules inherit it. Nine were missing it, covering **79 IT files**: shared-lib, gateway,
  audit, auth, authorization, crm, file, hr and user. Verified the way the fix has to be verified —
  `mvn -pl services/auth-service verify -Dit.test=AuthInternalBranchRoleIT` with
  `TESTCONTAINERS_RYUK_DISABLED` **stripped from the environment** (`env -u`), on **two independent
  modules**, because one module passing proves inheritance only for that module:

  ```
  auth-service  AuthInternalBranchRoleIT   Tests run: 19, Failures: 0, Errors: 0
  file-service  RlsNullSafeGucIT           Tests run:  2, Failures: 0, Errors: 0
  ```

  Both logged *"Ryuk has been disabled"* with zero mount-source-path errors. The eight per-module
  entries are now redundant but were left alone rather than churned in the same change.

  **A third decorative form exists**, in `AuditImmutabilityIT`, `AuditConsumerIT` and
  `AuditReadPathIT`: `r.add("TESTCONTAINERS_RYUK_DISABLED", () -> "true")` inside a
  `@DynamicPropertySource`. That registers a **Spring property**. Testcontainers reads the
  **process environment**. It was never going to arrive. Those suites pass only when someone
  exports the variable on the command line, which is easy to mistake for the code working.
- **`-Dtest=X` with `-am` fails the reactor before it reaches your module.** My earlier retraction
  was itself incomplete. With `-am` the filter also applies to shared-lib, which then fails on
  no-match *first*. `-Dsurefire.failIfNoSpecifiedTests=false` is required alongside — and it costs
  you the no-match safety net, so read per-class counts out of `target/surefire-reports/*.txt`
  rather than trusting the aggregate. Confirmed independently by two sessions. For ITs, surefire
  excludes `**/*IT.java` entirely: use `mvn -pl <module> verify -Dit.test=…`.
- **A structured-output schema is for SHORT fields and a FILE PATH — never for a report.** Two
  agents produced ~21 KB and ~15 KB of measured findings inside single string fields; the payloads
  failed to parse **five times each**, the workflow returned `{"results":[]}`, and only the opening
  ~2 KB of each survived in the transcript. 331k tokens of real investigation, most of it
  unrecoverable, because of how the *output* was asked for rather than anything the agents did. Have
  agents **write long-form findings to a file and return the path**; keep schema fields to verdicts,
  counts, SHAs and short summaries.
- **`-Dit.test='ClassA+ClassB'` matches NOTHING.** `+` separates METHODS; classes are
  comma-separated. On its own that would fail loudly — but `-Dfailsafe.failIfNoSpecifiedTests=false`
  is *required* (or `-am` lets shared-lib's failsafe kill the reactor first), and it turns "matched
  nothing" into **BUILD SUCCESS**. *The flag that unblocks the build is the flag that hides the
  empty run.*
- **In a FRESH WORKTREE there is no `frontend/node_modules`.** `npx tsc` / `npx vitest` then fetch a
  bare toolchain, resolve nothing, and a grep-filtered typecheck comes back **"clean" having checked
  nothing**. The correct command is **`pnpm install --frozen-lockfile`** — `frontend/` has
  `pnpm-lock.yaml` and `pnpm-workspace.yaml`.

  **Do NOT reach for `npm install` when `npm ci` fails.** `npm ci` is not failing on a broken
  lockfile; it is failing because **there is no npm lockfile at all**. `npm install` then "works" by
  resolving a fresh, *unlocked* tree — 642 packages nobody pinned — and writes a `package-lock.json`
  that does not belong in the repo. Every suite run after that is measured against different
  dependencies than the project ships. An earlier version of this very entry gave that advice; it
  was retracted by the session that had just been caught by it, on the grounds that **the wrong
  version is worse than the original problem, because `npm install` succeeds loudly.**

  Both halves were then measured. `pnpm install --frozen-lockfile` **succeeded**, so the pnpm
  lockfile was valid all along and "lock mismatch" was never the reason `npm ci` failed. And the two
  trees really did differ: the npm resolution pulled **vitest 4.1.10** where the lockfile pins
  **4.1.9**. The suite happened to give the same result — 12/12 either way — but that could not have
  been known without re-running it, which is the point. `package-lock.json` is now gitignored
  repo-wide so it cannot be committed and mistaken for a lockfile; three worktrees had grown one.
- **The ONLY safe check that a suite ran is a positive `Tests run: N` line naming the class you
  care about.** Not the exit code, not `BUILD SUCCESS`, not the absence of red.
- **An absence assertion written as `waitFor(() => expect(queryByRole(…)).not.toBeInTheDocument())`
  is vacuous.** It returns on the FIRST frame, where the element is absent for an unrelated reason
  (a loading flag still true). A six-case test written this way passed with the guard deleted. Wait
  **for** the element and fail if it arrives. There are more of these in the repo.
- **A running Next dev server makes the frontend suite go red for no reason.** One dev server
  alongside `vitest` produced **13 spurious 5s timeouts across 9 unrelated files**; with it stopped,
  40/40 files passed in 10s. A session reading that red as a regression would chase nine phantom
  bugs. Stop dev servers before you believe a frontend suite.
- **`grep` in the service that consumes a shared-lib bean finds nothing.** Searching audit-service
  for `set_config`/`current_setting` returned zero hits and reads as "RLS not wired". The mechanism
  lives in shared-lib auto-configuration; the service consumes it as a bean, not as literal SQL. An
  agent nearly built defensive machinery that already existed.

## 3. Git discipline in a shared checkout

Worktrees isolate **commits**. They do **not** isolate the main checkout's **index**. During this
session that index held 48 files staged by other sessions.

- `git commit -m "..."` with **no pathspec** sweeps all of them in under your message.
- `git add -A` / `.` / `-u` — never.
- `git commit -m "..." -- <explicit paths>` is correct for **tracked, modified** files, and fails
  with *"pathspec did not match"* for **untracked** ones. The obvious recovery — dropping the
  pathspec — is the damaging move.
- **Path-scoped commits silently omit new files.** `455237b5` shipped 4 files and needed 9 more,
  found over two follow-up commits (`fff8036a`, `f748c166`) — including the applied V27 migration.
  It is a broken commit in the history: it will not build on checkout and will poison a `git bisect`
  through that range. Not amended, because sixteen sessions may have rebased onto it.
- **The check that works:** build from a clean worktree at the SHA you are about to push, not from
  your working tree. `git stash -k` or a fresh clone of the SHA.

## 3a. Committing another session's uncommitted work

Worth doing — uncommitted work in a shared tree is one bad command from gone. But two rules, both
learned by getting them wrong:

**Never assert in the message that it is complete or verified.** Say **"snapshot, unverified"**, or
ask the owning session first. `01384466` claimed "complete and verified in the worktree"; it was
neither — a mid-flight capture missing two imports, so the commit does not compile, and carrying
only the Java third of a change whose rego policy and frontend were still unwritten. Putting a false
claim in the permanent record is the exact failure this register exists to prevent.

**Never give the snapshot a subject line that claims an outcome.** `f84c55c3` was a mid-flight
capture of a **test-first** worktree — 75 test insertions, zero production lines, which is precisely
what "watch the assertion fail first" looks like from outside. I titled it
*"fix(audit): bound the facets window so a 7-year log stays answerable"* and wrote that the work was
*"complete and verified."* Neither was true of that moment.

**Then it became evidence against its own author.** An integration agent read that commit, reported a
`fix(...)` with no production change; I "independently confirmed" it by diffing the same commit, filed
it as a **red spec — a test that fails by construction** — and put that on the register and in a
message to the author. All three of us were reading an artefact I had created. The author had done
the right thing in the right order and it was recorded as a defect.

So: a snapshot commit gets a subject that says what it *is* (`wip(audit): snapshot of an unfinished
worktree, unverified`), never what it *achieves*. And a test-only diff is not evidence of a red spec
until you have checked whether the production half simply had not been written **yet**.

**Then verify the file count.** `git show --stat HEAD` against what you intended. The follow-up to
that same commit had to recover **six** files, including the OPA clause that was the entire point of
the change — so the branch tip carried a security fix that measured a boundary and never enforced
it. A downstream agent then read that tip, grepped, concluded the clause "was never written on any
branch", and recommended authoring a new security rule from scratch. It had been written all along.

## 3b. Hand-assigned fixture IDs are a namespace with no allocator

The sharpest finding of the day, and it has no warning attached anywhere.

`save()` on an entity with a **hand-stamped id is a MERGE, not an insert**. A test that stamps
`d0000007` and saves "if absent" does not create a row — it **silently rewrites** whichever seeded
row already holds that id. In auth-service, `d0000007` belongs to the chef's KITCHEN_STAFF role at
MAIN, so a block whose stated intent was "give the cashier a branch-2 role" turned the chef's row
into "the cashier, at branch two". The chef then had zero active assignments and every login 500'd —
six classes later, because the `isEmpty()` guard fires only on the class's first test, so the damage
is invisible in the results of the class that caused it.

`BranchSwitchIT` had the identical copy-pasted block stamping `d0000006`. It was dormant **only
because the first bug satisfied its guard** — one bug suppressing another, so fixing the first would
have armed the second and looked exactly like "the fix caused a new failure".

Use `UUID.randomUUID()` wherever the id need not be stable, or a reserved test range above the seed.

Three distinct flavours of test coupling, needing three different remedies:

1. **Shared-fixture mutation** — own your rows. Cleanup in `@BeforeEach` protects you from your
   predecessors and nobody from you.
2. **Fixture-id collision** — the above.
3. **Global DDL / global assertions** — `DuplicateActiveRoleRepairIT` drops `is_primary` and both
   unique indexes, replays Liquibase, and the replay does not restore the column; every class after
   it in the fork dies with `column ubre1_0.is_primary does not exist`. `@DirtiesContext` does not
   help — it recycles the Spring context, not the database. Needs its own container or a guaranteed
   restore. `RlsForcedInvariantIT#configurationTablesAreEmptyAfterMigration` is in this category too.

## 3c. zsh does not word-split unquoted variables

`for f in $FILES` and `git checkout -- $F` take the whole variable as ONE word. The command then
does nothing, or errors, and a loop appears to run. Two sessions hit this independently today; one
only noticed because a controlled-comparison result came out suspiciously identical. Use an array,
`${=VAR}`, or write the paths out.

## 4. Merging branches cut at different times

A merge conflict where the other side **deletes** an authorization annotation usually means that
branch **predates** it, not that it changed it. Merging `claude/hungry-poincare-094970` into
`TillController.java` proposed removing `@PreAuthorize("hasAuthority('pos.till.open'))`, its `close`
equivalent, the `/cashiers` endpoint gated on `pos.till.open.other`, `TillReviewService` and
pagination — while *appearing to add a security fix*. Its real work was in `TillService`, which
merged cleanly.

**Integration acceptance criteria — count before and after, and stop if any count drops:**

```
git grep -c '@PreAuthorize' -- 'services/pos-service/**'   # was 98
git grep -c '@PreAuthorize' -- 'services/**'               # was 283
```

plus: all of V27/V28/V29/V30 present, and `.planning/decisions/` retains **both** decision documents.
A merge that removes an authorization annotation is worse than an unmerged branch.

## 5. The shared fleet is a shared database

Every session points at one Postgres, one RabbitMQ, one service fleet on fixed ports.

- **Restarting a service APPLIES its new migrations to the database all 17 sessions share.** V27
  (`tenant_tax_policy`) went in as an incidental side effect of a jar swap. Sequence it deliberately.
- **Applying a migration from a worktree breaks the main checkout** — Flyway's
  `validate-on-migrate: true` means the main tree cannot resolve a version the database now records.
  Land the file in both places in the same operation.
- **All instances of a service must restart together.** A stale JVM holding the port answers with
  pre-ruling math against a migrated schema. With money attached.
- **Live behaviour changes invalidate other sessions' baselines.** Anyone who baselined discount/tax
  numbers from the browser before the tax ruling has baselined pre-ruling behaviour and will file the
  fix as a regression. Announce a hold, restart, then tell sessions to re-baseline.
- **Never restart into a jar another session is mid-build on.** Check jar mtime and `unzip -l | grep
  -c BOOT-INF` first — a repackage failure yields a ~300 KB jar with **zero** BOOT-INF entries that
  holds its port and answers nothing.
- A full pos-service IT run exhausts the shared Postgres connections; parallel worktrees clobber
  `~/.m2` shared-lib (build with `-am`). Both look like your own bug.
- `TESTCONTAINERS_RYUK_DISABLED` is already set by the parent pom for **failsafe**, not for
  surefire-run ITs or shared-lib's own suite.

## 5a. `pkill -f <jar>` from a worktree kills the LIVE fleet

Every worktree builds `platform-admin-service-1.0.0.jar` at **the same basename**. `pkill -f` matches
the whole command line, so an agent tidying up *its own* service in *its own* worktree also kills the
one serving the user on :8096 — and the shared gateway with it. This happened twice in one afternoon:
the gateway was killed at 18:19:53, restarted, and killed again minutes later by a still-running
agent.

It is the same root cause as the false-STALE bug in `check-stale-jars.sh` (§2), from a new angle:
there, a *shell* that merely named the jar got matched; here, a *different worktree's identical jar*
does. The fix is the same one `scripts/run-dev-services.sh` uses — match on the **executable** and on
the **absolute path**, never the bare basename:

```bash
for pid in $(pgrep -f "$(pwd)/target/${n}-1\.0\.0\.jar"); do
  [ "$(ps -p "$pid" -o comm= | sed 's|.*/||')" = java ] && kill "$pid"
done
```

**Better still: an agent in a worktree should not stop shared services at all.** The stack on :8080
and :3000 belongs to the user. If a worktree needs its own service, give it a different port.

## 6. A migration cannot always see the rows it exists to migrate

Liquibase/Flyway runs as the table **owner** on a connection with **no** `app.current_tenant_id`.
Under `FORCE ROW LEVEL SECURITY` the owner is subject to the policy, so a repair `UPDATE` matches
**zero rows** while the `ALTER TABLE` beside it applies to every row.

hr-service `015b` drove a per-tenant loop from `SELECT DISTINCT tenant_id FROM employees` and got
nothing; `015c` would then have dropped the free-text columns believing the backfill ran — a green
migration followed by permanent data loss (3 of 4 employees' designations here; every department a
customer ever typed, there). `HrTestBase` migrates an **empty** table, so the loop iterates zero
times and the defect is structurally invisible under test. **The fix could not be a test.**

Two rules that came out of it:

1. **An invariant suspended for a migration must be restored by the same unit of work that suspended
   it**, or it depends on someone remembering. `034` dropped FORCE and did not restore it; measured
   `attendance_quarantine|f` afterwards — one table silently exempt from its own policy.
2. **Make the destructive step refuse to run if the backfill did not.** `015c` now counts rows
   holding a free-text value with no id and raises, naming the number. It cannot be satisfied by an
   empty table or a partial backfill.

Also: policies must use `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`. The
unguarded cast turns a tenantless connection into `invalid input syntax for type uuid: ""`.

## 7. Open product decisions — the user's, not ours

1. **Do redeemed loyalty points participate in the tax base?** Largely answered by implication: a
   **tender** settles a balance and does not change the value of supply; a **discount** does. Since
   the tax ruling made ORDER-scope discounts reduce the tax base, booking a redemption as a discount
   now **under-collects output tax on a sale that happened at full price** — a filing error, not a
   presentation error. `order_discounts` currently conflates three different things: price reduction,
   liability *redemption* (a tender, belonging in `order_payments`), and liability *issuance*. Only 3
   of 7 loyalty models are discounts.
2. **Is the service charge itself taxable?** Unowned, unfixed.
3. **Discount compounding — upheld, now pinned in code.** A manual ORDER discount *stacks on* an
   automatic promotion rather than replacing it: Rs 900.00 check, Rs 150.00 offer, manager takes
   Rs 80.00, guest pays Rs 670.00. The promotion is the guest's earned entitlement; the manager's
   discount is a separate service-recovery decision; neither may silently withdraw the other. The
   rejected alternative would take back an earned offer with nothing on screen saying so.

## 8. Known gaps, deliberately not papered over

- A promotion is ORDER scope, so it flows through `allocateProRata` and reduces tax automatically —
  **nobody has asserted that it does.** `PromotionDiscountPersistsIT` prices at 0% tax so every
  figure stays hand-checkable, which is exactly why it cannot cover this.
- **A zero-subtotal promotion writes a row no constraint can see.** The CRM fix carries the uncapped
  offer in `value`, so the row is `value = 150.0000, amountPaisa = 0`: it passes `value > 0` happily
  and V29's CHECK cannot see it. Every layer added — API bound, DB CHECK, clamp — is blind by
  construction, because they are all rules about *values* and this is a row that **should not exist
  at all**. Only a guard at the writer (`applyPromotions`' `capped <= 0`) and a person reading a bill
  can see it. The test that would have papered over this now asserts the gap explicitly.
- `cancelItem` has no terminal-status guard: a CLOSED or VOIDED check can be silently re-priced.
- `finance.invoice-matched.queue`: 26 messages, 0 consumers.
