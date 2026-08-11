# Phase 38 — ERP Design Transformation · CONTEXT

## Why

`.planning/DESIGN-BRIEF.md`, given by the product owner on 2026-08-12: a complete professional
UI/UX transformation of the Restaurant ERP, preserving every piece of existing functionality. 71
sections plus a 9-point appendix of constraints this codebase learned the hard way.

The brief's step 1 is an audit. It is done: `38-AUDIT.md`, measured against the live stack in
Chromium at four widths in both themes, with 56 screenshots and four computed-style probes.

The brief's steps 2–4 — tokens, layout vocabulary, component primitives — were delivered by
**phase 20** (OKLCH scales, 53 measured contrast pairings) and **phase 34** (richness zones, glass
and depth measured under both deployment conditions, motion vocabulary, surface primitives). This
phase delivers steps 5–20 on top of them.

---

## Locked decisions

### D-38-01 — This phase extends the phase-20/34 vocabulary. It does not start a second one.

Every token, zone, glass weight, depth level and motion class already exists and is measured.
Phase 38 adds **no** new colour token, **no** new glass weight, **no** new depth level and **no**
new motion duration. Where a screen needs a treatment that does not exist, the answer is that the
screen is wrong, not that the system is short.

The one exception is stated in D-38-02, and it is a bridge, not a new value.

### D-38-02 — The type and space scales get bridged, and that is the first plan.

`globals.css:526-533` declares the eight type roles and seven space steps and then deliberately
withholds them from `@theme`, because bridging would re-typeset ~700 call sites at once. The
audit measured the consequence: **986 Tailwind type-scale classes against 1 contract-token class**,
and `--text-body` rendering on 22 nodes product-wide.

That trade was correct when it was made and has now expired — it is the reason every later plan
would otherwise re-open the same argument screen by screen. The bridge lands first, behind
`PageHeader` / `PageBody`, with a conformance gate. Nothing downstream is planned on the
assumption that call sites migrate themselves.

### D-38-03 — Sequence by operational value, not by the brief's numbering.

The brief's implementation order (§66) is dashboard → POS → orders → KDS. A restaurant loses money
when the POS and the KDS are wrong, and loses nothing when the dashboard is plain. Foundations
first because everything compounds on them; then POS and KDS; then back office; then cross-cutting
quality. The brief itself supports this: §15 *"speed > decoration"*, §65's priority order puts
functionality and usability above visual polish, and §31 forbids aggressive 3D on exactly the
operational surfaces.

### D-38-04 — Richness is zoned, and the zoning is already law.

| Zone | Screens | This phase's licence |
|---|---|---|
| `expressive` | dashboards, reports, SuperAdmin console, onboarding, login, settings | glass, depth, entrance and hover motion — spend here |
| `restrained` | admin CRUD, lists, forms, menu management | elevation and ≤150 ms transitions; no decorative motion |
| `operational` | POS terminal, KDS/BDS board | depth cues only. No `backdrop-filter`, no entrance animation, no parallax, no tilt |

Say which screens get richness and which get restraint **in the spec**, per screen, with the
reason. An executor under deadline does not violate this by putting glass on the POS; they violate
it by putting glass on a shared `Card` the POS imports, or on shell chrome that renders above it.

### D-38-05 — Modal backdrop blur is not a phase-38 deliverable.

Brief §29 asks for backdrop blur on modals. Measured today, `[data-slot="dialog-overlay"]` reports
`backdrop-filter: none` under the tenant shell. **That is the system working, not a gap.** 34-02's
glass rule is keyed on the overlay's own `data-zone`, and the tenant shell is `restrained` because
its chrome composites over the POS and the KDS. A modal opened from an expressive surface may take
overlay glass; a modal opened from a list may not. Adding blur globally re-creates the defect
34-01 removed.

### D-38-06 — Role-aware UX means the workflow, not the button list.

The backend already gates by role and `nav-permission-matrix.test.tsx` freezes it. Brief §46 asks
for something different: the interface *designed around each role's workflow*. That means the
landing surface, the default density, the primary action and the information ordering differ per
role — not that a manager sees eleven sidebar rows and a cashier sees three. Concrete per-role
contracts belong in the spec.

### D-38-07 — Every visual gate is watched failing before it is trusted.

Six gates in phase 34 alone passed against known-broken code, including the positive control,
which had been *skipping* rather than passing for weeks. `SURFACE-MOTION-SPEC.md` §7 catalogues
all five. Every gate this phase adds carries its negative control **recorded as observed** in its
own docblock: break it on purpose, watch it go red, restore it. An assertion nobody has watched
fail is not evidence.

Corollary the audit itself had to obey: a screenshot taken while a backing service is 503 is not
evidence either. Capture harnesses assert the absence of an error box, and say so when they
cannot.

### D-38-08 — Real data, and no facade over missing backends.

Floating Terrace, branch F-7, real orders, real takings, a real `Rs 36,730.95` till variance, a
real `-2987 KG` of chicken. Specs and screenshots use them. Where a brief item needs backend work
that does not exist — KPI comparisons, floor-plan occupancy, the notification centre, the activity
timeline — the spec says so and the phase does not build a shell that displays nothing.
`38-AUDIT.md` §12 is the list.

### D-38-09 — The appendix constraints are preserved, and re-proved per route with a print path.

`transform` / `filter` / `backdrop-filter` on leaf surfaces only, never layout ancestors.
`position: fixed` survives on the receipt path. Print output verified by rendering a real PDF and
extracting its text, never by reading CSS. `@page size` never `<length> auto`. Money is BIGINT
paisa through the one formatter. Never import across the four ESLint-enforced layers.
`npm run lint && npx tsc --noEmit` alongside `npm test`, because Vitest does not typecheck.

Measured today and to be kept true: **0 containing-block creators and 0 running animations on the
POS route.**

### D-38-10 — Nothing here changes behaviour.

Presentation and interaction only. No endpoint, calculation, permission, validation rule, route or
workflow changes. Where a screen is wrong because its data is wrong, the audit records it and the
phase does not paper over it.

---

## Claude's discretion

- Exact component API shapes for `PageHeader`, `PageBody`, `DataGrid`, `FilterBar`, `ConfirmDialog`.
- Which of the 37 hand-rolled tables migrate in which plan, and the migration order.
- Responsive strategy per screen family, within the declared breakpoint set.
- Which micro-interactions earn their place, inside the zone rules.
- How the KDS station-count chips are re-laid-out to stop colliding.

## Deferred — not this phase

- Migrating raw `<select>` to the shared `Select`, live field validation, server-error→field
  mapping. **Phase 35 owns this** (D-35-01…05; plans `35-06`…`35-14` written, unexecuted).
- Inventory data correctness (negative stock, negative valuation).
- The `Performance.measure` TypeError on `/app/finance`.
- Removing `framer-motion` from `package.json` (orphaned by 34-03; `dependency-budget.test.ts`
  will fail if it is removed without updating the baseline in the same commit, deliberately).

---

*Phase 38 — ERP Design Transformation. Written 2026-08-12.*
