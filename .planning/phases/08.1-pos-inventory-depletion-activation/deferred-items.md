# Deferred Items — 08.1-pos-inventory-depletion-activation

## 08.1-04 (Task 3 lint verification)

`npm --prefix frontend run lint` exits 1 due to **pre-existing** errors/warnings in files this
plan never touches (confirmed via `git log -- <file>` — all predate this phase, e.g.
`station-picker.tsx`/`use-kds-clock.tsx` from 07.3-10). None are related to the inventory
four-layer slice, recipe-builder UI, or coverage dashboard added in 08.1-04; a targeted lint
of the new/modified inventory files (`git diff` scope) reports zero errors and zero warnings.

Out-of-scope pre-existing lint findings, NOT fixed here per the executor's scope-boundary rule:

- `components/finance/AccountCodeSelect.tsx:29` — `react-hooks/set-state-in-effect`
- `components/finance/GeneralLedger.tsx:27` — `react-hooks/set-state-in-effect`
- `components/finance/JournalEntryForm.tsx:13,54` — layer-boundary violation (`@/lib/api-client/errors`) + `react-hooks/set-state-in-effect`
- `components/finance/PeriodCloseModal.tsx:8` — layer-boundary violation (`@/lib/api-client/errors`)
- `components/kds/station-picker.tsx:102` — `react-hooks/purity` (`Date.now()` in `useMemo`)
- `components/providers/session-provider.tsx:54` — `react-hooks/set-state-in-effect`
- `lib/hooks/kds/use-kds-clock.tsx:44` — `react-hooks/purity` (`Date.now()` in a hook body)
- `components/purchasing/PurchaseOrderFormDialog.tsx:98`, `components/purchasing/VendorInvoiceFormDialog.tsx:98`, `components/ui/data-table.tsx:45` — React Compiler "incompatible library" warnings (react-hook-form `watch()` / TanStack Table `useReactTable()`)
- `lib/hooks/finance/use-accounts.ts:3` — unused imports (warning)
- `mocks/handlers.ts:72`, `mocks/purchasing.handlers.ts:6` — unused-directive/unused-var (warnings)

None of these block 08.1-04's success criteria (no boundary violations in the new inventory
code; the inventory-specific vitest suite and typecheck both pass clean).
