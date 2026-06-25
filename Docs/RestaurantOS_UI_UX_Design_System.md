# RestaurantOS — UI/UX Design System & Implementation Prompt

> **Status:** AUTHORITATIVE reference for all frontend work. Every GSD phase that touches the frontend (Phase 4 shell + module phases 5–12) MUST read this before writing components.
> **Companion to:** the GSD kickoff/spec docs.

---

## 0. Stack Adaptation Notice (READ FIRST — supersedes conflicting lines below)

This document was authored against an earlier assumed stack. The RestaurantOS frontend shell was **built and verified in Phase 4 on a newer stack**, and those choices are final project decisions. Where this document conflicts with the list below, **the built stack wins and the design *intent* is adapted to it** (decision: 2026-06-26, user-approved "adapt"):

| This doc originally says | ACTUAL project stack (authoritative) | How to apply the doc |
|---|---|---|
| Next.js 14 (App Router) | **Next.js 16.2.9** (App Router, Turbopack) | Use Next 16. `middleware.ts` → **`proxy.ts`**; `searchParams`/`headers()` are **awaited**. |
| Tailwind CSS 3.4 + `tailwind.config.ts` + `tailwindcss-animate` | **Tailwind CSS 4, CSS-first** (`@import "tailwindcss"`, `@theme inline` in `app/globals.css`, **NO** `tailwind.config.*`) + **`tw-animate-css`** | Port every `tailwind.config.ts` token/keyframe (§3.1) into `@theme`/CSS in `globals.css`. |
| HSL tokens `hsl(var(--x))` | **OKLCH** tokens (`oklch(...)`) | Translate the §3.2 HSL variables to OKLCH; the palette generator (§4.2) must emit OKLCH. |
| `frontend/src/components/...` | **Flat** `frontend/{app,components,lib}` (NO `src/`) | Map all §17 `src/` paths to the flat layout (e.g. `frontend/components/...`, `frontend/lib/...`). |
| `geist` npm package | **`next/font/google` Geist + Geist_Mono** (vars `--font-geist-sans` / `--font-geist-mono` already wired in `app/layout.tsx`) | Reuse the existing font vars; do not add the `geist` package. |
| (n/a) | **Four-layer API boundary is ENFORCED** (ESLint `no-restricted-imports` blocks components importing `@/lib/api-client/*` or `@/lib/repositories/*`) | All data access in these components MUST go through TanStack Query **hooks** → repositories. Never import the api-client/axios in a component. |
| (n/a) | **Already installed:** `sonner`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `@tanstack/react-query`, shadcn/ui (new-york), `next-themes`, `next-intl`, `zustand` | Reuse these; do not reinstall/duplicate. |
| Install list (§2) | **Not yet installed:** `framer-motion`, `recharts`, `react-countup`, `cmdk`, `date-fns`, `react-dropzone`, `@tanstack/react-virtual`, `@tanstack/react-table`, `colorjs.io` | Add as dev/runtime deps during the relevant gap-closure/module plan (owner of `frontend/package.json` per plan). |

**Money:** amounts are stored/transported as **BIGINT paisa**; never render raw paisa. Use a `<MoneyDisplay paisa={n} />` component (PKR formatting). The auth/session contract and `proxy.ts`/`has_session` model from Phase 4 are unchanged by this document.

Everything from §1 onward is the design intent. Treat stack-specific code blocks as **pseudocode to port**, not literal files.

---

## 1. Design Philosophy

RestaurantOS serves users who are under extreme time pressure — a cashier during dinner rush cannot afford a confusing interface. The design philosophy is built on five principles:

**1. Role-First.** A cashier and an accountant use the same product but must feel like they are using different apps. Every role gets a UI optimised entirely for their workflow. No irrelevant chrome, no cognitive clutter from features they cannot use.

**2. Speed is UX.** The most common actions must complete in the fewest possible steps. POS: order creation to payment in 3 taps. Dashboard: KPIs visible in under 2 seconds. Everything loads with skeletons — never blank screens, never spinners on data.

**3. The interface must feel alive.** Subtle, purposeful motion: data counting up on load, smooth page transitions, buttons that respond to touch, status changes that animate. Not decoration — feedback. The system must feel instantaneous and trustworthy.

**4. Progressive disclosure.** Show what the user needs right now. Everything else is one step away, never buried. Beginners see simple flows. Power users discover depth through the command palette, keyboard shortcuts, and contextual menus.

**5. Tenant identity.** Every restaurant owner should feel the product is theirs. The tenant's brand colour, logo, and name replace any RestaurantOS branding in the tenant-facing app. The platform is invisible; the tenant's brand is everything.

---

## 2. Technology Stack — UI Layer

> ⚠️ Adapted — see §0. We are on **Next 16 + Tailwind 4 CSS-first**. The original list is retained for the component-library intent (shadcn/Radix, Framer Motion, Recharts, react-countup, Sonner, cmdk, date-fns, react-dropzone, TanStack virtual/table, Lucide). Geist is delivered via `next/font/google` (no `geist` package). Install the not-yet-present libs during the relevant plan.

Original (reference) stack list:

```
Next.js 14 (App Router) — framework        → ACTUAL: Next.js 16
TypeScript 5 strict — language
Tailwind CSS 3.4 — utility styling          → ACTUAL: Tailwind CSS 4 (CSS-first)
shadcn/ui — base component library (Radix UI)
Framer Motion 11 — animations / transitions
Geist (Vercel) — primary typeface           → ACTUAL: next/font/google Geist
Lucide React — icon set
Recharts — charts and data visualisation
react-countup — animated number counting
Sonner — toast notifications
cmdk — command palette
date-fns — date formatting (timezone support)
react-dropzone — file upload
@tanstack/react-virtual — virtual lists
@tanstack/react-table — data tables
```

---

## 3. Design Tokens — The Foundation

> ⚠️ §3.1/§3.2 below are written for Tailwind 3.4 (`tailwind.config.ts` + HSL). **Port them into `app/globals.css`** using Tailwind 4 `@theme inline` and **OKLCH** values (the existing `globals.css` already defines `--background`, `--foreground`, `--card`, `--border`, `--input`, `--ring`, `--muted(-foreground)`, `--primary(-foreground)`, `--accent(-foreground)`, `--destructive`, `--radius`, chart + sidebar tokens, `.dark` overrides, and `@custom-variant dark`). Add the **missing semantic tokens** `--warning`, `--success`, `--info` (+ foregrounds) and the **animations/keyframes** (skeleton-shimmer, count-up/fadeSlideUp, slide-in-right, fade-in, scale-in, bounce-subtle) as CSS `@keyframes` + utilities. Keep `prefers-reduced-motion` reduction.

### 3.1 Token & animation intent (originally a `tailwind.config.ts`)

- **Fonts:** `sans` = `var(--font-geist-sans)`, `mono` = `var(--font-geist-mono)` (already wired).
- **Static neutrals (never change):** background, foreground, card(+fg), border, input, ring, muted(+fg).
- **Semantic states (never change):** `destructive`, `warning`, `success`, `info`.
- **Tenant-controlled (injected at runtime):** `primary(+fg)`, `accent(+fg)`.
- **Radius scale:** sm/md/lg/xl/2xl derived from `--radius` (0.625rem).
- **Animations:** `skeleton-shimmer` (shimmer 2s linear infinite), `count-up` (fadeSlideUp .5s), `slide-in-right` (.3s), `fade-in` (.2s), `scale-in` (.15s), `bounce-subtle` (.4s). Keyframes per the original doc.

Original snippet (port to `@theme`/CSS — do NOT create `tailwind.config.ts`):

```typescript
// tailwind.config.ts  ── PORT TO globals.css @theme (Tailwind 4). Reference only.
import type { Config } from 'tailwindcss'
const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'], // ACTUAL: flat dirs, content auto-detected by TW4
  theme: { extend: {
    fontFamily: { sans: ['var(--font-geist-sans)','system-ui','sans-serif'], mono: ['var(--font-geist-mono)','monospace'] },
    colors: {
      background:'hsl(var(--background))', foreground:'hsl(var(--foreground))',
      card:'hsl(var(--card))', 'card-foreground':'hsl(var(--card-foreground))',
      border:'hsl(var(--border))', input:'hsl(var(--input))', ring:'hsl(var(--ring))',
      muted:'hsl(var(--muted))', 'muted-foreground':'hsl(var(--muted-foreground))',
      destructive:'hsl(var(--destructive))', warning:'hsl(var(--warning))',
      success:'hsl(var(--success))', info:'hsl(var(--info))',
      primary:'hsl(var(--primary))', 'primary-foreground':'hsl(var(--primary-foreground))',
      accent:'hsl(var(--accent))', 'accent-foreground':'hsl(var(--accent-foreground))',
    },
    borderRadius: { sm:'calc(var(--radius) - 4px)', md:'var(--radius)', lg:'calc(var(--radius) + 4px)', xl:'calc(var(--radius) + 8px)', '2xl':'calc(var(--radius) + 16px)' },
    animation: {
      'skeleton-shimmer':'shimmer 2s linear infinite', 'count-up':'fadeSlideUp 0.5s ease-out',
      'slide-in-right':'slideInRight 0.3s ease-out', 'fade-in':'fadeIn 0.2s ease-out',
      'scale-in':'scaleIn 0.15s ease-out', 'bounce-subtle':'bounceSlight 0.4s ease-out',
    },
    keyframes: {
      shimmer:{ '0%':{ backgroundPosition:'-200% 0' }, '100%':{ backgroundPosition:'200% 0' } },
      fadeSlideUp:{ '0%':{ opacity:'0', transform:'translateY(8px)' }, '100%':{ opacity:'1', transform:'translateY(0)' } },
      slideInRight:{ '0%':{ opacity:'0', transform:'translateX(16px)' }, '100%':{ opacity:'1', transform:'translateX(0)' } },
      fadeIn:{ '0%':{ opacity:'0' }, '100%':{ opacity:'1' } },
      scaleIn:{ '0%':{ opacity:'0', transform:'scale(0.95)' }, '100%':{ opacity:'1', transform:'scale(1)' } },
      bounceSlight:{ '0%,100%':{ transform:'scale(1)' }, '50%':{ transform:'scale(1.05)' } },
    },
  } },
  plugins: [require('tailwindcss-animate')], // ACTUAL: tw-animate-css already imported
}
export default config
```

### 3.2 CSS Custom Properties — `globals.css`

> ⚠️ The existing `globals.css` already defines neutrals/primary/accent/radius/chart/sidebar tokens in **OKLCH** with `.dark`. Convert these HSL values to OKLCH and **add** the missing `--warning/--success/--info` (+ foregrounds) plus the `.skeleton` shimmer and the keyframes. Keep the `prefers-reduced-motion` block.

```css
/* Original HSL reference — translate to OKLCH and merge into existing globals.css */
@layer base {
  :root {
    --background:0 0% 100%; --foreground:224 71% 4%;
    --card:0 0% 100%; --card-foreground:224 71% 4%;
    --border:220 13% 91%; --input:220 13% 91%; --ring:var(--primary);
    --muted:220 14% 96%; --muted-foreground:220 9% 46%; --radius:0.625rem;
    --destructive:0 84% 60%; --warning:45 93% 47%; --success:142 71% 45%; --info:199 89% 48%;
    --primary:222 47% 11%; --primary-foreground:210 40% 98%;
    --accent:210 40% 96%; --accent-foreground:222 47% 11%;
  }
  .dark {
    --background:224 71% 4%; --foreground:210 40% 98%;
    --card:224 71% 8%; --card-foreground:210 40% 98%;
    --border:215 28% 17%; --input:215 28% 17%;
    --muted:215 28% 14%; --muted-foreground:217 11% 65%;
  }
}
.skeleton {
  background: linear-gradient(90deg, hsl(var(--muted)) 25%, hsl(var(--border)) 50%, hsl(var(--muted)) 75%);
  background-size:200% 100%; animation: shimmer 1.8s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after { animation-duration:0.01ms !important; transition-duration:0.01ms !important; }
}
```

---

## 4. Tenant Colour Palette System

### 4.1 Architecture

Every tenant chooses one primary hex colour and one accent hex colour in Settings → Appearance. The system derives a full 10-step scale from each and generates CSS custom properties served at runtime.

> Phase-4 reality: the shell ships a **static neutral** primary; this tenant-theming system is **new scope** (Settings→Appearance UI + a runtime theme endpoint + palette generation). The generator must emit **OKLCH** vars consistent with `globals.css`.

### 4.2 Colour Scale Generation — `lib/theme/generate-palette.ts`

> ⚠️ Emit OKLCH (not HSL) to match our tokens. `colorjs.io` is not yet installed.

```typescript
import Color from 'colorjs.io'

export function generateTenantCSSVars(primaryHex: string, accentHex: string): string {
  const primary = new Color(primaryHex)
  const accent  = new Color(accentHex)
  const primaryScale = generateScale(primary)
  const accentScale  = generateScale(accent)
  const p500 = primaryScale[5]
  const contrastOnDark = p500.contrast(new Color('white'), 'APCA')
  const useDarkText = Math.abs(contrastOnDark) < 45
  return `:root {
    --primary: ${toOklch(p500)};
    --primary-foreground: ${useDarkText ? '0.205 0 0' : '0.985 0 0'};
    --accent: ${toOklch(accentScale[1])};
    --accent-foreground: ${toOklch(accentScale[9])};
    ${primaryScale.map((c,i)=>`--primary-${(i+1)*100}: ${toOklch(c)};`).join('\n    ')}
    ${accentScale.map((c,i)=>`--accent-${(i+1)*100}: ${toOklch(c)};`).join('\n    ')}
  }`
}
function generateScale(base: Color): Color[] {
  const lightnesses = [0.97,0.93,0.88,0.80,0.70,0.58,0.46,0.35,0.25,0.15]
  const oklch = base.to('oklch')
  return lightnesses.map(l => new Color('oklch', [l, oklch.c * (l < 0.5 ? 1 : 0.9), oklch.h]))
}
function toOklch(c: Color): string { /* emit `L C H` triplet to match globals.css oklch() usage */ return '' }
```

### 4.3 Theme API Endpoint — Next.js route handler

```typescript
// app/api/theme/route.ts  (Next 16 route handler)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tenantId = searchParams.get('t')
  const theme = await fetchTenantTheme(tenantId) // Redis or DB
  const css = generateTenantCSSVars(theme.primaryHex, theme.accentHex)
  return new Response(css, { headers: {
    'Content-Type':'text/css',
    'Cache-Control':'public, max-age=300, stale-while-revalidate=3600',
  }})
}
```

### 4.4 Injection in `app/layout.tsx`

> ⚠️ Our `app/layout.tsx` already wires Geist via `next/font/google` and renders `<AppProviders>`. Add the tenant theme `<link>` (resolved tenant id) WITHOUT removing the existing font vars/providers. `searchParams`/tenant resolution is async in Next 16.

```tsx
// Inject tenant CSS before first paint — no FOUC. Merge into existing layout.
<head>
  <link rel="preload" href={themeUrl} as="style" />
  <link rel="stylesheet" href={themeUrl} />
</head>
```

### 4.5 Settings → Appearance UI

- Colour picker (hex input + native `<input type="color">`)
- Live preview panel: sidebar, button, badge, chart, table in chosen colours
- Six preset palettes: Ember Red, Forest Green, Ocean Blue, Royal Purple, Saffron Gold, Midnight Slate
- Logo upload: light variant (dark sidebar) + dark variant (light backgrounds)
- Font choice: Inter, Geist, Poppins, Nunito Sans (4 max)
- Preview updates instantly via `document.documentElement.style.setProperty('--primary', value)`
- "Save & Apply" persists to backend and clears the CDN cache for this tenant

---

## 5. Global Components

### 5.1 Skeleton Loading — Non-Negotiable Rule

**Every** data-fetching state renders a skeleton, never a spinner and never blank space. Skeletons must exactly mirror the shape of the loaded content. One skeleton component per major UI block.

```tsx
// components/ui/skeleton.tsx
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('skeleton rounded-md', className)} aria-hidden="true" {...props} />
}
// components/skeletons/revenue-card-skeleton.tsx — mirror exact shape of loaded content
```

Skeleton rules:
- `animate-pulse` (Tailwind) or the custom `shimmer` animation
- Match the exact number of skeleton lines to the loaded content
- `aria-hidden="true"` on all skeleton elements
- Transition skeleton → content with `animate-fade-in`
- Minimum skeleton display time: 300ms (prevents flash on fast networks)

### 5.2 Page Transitions — Framer Motion

Wrap every `page.tsx` in `<PageTransition>`. `hidden→visible→exit` = `opacity`+`y(8→0→-8)`, **200ms**, ease `[0.4,0,0.2,1]`.

### 5.3 Toast Notifications — Sonner

- Always `richColors`; `position="bottom-right"` (kitchen ceiling displays need top clear)
- Auto-dismiss: success 4s, info 4s, warning 6s, **error stays until dismissed**
- Non-blocking errors → toast; **destructive actions (void/delete) → `AlertDialog`, never just a toast**

```tsx
toast.success('Order closed', { description: 'ORD-0047 — PKR 2,457' })
toast.error('Payment failed', { description: 'Amount exceeds order total' })
toast.warning('Low stock', { description: 'Chicken — 0.8 kg remaining' })
toast.loading('Syncing 3 offline orders...')
```

### 5.4 Command Palette — `⌘K` / `Ctrl+K`

`cmdk`-based, global shortcut, always available. Searches: nav routes, recent orders, customers, menu items, vendors, reports, quick actions. Centered modal + blur backdrop. Footer hint on every page: `⌘K to search anything`.

### 5.5 Animated Number Component

`react-countup`-based. `format`: currency (paisa→PKR, `value/100`, prefix `PKR `), integer, percent (1 decimal). Count up from zero on first render; transition smoothly on WebSocket updates. Use on every KPI.

### 5.6 Status Badges

Map every status string → colour + label. Statuses: OPEN, SENT_TO_KDS (In Kitchen), READY, CLOSED, VOIDED, PENDING, APPROVED, MATCHED, MISMATCHED, LOW_STOCK, OUT_OF_STOCK, ACTIVE, SUSPENDED. (Status colours are semantic — these may use fixed palettes, NOT the tenant `primary`.)

---

## 6. Navigation Architecture

### 6.1 Sidebar (240px expanded | 64px collapsed | hidden on mobile)
Brand/logo, branch selector, grouped sections (Operations / Supply / Finance / People / Insights), then Settings + user/logout.
- Collapsed: icons only + hover tooltips
- Mobile: hidden → bottom nav (Home, POS, Orders, Reports, More)
- Sub-menus expand **inline** (no flyout — avoids touch-miss)
- Active route: `bg-primary/10 text-primary font-medium`
- Notification badges: red dot (unread) / number (actionable)
- **Role filtering: items the user can't access are completely ABSENT** (see Rule 10) — composes PermissionGuard + FeatureGuard (already in Phase-4 sidebar)
- Collapse/expand animation: 240ms ease-out

### 6.2 Top Bar
Page title + breadcrumb (full path), `⌘K` search, notification bell (last 5 grouped by severity), profile dropdown (profile, theme light/dark/system, help, logout). Mobile: hamburger replaces breadcrumb.

---

## 7. Role-Specific UX Layouts

### 7.1 POS — Cashier (Phase 7)
Touch-first, full-screen, ≤3 taps. Menu cards ≥`100×100px`; horizontally-scrollable category pills; "SEND TO KITCHEN" `h-12` success-green; "CHARGE NOW" `h-14 text-lg font-bold` tenant-primary (most prominent). Modifiers in bottom sheet (mobile) / right panel (tablet), 44px targets. Qty `+`/`−` ≥40px, long-press `−` removes. Full-screen fuzzy search overlay. Offline indicator `⚠ Offline — N orders queued`. Order panel fixed; items list scrolls within. Receipt modal: Print / Email / WhatsApp.

### 7.2 Kitchen Display System — Chef (Phase 7)
Always **dark mode**, no chrome. High contrast, readable at 2m. Ticket cards: 0–10m green border; 10–15m amber + pulsing glow; 15m+ red border + `red-950/30` bg + shake every 30s. Item names `text-2xl`. PENDING→COOKING→READY taps, distinct bg per state. READY auto-moves to done column (✓), archives after 60s. Optional `AudioContext` cue on new ticket.

### 7.3 Owner — Executive Dashboard
All numbers count-up on load, smooth on WebSocket. KPI cards: `text-4xl font-bold` number, `text-sm text-muted-foreground` label, ↑↓ trend (green/red), 60px Recharts sparkline (no axes). "Pending Actions" always visible, click → resolution. Drag-to-reorder per user (`PATCH /api/v1/users/me/dashboard-layout`). Charts interactive (hover tooltips, click→drill-down).

### 7.4 Accountant — Finance (Phase 6)
Data density, keyboard nav, **all money `font-mono tabular-nums`**. Dr/Cr right-aligned fixed width. Period chip OPEN (emerald)/LOCKED (amber)/CLOSED (slate). `Tab` rows, `Enter` open, `E` export. Bulk select+export. Every number is a link → breakdown; account → GL drill-down.

### 7.5 Inventory Manager (Phase 8)
Dense tables + stock health. 4px left border per row: red critical / amber low / green OK. `[PO+]` quick-add on low-stock rows. Mini progress bar per ingredient vs reorder threshold. Receive stock = slide-over panel (no full-page nav).

---

## 8. Module-Specific UX Requirements

### 8.1 NLQ — AI Assistant (Phase 12)
User bubbles right (primary/accent bg), AI left (card bg). Thinking = animated `●●●` (not spinner). Recharts embedded in AI bubble. "Show SQL" collapsible syntax-highlighted block. Quota indicator top-right (green→amber@80%→red@100%; disable input + upgrade CTA at 100%). 3 refreshing suggestion chips. History sidebar (last 20). Illustrated first-use onboarding with 5 example questions.

### 8.2 Reports (Phase 12)
Card grid (icon/name/description/Run). Runs in right-side **drawer** (keep context). Collapsed Filters at top. Inline charts. `[PDF][Excel][CSV]` top-right. `[Schedule ▼]` per card.

### 8.3 HR — Payroll Run Wizard (Phase 11)
Steps: Select Period → Review Employees → Verify Calculations → Approve & Pay. Step indicator with connecting lines. Employee rows: avatar/name/gross/deductions (hover expand)/net. Editable cells in step 3. Step 4: large "Approve Payroll" + confirmation modal with total summary.

### 8.4 Vendor — Three-Way Match (Phase 10)
PO | Goods Received | Invoice columns, colour-coded green/amber/red (OK / within tolerance / exceeds). Override button only for Accountant/Owner, with mandatory text field.

---

## 9. Micro-Interactions Catalogue

Implement via CSS transitions or Framer Motion. Key entries: button hover `scale(1.02)`+shadow 120ms; press `scale(0.97)` 80ms; success checkmark+green flash 300ms (spring); card hover `translateY(-2px)` 150ms; sidebar item fill-from-left 100ms; table row `muted/40` 80ms; dropdown `scaleY(0→1)` 150ms; modal open `scale(0.95→1)`+fade 200ms / close 150ms; toast enter slide-from-right 300ms (spring) / exit 200ms; badge pulse `scale(1→1.2→1)` 400ms (spring); status crossfade 300ms; page transition fade+`y(8→0)` 200ms; accordion `height(0→auto)` 200ms; KPI count-up 1200ms; skeleton→content fade 300ms; chart bars from y-axis 600ms; switch knob spring(120,12); checkbox path-draw 150ms. **All respect `prefers-reduced-motion`.**

---

## 10. Responsiveness

Breakpoints: `sm`640 / `md`768 (POS) / `lg`1024 (admin) / `xl`1280 (owner) / `2xl`1536.

| Element | Mobile `<md` | Tablet `md` | Desktop `lg+` |
|---|---|---|---|
| Sidebar | Hidden (bottom nav) | Icon-only collapsed | Expanded 240px |
| POS menu grid | 2 col | 3 col | 4 col |
| Dashboard KPI grid | 1 col | 2 col | 4 col |
| Data tables | H-scroll | H-scroll | Full |
| Reports drawer | Full-screen modal | 60vw | 40vw |
| KDS | 1/row | 2 col | 3–4 col |

Mobile bottom nav (`<md`): Dashboard / POS / Orders / Reports / More.

---

## 11. Accessibility — WCAG 2.1 AA minimum (non-negotiable)
- Contrast ≥4.5:1 normal, ≥3:1 large. **Tenant colour validator must reject colours failing AA** on the generated foreground.
- All interactive: `focus-visible` ring `ring-2 ring-ring ring-offset-2`; never remove outline without visible replacement.
- Keyboard: tab order = visual order; modals trap focus; `Escape` closes overlays.
- Screen readers: icon-only buttons `aria-label`; skeletons `aria-hidden="true"`; status changes `aria-live="polite"`.
- Colour never the sole information conveyor (pair with icon/text).
- Touch targets ≥44×44px (`min-h-11 min-w-11`).
- Body ≥14px, inputs ≥16px (prevents iOS zoom).
- Form errors via `aria-describedby`, visible below field (not tooltip).

---

## 12. Dark Mode
`next-themes` (already wired), light/dark/system, persisted (localStorage + profile). Both modes in `globals.css`. Tenant primary derives both variants. Charts adapt axis/grid via `useTheme()`. **KDS always dark.** POS follows user preference.

---

## 13. Performance Targets
FCP <1.0s · LCP <2.0s · TTI <2.5s · CLS <0.05 (skeletons) · INP <100ms · Dashboard KPIs <1.5s · POS menu <800ms (SW cache) · chart <300ms · page transition 200ms perceived. Techniques: `next/image`; route code-split; `@tanstack/react-virtual` for >100 items; prefetch links on hover; SW caches menu/assets/fonts; Recharts `isAnimationActive={false}` on SSR, enable on client.

---

## 14. Empty States
Every empty list / zero-result / first-use view shows an intentional empty state (SVG ~120px muted/tenant-primary illustration + title + description + optional CTA). Per-module: Orders→"Go to POS"; Inventory→"Add First Ingredient"; Finance→"Post Journal Entry"; Reports→"Run your first report"; NLQ→animated sparkle + 5 examples; Vendors→"Add First Vendor".

---

## 15. Error States
Field validation → inline red + red border. Recoverable API error → toast (or inline banner above submit in forms). 404 → full-page illustration + "Go Back". 403 → inline "no access" card. 503 → full-page + Retry w/ exponential backoff. Offline (POS) → amber banner (not modal). Schema mismatch (ZodError) → silent GlitchTip capture + toast "Something went wrong. Our team has been notified."

---

## 16. Onboarding & First-Use
**New Tenant Setup Wizard** (after first login, 5 steps, cannot skip): Welcome (brand/logo/primary colour live preview) → First Branch (name/address/timezone/currency) → Fiscal Year (Pakistan Jul–Jun) → Invite Team (skippable) → Done (confetti + "Open your Dashboard").
**Feature Discovery Tooltips:** dismissible coach marks, one at a time, "Got it" + "Learn more", state persisted in profile.

---

## 17. Implementation File Structure (Frontend UI)

> ⚠️ Map all `src/` paths to our **flat** layout: `frontend/components/...`, `frontend/lib/...`, `frontend/app/...` (NO `src/`).

```
frontend/
├── components/
│   ├── ui/                 (shadcn + custom: skeleton, animated-number, status-badge, money-display, data-table, empty-state, ...)
│   ├── layout/             (sidebar, topbar, mobile-nav, page-transition, command-palette)
│   ├── skeletons/          (one per major view)
│   ├── pos/ dashboard/ inventory/ finance/ hr/ crm/ reports/ nlq/
│   └── settings/appearance/(colour-picker, theme-preview, logo-uploader)
└── lib/
    └── theme/              (generate-palette, use-tenant-theme, theme-presets [6 presets])
```

---

## 18. Absolute UI/UX Rules — Never Break

1. **Skeleton first, always.** No spinner where a skeleton is possible.
2. **Paisa stays server-side.** Render via `<MoneyDisplay paisa={value} />`.
3. **Tenant colour never hardcoded.** Use `text-primary`/`bg-primary`/`text-accent`/`bg-accent` for brand elements — never `text-blue-600` etc.
4. **Touch targets ≥44px** everywhere (`min-h-11 min-w-11`).
5. **Empty states always illustrated.**
6. **Animations respect `prefers-reduced-motion`.**
7. **Forms never full-page-navigate on error.** Inline / toast / banner.
8. **AI Assistant always one click away** — persistent `[🤖 Ask AI]` FAB (bottom-right, `z-50`) on dashboard + report pages; opens NLQ drawer without navigation.
9. **Numbers in tables always monospace** (`font-mono tabular-nums`).
10. **Role-based visibility IS the UX.** Inaccessible items are completely absent from navigation (never greyed-out). Enforced via PermissionGuard + FeatureGuard (Phase 4).
