---
phase: 26
plan: "05"
subsystem: print
status: partial
tags: [print, receipt, frontend, css, fbr, 80mm]
requires:
  - 26-01 (PrintDocument model + adapter, and the golden fixture)
  - 26-03 (the server-issued document these render)
provides:
  - "`ReceiptDocumentView` — the 80 mm bill, rendered from strings the server already produced"
  - "`receipt-print.css` — the `@page { size: 80mm auto }` stylesheet and the print-media isolation"
  - "`FiscalRegion` — the FBR invoice-number and QR regions, reserved and collapsing (D-26-03)"
  - "`ReceiptView` + the `/app/pos/orders/[orderId]/receipt` route — the screen a cashier reaches"
  - "`PrintRepository` / `useIssueReceipt` — the layer-3 and layer-4 halves of issuing a document"
  - "a Print bill control on the settlement screen"
affects:
  - frontend/components/print (new directory)
tech-stack:
  added: []
  patterns: [render-the-string-never-the-number, collapse-to-nothing, physical-units-for-physical-requirements]
key-files:
  created:
    - frontend/components/print/receipt-document.tsx
    - frontend/components/print/fiscal-region.tsx
    - frontend/components/print/receipt-print.css
    - frontend/components/print/__tests__/receipt-document.test.tsx
    - frontend/components/print/__tests__/fiscal-region.test.tsx
  modified: []
decisions:
  - "Content is held to 72 mm inside the 80 mm page, so a driver's unprintable margin cannot clip a right-aligned total"
  - "Monospace, so a browser bill and a thermal bill read as the same document"
  - "The FBR region returns null — not an empty wrapper — for both a null region and an all-null one"
  - "The reserved QR square is sized in millimetres, never pixels"
  - "A present-but-unrenderable QR payload shows an explicit unavailable state, never a blank square"
metrics:
  duration: ~35m
  completed: 2026-08-11
commits:
  - c8e0e4a feat(26-05) — tasks 1 and 2
---

# Phase 26 Plan 05: The 80 mm Browser Bill — PARTIAL

**Tasks 1–5 are complete.** Task 5's checkpoint was RUN rather than deferred; the one thing that
remains is a human physically pressing print, and everything checkable was checked first.

**Tier 1 is now reachable**: a cashier who has taken money sees a Print bill control on the
settlement screen, which opens a route that issues a server-produced document and prints it. That
was the gap called out at the end of the previous run.

## What landed

### `ReceiptDocumentView` + `receipt-print.css` (task 1)

A presentational component — no fetching, no hooks, no state — that renders a server-issued
`PrintDocument`. **It performs no money arithmetic of any kind.** It never divides a paisa value,
never calls a locale formatter, and deliberately does not use `components/ui/money-display.tsx`,
which takes paisa and formats. That component is named in a comment on the receipt so its absence
reads as a decision rather than an oversight.

The load-bearing test is the last of the seven:

> every currency-shaped token in the rendered output must appear in the document's own set of
> rendered amount strings

A component that computed its own number would produce a token that is not in the set. That is the
assertion that makes the hundredfold defect unshippable, and it found nothing because the component
genuinely does no arithmetic.

The stylesheet sets `@page { size: 80mm auto; margin: 0 }` — the explicit-length `size` descriptor
reached baseline availability in December 2024 (research §4.1) — and holds content to **72 mm**
inside it. Four millimetres of gutter each side is the difference between a right-aligned total
that prints and one that is clipped, and a clipped total is the single worst thing this document
can do. Monospace with tabular numerals, so a customer comparing a browser bill against a thermal
bill is looking at the same document. A `@media print` block hides everything outside the receipt
root; the test asserts no `navigation`, no `banner`, no button and no link reach the paper.

**Design tokens:** a monochrome receipt is deliberately exempt from the phase-20 colour system,
stated in the stylesheet header so a later design pass does not "fix" it by adding brand colour to
a bill printed in black on white.

### `FiscalRegion` (task 2)

Returns **`null`** — not an empty wrapper, not a zero-height div — for a null region *and* for the
declared-but-entirely-empty region 26-03 actually produces today. Both cases are tested on child
count rather than visibility, because "collapses cleanly" is definition-of-done item 5 and a stray
element leaves a visible gap on 80 mm paper.

The reserved QR square is sized in **millimetres** from the document's own `qrSizeMm`, defaulting
to the specification's 25.4 mm. A pixel is a screen unit; this is a physical-size legal
requirement. A present-but-unrenderable payload renders an explicit "QR code unavailable" state,
never a blank square — on a tax invoice a blank square is indistinguishable from a printing fault,
and a customer cannot tell "not built yet" from "your printer is failing". No QR library was added;
the gate asserts none is in `package.json`.

## Real command output

```
$ npx vitest run components/print
 Test Files  2 passed (2)
      Tests  13 passed (13)

$ # task 1 gates
arithmetic gate: 0          # /100, *0.01, toLocaleString, Intl.NumberFormat, MoneyDisplay
@page mm rule: PRESENT

$ # task 2 gate
no qr/zxing dependency: PASS

$ npm run lint
✖ 10 problems (0 errors, 10 warnings)      # the pre-existing baseline; 0 in components/print

$ npm run typecheck
  __tests__/lib/money-display-authority.test.ts(6,10):  error TS2305 …
  __tests__/lib/money-display-authority.test.ts(10,24): error TS2307 …
errors in files this phase created/modified: 0
```

**The two typecheck errors are not this phase's.** `__tests__/lib/money-display-authority.test.ts`
is an untracked, in-flight file belonging to another agent working on the same branch (see the
ownership note at the end of this file). Zero errors fall in any file phase 26 created or modified.

## Deviations from Plan

### [Rule 3 — Blocking] The test cannot import the zod schema

`components/**` is forbidden by the project's own `no-restricted-imports` rule from reaching the
api-client layer, and that boundary is right — a component that reaches into the wire layer is a
component that will eventually parse its own responses. The test therefore adapts the golden
fixture through `adaptPrintDocument` with the parameter type taken structurally
(`Parameters<typeof adaptPrintDocument>[0]`), so the fixture is still typed against the real wire
shape. That the fixture *parses* is asserted where it belongs — 26-01's adapter test.

The fixture is still read from `contracts/print/golden-receipt-document.json` by walking up from
cwd. Not imported, and not copied.

## NOT DONE — tasks 3, 4 and 5

**D-5 is closed** — the coordinator rebuilt and restarted pos-service, and the receipt routes now
answer. Definition-of-done item 1 is **demonstrated in a real browser**.

## Task 4 — the Playwright journey, and the two defects it found

`e2e/journeys/pos-receipt-print.spec.ts` drives a real Chromium against the real gateway,
pos-service and database. **It found two defects that every other assertion in this plan had
passed over**, and both were invisible from the DOM.

### Defect 1 — the bill was printing on US Letter

`size: 80mm auto` is **invalid CSS**. The grammar is
`size: <length>{1,2} | auto | [<page-size> || [portrait|landscape]]`, so `auto` cannot follow a
length; Chromium dropped the whole declaration and fell back to the default page. Measured rather
than reasoned about:

| declaration | `cssText` | rendered PDF |
| --- | --- | --- |
| `size: 80mm auto;` | `@page { margin: 0px; }` | **215.90 × 279.40 mm — US Letter** |
| `size: 80mm;` | `@page { size: 80mm; … }` | 80.09 × 80.09 mm — a **square** page |
| `size: 80mm 297mm;` | `@page { size: 80mm 297mm; … }` | **80.09 × 297.01 mm** ✓ |

Height is 297 mm because `auto` height is **not expressible** in the `size` grammar at all. A
thermal printer on continuous paper ignores it and feeds to the cut; an office printer — the
level-3 fallback this tier exists for — gets a sheet it understands.

### Defect 2 — the application sidebar printed onto the customer's bill

`body * { visibility: hidden }` has specificity (0,0,1) and loses to Tailwind utility classes, so
the shell never stopped painting. `pdftotext` on the real print output returned:

```
  Zaitoon Kitchen        Orde
  OVERVIEW
    Dashboard
  ORDERS                  Or
    POS                   Is
```

The shell on the paper, and the receipt pushed and clipped to two characters a row with **not one
currency figure on it**. Fixed with `!important`.

**A correction to my own first diagnosis, recorded because it was wrong.** I initially blamed
`position: absolute` for the clipping and wrote that into a code comment. It was not the cause:
injecting `position: absolute !important` at runtime with the visibility rule fixed produces a
clean PDF. The clipping was the shell still occupying the page. `position: fixed` is kept as
*hardening* — it anchors the bill to the page box so a future shell change cannot reintroduce this
— and the comment now says so. The `transform`/`filter`/`will-change` caveat is written down,
because phase 34 is adding blur effects to POS surfaces and any of those would break `fixed` the
same way.

### Why the assertion shells out to `pdftotext`

Every in-browser proxy for "what got printed" was tried, and **every one PASSED against the
known-broken page**:

- reading the `@page` rule's text — passed (the rule was present; only the geometry was wrong, and
  `size: 80mm` would satisfy a "contains 80mm" check while paginating into squares);
- measuring the rendered PDF's page width — passed (the page really was 80 mm; the content was off
  it);
- narrowing the viewport and asserting containment — passed (a 302 px viewport collapses the
  sidebar, removing the very offset the bug is made of);
- checking the element's bounding box under `emulateMedia({ media: "print" })` — passed (reported
  `x = 0` while the real print was clipped).

So the surviving assertion extracts the **text of a rendered PDF** and asserts the grand total is
on it and the shell is not. Chrome outlines the monospace font into glyph paths, so in-process
extraction with `zlib` does not work — poppler is required. It **fails loudly** if `pdftotext` is
missing rather than skipping: a print assertion that quietly disables itself is the shape of test
that lets a bill ship with no amounts on it. It was verified to go red by simulating the failure.

The four dead assertions were **deleted, not kept for comfort.**

## Task 5 — the checkpoint, run rather than deferred

Driven end to end and the real print output inspected. Against the checkpoint's six steps:

1. **Narrow continuous strip, not a centred block on A4** — ✅ PDF MediaBox 80.09 × 297.01 mm,
   single page.
2. **Every element present and legible** — ✅ the full paper:

```
           Zaitoon Kitchen HQ

Order                ORD-20260811-0018
Issued        2026-08-11T18:04:20.403Z

3 x Butter Naan                 Rs 278.40

Subtotal                        Rs 240.00
Discount                          Rs 0.00
Service charge                    Rs 0.00
Tax (16.00%) [OTHER]             Rs 38.40
Tax                              Rs 38.40

TOTAL                       Rs 278.40

CASH                            Rs 278.40
Tendered                        Rs 778.40
Change                          Rs 500.00

No printer configured for this branch
           - browser bill
```

3. **No amount clipped at the right edge** — ✅ every figure is complete.
4. **The FBR area is absent, not an empty box** — ✅ nothing between the tenders and the footer.
5. **Browser header/footer (step 5's open question)** — **ANSWERED: the zero `@page` margin
   SUPPRESSES them.** Rendering with `displayHeaderFooter` explicitly requested produced text
   *byte-identical* to rendering without it — no URL, no date, no page number. Caveat stated
   plainly: this is CDP printing, and Chrome's interactive dialog has its own "Headers and footers"
   checkbox. The mechanism is the same (they are drawn in the margin box, and there is none), but
   the interactive dialog has not been observed. **The runbook does not need a kiosk-mode note.**
6. **Printed total vs the order** — ✅ order `totalPaisa = 27840`; paper reads `Rs 278.40`. Agrees
   to the paisa.

**What is still genuinely outstanding:** nobody has held the paper. I cannot press a physical
printer. Everything that can be checked without one has been, and a printable artefact is
regenerated at `frontend/e2e/__screenshots__/26-05-checkpoint/receipt.pdf` (gitignored) for whoever
does.

### Two cosmetic observations, not defects

- `Tax (16.00%) [OTHER]` then `Tax` prints the same figure twice on a single-rate order. The
  breakdown row falls back to rate code `OTHER` because the seeded menu item has no `taxRateCode`.
  Money is correct; the layout reads oddly. Worth a look in 26-12.
- `Discount Rs 0.00` and `Service charge Rs 0.00` always print. Arguably they should collapse when
  zero — but a customer querying a discount they expected is better served by an explicit zero.

## Task 3 — what landed

**The route.** `/app/pos/orders/[orderId]/receipt`, guarded on `FEATURE_POS` then
`pos.order.view` — matching 26-03's endpoints rather than the sibling Charge route's
`pos.order.close`. Reprinting is reading; requiring the settlement permission would mean fetching a
manager to reprint a torn receipt.

The page holds the guards and `ReceiptView` holds the content, mirroring `ChargePage`/`ChargeSummary`.
That split is not cosmetic: `use(params)` suspends, so a page-level test asserts against a Suspense
fallback instead of against the thing it is testing. Discovered by writing the test first.

**`useIssueReceipt` wraps a POST in a `useQuery`.** Issuing writes a `print_jobs` row, so it is a
POST — but every data-fetching screen here is required to use `QueryBoundary`, which takes a query
result. The wrap is only honest because of the idempotency key, generated **once per mount** in
`useState` (not `useMemo` — `useMemo` is a hint React may discard, and a discarded idempotency key
is a duplicate print job). Consequently TanStack's automatic retry, the error-state retry button and
any re-render all return the *same* issue. `staleTime: Infinity` and no refetch on focus, so tabbing
away from a printed bill and back does not add a phantom reprint to a customer's history.

**The Print bill control** sits at the end of the bill breakdown on `charge-summary.tsx`, where the
cashier's eye already is. It appears as soon as *something* has been paid rather than only when the
order is `CLOSED`: an order stays open until it is both fully paid **and** fully served, and a
customer asks for the bill at the moment they hand over money. It navigates; it does not print.

**No success toast anywhere.** `window.print()` has no completion callback, no failure signal and no
paper-out status (research §4.1). The only occurrence of the string `toast` in any file this task
touched is the comment explaining why there is none.

### Task 3 real command output

```
$ npm run test:run -- components/pos components/print
 Test Files  7 passed (7)
      Tests  38 passed (38)

$ npm run typecheck
(clean — 0 errors)

$ npm run lint
✖ 10 problems (0 errors, 10 warnings)     # the pre-existing baseline

$ grep -rn "toast" components/print/ .../receipt/ lib/hooks/pos/use-print-document.ts lib/repositories/print.repository.ts
components/print/receipt-view.tsx:19: * <p><b>No success toast, deliberately.</b> ...
```

`ReceiptView`'s four tests, the load-bearing one being **"renders an ERROR when the issue fails —
never an empty bill"**: on rejection the screen shows `role="alert"`, there is no `receipt-root`
anywhere, and `window.print` was never called. An empty bill is worse than an error message,
because the cashier hands it over.

### Task 3 deviations

**[Rule 2 — missing verification] Added `components/print/__tests__/receipt-view.test.tsx`.** The
plan's `files_modified` for task 3 lists no test file, but two of its acceptance criteria are
assertions ("the route renders for a settled order"; "a forced failure renders an error state, not
an empty document"). Shipping those unverified would have been the exact
structurally-present/behaviourally-absent shape this phase exists to escape.

**[Rule 3 — blocking] `ReceiptView` was extracted from the route file.** See above: `use(params)`
suspends. The extraction also matches the charge route's existing shape.

**Scope note:** `apiIssuedPrintDocumentSchema` was added to `lib/api-client/schemas/print.schema.ts`
(26-01's file) rather than to a new schema module. Layer-1 is where a wire shape belongs, and that
file is already the print wire contract.

## Hardware sign-off (U3) and open questions

1. **Whether a zero `@page` margin suppresses the browser's own header and footer** (URL, page
   number, date). Research §4.1 could not verify this against any primary document. The stylesheet
   is written to be correct if it does and legible if it does not — 3 mm of top padding keeps the
   branch name off the very edge either way. **This is a browser question, not a printer question:
   it needs a till and any printer, not an 80 mm thermal unit.** It is task 5 step 5.
2. **Whether 72 mm of content clears a real 80 mm thermal printer's unprintable margin.** Chosen
   conservatively; only paper can confirm it.

## Known stubs

- `FiscalRegion` renders "QR code unavailable" whenever a payload is present. Nothing populates a
  payload in this phase (26-03 leaves every fiscal field null), so this branch is reachable only
  from a test today. Phase 27 replaces it with a generator.

## Ownership note — a concurrent writer on this branch

During this run another agent committed to `phase-13-access-repair` and edited files underneath
this work: commits `378840e fix(37-01)`, `cb65573 test(36-01)`, `2be9ffa feat(34-01)`, plus an edit
to `frontend/vitest.config.ts` and an untracked, non-compiling
`frontend/__tests__/lib/money-display-authority.test.ts`.

The brief for this run stated that the other agents were planning phases 27–32 and that **none was
executing code**. That is not what happened. Consequences, stated plainly:

- Their `vitest.config.ts` edit merged cleanly with the one 26-01 made; both globs survive.
- Their test file is the **only** failing test file in the frontend suite
  (`1 failed | 78 passed`, `15 failed | 663 passed`), and the only source of typecheck errors.
  Nothing of phase 26's fails.
- Their 37-01 work is described as "the JVM had two money renderers and the wrong one won" — which
  is adjacent to 26-01's decision to introduce `ReceiptMoneyFormatter` as a deliberate second
  formatter for print. **These two pieces of work need to be reconciled by a human**, because one
  of them may be trying to consolidate exactly what the other deliberately separated.
