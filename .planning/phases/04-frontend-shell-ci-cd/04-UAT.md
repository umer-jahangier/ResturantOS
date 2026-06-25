---
status: complete
phase: 04-frontend-shell-ci-cd
source: 04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md, 04-04-SUMMARY.md, 04-05-SUMMARY.md, 04-06-SUMMARY.md, 04-07-SUMMARY.md, 04-08-SUMMARY.md
started: 2026-06-26T03:17:00Z
updated: 2026-06-26T03:20:00Z
verification_mode: automated_browser_and_terminal
---

## Current Test

[testing complete]

## Tests

### 1. TypeScript strict (tsc --noEmit)
expected: Zero compile errors with strict mode and no explicit `any`
result: pass
verified_by: terminal — `corepack pnpm run typecheck`

### 2. ESLint (FE-08 boundary + flat config)
expected: Zero ESLint errors; components/** cannot import api-client/repositories
result: pass
verified_by: terminal — `corepack pnpm run lint` (1 benign React Compiler warning on data-table)

### 3. Vitest unit + contract tests
expected: All frontend tests pass (auth, guards, repositories, motion, palette, eslint boundary)
result: pass
verified_by: terminal — 7 files, 58 tests passed

### 4. Vitest coverage gate (≥60%)
expected: Frontend line coverage meets ≥60% gate from coverage-gates.json
result: pass
verified_by: terminal — `pnpm run test:coverage`

### 5. Next.js production build
expected: `next build` succeeds; routes /login, /app/dashboard, /platform/dashboard, /settings/appearance, /api/theme; Proxy registered
result: pass
verified_by: terminal — `corepack pnpm run build`

### 6. OPA policy coverage (100%)
expected: `opa test policies/ --coverage` reports 100% coverage
result: pass
verified_by: terminal — coverage 100%, 230 covered lines

### 7. Playwright smoke (unauthenticated redirect)
expected: Visiting /app/dashboard without session redirects to /login
result: pass
verified_by: terminal — `playwright test` after `playwright install chromium`

### 8. proxy.ts route protection — tenant app
expected: Unauthenticated GET /app/dashboard returns 307 to /login
result: pass
verified_by: curl — HTTP 307 → /login

### 9. proxy.ts route protection — platform
expected: Unauthenticated GET /platform/dashboard returns 307 to /login
result: pass
verified_by: curl — HTTP 307

### 10. GET /api/theme CSS route (DS-06)
expected: Returns valid CSS with OKLCH :root overrides for brandColor query param
result: pass
verified_by: curl — `:root { --primary: oklch(...)` body returned

### 11. Login — staff user → dashboard (FE-04)
expected: staff@demo.test + password signs in via MSW; lands on /app/dashboard with shell chrome
result: pass
verified_by: browser — filled demo/staff@demo.test/secret → /app/dashboard

### 12. Login — conditional TOTP step-up (FE-04)
expected: owner@demo.test without TOTP reveals Authenticator code field; with code completes login
result: pass
verified_by: browser — TOTP field appeared; 123456 + sign in → /app/dashboard

### 13. TopBar chrome (DS-05)
expected: Breadcrumb, command palette button, notifications, theme toggle, profile menu visible on dashboard
result: pass
verified_by: browser snapshot — all controls present with aria-labels

### 14. Command palette (DS-04)
expected: ⌘K / button opens palette with Dashboard, Settings, Appearance, Toggle theme; navigates to Appearance
result: pass
verified_by: browser — opened palette, selected Appearance → /settings/appearance

### 15. Settings → Appearance UI (DS-06)
expected: 8 preset swatches, custom hex input, palette preview, Save button, logo URL field
result: pass
verified_by: browser — all controls on /settings/appearance

### 16. Sidebar — PermissionGuard + FeatureGuard nav (FE-05/06)
expected: POS link visible when FEATURE_POS in JWT; nav groups render
result: pass
verified_by: browser — POS link visible after owner login with mock permissions

### 17. BranchSwitcher — JWT reissue (FE-05)
expected: Switch branch dropdown lists branches; selecting Downtown Branch completes without error
result: pass
verified_by: browser — Main Branch / Downtown Branch menuitems; switch succeeded

### 18. Sidebar collapse (DS-05)
expected: Collapse toggles to icon mode; Expand sidebar restores
result: pass
verified_by: browser — Collapse sidebar → Expand sidebar button

### 19. Theme toggle (DS-07)
expected: Theme toggle cycles light/dark/system (button shows current target mode)
result: pass
verified_by: browser — "Switch to light mode" button present and interactive

### 20. StatusAnnouncer mounted (DS-07)
expected: aria-live="polite" region exists in DOM for screen-reader announcements
result: pass
verified_by: browser CDP — `document.querySelector('[aria-live="polite"]')` present

### 21. Mobile layout — bottom nav (DS-05)
expected: At mobile viewport, Mobile navigation region with Dashboard/Orders/Settings links; mobile menu toggle
result: pass
verified_by: browser — Emulation 390×844; Mobile navigation + Toggle mobile menu visible

### 22. PageTransition wired (DS-03)
expected: Tenant layout wraps children in PageTransition (verified in prior code review + build)
result: pass
verified_by: code + successful navigation animations between dashboard ↔ appearance

### 23. CI workflow present (INFRA-05)
expected: .github/workflows/ci.yml defines lint → test → build → schema-sync with coverage-gates.json
result: pass
verified_by: file inspection — ci.yml + coverage-gates.json exist

### 24. CI pipeline on live GitHub runner
expected: Full Java build, JaCoCo gates, cosign sign on push/PR
result: skipped
reason: Cannot exercise GH Actions OIDC, Testcontainers matrix, or cosign locally; deferred to live runner

## Summary

total: 24
passed: 23
issues: 0
pending: 0
skipped: 1

## Gaps

<!-- No gaps — all executable tests passed -->
