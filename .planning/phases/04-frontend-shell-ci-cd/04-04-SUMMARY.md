---
phase: 04-frontend-shell-ci-cd
plan: 04
subsystem: frontend-design-system
tags: [tailwind4, oklch, css-tokens, a11y, wcag, framer-motion, cmdk, tanstack-table, colorjs]
status: complete
completed: "2026-06-26"
duration: "~20 minutes"

dependency-graph:
  requires:
    - 04-01 (Next 16 shell, globals.css base tokens, ESLint boundaries)
    - 04-02 (BranchSwitcher, PermissionGuard, FeatureGuard established)
    - 04-03 (CI/CD pipeline green; pnpm + build gates confirmed)
  provides:
    - Semantic state tokens (warning/success/info + fg) in OKLCH — Tailwind utilities bg-warning, text-success, etc. available
    - 6 named keyframes + animation CSS custom props registered in @theme inline
    - .skeleton shimmer class + prefers-reduced-motion suppression
    - :focus-visible ring + .touch-target 44px base utilities
    - WCAG-AA contrast validator (colorjs.io OKLCH→sRGB luminance)
    - ThemeToggle component (light/dark/system cycle, SSR-safe)
    - StatusAnnouncer aria-live="polite" region + useStatusAnnouncer hook
    - All gap-closure runtime deps: framer-motion, cmdk, react-countup, @tanstack/react-table, colorjs.io
  affects:
    - 04-05 (recharts charts — can now use bg-success/warning/info tokens)
    - 04-06 (data-tables with @tanstack/react-table now installed)
    - 04-07 (Top Bar mounts ThemeToggle; animation keyframes available for motion)
    - 04-08 (tenant theming uses wcagContrastCheck for colour validation)

tech-stack:
  added:
    - framer-motion@12.41.0
    - cmdk@1.1.1
    - react-countup@6.5.3
    - "@tanstack/react-table@8.21.3"
    - colorjs.io@0.6.1
  patterns:
    - Tailwind 4 CSS-first @theme inline for semantic colour registration
    - OKLCH colour tokens for perceptual uniformity across themes
    - useSyncExternalStore for SSR-safe mounted detection (no useEffect setState)
    - colorjs.io Color class for WCAG luminance computation

key-files:
  created:
    - frontend/lib/theme/wcag-validator.ts
    - frontend/components/ui/theme-toggle.tsx
    - frontend/components/ui/status-announcer.tsx
  modified:
    - frontend/package.json (5 new deps)
    - frontend/pnpm-lock.yaml
    - frontend/app/globals.css (semantic tokens, keyframes, skeleton, a11y, reduced-motion)

decisions:
  - id: "04-04-A"
    summary: "useSyncExternalStore for SSR mounted check instead of useEffect setState"
    detail: "Project ESLint rule react-hooks/set-state-in-effect prohibits direct setState in effects. Used useSyncExternalStore(noop, () => true, () => false) — returns false on server and true on client, enabling hydration-safe ThemeToggle without triggering the rule."
  - id: "04-04-B"
    summary: "OKLCH token values for warning/success/info approximate DS doc HSL intent"
    detail: "Design system doc specifies amber/green/blue in HSL. Converted to OKLCH for perceptual uniformity: warning≈oklch(0.795 0.184 86°) amber, success≈oklch(0.723 0.191 149°) green, info≈oklch(0.685 0.169 237°) blue. Dark variants shift lightness slightly upward for dark-mode legibility. All pass AA against their foreground tokens."
  - id: "04-04-C"
    summary: "skeleton uses var(--muted)/var(--border) — NOT oklch(var(...))"
    detail: "Per plan constraint: globals.css tokens are full oklch(...) values. Using oklch(var(--muted)) would be invalid CSS. .skeleton uses var(--muted) and var(--border) directly in the gradient."
  - id: "04-04-D"
    summary: "StatusAnnouncer uses module-level globalSetMessage reference"
    detail: "A module-level variable holds the setState reference so useStatusAnnouncer() works anywhere without React context. The component registers/deregisters on mount/unmount. This avoids a Context provider for a low-frequency side-effect."

metrics:
  tasks-completed: 2
  tasks-total: 2
  deviations: 1
  commits:
    - "53e16a8 chore(04-04): install gap-closure deps + design-system CSS foundation"
    - "54945ed feat(04-04): WCAG-AA validator, ThemeToggle, StatusAnnouncer"
---

# Phase 4 Plan 04: Design-System CSS Foundation Summary

**One-liner:** OKLCH semantic tokens + 6 keyframes + skeleton shimmer + WCAG-AA validator + ThemeToggle (useSyncExternalStore SSR-safe) + aria-live StatusAnnouncer; all 5 gap-closure runtime deps installed in one pass.

## Objective

Close DS-SHELL-01 (design tokens incomplete) and DS-SHELL-07 (a11y/dark-mode CSS foundations). Establish the complete CSS design-system foundation that all downstream gap-closure plans (04-05..08) depend on. Install all runtime dependencies for the entire gap-closure series.

## Tasks Completed

| # | Task | Commit | Files Changed |
|---|------|--------|---------------|
| 1 | Install gap-closure deps + globals.css foundation | `53e16a8` | package.json, pnpm-lock.yaml, globals.css |
| 2 | WCAG validator + ThemeToggle + StatusAnnouncer | `54945ed` | lib/theme/wcag-validator.ts, components/ui/theme-toggle.tsx, components/ui/status-announcer.tsx |

## What Was Built

### globals.css additions

**Semantic state tokens** — warning (amber), success (green), info (blue) in OKLCH with foreground variants for both `:root` (light) and `.dark`. Registered in `@theme inline` as `--color-warning`, `--color-success`, `--color-info` (+ fg), enabling Tailwind utilities `bg-warning`, `text-success`, `text-info-foreground`, etc.

**6 Keyframes:**
- `shimmer` (2s linear) — skeleton loading effect
- `fadeSlideUp` (0.5s ease-out) — count-up / card reveal
- `slideInRight` (0.3s ease-out) — panel/drawer entrance
- `fadeIn` (0.2s ease-out) — general fade
- `scaleIn` (0.15s ease-out) — modal/popover entrance
- `bounceSlight` (0.4s ease-out) — micro-interaction feedback

Animation utilities registered in `@theme inline`: `--animate-skeleton-shimmer`, `--animate-count-up`, `--animate-slide-in-right`, `--animate-fade-in`, `--animate-scale-in`, `--animate-bounce-subtle`.

**`.skeleton` class** — shimmer gradient using `var(--muted)` / `var(--border)` (not `oklch(var(...))` which would be invalid CSS).

**`prefers-reduced-motion`** — suppresses all animation/transition durations to 0.01ms for motion-sensitive users.

**A11y base utilities** — `:focus-visible` applies `ring-2 ring-ring ring-offset-2 ring-offset-background outline-none`. `.touch-target` ensures `min-height: 44px; min-width: 44px` for WCAG 2.5.5.

### lib/theme/wcag-validator.ts

`wcagContrastCheck(fg: string, bg: string): ContrastResult` — accepts any CSS-parseable colour string (hex, oklch, hsl, etc.), converts via colorjs.io to sRGB, computes WCAG 2.1 relative luminance, returns `{ ratio, passAA (≥4.5:1), passAALarge (≥3:1) }`.

`validateTenantColours(primaryHex: string, fgHex: string): boolean` — returns whether a tenant primary/foreground pair meets AA for normal text. Used by 04-08 Settings → Appearance to reject failing colour combos.

### components/ui/theme-toggle.tsx

Cycles `light → dark → system` via `next-themes` `useTheme()`. Uses `useSyncExternalStore` (server snapshot = `false`, client snapshot = `true`) for SSR-safe mounted detection — avoids `useEffect` setState which violates the project's `react-hooks/set-state-in-effect` ESLint rule. Renders `Sun` / `Moon` / `Monitor` icons with proper `aria-label` and `.touch-target` class. Will be mounted in the Top Bar by plan 04-07.

### components/ui/status-announcer.tsx

`<StatusAnnouncer />` renders `<div role="status" aria-live="polite" aria-atomic="true" className="sr-only" />`. `useStatusAnnouncer()` returns `{ announce(message) }` — sets text on the region and clears after `clearAfterMs` (default 3s). Module-level reference pattern avoids a React context provider for this low-frequency side-effect. Mount `<StatusAnnouncer />` once in root layout or `AppProviders`.

## Newly Installed Dependencies

| Package | Version | Consumer Plans |
|---------|---------|----------------|
| framer-motion | 12.41.0 | 04-07 (Top Bar animations), 04-05 (chart transitions) |
| cmdk | 1.1.1 | 04-07 (Command Palette) |
| react-countup | 6.5.3 | 04-05 (KPI metric counters) |
| @tanstack/react-table | 8.21.3 | 04-06 (data tables) |
| colorjs.io | 0.6.1 | wcag-validator.ts (OKLCH→sRGB) |

## Deviations from Plan

### Auto-fixed Issues

**[Rule 1 - Bug] useSyncExternalStore replaces useEffect setState for SSR mounted check**

- **Found during:** Task 2 (ThemeToggle)
- **Issue:** The standard next-themes SSR hydration pattern (`useEffect(() => setMounted(true), [])`) violates the project's `react-hooks/set-state-in-effect` ESLint rule which prohibits calling `setState` synchronously inside effect bodies.
- **Fix:** Replaced with `useSyncExternalStore(noop, () => true, () => false)` — returns `false` on server render and `true` on the client, achieving the same hydration-safe behavior without triggering the ESLint rule.
- **Files modified:** `components/ui/theme-toggle.tsx`
- **Commit:** `54945ed`

## Verification Results

```
✓ pnpm --dir frontend build — passes (Next 16 + Turbopack, 2.2s compile)
✓ pnpm exec tsc --noEmit — 0 errors
✓ pnpm run lint — 0 errors
✓ grep -q "\-\-warning:" frontend/app/globals.css — PASS
✓ grep -q "\-\-success:" frontend/app/globals.css — PASS
✓ grep -q "\-\-info:" frontend/app/globals.css — PASS
✓ grep -q "@keyframes shimmer" frontend/app/globals.css — PASS
✓ grep -q "prefers-reduced-motion" frontend/app/globals.css — PASS
✓ grep -q "framer-motion" frontend/package.json — PASS
✓ grep -q "cmdk" frontend/package.json — PASS
✓ grep -q "react-countup" frontend/package.json — PASS
✓ grep -q "@tanstack/react-table" frontend/package.json — PASS
✓ grep -q "colorjs.io" frontend/package.json — PASS
✓ grep -q "wcagContrastCheck" frontend/lib/theme/wcag-validator.ts — PASS
✓ grep -q "useTheme" frontend/components/ui/theme-toggle.tsx — PASS
✓ grep -q "aria-label" frontend/components/ui/theme-toggle.tsx — PASS
✓ grep -q "aria-live" frontend/components/ui/status-announcer.tsx — PASS
```

## Next Phase Readiness

Plan 04-05 (charts + KPI counters) can now:
- Use `bg-success`, `bg-warning`, `bg-info` Tailwind utilities
- Use `animate-fade-in`, `animate-count-up` utilities
- Import `react-countup` and `framer-motion` without touching package.json

Plan 04-06 (data tables) can now:
- Import `@tanstack/react-table` directly
- Use `.skeleton` class for loading states

Plan 04-07 (Top Bar + Command Palette) can now:
- Mount `<ThemeToggle />` from `components/ui/theme-toggle`
- Import `cmdk` and `framer-motion`
- Use `slideInRight` / `scaleIn` animation utilities

Plan 04-08 (tenant theming) can now:
- Call `validateTenantColours(primary, fg)` from `lib/theme/wcag-validator`
