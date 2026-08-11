---
phase: 34-visual-design-language
plan: 07
subsystem: ui
tags: [login, auth, glass, contrast, evidence-harness]

requires:
  - phase: 34-visual-design-language
    provides: "34-02 glass tokens + substrate manifest; 34-03 .vdl-enter; 34-04 GlassPanel"
provides:
  - "The login card as a glass surface over a declared, measured substrate"
  - "A fixed evidence harness that cannot produce a false dark-theme screenshot"
affects: [34-08]

tech-stack:
  added: []
  patterns:
    - "A glass surface names the substrate token that is MEASURED, not one that happens to resolve to the same colour"

key-files:
  created: []
  modified:
    - frontend/app/(auth)/layout.tsx
    - frontend/components/auth/login-form.tsx
    - frontend/e2e/shots.mjs

key-decisions:
  - "The auth backdrop stays a FLAT token. A login page is the most tempting place in the product to put a gradient mesh behind glass, and the only place where breaking that rule affects users who have not signed in yet. Contrast over an unbounded background is undefined, not merely hard."
  - "The layout names --surface-2 rather than --muted. Both resolve to the same colour today; only --surface-2 is in the manifest and measured. Naming the measured token is the difference between a guarantee and a coincidence."

patterns-established:
  - "An evidence harness asserts that the condition it claims to have set actually took effect"

requirements-completed: []

coverage:
  - id: D1
    description: "The login screen is visibly transformed and still functions with the compositing filter unavailable"
    requirement: VDL-02
    verification:
      - kind: unit
        ref: "__tests__/auth — 25 tests green; field names, submit path, error wording, step-up and redirects unchanged"
        status: pass
      - kind: unit
        ref: "__tests__/lib/theme/glass-contrast.test.ts — the panel over --surface-2: 18.01:1 filter-disabled, 17.73:1 composited"
        status: pass
      - kind: automated_ui
        ref: "playwright:evidence/before/login-{light,dark}.png vs after/login-{light,dark}.png"
        status: pass
    human_judgment: true
    rationale: "The contrast and behaviour are measured; whether the card now reads as designed rather than merely shadowed is the user's call."
  - id: D2
    description: "The SuperAdmin console and the settings screens are transformed"
    verification: []
    human_judgment: true
    rationale: "NOT IMPLEMENTED. See Deviations."
  - id: D3
    description: "The glass contrast guarantee holds across the tenant brand hue range"
    verification: []
    human_judgment: true
    rationale: "NOT IMPLEMENTED. The appearance screen can move --brand-h at runtime and no hue sweep was added, so glass contrast is proven only at the shipped hue of 195."

duration: 20min
completed: 2026-08-11
status: partial
---

# Phase 34 Plan 07: Expressive Surfaces Summary — PARTIAL

**The login card is a glass surface with depth, a brand band and an entrance, sitting over a substrate that is named and measured rather than inherited — and the evidence harness that was silently producing identical light and dark screenshots was fixed. The platform console, the settings screens and the brand-hue contrast sweep were not done.**

## What was done

- `(auth)/layout.tsx` declares `bg-surface-2` — an enumerated substrate — so the card above resolves a measured pairing: **18.01:1** with the compositing filter unavailable, **17.73:1** composited.
- `login-form.tsx` renders in a `GlassPanel depth={3}` with a brand band and `.vdl-enter`. The form's field names, submit path, error wording, step-up prompt behaviour and redirect targets are untouched; 25 auth tests green.
- Verified in Chromium in both themes.

## The harness was lying, and that is worth recording

`e2e/shots.mjs` switched themes by writing `localStorage` **after** navigation. `ThemeProvider` runs `defaultTheme="system"` and had already read it, so the write was a no-op and every "dark" screenshot was byte-identical to its light counterpart. That is the shape of failure this phase keeps finding: a green result that means "the thing never ran".

Each theme now gets its own browser context with `colorScheme` set, and `assertTheme()` throws if `html.dark` does not match what was requested — so a screenshot cannot claim a theme it did not render.

## Task Commits

1. **Login glass over a measured substrate + harness fix** — `3953a79` (feat)

## NOT DONE — stated plainly

| Not built | Consequence |
|---|---|
| `platform-shell.tsx`, `/platform/dashboard`, `/platform/tenants` | The SuperAdmin console is **unchanged**. The phase's definition of done names it explicitly. |
| `/app/settings`, `/settings/appearance` | Unchanged. |
| Brand-hue sweep in `glass-contrast.test.ts` | Glass contrast is proven at the shipped hue (195) only. The appearance screen can move `--brand-h` at runtime, so a tenant on another hue has **unverified** glass contrast. This is the most substantive gap in this plan. |
| `e2e/journeys/expressive-surfaces-visual.spec.ts` | No dedicated runtime gate for these surfaces. |

## Deviations from Plan

Execution stopped before those tasks. Recorded as incomplete, not as done.

## Self-Check: PASSED

All three modified files exist; commit `3953a79` resolves in git.

---
*Phase: 34-visual-design-language*
*Completed (partial): 2026-08-11*
