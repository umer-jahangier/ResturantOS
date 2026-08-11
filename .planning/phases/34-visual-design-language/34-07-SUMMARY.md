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
    verification:
      - kind: automated_ui
        ref: "e2e/shots-owner.mjs -> evidence/after-34/settings-{light,dark}.png and appearance-{light,dark}.png, captured as the OWNER with a forbidden-condition check so a refusal cannot be filed as evidence"
        status: pass
      - kind: e2e
        ref: "e2e/journeys/expressive-surfaces-visual.spec.ts — /app/settings in both themes, filter forced off, axe clean"
        status: pass
    human_judgment: true
    rationale: "The platform console was restyled in the breadth commit and is captured by e2e/shots.mjs, but its shots were taken by the SuperAdmin persona and are not re-verified here. Whether the treatment reads as designed is the user's call."
  - id: D3
    description: "The glass contrast guarantee holds across the tenant brand hue range"
    verification:
      - kind: unit
        ref: "__tests__/lib/theme/glass-hue-sweep.test.ts — 0-355 deg at 5 deg steps, both themes, both conditions; worst case 5.34:1 at 125 deg; three assertions bound app/api/theme/route.ts to the --primary ramp"
        status: pass
    human_judgment: false
  - id: D4
    description: "A semantic tint's text stop clears AA in BOTH themes"
    verification:
      - kind: unit
        ref: "__tests__/components/state-character.test.tsx — the appearance warning notice measured per theme; negative control observed red at 1.21:1"
        status: pass
    human_judgment: false

duration: 20min + 35min (second session)
completed: 2026-08-12
status: complete
---

# Phase 34 Plan 07: Expressive Surfaces Summary

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

## Completed in a later session, and what the harness was hiding (2026-08-12)

The console and settings were restyled in the breadth commit `eb1d5bd8`, and the brand-hue
sweep landed in `24220280`. What had never happened was **looking at the settings screens**.

`e2e/shots.mjs` signs in as `manager@terrace.local`. That persona does not hold `rbac.manage`,
so every settings screenshot this phase has on file is a picture of an **Access-denied page**,
filed as evidence that the settings restyle landed. The same harness cannot reach the owner
dashboard's chart at all, because the manager preset does not contain one.

`e2e/shots-owner.mjs` signs in as the OWNER — which needs a TOTP code, which is why the manager
was used in the first place — and asserts **two** conditions per route: something that must be
present, and a pattern whose presence means the shot would be a lie. "Access denied" renders
perfectly well, and a harness with no forbidden condition files it happily.

Run that way, in a real browser, in both themes, it found two things.

### One — `/settings/appearance` was never restyled

It rendered as an untreated page with a horizontal rule for structure, while the screen that
links to it had depth. It was inheriting `restrained` from the back-office shell — the shell's
correct default, and not what D-34-02's table assigns this screen. It now declares the
expressive zone and its form sits on a `Card` at depth 2. No control, no preset, no persistence
key and no validation rule changed; `AppearanceForm`'s logic is untouched.

### Two — its warning notice was unreadable in dark, at 1.21:1

`--warning-foreground` is the stop for text on a **solid** warning fill; in dark it resolves to
`--neutral-1000`, and on `bg-warning/10` over the card that measures **1.21:1**. That is not a
contrast, it is camouflage. Light measured 17.74:1, which is exactly why it survived — the
defect is invisible in the theme people develop in, and the same class list is correct in one
theme and unreadable in the other. Now `text-foreground`: **17.74:1 light, 15.94:1 dark**. The
semantic channel is not lost, because the border, the tint and the icon all still say "warning"
and §40's rule is that colour is never the only channel.

The gate generalises it: any notice pairing a `/NN` semantic tint with a text stop is measured
in **both** themes, with the class list read out of the shipped source rather than restated in
the test. Negative control observed red, reporting the 1.21:1 figure in its message.

### The brand-hue sweep, and the correction that came with it

Swept 0–355° at 5° steps, both themes, both filter conditions. **Worst case 5.34:1 at hue 125°**
— the same `light / panel / --foreground-tertiary over --surface-3` pairing that binds
everywhere else, because every glass input is authored at near-zero chroma.

It is a **build-time** guarantee, not a runtime guard, and the earlier claim that "a tenant can
pick a hue that silently drops text below AA" was wrong. `app/api/theme/route.ts` emits exactly
thirteen declarations, all `--primary-*`; no glass input resolves through the primary ramp, so a
tenant cannot move a single figure in the table. Three assertions fail if that route's scope
ever widens.

### Still not done

`/platform/dashboard` and `/platform/tenants` were restyled and are captured by `e2e/shots.mjs`
as the SuperAdmin — those shots are genuine, since that persona *can* reach the console — but
the console was **not** re-verified in this session and is not covered by the new runtime gate.
The onboarding surface named in 34-CONTEXT does not exist in the codebase and was not treated.

## Task Commits

1. **Login glass over a measured substrate + harness fix** — `3953a79` (feat)
2. **Console, settings and the four data states** — `eb1d5bd8` (feat)
3. **Brand-hue sweep + the runtime-claim correction** — `24220280` (test)
4. **The owner harness, the appearance restyle, the contrast fix** — `391149d6` (fix)
5. **The expressive-surfaces runtime gate** — `56fe3bbd` (test)

## Self-Check: PASSED

All modified and created files exist; the five commits resolve in git.

---
*Phase: 34-visual-design-language*
*Completed (partial): 2026-08-11*
