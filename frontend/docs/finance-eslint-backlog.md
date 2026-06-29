# Finance components — ESLint backlog

Reference for lint issues in `frontend/components/finance/`. Documented after running:

```bash
cd frontend
npm run lint -- components/finance
```

**Last checked:** 2026-06-30  
**Result:** 5 errors in 4 files (6 of 10 files clean)

These are **not critical runtime bugs** — finance flows can work correctly while these remain. Fix when lint/CI must pass or during a finance-layer cleanup pass.

---

## Clean files (no action needed)

| File | Status |
|------|--------|
| `components/finance/DrCrCell.tsx` | Pass |
| `components/finance/AccountTable.tsx` | Pass |
| `components/finance/FinanceEmptyState.tsx` | Pass |
| `components/finance/JournalEntryTable.tsx` | Pass |
| `components/finance/OpenPeriodDatePicker.tsx` | Pass |
| `components/finance/PeriodStatusChip.tsx` | Pass |

---

## Issue 1 — Layer boundary violation

**Rule:** `no-restricted-imports`  
**Config:** `frontend/eslint.config.mjs` (FE-08 layer boundary)  
**Message:** Components must not import `@/lib/api-client/**` or `@/lib/repositories/**`. Use Layer-3 hooks from `@/lib/hooks/**` instead.

| File | Line | Import |
|------|------|--------|
| `components/finance/JournalEntryForm.tsx` | 13 | `formatUserFacingError` from `@/lib/api-client/errors` |
| `components/finance/PeriodCloseModal.tsx` | 8 | `formatUserFacingError` from `@/lib/api-client/errors` |

**What it does today:** Formats mutation errors from `useCreateJe` and `useClosePeriod` for display in the UI.

**Severity:** Low (architecture / lint gate). No direct API calls; runtime behavior is fine.

**Fix direction (later):**
- Move `formatUserFacingError` to a neutral module (e.g. `@/lib/utils/errors`), or
- Have hooks expose a user-facing error string so components never touch `api-client`.

**Related (same pattern, outside this folder):**
- `app/(tenant)/app/finance/journal-entries/[id]/page.tsx` line 5 — same import.

---

## Issue 2 — `setState` inside `useEffect`

**Rule:** `react-hooks/set-state-in-effect`  
**Source:** React Compiler / Next.js ESLint (discourages syncing state via effects)

### 2a — `AccountCodeSelect.tsx` (line 29)

```tsx
useEffect(() => {
  setQuery(value);
}, [value]);
```

**Intent:** Keep local search `query` in sync when the controlled `value` prop changes.

**Severity:** Low (possible extra render; combobox still works).

**Fix direction (later):** Derive display text from `value` / `selectedName`, or reset query only on explicit select without an effect.

---

### 2b — `GeneralLedger.tsx` (line 27)

```tsx
useEffect(() => {
  if (!selectedPeriodId && activePeriodId) {
    setSelectedPeriodId(activePeriodId);
  }
}, [activePeriodId, selectedPeriodId]);
```

**Intent:** Default period dropdown to the open period (or first period) once periods load.

**Severity:** Low (one extra render on load; GL data still loads correctly).

**Fix direction (later):** Lazy `useState` init, derive selected period without duplicate state, or key remount when `periods` first arrives.

---

### 2c — `JournalEntryForm.tsx` (line 54)

```tsx
useEffect(() => {
  if (defaultDate && !entryDate) {
    setEntryDate(defaultDate);
  }
}, [defaultDate, entryDate]);
```

**Intent:** Set journal entry date once open periods resolve (`defaultDate` from `useOpenPeriods`).

**Severity:** Low (form works; date defaults as expected).

**Fix direction (later):** Initialize `entryDate` when `defaultDate` becomes available without an effect (lazy init, controlled default, or remount key on `openPeriods`).

---

## Summary table

| Priority | Count | Category | Blocks runtime? | Blocks CI if lint required? |
|----------|-------|----------|-------------------|----------------------------|
| P2 | 2 | Layer boundary imports | No | Yes |
| P3 | 3 | `setState` in effect | No | Yes |
| — | **5 total** | | | |

---

## Re-verify after fixes

```bash
cd frontend
npm run lint -- components/finance
```

Optional broader check (includes finance app pages with the same error import):

```bash
npm run lint -- components/finance app/\(tenant\)/app/finance
```
