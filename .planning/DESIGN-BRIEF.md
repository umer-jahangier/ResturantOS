# MASTER DESIGN BRIEF — Complete Restaurant ERP UI/UX Revamp

> **Source of truth.** Given by the product owner on 2026-08-12, reproduced faithfully.
> Every design phase, plan and executor works from THIS document. Where a phase plan
> and this brief disagree, this brief wins and the plan is amended.
>
> **Status of prior work:** Phase 34 (`.planning/phases/34-visual-design-language/`) has already
> delivered what this brief calls PHASE 2–4 — design tokens, richness zones, a measured
> glass/depth contract, a motion vocabulary, and layout primitives. Build on it. Do NOT
> start a second design vocabulary. Phase 20 delivered the OKLCH token scales beneath it.

## ROLE

Act as a world-class Senior Product Designer, UI/UX Engineer, Design Systems Architect,
Frontend Architect, and Motion Designer specializing in premium enterprise SaaS, restaurant
POS systems, hospitality software, dashboards, and operational applications.

You are working on an EXISTING Restaurant ERP application. The task is NOT a superficial theme
or a colour change. Perform a complete professional UI/UX transformation while preserving all
existing functionality, business logic, API integrations, database behaviour, authentication,
authorization, routes, forms, workflows, calculations, and permissions.

The final product should feel like a premium, modern, commercially viable restaurant operating
system comparable in polish to Toast, Lightspeed Restaurant, Square for Restaurants, and Oracle
Hospitality.

**The goal:** existing functionality + enterprise-grade design system + premium UI + excellent UX
+ subtle motion + responsive architecture + accessibility + performance. **Do NOT sacrifice
usability for visual effects.**

## 1. FIRST: AUDIT THE EXISTING APPLICATION

Before changing code, inspect the entire existing project. Analyze: framework, frontend
architecture, component structure, routing, layouts, pages, forms, tables, modals, drawers,
navigation, sidebar, header, dashboard, POS, orders, tables, kitchen/KDS, inventory, menu
management, products, categories, recipes, ingredients, suppliers, purchases, customers, staff,
employees, attendance, reports, analytics, expenses, payments, billing, settings, notifications,
authentication, role-based access, branch/location management, and any other existing module.

Identify: inconsistent spacing, typography, colours, border radius; duplicated CSS; poor
responsive behaviour; oversized components; visually outdated components; poor hierarchy;
confusing interactions; missing loading/empty/error states; missing success feedback; poor table
UX; poor form UX; excessive scrolling; inefficient navigation; inaccessible controls; excessive
animations; missing keyboard support; poor touch interaction; mobile/tablet/desktop issues;
performance-heavy CSS; unnecessary dependencies; component duplication.

**Do NOT blindly rewrite. First understand what already exists.**

## 2. CRITICAL RULE — PRESERVE FUNCTIONALITY

This is a UI/UX transformation. DO NOT break: APIs, endpoints, authentication, authorization,
database queries, business logic, calculations, validation, routes, permissions, role behaviour,
existing workflows, state management, integrations, POS operations, inventory calculations,
reporting logic.

If an existing component works correctly, improve its presentation and interaction rather than
rewriting its underlying functionality. **Never replace real data with mock data. Never remove a
feature because its current UI is poor.**

## 3. DESIGN DIRECTION

Create a premium **Modern Restaurant Operations SaaS** visual language combining: premium
enterprise SaaS, modern restaurant technology, subtle glassmorphism, sophisticated dashboard
design, clean typography, tactile controls, intelligent information hierarchy, subtle depth,
restrained 3D effects, polished micro-interactions, high-quality data visualization, excellent
spacing, strong accessibility.

**Should feel:** premium, fast, trustworthy, intelligent, professional, modern, operational,
clean, sophisticated, slightly futuristic.

**Should NOT feel:** childish, game-like, overly neon, excessively animated, cluttered, gimmicky,
crypto/Web3-like, or like a generic admin template.

## 4. DESIGN SYSTEM

Create a centralized design system before styling individual screens. Semantic colour tokens for:
primary, primary-hover, primary-active, secondary, accent, success, warning, danger, info,
background, surface, surface-elevated, surface-muted, border, border-subtle, text-primary,
text-secondary, text-muted, text-disabled.

Support Light Mode and Dark Mode. **Do not simply invert colours — both themes must be
intentionally designed.**

## 5. GLASSMORPHISM

Use selectively. Reusable glass surfaces via translucent backgrounds, backdrop blur, subtle
borders, controlled shadows, layered surfaces, background gradients.

**Use for:** top navigation, floating panels, command palettes, modal dialogs, floating action
areas, dashboard widgets, notification panels, contextual overlays, selected cards, premium
analytics panels.

**DO NOT make every element glass.** Tables, dense POS controls, forms and operational areas must
remain highly readable. Glass should enhance hierarchy, not reduce readability.

## 6. TYPOGRAPHY

Professional hierarchy: Display, H1, H2, H3, H4, Body large, Body, Body small, Caption, Label,
Numeric/KPI typography.

Financial and operational numbers must be immediately scannable — revenue, orders, tables
occupied, pending orders, inventory alerts, today's sales, outstanding payments get strong visual
hierarchy. **Do not make everything bold.**

## 7. SPACING SYSTEM

Consistent spacing scale; every page follows a predictable rhythm. Avoid random padding, random
margins, inconsistent gaps, arbitrary card sizes. The interface must look designed as ONE product,
not a collection of unrelated pages.

## 8. BORDER RADIUS SYSTEM

Tokens: small, medium, large, extra-large, pill. Larger radius for cards, dialogs, dashboards,
floating containers. Smaller for compact controls, tables, inputs, operational elements. Avoid
excessive rounding everywhere.

## 9. SHADOW & DEPTH SYSTEM

Professional elevation hierarchy: subtle shadows, layered shadows, glass depth, inset borders,
hover elevation. Avoid huge blurry shadows. **Depth communicates hierarchy.**

## 10. APPLICATION SHELL — SIDEBAR

Expandable/collapsible, icons, labels, active state, section grouping, tooltip when collapsed,
keyboard accessibility, smooth transitions. Navigation clearly distinguishes: Dashboard, POS,
Orders, Tables, Kitchen, Inventory, Menu, Customers, Staff, Suppliers, Finance, Reports, Settings.
**Only show modules permitted for the current role.**

## 11. TOP NAVIGATION

Page title, breadcrumb/context, branch selector, global search, notifications, quick actions, user
profile, theme switcher if appropriate. **Do not overcrowd.**

## 12. GLOBAL COMMAND PALETTE

Modern command palette searching orders, customers, products, menu items, tables, employees,
suppliers, pages, settings. Keyboard shortcut CTRL/CMD + K. Include search animation, keyboard
navigation, categorized results, recent searches, quick actions.

## 13. DASHBOARD REDESIGN

Executive-level restaurant overview. Configurable KPI cards: Today's Revenue, Orders, Average
Order Value, Gross Profit, Food Cost, Pending Orders, Occupied Tables, Low Stock Items.

Each KPI card supports icon, current value, comparison, percentage change, trend indicator, mini
chart/sparkline, subtle hover interaction. Example: `Revenue · Rs. 248,500 · +12.4% vs yesterday`.

**Do not overload.** Prioritize by importance.

## 14. ANALYTICS

Premium data visualization: revenue charts, order trends, category performance, top-selling
products, payment breakdown, branch comparison, peak hours, inventory movement, food cost, profit,
employee performance. Charts include smooth transitions, hover states, tooltips, readable axes,
legends, empty states, loading skeletons. **Avoid decorative charts with no operational value.**

## 15. POS REDESIGN — ONE OF THE MOST IMPORTANT SCREENS

**Speed > decoration.** Design for touchscreens, tablets, desktops, mouse, keyboard.

Recommended structure — LEFT: categories, search, menu/product grid. CENTER: products, modifiers,
quick actions. RIGHT: current order, customer, table, subtotal, tax, discount, payment.

Product cards: image where appropriate, name, price, availability, category, modifiers, quick add.
Tactile interaction on selection — subtle scale, highlight, feedback, order-line animation. **Do
NOT introduce animations that slow down repeated ordering.**

## 16. TOUCH-FIRST POS UX

Comfortable touch targets, no tiny buttons. Large tap areas, clear labels, obvious active states,
tactile feedback, minimal scrolling. **Do not rely on hover for critical POS functionality —
every hover interaction needs a touch/click equivalent.**

## 17. TABLE MANAGEMENT

Interactive restaurant floor plan. Tables show visual status, capacity, table number, current
order, elapsed time, server, occupancy. States: AVAILABLE, OCCUPIED, RESERVED, ORDERING, FOOD
SERVED, PAYMENT, CLEANING, OUT OF SERVICE. Allow table selection, transfer, merge, split bills,
move orders, reservation information.

## 18. KITCHEN DISPLAY SYSTEM

Operational clarity first. Columns: NEW, PREPARING, READY, COMPLETED. Tickets communicate order
number, table, elapsed time, priority, items, modifiers, notes, server. Urgency states: Normal,
Warning, Critical. **Avoid distracting animations.** State changes animate smoothly, preserve
context, update counters. Critical kitchen alerts remain visually obvious.

## 19. ORDER MANAGEMENT

Premium order tables/cards supporting search, filtering, sorting, pagination, date range, order
status, payment status, branch, customer, server, order type. Status badges, contextual actions,
expandable details, quick actions. **Avoid huge rows that waste screen space.**

## 20. INVENTORY UI

Current stock, low stock, out of stock, reorder threshold, stock movement, supplier, purchase
price, selling price, wastage, expiry, inventory valuation. Visually obvious low-stock alerts.
Filter chips, bulk actions, column visibility, search, sorting.

## 21. MENU MANAGEMENT

Categories, products, modifiers, variants, pricing, availability, images, recipes, ingredients.
Visual product cards where appropriate. Availability toggles get immediate visual feedback.

## 22. FORMS

Clear labels, helper text, validation, error states, success states, required indicators, disabled
states, loading states, keyboard navigation. **Never rely exclusively on placeholder text as
labels.** Logical grouping; for long forms use sections, tabs, accordions, progressive disclosure.

## 23. TABLES

Reusable enterprise data-table component: sorting, filtering, searching, pagination, column
resizing where useful, column visibility, row selection, bulk actions, sticky headers, responsive
behaviour, empty state, loading state, error state. Readable even with large datasets.

## 24. SKELETON LOADING

Complete skeleton system — **do NOT use a generic spinner for everything.** Contextual skeletons
for dashboard cards, charts, tables, order lists, product grids, profile sections, forms, cards,
KDS tickets. Skeletons match final component dimensions. Subtle shimmer. The user should perceive
"the interface is loading", not "something is broken."

## 25. LOADING STATES

Every async action gets an appropriate loading state: `Saving… → Saved`, `Deleting… → Deleted`,
`Refreshing…`, `Processing payment…`, `Submitting order…`. **Do not freeze the entire interface.**
Prefer localized loading states.

## 26. EMPTY STATES

Beautiful and contextual. Every empty state explains: what is empty, why, and what the user can do
next. Provide a CTA when useful.

## 27. ERROR STATES

**Never show raw technical errors.** Explain what happened, provide useful action, allow retry,
preserve entered data where possible. `"Unable to load today's orders." [Try Again]` — never
`"500 Internal Server Error."`

## 28. TOASTS & NOTIFICATIONS

Unified system: Success, Info, Warning, Error. Icon, concise message, optional action, dismiss,
progress indicator. **Avoid unnecessary notifications.**

## 29. MODALS & DRAWERS

Consistent architecture: backdrop blur, subtle scale/fade, clear hierarchy, appropriate width,
responsive. For complex workflows prefer a DRAWER over an enormous modal. **No modal-inside-modal.**

## 30. MICRO-INTERACTIONS

Button: hover → subtle elevation, press → subtle scale down, release → return. Card: hover →
slight elevation. Toggle: smooth transition. Dropdown: fade + slight vertical movement. Modal:
fade + subtle scale. Page: smooth transition. Success: subtle confirmation animation. **Do not
animate every element.**

## 31. 3D ANIMATIONS

Selective. CSS perspective/transforms, or an already-compatible library. Uses: dashboard cards,
premium KPI cards, interactive table cards, product cards, onboarding, empty states, success
states, hover interactions. Example: card perspective → slight tilt based on pointer movement.

**NEVER use aggressive 3D on:** POS buttons, kitchen tickets, financial tables, dense data grids,
frequently clicked controls. Operational interfaces must remain fast.

## 32. 3D PERFORMANCE

GPU-friendly transforms; avoid expensive layout recalculation; avoid unnecessary JavaScript;
respect reduced-motion; disable/reduce on low-performance devices. **Never sacrifice FPS for
polish.**

## 33. PAGE TRANSITIONS

Subtle — opacity, translateY, scale where appropriate. Keep short. **Avoid slow cinematic
animations; restaurant employees need immediate feedback.**

## 34. HOVER SYSTEM

Cards: subtle elevation. Buttons: brightness/elevation. Rows: subtle surface change. Icons: small
scale. Navigation: active indicator. **Never make hover the only way to understand functionality.**

## 35. BUTTON SYSTEM

Primary, Secondary, Tertiary, Ghost, Danger, Success, Icon, Icon + Label, Floating Action Button.
Each with default, hover, active, focus, disabled, loading states.

## 36. INPUT SYSTEM

Text, search, number, date pickers, selects, multi-select, autocomplete, switches, checkboxes,
radio buttons, sliders — all sharing one visual language.

## 37. SEARCH UX

Instant filtering, keyboard shortcuts, clear button, loading state, no results, recent searches.
Global search uses the command palette.

## 38. RESPONSIVE DESIGN

Large desktop, standard desktop, laptop, tablet, POS touchscreen, mobile. **Do not simply shrink
desktop layouts — adapt the interface.** Desktop: sidebar + full dashboard. Tablet: condensed
navigation + optimized panels. Mobile: bottom or compact navigation. POS: touch-first.

## 39. DARK MODE

**Not black background + white text.** Multiple elevation layers: Background → Surface → Elevated
Surface → Glass Surface → Modal. Maintain readable contrast.

## 40. ACCESSIBILITY

Target WCAG 2.2 AA where practical: keyboard navigation, visible focus, adequate contrast,
semantic HTML, screen-reader labels, accessible dialogs, accessible form errors, reduced motion,
appropriate touch targets. **Never use colour alone to communicate status — use icon + text +
colour.**

## 41. REDUCED MOTION

Respect `prefers-reduced-motion`: disable 3D tilt, minimize page transitions, reduce durations,
disable decorative motion. **Functionality must remain identical.**

## 42. PERFORMANCE

Optimize CSS, animations, rendering, component re-renders, images, charts, shadows,
backdrop-filter, large tables. Avoid unnecessary DOM nodes, JS animation loops, huge dependencies,
duplicated components. **Do not introduce a heavy library for one animation.**

## 43. DESIGN SYSTEM COMPONENT LIBRARY

AppShell, Sidebar, Topbar, Breadcrumb, PageHeader, KpiCard, StatCard, GlassCard, DataTable,
DataGrid, SearchInput, CommandPalette, Modal, Drawer, Dropdown, Tooltip, Popover, Tabs, Badge,
StatusBadge, Button, IconButton, Input, Select, DatePicker, FilterBar, EmptyState, ErrorState,
Skeleton, Toast, ConfirmDialog, ChartCard, ProductCard, OrderCard, TableCard, KitchenTicket,
UserAvatar, ActivityTimeline, Pagination, LoadingOverlay.

**Avoid separate visually inconsistent implementations of the same pattern.**

## 44. RESTAURANT-SPECIFIC VISUAL LANGUAGE

Subtly communicate hospitality — cues from menus, table layouts, food photography, premium
hospitality, modern restaurant interiors, reservation systems, kitchen workflows. **But do NOT
turn the ERP into a restaurant marketing website.** It remains an enterprise operational system.

## 45. DASHBOARD PERSONALIZATION

Where architecture allows: rearrangeable widgets, hide/show widgets, branch selection, date range,
saved filters. Management sees strategic information; operational users see operational
information. **Do not show every metric to every user.**

## 46. ROLE-AWARE UX

OWNER: revenue, profit, branches, analytics, performance. MANAGER: orders, tables, inventory,
staff, reports. CASHIER: POS, orders, payments, customers. KITCHEN: KDS, orders, preparation
status. INVENTORY MANAGER: stock, purchasing, suppliers, wastage.

**Do not merely hide buttons — design the interface around each role's workflow.**

## 47. DATA VISUALIZATION

Line, bar, area, donut, sparklines, heatmaps where useful. **Avoid 3D pie charts, excessive
gradients, decorative charts, unreadable legends.** Every chart answers a business question.

## 48. FILTER EXPERIENCE

Unified system — discoverable, removable, persistent where appropriate, visually represented as
chips, easy to reset. Example: `Branch: Islamabad · Date: Aug 1–12 · Status: Completed [Clear all]`.

## 49. BULK ACTIONS

Bulk delete, update, activate, deactivate, export, assign, status change. **Show selected count
clearly.**

## 50. CONFIRMATION UX

Destructive actions require confirmation — delete product, delete employee, cancel order, void
payment, remove inventory. Contextual confirmations. **Do not repeatedly confirm harmless actions.**

## 51. UNDO WHERE POSSIBLE

`"Product archived." [Undo]` — prefer undo over unnecessary confirmation dialogs where safe.

## 52. NOTIFICATION CENTER

Centralized panel with categories: Orders, Inventory, Payments, Staff, System, Alerts. Unread
state, timestamps, severity, quick actions.

## 53. ACTIVITY TIMELINE

Where useful: order created → payment received → sent to kitchen → prepared → completed.
Inventory: purchase created → stock received → adjustment → wastage recorded. Improves
operational transparency.

## 54. PREMIUM LOGIN / AUTH UI

Premium background, subtle depth, clean form, clear branding, password visibility, validation,
loading state, error handling. **Professional rather than excessively animated.**

## 55. SETTINGS

Structured architecture grouped into: General, Restaurant, Branches, Users, Roles, Permissions,
Taxes, Payments, Printers, Kitchen, Notifications, Integrations, Security, Appearance. **Avoid one
enormous settings page.**

## 56. PRINT / RECEIPT UX

The redesign must not interfere with receipt generation, invoice printing, kitchen tickets, or
thermal printer workflows. **Print-specific styles must remain clean and functional.**

## 57. MOBILE UX

Prioritize critical actions; bottom sheets, drawers, compact cards; avoid giant tables; horizontal
scrolling only when necessary. **Do not force desktop tables onto mobile.**

## 58. ANIMATION DESIGN TOKENS

Centralized tokens: Fast, Normal, Slow, plus easing curves. Consistent across the application.
**Never create random durations per component.**

## 59. CSS ARCHITECTURE

Scalable structure for tokens, themes, components, utilities, layouts, animations, responsive
rules. CSS variables wherever appropriate. **Avoid `!important` unless genuinely necessary. Avoid
duplicated styles.**

## 60. RESPONSIVE BREAKPOINTS

Coherent strategy, not dozens of breakpoints. Components adapt naturally. Test 320, 375, 430, 768,
1024, 1280, 1440, 1920+ where appropriate.

## 61. VISUAL CONSISTENCY AUDIT

After implementation inspect EVERY screen for inconsistent padding, typography, colours, button
heights, icon sizes, radius, shadows, alignment, status colours. **The entire ERP must feel like
one unified product.**

## 62. INTERACTION CONSISTENCY AUDIT

Every interaction follows the same pattern. If deleting a product confirms, all equivalent deletes
confirm. If save buttons show loading, all async saves do. If status badges use icons, the same
semantic system applies throughout.

## 63. VISUAL QA

Check desktop, tablet, mobile, light mode, dark mode, keyboard navigation, loading states, empty
states, error states, long text, large numbers, large datasets, slow network, API failures,
permission restrictions. Fix every obvious inconsistency.

## 64. DO NOT DO THESE THINGS

Do not: destroy existing functionality; replace real APIs with mocks; remove features; redesign
backend logic; add unnecessary dependencies; use excessive animation or glassmorphism; make
everything neon; make every card 3D; use giant typography everywhere; use tiny POS buttons; rely
on hover; create inaccessible colour combinations; create giant unnecessary whitespace; make
tables hard to scan; make dashboards decorative instead of useful; use random gradients; use
excessive blur; animate every click; create inconsistent components.

## 65. PRIORITY ORDER

When aesthetics and usability conflict:
**1. Functionality · 2. Usability · 3. Performance · 4. Accessibility · 5. Information hierarchy ·
6. Consistency · 7. Visual polish · 8. Decorative animation.** Never reverse this.

## 66. IMPLEMENTATION STRATEGY

Do NOT rewrite everything blindly in one pass.

1. Audit existing application
2. Create design tokens
3. Create global layout
4. Create reusable component library
5. Redesign dashboard
6. Redesign POS
7. Redesign orders and tables
8. Redesign KDS
9. Redesign inventory/menu/purchasing
10. Redesign customers/staff/finance
11. Redesign reports/analytics
12. Redesign settings/authentication
13. Add loading/empty/error/success states
14. Add micro-interactions
15. Add carefully selected 3D effects
16. Responsive optimization
17. Accessibility audit
18. Performance optimization
19. Full visual consistency audit
20. Final regression testing

## 67. COMPONENT-FIRST IMPLEMENTATION

Finalize first: Button, Input, Select, Badge, Card, Modal, Drawer, Tooltip, Dropdown, Table,
Skeleton, Toast, Tabs, Sidebar, Topbar. Then use those components everywhere.

## 68. REAL DATA

The application must continue displaying REAL DATA. Do not create fake dashboards to make
screenshots impressive. If an API returns `revenue = X`, display X. If no data exists, show a
proper empty state. **Do not fabricate statistics.**

## 69. UX PRINCIPLE

The interface answers "What does the user need to know?" and "What does the user need to do next?"
within seconds. A restaurant employee should not have to study the interface.

## 70. FINAL QUALITY TARGET

Should look like a serious commercial SaaS product sellable to independent restaurants, cafes,
fast-food businesses, fine-dining restaurants, restaurant chains, multi-branch operators and
hospitality businesses. Substantially more polished than a generic Bootstrap/admin dashboard.

## 71. FINAL ACCEPTANCE CRITERIA

The redesign is NOT complete until:

- [ ] Entire application uses one design system
- [ ] All existing functionality works
- [ ] All existing APIs work
- [ ] All routes work
- [ ] Authentication works
- [ ] Permissions work
- [ ] POS remains fast
- [ ] KDS remains operational
- [ ] Tables are easy to scan
- [ ] Dashboard is visually polished
- [ ] Forms are consistent
- [ ] Tables are consistent
- [ ] Loading skeletons exist
- [ ] Empty states exist
- [ ] Error states exist
- [ ] Success feedback exists
- [ ] Toast system exists
- [ ] Modal system is consistent
- [ ] Glass effects are used intelligently
- [ ] 3D effects are subtle
- [ ] Animations are performant
- [ ] Reduced motion is supported
- [ ] Dark mode works
- [ ] Light mode works
- [ ] Mobile works
- [ ] Tablet works
- [ ] Desktop works
- [ ] Touch interaction works
- [ ] Keyboard navigation works
- [ ] Accessibility has been reviewed
- [ ] No major visual inconsistencies remain
- [ ] No unnecessary duplicated CSS remains
- [ ] No unnecessary dependencies were introduced
- [ ] No mock data replaced real data
- [ ] No backend functionality was broken
- [ ] No business logic was changed unnecessarily

## FINAL INSTRUCTION

Do not treat this as CSS beautification. Treat the existing Restaurant ERP as a real commercial
product undergoing a complete professional product-design transformation. Preserve functionality
while dramatically improving UI, UX, visual hierarchy, interaction design, responsive behaviour,
accessibility, performance, loading experience, feedback, navigation, data visualization, POS
usability, restaurant workflow efficiency, and overall perceived product quality.

A user should open the ERP and immediately think: **"THIS LOOKS LIKE A PROFESSIONAL, PREMIUM
RESTAURANT MANAGEMENT PLATFORM."**

**Do not stop after redesigning the dashboard. Apply the design system consistently across the
ENTIRE APPLICATION.**

---

## APPENDIX — PROJECT-SPECIFIC CONSTRAINTS THAT OVERRIDE NOTHING ABOVE BUT MUST BE HONOURED

These are facts about THIS codebase, discovered the hard way. None contradict the brief.

1. **`transform`, `filter` and `backdrop-filter` create a containing block** and break
   `position: fixed` in descendants. The receipt print path depends on `position: fixed` to lift
   the bill out of the app shell. Keep those properties on LEAF surfaces, never on layout
   ancestors. This is §56 (print must keep working) expressed as a CSS rule.
2. **`body * { visibility: hidden }` has specificity (0,0,1) and loses to every Tailwind utility.**
   A print stylesheet written that way printed the entire application sidebar onto a customer's
   bill. Verify print output by rendering a real PDF and extracting its text, never by reading CSS.
3. **`size: 80mm auto` is invalid CSS** — `auto` cannot follow a length in the `@page size`
   grammar, and Chromium silently drops the whole declaration and falls back to US Letter.
4. **Glass is authored solid-first** (opaque base, translucency as a positive `@supports`
   enhancement) so the degraded path is what ships. WCAG validation uses source-over compositing
   in sRGB, not OKLCH — 50% white over black is 0.5, not the ~0.735 a perceptual blend gives.
   Do not "fix" that for consistency.
5. **The frontend has a 4-layer architecture enforced by ESLint** — api-client → repositories →
   adapters/schemas → hooks. Never import across layers.
6. **Money is BIGINT paisa** throughout, rendered ONLY through the shared formatter, so screen,
   printed bill and ledger agree to the paisa. Never add a second formatting path. Never a float.
7. **`npm test` passing does NOT mean it compiles** — Vitest does not typecheck. Always run
   `npm run lint && npx tsc --noEmit` as well.
8. **Every visual gate needs a negative control.** Six gates in the design phase alone passed
   against known-broken code — including the positive control itself, which was *skipping* rather
   than passing for weeks. Break the code on purpose, watch the test go red, then fix it. An
   assertion you have not watched fail is not evidence.
9. **Verify in a real browser.** Two print defects invisible from the DOM and invisible on screen
   were found only by rendering. A design phase verified by reading its own CSS is not verified.
