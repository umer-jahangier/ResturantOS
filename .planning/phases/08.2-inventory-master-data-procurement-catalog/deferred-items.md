# Deferred Items — 08.2-inventory-master-data-procurement-catalog

## 08.2-19 (Task 2 test-writing — CatalogItemCombobox pre-existing a11y gap)

**`components/shared/catalog-item-combobox.tsx`'s trigger `aria-label` never reflects the current
selection — NOT fixed here (out of scope, pre-existing since plan 08.2-05):**

```tsx
aria-label={disabled ? disabledPlaceholder : placeholder}
```

The trigger button's accessible name is always `disabledPlaceholder` or `placeholder`, even after
`onSelect` fires and a real item is chosen — only the button's *visible* text (the inner `<span>`)
switches to `selected.name`. A screen-reader user would always hear "Select an item…" (or whatever
`placeholder` the caller passes), never the actually-selected item's name. This affects every
consumer of `CatalogItemCombobox` (the ingredient picker in `VendorItemFormDialog`, the vendor-item
picker in `PurchaseOrderFormDialog`), not something introduced by plan 08.2-19.

Discovered while writing `components/purchasing/__tests__/po-line-catalog-picker.test.tsx`'s
`changingTheVendorClearsExistingLines` test: an assertion using
`getByRole("button", { name: "Chicken breast, boneless" })` failed to find the trigger after a
real selection, because the button's accessible name never changed from the placeholder. The test
was written to assert on the trigger's visible text (`getByText`) instead, which is unaffected by
this gap and correctly proves the selection/clear behavior plan 08.2-19 itself is responsible for.

Not fixed here per the executor's scope-boundary rule (out-of-scope pre-existing file, not
declared in this plan's `files_modified`, and not blocking any of this plan's own success
criteria — `PurchaseOrderFormDialog`'s own line-item selection state is provably correct via the
`uom`/`unitPriceRupees` field values and the visible trigger text). A future plan touching
`catalog-item-combobox.tsx` should set `aria-label={disabled ? disabledPlaceholder : selected ? selected.name : placeholder}`.
