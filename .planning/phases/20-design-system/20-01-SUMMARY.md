---
phase: 20
plan: "01"
slug: design-system-foundation
subsystem: frontend
status: complete
completed: 2026-08-07
branch: phase-13-access-repair
implements: UI-SPEC.md §1 (prerequisite), §3, §3.8, §7.4 wiring bug, §4.2 dead links, §10.2 steps 0 and 2, §10.3 gates 2 and 3
implements_decisions:
  - D-UI-01
commits:
  - 53b42e3 fix(frontend): widen the layer-boundary rule to app/**, where the revamp lands
  - b006e54 feat(design-system): the Phase 20 token layer, measured — plus the four confirmed defects
---

# Phase 20 Plan 01 — Design-system foundation

The OKLCH token layer regenerating from one hue variable, its 53 measured contrast
pairings turned into an executable test, the four confirmed defects fixed, and the nav
permission matrix frozen — with three spec claims corrected because they did not survive
the renderer.

**Scope discipline:** foundation only. Not one screen was rebuilt; the concurrent E2E
harness is written against screens that still exist. Where a screen looks different, it
is because a token moved, which is the point of step 2.

---

## 1. What shipped

### Step 0 — the blocking architecture fix (commit `53b42e3`)

`eslint.config.mjs` scoped `no-restricted-imports` to `components/**`. `app/**` is the
other half of Layer 4 and was uncovered, which is why
`app/(tenant)/app/purchasing/invoices/page.tsx:8` and `.../purchase-orders/page.tsx:8`
had been importing Layer 1 directly with lint green. Rule widened to
`["components/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"]`, ignoring `app/api/**` — route
handlers are server-side Layer 1/2 by definition and `app/api/theme/route.ts`
legitimately calls the palette generator.

It caught exactly the two known violations and nothing else. Both fixed with the
established escape-hatch pattern (`@/lib/errors`, per `docs/finance-eslint-backlog.md`
Issue 1): `PO_STATUSES` / `INVOICE_STATUSES` and their types moved to
`lib/models/purchasing-status.ts`, a leaf module that imports nothing, and the Layer-1
schema re-exports them so every existing Layer-1/2/3 import resolves unchanged.

### Step 1 — the token layer (`app/globals.css`)

Every colour is `oklch(L C var(--brand-h))` or an explicit semantic hue. **There is no
hex literal in the file**, and a test asserts there never will be — D-UI-01 says "do not
hard-code hex values throughout", and one hex is one token that has silently stopped
regenerating.

Landed: primary ramp (11 stops), neutral ramp (13, carrying the brand hue at C ≤ 0.010),
four semantic ramps (44 stops), five CVD-verified chart series per theme, the sequential
and diverging ramps, the full role-token set for both themes, the two-tier border split,
`--radius: 0.5rem`, four elevation levels, the motion scale, the z-index scale, and the
`[data-surface="kds"]` block.

Every L/C pair was **re-derived from the spec's own formulae** with the repo's
`colorjs.io` (hold L and H, bisect C to the sRGB gamut) before being written. All 11
primary, all 13 neutral and all 44 semantic stops reproduce the spec's hexes exactly.

Two deliberate deviations from the spec's literal instruction, both recorded in the file:

| Spec said | What shipped | Why |
|---|---|---|
| Bridge the type scale (`--text-sm: 13px`, …) into `@theme` | Declared in `:root` as plain custom properties, **not** bridged | Tailwind owns the `--text-*` namespace. `--text-sm: 13px` inside `@theme` silently re-typesets every one of ~700 `text-sm` call sites across 53 routes — a screen rewrite wearing a token's clothes. The bridge belongs to step 4 (PageHeader/PageBody), surface by surface. |
| Delete `.touch-target` | Kept | It is deleted "once Button/Input carry real `touch`/`pos` sizes" (§5.3). Those sizes are step 3. Deleting it now shrinks the shell's touch targets below SC 2.5.5. |

One token was **added** that the spec does not define — see §3 below.

### Step 2 — the contrast table as a test

`__tests__/lib/theme/design-tokens.test.ts` (142 assertions) parses the **shipped**
`app/globals.css`, brace-matches the three token blocks, resolves each name through its
`var()` chain to a literal `oklch(...)`, and re-measures every §3.8 pairing with the
repo's existing `wcagContrastCheck`.

It reads the stylesheet rather than a TypeScript fixture on purpose: a fixture drifts,
and the table would keep passing while the shipped CSS quietly regressed.

Two assertions per row, because they catch different failures:

1. the ratio clears the floor for the level the spec claims — a real a11y gate;
2. the ratio still **equals** the number the spec records (±0.02) — a drift gate that
   fails on any token edit at all, including one that stays legal.

Expectations are written out literally rather than captured with `toMatchSnapshot`; a
snapshot that `vitest -u` rewrites on demand is not a gate, it is a diary.

Also asserted: the D-UI-01 regenerability contract (every hue-parameterised token
literally contains `var(--brand-h)`; `--brand-h` declared exactly once; no hex anywhere
in any token block), the two-tier border split, chart-series contrast against both page
surfaces, the sequential ramp's cell-label ratios, role-token wiring in both themes, and
that every role a component can name is defined in **both** themes.

### Step 3 — the four defects

| # | Defect | Fix |
|---|---|---|
| 1 | `data-table.tsx:65` called `table.getFilteredRowModel()` with the model never registered. TanStack falls back to the core row model rather than throwing, so filtering could never work and "Showing 1–N of N" reported the **unfiltered** total. | Registered `getFilteredRowModel`, plus an optional `columnFilters` prop (additive, defaults to none — the same contract §7.4 mandates and the file already documents for `rowClassName`) so the fix is observable rather than latent. Also added the missing `scope="col"` (§9.3). |
| 2 | `:focus-visible` used `ring` (a box-shadow). | Now `outline: 2px solid var(--ring); outline-offset: 2px` in `@layer base`, and the ring removed from 31 files. **The spec's stated reason was wrong** — see §3. |
| 3 | `input.tsx` border was `border-input` = `oklch(0.922 0 0)` — **1.23:1**, a flat SC 1.4.11 failure on every text field in the product. | `--input` now points at `--border-interactive` (**3.77:1** light / **3.48:1** dark), which fixes all ~28 `border-input` call sites at once. `input.tsx` names `border-border-interactive` explicitly. The `bg-input/*` states that abused the same token as a *fill* now name a surface, in `input.tsx` and in Button's `outline` variant. |
| 4 | `mobile-bottom-nav.tsx:51` → `/app/settings`; `top-bar.tsx` → `/settings/profile` and `/app/settings`. None exist; `sidebar-nav-items.ts:334,348` has marked them `comingSoon: true` all along. | The bottom bar now computes visibility with `useNavGroupVisibility` — the sidebar's own guard — so `comingSoon`, `roles`, `permission` and `feature` all apply to it identically. Its fifth tab points at `/settings/appearance`, the only settings surface that exists, role-gated exactly as its sidebar twin is. The profile menu and `NAV_COMMANDS` offer the same one real destination instead of two 404s. |

Defect 4's guard swap is behaviour-preserving for the four pre-existing items (same
permission codes, same fail-open-on-feature-error), and adds the two gates the bottom bar
never had.

### Step 4 — the permission matrix

`__tests__/shared/nav-permission-matrix.test.tsx`: six role fixtures (OWNER,
TENANT_ADMIN, MANAGER, ACCOUNTANT, CASHIER, KITCHEN_STAFF, drawn from
`scripts/CREDENTIALS.md`) × the full nav config, each recording the exact ordered set of
groups and items. Plus the feature axis (a tenant without `FEATURE_CRM`, a group whose
only feature is off, a feature-flags outage failing open) and a sweep asserting no role
ever sees a route without a `page.tsx`.

It asserts `useNavGroupVisibility` — what `Sidebar` calls and what `MobileBottomNav` now
calls. Whatever renders the nav after the revamp must route through it and produce these
sets unchanged.

One finding worth recording: **TENANT_ADMIN's nav is currently identical to OWNER's.**
Not a bug — the two items `rbac.manage` would unlock are `comingSoon`, so the difference
is invisible today. The test states this explicitly so that when `/app/settings/users`
ships, that assertion is what forces the split.

---

## 2. Proof the gates bite

Both new tests were verified by breaking the thing they guard, then restoring.

**Contrast gate.** Moved `--primary-700` to `--primary-600`'s lightness — the exact
"a designer reaches for 500 or 600" error §3.1 warns about:

```
 × white on --primary-700 (solid button)
 × --primary-700 link on surface-0
 × Send button: white on --primary-700
 × solid fills stay legible against their own foreground in both themes
AssertionError: --neutral-0 on --primary-700 must clear AA (≥4.5:1): expected 3.67 to be greater than or equal to 4.5
      Tests  4 failed | 133 passed (137)
```

**DataTable gate.** Removed the `getFilteredRowModel` registration:

```
 × applies a column filter — impossible before getFilteredRowModel was registered
 × counts the FILTERED rows in the footer, not the unfiltered total
 × paginates over the filtered set, not the raw set
AssertionError: expected 5 to be 3
      Tests  3 failed | 2 passed (5)
```

Five rows on screen, three rendered — the reported defect, reproduced.

**Permission matrix.** Relaxed Till Review from `pos.till.review` to `pos.order.view`,
the classic revamp mistake:

```
 × CASHIER sees POS and the dashboard — nothing else
+       "Till Review",
      Tests  1 failed | 9 passed (10)
```

---

## 3. Where the spec did not survive the renderer

Three corrections, all measured, all written back into `UI-SPEC.md` rather than absorbed.

### 3.1 "`outline` is never clipped" is false

§3.9 and §9.1 justified the focus change with: *"`ring` is a `box-shadow`, which is
clipped by any `overflow: hidden` ancestor … `outline` is never clipped."*

Measured in Chromium 1228 by pixel-sampling a screenshot 3px outside the container:

```
id  overflow  indicator | pixel 3px OUTSIDE the container | verdict
c1  hidden    ring      | rgb(255,255,255)   | CLIPPED
c2  hidden    outline   | rgb(255,255,255)   | CLIPPED
c3  auto      ring      | rgb(255,255,255)   | CLIPPED
c4  auto      outline   | rgb(255,255,255)   | CLIPPED
c5  visible   ring      | rgb(0,149,149)     | PAINTED (not clipped)
c6  visible   outline   | rgb(0,149,149)     | PAINTED (not clipped)
```

**No difference.** An outline is clipped by `overflow: hidden` and by `overflow: auto`
exactly as a box-shadow is.

The change is still right, for two reasons that were measured instead of assumed:

```
forced-colors: none
  ring     4px-outside=rgb(0,149,149)    canvas-ref=rgb(255,255,255)  -> indicator painted
  outline  4px-outside=rgb(0,149,149)    canvas-ref=rgb(255,255,255)  -> indicator painted
forced-colors: active
  ring     4px-outside=rgb(255,255,255)  canvas-ref=rgb(255,255,255)  -> NO INDICATOR
  outline  4px-outside=rgb(0,0,0)        canvas-ref=rgb(255,255,255)  -> indicator painted
```

Under **Windows High Contrast the box-shadow vanishes entirely** — indistinguishable
from the canvas — while the outline is preserved and repainted in the system colour.
Every keyboard user in HCM had **no focus indicator anywhere in this product**. That is
the serious one.

Second, on a **selected row**:

```
kind     | 2px outside the control (ring-offset territory) | 4px outside
ring     | rgb(255,255,255)                                | rgb(0,149,149)
outline  | rgb(237,250,250)                                | rgb(0,149,149)
```

`ring-offset-background` paints an **opaque page-background band**: on a `--primary-50`
row (rgb 237 250 250) it renders rgb(255 255 255), punching a white notch through the
selection tint. §5.1 requires `selected` and `focus-visible` to read simultaneously; with
the ring they cannot. With `outline-offset` the gap is transparent and the tint shows
through.

**Consequence carried forward:** because the outline *is* clipped, focus movement inside
the DataGrid, the POS tile grid and the KDS board must call
`scrollIntoView({ block: "nearest" })`. That is now a requirement in §9.1, not a nicety.

### 3.2 The `selected` state had no dark theme — 1.02:1

§5.1, §7.4 and §11 all write the selected row as "`--primary-50` fill + `--primary-600`
left border", with "(light)" as the only hint that a second case exists. `--primary-50`
is a **ramp stop, not a role token**: it stays near-white when `.dark` is on. Applied
literally it puts `--foreground` (`--neutral-50`) on `--primary-50` — **measured
1.02:1**. The selected row is invisible at night.

Found by rendering the token layer, not by reading it. Replaced with a role triple,
defined in both themes:

| Token | Light | Dark |
|---|---|---|
| `--selected` | `--primary-50` | `--primary-950` |
| `--selected-foreground` | `--neutral-950` — **17.96:1** | `--neutral-50` — **14.58:1** |
| `--selected-border` | `--primary-600` — **3.44:1** on the fill | `--primary-400` — **7.79:1** on the fill |

Nothing consumes it yet (no selected-row implementation exists), so it is purely
additive — and it means step 7 cannot reintroduce the bug.

### 3.3 Three KDS hexes were annotation drift

§3.7's `--kds-surface` / `--kds-card` / `--kds-card-focus` read `#0a0e0e` / `#161b1b` /
`#1f2525`. Re-derived from the OKLCH in the same table they are `#080c0c` / `#151a1a` /
`#202626` — the old values sat about 0.008 L high. The **OKLCH is authoritative** (it is
what ships), every measured ratio still reproduces exactly, so no contrast claim moves.
The other six tokens were exact.

### 3.4 Measurement basis, documented

All 53 §3.8 ratios were computed from the **unquantised OKLCH**, not from the 8-bit hex
beside it. Every one reproduces to the last digit that way; measuring the rounded hex
drifts by up to 0.07 (`--neutral-1000` on `--primary-400`: 10.27 from OKLCH, 10.34 from
`#57cbca`). The test measures the OKLCH accordingly — which is also what ships, since
the browser renders `oklch()` at display precision.

### 3.5 The tenant brand override has no hue guard (new open item)

§2.3 lets a tenant drive `--brand-h`, `--chart-1` and `--seq-*` while `--chart-2..5` stay
pinned. Rendering at `--brand-h: 275` shows the cost: `--chart-1` walks toward the fixed
`--chart-3` (hue 262). ΔE2000 under **normal vision** as the brand hue moves:

| `--brand-h` | 195 | 220 | 240 | 250 | **262** | 275 | 290 | 310 | 340 |
|---|---|---|---|---|---|---|---|---|---|
| ΔE2000 vs `--chart-3` | **35.5** | 26.6 | 19.5 | 17.1 | **15.8** | 16.8 | 20.6 | 27.0 | 34.6 |

It never fully collapses — chroma and lightness keep them apart even at the same hue —
but §3.4's published guarantee (min ΔE **17.3** deuteranopia, **16.1** protanopia) was
*solved at hue 195* and does not survive an arbitrary tenant hue; at 240–290 the
normal-vision figure is already below both. The theme route must band the accepted hue or
re-solve `--chart-2..5` per tenant. Dichromat ΔE across the hue circle was **not**
computed — only normal vision — so the guard band is a floor, not a proof. Filed as open
items 8 and 9.

---

## 4. Rendered evidence

`evidence/20-01-tokens-{light,dark,hue275}.png` — the shipped token blocks extracted from
`globals.css` and rendered by Chromium at 2× DPR: full ramps, a button row, a focused
field, a card with a selected table row, and the KDS ageing strip.

`hue275` is the D-UI-01 proof: **one variable changed**. The primary ramp, the neutral
ramp, the sequential ramp, `--chart-1`, the focus ring, the selected-row fill and border
and every KDS surface all move; the four semantic ramps and `--chart-2..5` hold, exactly
as the contract requires. Green stays the colour of a fresh ticket and red stays the
colour of a late one, whatever the tenant picks.

---

## 5. Gates — real output

Run from the repo root with `ci.yml`'s exact commands.

```
$ pnpm --dir frontend run lint
✖ 9 problems (0 errors, 9 warnings)

$ pnpm --dir frontend exec tsc --noEmit
(no output)

$ pnpm --dir frontend run format:check
[warn] e2e/fixtures/isolation.ts
[warn] e2e/fixtures/observability.ts
[warn] e2e/journeys/role-visibility-matrix.spec.ts
[warn] e2e/journeys/superadmin-tenant-lifecycle.spec.ts
[warn] e2e/journeys/tenant-admin-user-provisioning.spec.ts
[warn] pnpm-lock.yaml
[warn] Code style issues found in 6 files.
```

- **lint: PASS.** 0 errors. The 9 warnings are the expected TanStack Table and
  react-hook-form React-Compiler notices; CI runs plain `eslint`, which does not fail on
  warnings.
- **tsc: PASS.** Clean.
- **format:check: fails on 6 files, none of them mine.** Five are in `frontend/e2e/` and
  one is `pnpm-lock.yaml` (regenerated by an install, so it lost its prettier
  formatting) — all in-flight from the concurrent E2E work, all outside my scope.
  Scoped to everything I touched it is clean:

```
$ cd frontend && pnpm exec prettier --check app components lib __tests__ mocks
Checking formatting...
All matched files use Prettier code style!
```

**Test suite:**

```
$ pnpm --dir frontend run test:run
 FAIL  __tests__/auth/login-form.test.tsx > LoginForm > logs in a non-privileged user and redirects to /app/dashboard
 FAIL  __tests__/auth/login-form.test.tsx > LoginForm > reveals the TOTP field on TOTP_REQUIRED and succeeds on resubmit (FD-2)
 FAIL  __tests__/lib/session.repository.test.ts > SessionRepository > login() returns a camelCase Session
 Test Files  2 failed | 65 passed (67)
      Tests  3 failed | 563 passed (566)
```

Baseline before this work was 409 passing; this plan adds 157. The 3 failures are the
concurrent auth change landing under me — a `ZodError` for a newly-required token field
absent from the MSW mock, and `error.isTotpRequired is not a function` (a new `ApiError`
method). Nothing token-, focus-, nav- or table-related. Their files were not touched.

---

## 6. Deviations from the brief

| Rule | What | Why |
|---|---|---|
| Rule 2 (missing critical functionality) | Added `--destructive-foreground` | Five call sites use `text-destructive-foreground`; the token was **never defined** and not bridged, so those five rendered inherited text on a solid red fill. Defining it in both themes fixes all five. |
| Rule 2 | Added `--selected` / `--selected-foreground` / `--selected-border` | §3.2 above — the spec's rule is illegible in dark mode. |
| Rule 2 | Added `scope="col"` to `data-table.tsx` headers | §9.3 calls it "currently missing everywhere". One word, zero visual risk, and the DataTable was already open. |
| Scope call | Swept the ring from 31 files, not just the two primitives | The base-layer outline is overridden by any element carrying `outline-none`, which 47 call sites did. Fixing only Button and Input would have left every filter control in the app — the scroll-container case the defect is about — still on the clipped indicator. The replacement is one mechanical string per pattern. |
| Scope call | Did **not** change the light-theme outline-button border | `border-border` on an outline button measures 1.23:1 — the same 1.4.11 class as the input defect, but not one of the four named. Left for step 3 with Button's `touch`/`pos` sizing. Recorded below. |

**One unavoidable overlap:** commit `53b42e3` also carries the concurrent agent's
`e2e/**` `react-hooks` override, which was already uncommitted in the working tree. Git
cannot split a file, and the widened rule needs that override to stay green.

---

## 7. Carried forward

1. **Step 3 (Button/Input sizing).** `touch: h-11` / `pos: h-14`, the `touch` hit-area
   variants for Checkbox/Switch/RadioGroup, then delete `.touch-target`.
2. **Outline-button border**, light theme: `border-border` = 1.23:1. Should be
   `--border-interactive`.
3. **Dark `bg-destructive` + `text-white`.** Now that `--destructive-foreground` exists,
   the remaining hand-written `bg-destructive text-white` sites should name the token.
4. **The type-scale bridge** into `@theme`, with step 4's PageHeader/PageBody.
5. **`scrollIntoView({block:"nearest"})`** on DataGrid / POS-grid / KDS focus movement —
   see §3.1. Genuinely required, not cosmetic.
6. **`aria-invalid:ring-*`** still uses box-shadow on Input and Button. Not the focus
   bug, but the same forced-colors weakness; fold into step 3.
7. **Two `:focus` (not `:focus-visible`) ring sites** remain in `station-board.tsx` and
   `customer-picker.tsx`. Deliberate always-on treatments on KDS/CRM surfaces; step 12
   and the CRM conversion own them.
8. **`--seq-*` / `--div-*` have no dark values** (open item 10). Acceptable for a heatmap
   fill — the §3.5 contract is the cell *label*, which holds in both themes — but
   re-measure when charts land at step 13.
9. **Tenant hue guard** (open items 8 and 9) — §3.5 above.

---

## Self-Check: PASSED

Files claimed and verified on disk:

- `frontend/app/globals.css` — FOUND
- `frontend/lib/models/purchasing-status.ts` — FOUND
- `frontend/__tests__/lib/theme/css-tokens.ts` — FOUND
- `frontend/__tests__/lib/theme/design-tokens.test.ts` — FOUND
- `frontend/__tests__/components/ui/data-table.test.tsx` — FOUND
- `frontend/__tests__/shared/nav-permission-matrix.test.tsx` — FOUND
- `.planning/phases/20-design-system/evidence/20-01-tokens-{light,dark,hue275}.png` — FOUND

Commits verified in `git log`: `53b42e3`, `b006e54`.

No stubs. No placeholder values. Every number in this document was produced by a command
whose output is quoted above.
