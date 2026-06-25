---
phase: 04-frontend-shell-ci-cd
plan: 08
subsystem: frontend-theming
tags: [oklch, tenant-theming, wcag, palette-generator, settings-ui, react-hook-form, zod, localStorage]
status: complete
completed: "2026-06-26"
duration: "~6 minutes"

dependency-graph:
  requires:
    - 04-04 (colorjs.io + wcag-validator.ts exist; OKLCH design tokens in globals.css)
    - 04-01 (Next 16 App Router shell, four-layer ESLint boundary)
    - 04-03 (CI gates + pnpm build green)
  provides:
    - generatePalette(hex): 11-stop OKLCH scale from any brand hex colour with WCAG-AA validation
    - GET /api/theme?brandColor=#xxxxxx → text/css with :root + .dark custom property overrides
    - Settings → Appearance page at /(tenant)/settings/appearance
    - AppearanceForm: 8 presets + custom hex + live OKLCH preview + WCAG guard + logo URL + localStorage stub
    - Backend API contract documented for Phase 7 handoff
  affects:
    - 04-07 (can link to /settings/appearance from sidebar nav-items)
    - Phase 7 (backend persistence: PUT /api/v1/tenants/:id/theme replaces localStorage stub)

tech-stack:
  added: []
  patterns:
    - OKLCH palette generation via colorjs.io Color class (L/C/H channel manipulation)
    - WCAG-AA foreground derivation by contrast ratio comparison (white vs black)
    - text/css Next.js route handler (no JSON wrapper)
    - Fully-controlled hex input with no useEffect (complies with react-hooks/set-state-in-effect)
    - localStorage persistence stub with documented backend contract for Phase 7

key-files:
  created:
    - frontend/lib/theme/palette-generator.ts
    - frontend/app/api/theme/route.ts
    - frontend/__tests__/lib/theme/palette-generator.test.ts
    - frontend/app/(tenant)/settings/appearance/page.tsx
    - frontend/components/settings/appearance-form.tsx

decisions:
  - id: "04-08-A"
    summary: "Test placed in __tests__/lib/theme/ not lib/theme/__tests__/"
    detail: "The plan specified lib/theme/__tests__/palette-generator.test.ts but vitest.config.ts only scans __tests__/**/*.test.ts relative to the frontend root. Test placed at frontend/__tests__/lib/theme/palette-generator.test.ts to match the existing include pattern without modifying vitest config."
  - id: "04-08-B"
    summary: "AppearanceForm uses fully-controlled hex input — no useEffect+setState"
    detail: "The initial draft used useEffect to sync internal 'raw' state with the incoming 'value' prop (for preset clicks). This violates the project's react-hooks/set-state-in-effect ESLint rule. Fix: removed internal state from HexInput component entirely; hex input is fully controlled from the parent AppearanceForm state. brandColor, hexInput, and palette are all updated atomically in applyColor()."
  - id: "04-08-C"
    summary: "AppearancePage is a Server Component; onSave handled entirely in AppearanceForm"
    detail: "RSC cannot pass function props to Client Components. The plan's onSave callback is implemented inside AppearanceForm itself (localStorage save + optional external onSave prop). The page passes no onSave — it is the client component's responsibility, which is the correct Next.js pattern for this level of persistence."

metrics:
  tasks-completed: 2
  tasks-total: 2
  deviations: 2
  commits:
    - "9e01f38 feat(04-08): OKLCH palette generator + /api/theme route + tests"
    - "ba0a1d5 feat(04-08): Settings → Appearance page + form (DS-06 complete)"
---

# Phase 4 Plan 08: Tenant Theming (DS-06) Summary

**One-liner:** OKLCH palette generator (11-stop, WCAG-AA) + `/api/theme` CSS endpoint + Settings → Appearance page with 8 presets, hex input, live preview, contrast guard, and localStorage stub with Phase 7 backend contract.

## Objective

Close DS-SHELL-06 (tenant colour palette system). Tenants can choose a brand colour from presets or a custom hex input, preview the generated 11-stop OKLCH palette with WCAG validation, and save to localStorage until the real backend API lands in Phase 7.

## Tasks Completed

| # | Task | Commit | Files Changed |
|---|------|--------|---------------|
| 1 | Palette generator + /api/theme route + tests | `9e01f38` | lib/theme/palette-generator.ts, app/api/theme/route.ts, __tests__/lib/theme/palette-generator.test.ts |
| 2 | Settings → Appearance page + form | `ba0a1d5` | app/(tenant)/settings/appearance/page.tsx, components/settings/appearance-form.tsx |

## What Was Built

### lib/theme/palette-generator.ts

**`generatePalette(primaryHex: string): ThemePalette`**

Algorithm:
1. Parse `primaryHex` via `colorjs.io` → OKLCH (L, C, H channels).
2. Generate 11 stops by varying L and C while preserving the brand hue:
   - Stops 50–400: fixed L values (0.97 → 0.68), C scaled from 10%–80% of base.
   - Stop 500: the input colour exactly (base L and C).
   - Stops 600–950: L scaled as fraction of base (×0.85 → ×0.25), C scaled similarly.
   - L and C are clamped to [0,1] and [0,0.4] respectively.
3. Serialise each stop as `oklch(L C H)` string (4 decimal places).
4. Derive foreground: white (`#ffffff`) vs black (`#000000`) — whichever passes WCAG AA (≥4.5:1) against the 500 stop; white wins on ties.
5. Return `{ primary: PaletteScale, foreground, background: primary[50], contrastValid }`.

### app/api/theme/route.ts

`GET /api/theme?brandColor=#xxxxxx`

- Validates `brandColor` param (hex regex).
- Calls `generatePalette`, formats all 11 stops + `:root` / `.dark` override CSS.
- Returns `text/css` with `Cache-Control: public, max-age=3600`.
- JSDoc documents the **Phase 7 backend contract**: `GET /api/v1/tenants/:id/theme → { brandColor, logoUrl }` that will replace this query-param approach once backend delivers tenant settings.

### components/settings/appearance-form.tsx

Client component (`'use client'`) with:
- **8 preset colour swatches** — circular buttons with `aria-pressed` active state and ring focus.
- **Custom hex input** — fully-controlled (no `useEffect`); accepts 6 hex chars, live-previews on 6th character. Complies with `react-hooks/set-state-in-effect` ESLint rule.
- **Live palette preview** — 11-stop swatch row + primary 500 contrast sample ("Sample Text").
- **WCAG-AA guard** — warning banner + disabled Save button when `contrastValid` is `false`.
- **Logo URL input** — text input with `type="url"` and a hint about future file upload.
- **Save** — calls `localStorage.setItem('tenant-theme-settings', ...)` (stub) + optional `onSave` callback prop.
- Validation via `react-hook-form` + `zod` using the hand-rolled `createZodResolver`.

### app/(tenant)/settings/appearance/page.tsx

Server Component page wrapper:
- Exports `metadata` (title/description for SEO).
- Renders `<AppearanceForm />` without passing an `onSave` callback (RSC cannot pass function props).
- Documents the sidebar nav-items entry deferred to plan 04-07.
- Documents Phase 7 persistence contract.

### __tests__/lib/theme/palette-generator.test.ts

16 tests across 5 `describe` blocks:
- Blue (`#3b82f6`): 11 stops present, all valid OKLCH strings, hue preserved, 50 < 500 lightness, 950 < 500 lightness, contrastValid = true.
- Red (`#ef4444`): valid OKLCH, foreground is white or black, background = primary[50].
- Very dark (`#1a1a1a`): no negative lightness, valid OKLCH, 950 ≥ 0.
- Very light (`#f8f8f8`): 50 ≥ 950 lightness, valid OKLCH, C ≤ 0.4.
- Bright green (`#10b981`): contrastValid returns a boolean.

**Coverage on `lib/theme/palette-generator.ts`: 95.83% lines (target ≥60%).**

## Deviations from Plan

### Auto-fixed Issues

**[Rule 3 - Blocking] Test location changed to match vitest scan pattern**

- **Found during:** Task 1 (writing tests)
- **Issue:** Plan specified `lib/theme/__tests__/palette-generator.test.ts`, but `vitest.config.ts` `include` pattern is `["__tests__/**/*.test.ts"]` relative to `frontend/` root. Tests at `lib/theme/__tests__/` would not be discovered.
- **Fix:** Placed test at `frontend/__tests__/lib/theme/palette-generator.test.ts` — matches existing vitest config without modifications.
- **Files modified:** test placed in `frontend/__tests__/lib/theme/`

**[Rule 1 - Bug] Removed useEffect+setState from HexInput for ESLint compliance**

- **Found during:** Task 2 (lint check after first draft)
- **Issue:** Initial draft used `useEffect(() => setRaw(value.replace(/^#/, '')), [value])` to sync hex input display with preset clicks. This triggered `react-hooks/set-state-in-effect` ESLint error (same rule fixed in 04-04 ThemeToggle).
- **Fix:** Made hex input fully controlled — removed HexInput internal state, parent's `applyColor()` atomically updates `brandColor`, `hexInput`, and `palette` together. No `useEffect` needed.
- **Files modified:** `components/settings/appearance-form.tsx`

## Verification Results

```
✓ pnpm --dir frontend exec tsc --noEmit — 0 errors
✓ pnpm --dir frontend run lint — 0 errors (1 pre-existing warning, unrelated file)
✓ pnpm --dir frontend build — passes; /api/theme + /settings/appearance in route table
✓ pnpm --dir frontend test -- palette-generator — 16/16 tests pass
✓ lib/theme/palette-generator.ts coverage: 95.83% lines (≥60% target met)
✓ grep -q "generatePalette" frontend/lib/theme/palette-generator.ts — PASS
✓ grep -q "text/css" frontend/app/api/theme/route.ts — PASS
✓ grep -q "AppearanceForm" frontend/components/settings/appearance-form.tsx — PASS
✓ grep -q "appearance" frontend/app/(tenant)/settings/appearance/page.tsx — PASS
✓ Four-layer ESLint boundary: AppearanceForm imports no repositories — PASS
```

## Backend Persistence Contract (Phase 7)

```
GET  /api/v1/tenants/:id/theme
     → { brandColor: string, logoUrl: string | null }

PUT  /api/v1/tenants/:id/theme
     Body: { brandColor: string, logoUrl: string | null }
     → 200 OK (updated theme persisted to DB)
```

Current stub: `localStorage.setItem('tenant-theme-settings', JSON.stringify({ brandColor, logoUrl }))`.

The `/api/theme` route will be replaced by a proxy to `GET /api/v1/tenants/:id/theme` once Phase 7 delivers tenant settings persistence.

## Next Phase Readiness

Plan 04-07 (Top Bar + Command Palette) can:
- Link to `/settings/appearance` from sidebar nav-items

Phase 5+ modules can:
- Use `generatePalette(brandColor)` to preview tenant colours in any component
- Call `GET /api/theme?brandColor=...` to inject dynamic CSS into tenant layouts

Phase 7 (backend persistence) must:
- Implement `PUT /api/v1/tenants/:id/theme` and the GET equivalent
- Replace the localStorage stub with an API call from `AppearanceForm.onSubmit`
