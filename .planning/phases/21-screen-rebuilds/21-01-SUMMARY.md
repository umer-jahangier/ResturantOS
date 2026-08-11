---
phase: 21
plan: "01"
subsystem: frontend
title: KDS board and role dashboards rebuilt on the phase-20 design system
status: complete
commit: 3034fc3
depends_on:
  - phase 20 (UI-SPEC.md, tokens in globals.css)
  - phase 14b (QueryBoundary)
provides:
  - components/kds/kds-aging.ts — the four-channel ageing encoding
  - components/dashboard/presets.ts — role dashboard layout as data
  - components/dashboard/portlets/** — KpiTile, TrendChart, RankedList, ExceptionList, RecordList
affects:
  - frontend/components/kds/**
  - frontend/components/dashboard/**
  - frontend/app/(tenant)/app/kitchen/**
tech-stack:
  added: [] # no new dependencies — the trend chart is inline SVG, not Recharts
  patterns:
    - "[data-surface=\"kds\"] token scope applied at the board root"
    - "derived focus rather than effect-repaired focus"
    - "type scale via text-[length:var(--text-*)] until §10.2 step 4 bridges @theme"
metrics:
  files_changed: 15
  unit_tests: 602 passing (1 pre-existing failure outside this plan)
  browser_checks: 4/4 passing
---

# Phase 21 Plan 01: KDS Board & Role Dashboards Summary

The first real application of the phase-20 revamp: the kitchen display and the role
dashboards taken off hard-coded Tailwind literals and onto the measured token layer, with the
two accessibility contracts the spec is most insistent about — redundant ageing encoding and
label-not-swatch charts — implemented rather than approximated.

---

## What was actually broken, and what the fix was

### 1. KDS ageing was colour, and the tests certified it

`getAgingTreatment` returned `border-l-emerald-500/60`, `border-l-amber-500`,
`border-l-red-500`. Hue was the entire signal. UI-SPEC §3.7 measured the fresh/warn pairing at
**ΔE2000 8.3 under protanopia** — the weakest separation anywhere in the system, on the screen
read across a kitchen under time pressure.

The tests were worse than absent. `kds-ticket-card.test.tsx` asserted
`expect(chip.className).toContain("amber")`. A board that a protanope could not read at all
passed green, because the suite's definition of "shows the ticket is late" was "the class
string contains the word red".

**Now:** `components/kds/kds-aging.ts` returns four channels — border width `2/4/6px`, a
distinct icon *shape* (`Clock` / `AlertTriangle` / **filled** `Flame`), literal chip text
(`mm:ss` / `+DUE` / `+LATE`), and for late a **card fill change** to `--kds-late-fill`
(`--kds-text` on it measures 9.07:1). The fraction logic is byte-identical to before and still
scales with each station's own `escalationThresholdSeconds`.

The rewritten test asserts the *contract*: it reads `getComputedStyle().borderLeftWidth`, it
asserts three distinct lucide icon classes, it asserts the fill change, and it asserts the
card carries **no** `bg|text|border-(gray|red|amber|emerald|blue)-\d+` class at all. It would
fail if every colour in the file were replaced with the same grey — which is the point.

### 2. The item list was one truncated line

`formatItemNames` comma-joined every item into a single `truncate`d 14px row. At the two
metres a wall board is read from, the third item was not on the screen.

**Now:** one item per line at `--text-kds` (22/28, weight 600, 16.06:1 measured), quantity in
its own column, **modifiers bold beneath their own item**, notes in a distinct block. The test
`renders modifiers ON THEIR OWN ITEM, never merged into a shared notes line` exists because
that is how a nut allergy gets cooked.

### 3. The board could not report failure

The old board destructured `{ data: tickets = [], isLoading }` and never touched `isError` —
the exact GA-001 shape that phase 14b catalogued across eleven list screens. **This was not
hypothetical during this phase:** kitchen-service was running and healthy on `:8090` while its
Eureka lease had expired, so the gateway answered 503 for every `/api/v1/kitchen/**` call. The
old board would have rendered a calm, empty, four-column board to a kitchen with eleven live
tickets.

**Now:** `QueryErrorNotice` with a retry, `role="alert"`, on both the board and the station
picker; and `kds-ticket-detail.tsx`'s `if (isLoading || !ticket)` — which folded a failed
fetch into "Loading ticket…" *forever* — is split so error is checked first.

### 4. There was no focus, so no bump bar could work

§7.2: USB bump bars enumerate as HID keyboards, so keyboard bindings *are* bump-bar support.
The board had neither a focus concept nor position numbers, so `↑ ↓ 1–9 Enter F` had nothing
to refer to.

**Now:** board-owned focus (the board owns it because `↑`/`↓` traverse *across* columns),
visible position numbers, and `↑ ↓ / 1–9,0 / PageUp / PageDown / Enter / F / R / V`.

Two implementation notes worth keeping:

- **Focus is derived, not repaired.** The obvious version is an effect that notices
  `focusedKey` has gone stale and calls `setFocusedKey`. That is a cascading render the React
  Compiler rejects outright, and it has a real symptom: for one paint the outline points at
  nothing and visibly blinks. `effectiveFocusedKey` is computed during render instead, so
  there is no frame in which focus is invalid.
- **`scrollIntoView({ block: "nearest" })` on every focus move.** Phase 20 measured
  (`globals.css:520`) that Chromium **clips `outline` under `overflow: hidden` and
  `overflow: auto`** — correcting UI-SPEC's own claim that it does not. The board is a scroll
  container and the focus ring is an outline, so without this a focused ticket can be focused
  and invisible.

### 5. Every role got the same four numbers

Closed sales, active orders, menu items, dining tables — chosen because they were easy to
fetch, answering nobody's question. The entire notion of who was reading was one
`if (!canViewOrders) return <KitchenDashboard/>`.

**Now**, four presets shipped as data in `presets.ts`:

| | Owner | Manager | Cashier | Kitchen |
|---|---|---|---|---|
| Question | Is the business healthy? | What needs me in the next five minutes? | Where is my till? | What is on the pass? |
| Time frame | Last 30 days vs prior 30 | **Today, live** | This shift | Live |
| First seen | Net sales · Gross margin · Covers · Avg order | **Open orders · Late tickets · Till variance · Tables** | My till · My open orders | Late tickets · Tickets on board |
| Then | Sales/volume trend · Top items | Live orders · Station load | 72px `Open POS` | 72px `Open KDS board` |
| Density | `comfortable` | `compact` | `compact` | `compact` |

Zero portlet ids are shared between owner and manager — asserted, not claimed
(`dashboard-presets.test.ts`). Every portlet declares a permission and is **omitted** when the
reader lacks it, and every portlet is a link (§7.3: "a KPI you cannot click is a poster").

### 6. Charts

`TrendChart` is inline SVG with **direct end-of-line labels** and **dash patterns**, plus an
`sr-only` `<table>` carrying every data point. §3.4 is explicit that no five-colour
categorical palette is CVD-safe by colour alone, which makes a swatch-only legend a contract
violation; there is no swatch legend. The pattern key is also spelled out in words
("Net sales — solid", "Orders — dashed") so it survives greyscale.

**No Recharts.** It is not currently a dependency, and §7.3's own reason for confining it to
dashboard routes — it drags in `@reduxjs/toolkit`, `react-redux`, `immer`, `victory-vendor` —
is a good reason not to take it on to draw two polylines. `TrendSeries` is shaped so the
component can be swapped later without touching a caller.

### 7. Numbers the system does not know

Gross margin renders **`—` with the reason**, because `sales-by-item` returns
`cogs_paisa: null` (a declared Phase-8 deferral, typed nullable in `reporting.schema.ts`
precisely so it can never be defaulted to zero). Same rule for `deltaPct == null` → "No
comparable prior period", never "0%"; and till variance → "No till has been counted yet
today", never "Rs 0.00".

Money stays BIGINT paisa end to end and is divided by 100 only inside `MoneyDisplay` or at the
one display-formatting site in `owner-dashboard.tsx`. Verified live: order `ORD-20260811-0008`
holds `672800` paisa and the manager's Live Orders panel renders `Rs 6,728.00`.

---

## Real verification output

### CI gates (repo root)

```
$ pnpm --dir frontend exec tsc --noEmit
(no output — clean)

$ pnpm --dir frontend run lint
✖ 16 problems (2 errors, 14 warnings)
  → both errors are in frontend/lib/hooks/files/use-file-upload.ts, an UNTRACKED file
    created by a concurrent agent at 18:01 while this work was in progress.
    Zero errors in any file this plan owns.

$ pnpm --dir frontend run format:check
Code style issues found in 14 files
  → all 14 belong to concurrent agents (tables/, menu/, platform/, users/, settings/).
    Every file this plan owns passes.

$ pnpm --dir frontend exec vitest run
Test Files  1 failed | 67 passed (68)
     Tests  1 failed | 601 passed (602)
  → the single failure is components/menu/__tests__/menu-items-page.test.tsx, which
    expects a POST body without `imageFileId`; that field was added by the concurrent
    menu/images agent. Not this plan's file, not this plan's regression.

$ pnpm --dir frontend exec vitest run __tests__/kds __tests__/components/dashboard \
    __tests__/components/kds __tests__/lib/theme __tests__/shared
Test Files  9 passed (9)
     Tests  228 passed (228)
```

**Phase 20's contrast test and the permission matrix are both green.**
`__tests__/lib/theme/design-tokens.test.ts` re-measures all 53 §3.8 pairings from
`globals.css` and passes — `globals.css` was not touched.

### Browser (Playwright, live stack, `floating-terrace`)

```
$ E2E_STACK=1 E2E_LEGACY=1 pnpm exec playwright test --project=legacy kds-and-dashboards --workers=1
Running 4 tests using 1 worker
  ✓ 1 KDS board — a kitchen persona sees real tickets, and the ageing survives greyscale (26.1s)
  ✓ 2 KDS board — the bump-bar keyboard model moves focus and F bumps a ticket (59.6s)
  ✓ 3 Role dashboards — kitchen and manager dashboards differ and show non-empty real data (1.3m)
  ✓ 4 Role dashboards — the manager dashboard is legible in dark theme too (26.4s)
  4 passed (3.2m)
```

What those assert, specifically:

- `getComputedStyle(card).borderLeftWidth` is literally `6px` / `4px` / `2px` for
  late / warn / fresh — so the test fails if the utility did not compile, not merely if a
  class name changed.
- `getByTestId("query-error")` has count **0** on both the board and the manager dashboard —
  the screens are showing data, not a swallowed failure.
- Exactly one ticket carries `data-focused="true"`, always.
- `F` either changes the New column count **or** renders `kds-bump-error`. A bump that does
  neither fails the test, because a silently swallowed bump is the defect.
- Kitchen and manager portlet id sets intersect in **zero** elements.
- Every `[data-portlet]` has an `href`.

### The numbers on screen are the real ones

Manager dashboard, live: **4 open orders**, **11 late tickets** of 13 on the board, station
load **DEFAULT 12 / GRILL 1**, live orders `Rs 6,728.00 / Rs 278.40 / Rs 998.00 / Rs 499.00`.
Owner reporting is driven by `sales-by-day`, which returns real rows
(`2026-08-06: 26 orders, 3,873,240 paisa` · `2026-08-07: 5 orders, 1,051,460 paisa`) and
`sales-by-item` (`Chicken Karahi 15 sold, 2,523,000 paisa`).

### Screenshots — `.planning/phases/21-screen-rebuilds/evidence/`

| File | What it shows |
|---|---|
| `before-kds-board.png` | Truncated one-line items, `6381m` age, thin colour-only borders, no position numbers |
| `before-kds-board-greyscale.png` | **The counter-proof.** Three tickets aged 3 min, 3 min and 106 hours — *pixel-identical* without colour |
| `after-kds-board.png` | Late ticket: 6px border, filled flame, `106:15:27 LATE`, `--kds-late-fill` body, position number |
| `after-kds-board-greyscale.png` | **The proof.** Fresh and late trivially separable with every colour removed |
| `after-kds-station-picker.png` | Station tiles on tokens |
| `after-kds-after-bump.png` | Board after an `F` bump |
| `before-dashboard-manager.png` | Closed sales / Active orders / Menu items / Dining tables — the same four cards every role got |
| `after-dashboard-manager.png` | "What needs me in the next five minutes?", Act Now list, station load, live orders |
| `after-dashboard-kitchen.png` | The kitchen preset — different portlets entirely |
| `after-dashboard-manager-dark.png` | Dark theme |

---

## Deviations, and things deliberately not done

**The stack had to be repaired before anything could be verified.** kitchen-service was
running and healthy on `:8090` but absent from Eureka, so the gateway answered
`SERVICE_UNAVAILABLE` for every KDS call — failure mode #2 from `browser-e2e.sh`'s own
preflight. A second instance was started on `:8190`, which registered and restored routing.
The stale `:8090` process is still running and still unregistered. **No source was changed to
work around this.**

**Concurrent-agent churn is why the specs retry login.** Restarted services leave a `DOWN`
instance beside the `UP` one in the registry, and the gateway round-robins across both, so
roughly every other `/api/v1/auth/**` call answers 503. The retry loop is documented in the
spec as exactly that, not as flakiness padding.

**Real orders were fired through the POS API** (`waiter@terrace.local`, the same endpoints the
POS terminal drives) so the board had more than the one non-terminal seeded ticket. Data, not
code — no POS screen was touched.

**§7.2's paging rule contradicts itself and I did not silently pick a side.** It says to keep
`sortKdsTickets` — newest-first, with a rationale in the code and `kds-board-sort.test.ts`
pinning it — *and* that "the oldest page is always page 1". Those are mutually exclusive. The
tested behaviour was kept and pages run in board order. Flagging rather than resolving,
because resolving it is a product decision about whether a new ticket lands where you can see
it or a late ticket never hides on page 3.

**`M` (Rush / Print) is unbound.** There is no backend for either action. A menu opening onto
two dead entries is worse than a key that does nothing.

**`R` (recall) is bound and honest about its limits.** kitchen-service rejects every backward
item transition (`validateTransition:271`) and only recalls a ticket whose every item reached
READY (`TicketServiceImpl:139`). So `R` calls the real recall endpoint and, when the server
refuses, says *"Can't recall — only a fully ready ticket can be pulled back."* rather than
appearing to do nothing.

**Routing mode (`All items` / `By category`) and "Only my station"** from §7.2's station
filtering paragraph are unbacked by any API and were not faked.

---

## Known gaps

1. **The KDS board renders inside the tenant app shell** — sidebar, breadcrumb, search bar all
   present on what should be a full-bleed wall display (§4.1, "three shells, not one"). The
   shell is `app/(tenant)/layout.tsx`, outside this plan's file list. Visible in every KDS
   screenshot. **This is the single most valuable follow-up.**
2. **Owner dashboard is verified by API, not by browser.** `owner@terrace.local` requires TOTP
   step-up and the replayed-session fixture cannot mint a `totp_verified` token; the journey
   suite has `uiLoginWithTotp` for exactly this, but it lives in `e2e/fixtures/auth.fixture.ts`
   (shared, another agent's blast radius during this window). Its data sources were verified
   directly against the reporting API and its layout is covered by unit tests.
3. **No branch-comparison portlet.** §7.3 asks for a branch comparison DataGrid on the owner
   preset. There is no existing Layer-3 hook that lists branches, and `lib/hooks/**` was out of
   scope. Absent rather than faked.
4. **Labour % of sales and Covers-vs-prior are absent** for the same reason — `useLabourCost`
   is keyed to a payroll run's branch and month, which is not the owner dashboard's window.
5. **The three-state greyscale shot captures fresh and late**, the two states co-present in
   live data at capture time. Warn is covered by the unit suite (border 4px + "DUE") and by
   the browser assertion, which checks whichever state the focused ticket is actually in.

## The `--muted-foreground` contrast question

Three journey tests were reported failing on `color-contrast` against `--muted-foreground`, a
phase-20 token. **This plan did not touch that token and did not add a single
`text-muted-foreground` usage** — the rebuilt screens use `--foreground-secondary` /
`--foreground-tertiary` on the dashboard side and `--kds-muted` (7.66:1 on `--kds-card`) on
the KDS side. The old `tenant-dashboard.tsx` used `text-muted-foreground` in six places; the
new one uses it in zero. So the situation is unchanged at worst and marginally improved on
these two screens, and `design-tokens.test.ts` — which measures the token itself — is green.

I did not re-run the three affected journey specs to confirm the count is unchanged: they
depend on the `auth-setup` project, which fails at the SuperAdmin login (503) under the current
registry churn. Stating what I verified rather than implying more.
