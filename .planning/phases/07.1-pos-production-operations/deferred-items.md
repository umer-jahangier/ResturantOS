# Deferred Items — Phase 07.1

Out-of-scope discoveries logged during plan execution, per the executor's Scope
Boundary rule (only auto-fix issues directly caused by the current task's changes).

## From 07.1-05 (frontend data layer + StatusBadge/revision-chip)

`npx eslint components lib --max-warnings=0` (repo-wide) reports 7 pre-existing
errors + 3 warnings, none in files touched by 07.1-05:

- `components/finance/AccountCodeSelect.tsx` — pre-existing lint error (not inspected
  in detail; unrelated to POS/KDS).
- `components/finance/GeneralLedger.tsx:27` — `react-hooks/set-state-in-effect`
  (`setSelectedPeriodId` called synchronously inside a `useEffect`).
- `components/finance/JournalEntryForm.tsx:13` — `no-restricted-imports` (imports
  `@/lib/api-client/errors` directly, a four-layer boundary violation); also
  `JournalEntryForm.tsx:54` — `react-hooks/set-state-in-effect`.
- `components/finance/PeriodCloseModal.tsx:8` — `no-restricted-imports` (imports
  `@/lib/api-client/errors` directly).
- `components/pos/pos-terminal.tsx:11` — `no-restricted-imports` (imports
  `@/lib/repositories/pos.repository` directly). This file was already
  uncommitted/modified in the working tree before 07.1-05 started (see repo git
  status at session start) — not a regression introduced by this plan.
- `components/providers/session-provider.tsx:54` — `react-hooks/set-state-in-effect`
  (`setIsBootstrapping(true)` called synchronously inside a `useEffect`).
- `components/ui/data-table.tsx:36` — `react-hooks/incompatible-library` warning
  (TanStack Table `useReactTable()` returns non-memoizable functions — expected,
  documented elsewhere as [04-06-B]).
- `lib/hooks/finance/use-accounts.ts:3` — unused `useMutation`/`useQueryClient`
  imports (warnings).

None of these are in 07.1-05's file list; none were caused by 07.1-05's changes.
Flagging for a future Finance/POS-terminal-focused plan or a dedicated lint-debt
cleanup pass.

## Also from 07.1-05: `__tests__/lib/eslint-boundary.test.ts` timeout flake

`flags a component importing a repository directly` intermittently exceeds vitest's
default 5000ms test timeout on this dev machine — the test instantiates a fresh
`ESLint` (flat-config) linter per test, and cold-start can take >5s on Windows.
Re-running with `--testTimeout=20000` (or in isolation) passes reliably; this is a
pre-existing environmental timing issue in the test file itself (untouched by
07.1-05), not a regression. A future plan touching test infra could raise this
specific test's timeout via a per-test `it(..., { timeout: 15000 })` override.
