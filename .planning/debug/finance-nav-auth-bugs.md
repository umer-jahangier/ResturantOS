---
status: diagnosed
trigger: "Debug session for RestaurantOS frontend finance navigation and authorization bugs."
created: 2026-06-27T00:00:00Z
updated: 2026-06-27T00:00:00Z
goal: find_root_cause_only
---

## Current Focus

hypothesis: Multiple layered failures — route guards absent, sidebar group labels unconditional, FeatureGuard fail-closed on API errors, permission string drift
test: Read cited files + live API calls for feature-flags with fresh JWT
expecting: Confirm parent hypotheses with code evidence and runtime behavior
next_action: Return structured diagnosis to orchestrator

## Symptoms

expected: Cashier cannot access finance routes or see finance nav; finance_demo sees Finance submenu (Accounts, Journal Entries, GL, Periods)
actual: Cashier can navigate to /app/finance/accounts directly; both users see "Finance" heading with no links; finance_demo missing submenu
errors: None reported in UI; feature-flags API returns 401 in live dev test
reproduction: Log in as cashier@demo.local or finance_demo@demo.local, observe sidebar; navigate to /app/finance/accounts
started: Current dev session

## Eliminated

- hypothesis: finance_demo lacks finance.journal.view in JWT
  evidence: login-response.json and fresh login decode show finance.journal.view + finance.journal.post for FINANCE_VIEWER role
  timestamp: 2026-06-27

- hypothesis: Finance nav uses wrong permission string (like order:create drift)
  evidence: sidebar-nav-items.ts uses finance.journal.view which matches 030-create-roles-permissions.xml
  timestamp: 2026-06-27

## Evidence

- timestamp: 2026-06-27
  checked: frontend/proxy.ts
  found: Only checks has_session cookie for /app/* and /platform/*; no permission or feature checks
  implication: Any authenticated user can load finance page URLs (symptom 1)

- timestamp: 2026-06-27
  checked: frontend/app/(tenant)/layout.tsx, finance pages, grep PermissionGuard in app/**
  found: No layout.tsx under finance/; zero PermissionGuard/FeatureGuard in app routes
  implication: Sidebar hiding is the only nav gate; pages render without authorization

- timestamp: 2026-06-27
  checked: frontend/components/shared/sidebar.tsx lines 156-174
  found: group.label always rendered; GuardedNavItem children may all return null
  implication: Empty "Finance" heading when all items hidden (symptom 2)

- timestamp: 2026-06-27
  checked: frontend/components/shared/feature-guard.tsx lines 17-28
  found: isError or !features returns fallback (null); isPending also returns null
  implication: Failed feature-flags fetch hides ALL feature-gated nav items

- timestamp: 2026-06-27
  checked: Live curl — POST login + GET /api/v1/feature-flags with Bearer token
  found: Login 200 OK; feature-flags returns 401 UNAUTHENTICATED (cashier and finance_demo)
  implication: FeatureGuard likely isError=true in dev → finance links hidden even for finance_demo

- timestamp: 2026-06-27
  checked: 030-create-roles-permissions.xml
  found: CASHIER has pos.order.* only; FINANCE_VIEWER has finance.journal.view + finance.journal.post
  implication: Cashier correctly denied nav links by PermissionGuard; direct URL still works (no route guard)

- timestamp: 2026-06-27
  checked: sidebar-nav-items.ts permission strings vs auth DB
  found: Finance uses finance.journal.view (correct); POS uses order:create (DB: pos.order.create); Inventory uses inventory:read (DB: inventory.item.view); Purchasing uses purchasing:read (not in permissions catalogue)
  implication: Widespread nav permission drift; finance permission string is correct

- timestamp: 2026-06-27
  checked: mobile-bottom-nav.tsx line 48
  found: permission: "finance:read" — does not exist in auth DB (correct: finance.journal.view)
  implication: Mobile finance tab never shows for any user

- timestamp: 2026-06-27
  checked: sidebar-nav-items.ts Finance group lines 127-164
  found: Purchasing nested under Finance label with separate permission/feature
  implication: Misleading IA; Finance heading can appear with only irrelevant hidden items

## Resolution

root_cause: Defense-in-depth failure — authorization is sidebar-only (client guards), with no route-level PermissionGuard/FeatureGuard or proxy permission checks. Sidebar group headings render unconditionally. FeatureGuard fail-closed on feature-flags API errors hides finance links for all users including finance_demo; live dev confirms feature-flags returns 401 despite valid JWT.
fix: (investigation only — not applied)
verification: (not performed — diagnosis only)
files_changed: []
