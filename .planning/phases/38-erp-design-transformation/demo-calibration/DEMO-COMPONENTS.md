# DEMO-COMPONENTS — Component Vocabulary of `Docs/NEXUS_ERP_Demo.html`

Read-only extraction. Source of every recipe below: `/Users/muhammadumer/Documents/Projects/ResturantOS/Docs/NEXUS_ERP_Demo.html` (1562 lines; `wc -l`).

**Method.** The whole stylesheet is one `<style>` block, `Docs/NEXUS_ERP_Demo.html:9–517`. Markup body starts at `:519` (`grep -n '^<body>'`). Every CSS declaration below is transcribed verbatim from the cited line — none is paraphrased or reconstructed. Usage counts come from tokenising every `class="…"` attribute at or after line 519:

```
awk 'NR>=519' Docs/NEXUS_ERP_Demo.html | grep -oE 'class="[^"]*"' \
  | sed 's/class="//;s/"$//' | tr ' ' '\n' | grep -v '^$' | sort | uniq -c | sort -rn
```

Structural facts measured up front:

| Measurement | Command | Value |
|---|---|---|
| Distinct CSS class selectors (base) | `sed -n '9,517p' … \| grep -oE '^\s*\.[a-zA-Z0-9_-]+' \| sort -u \| wc -l` | **128** |
| Distinct selectors incl. modifiers (`.gold`, `.active`, `.up`…) | `grep -oE '\.[a-zA-Z][a-zA-Z0-9_-]*' \| sort -u \| wc -l` | **155** |
| `class="` attributes in body | `awk 'NR>=519' … \| grep -oE 'class="' \| wc -l` | **979** |
| `style="` attributes in body | `awk 'NR>=519' … \| grep -oE 'style="' \| wc -l` | **235** |
| Inline `<svg>` elements in body | `grep -oE '<svg' \| wc -l` | **62** |
| `@media` blocks | `grep -n '@media'` | **1** — `:53`, `prefers-reduced-motion` only. **Zero responsive breakpoints.** |
| `@keyframes` | `grep -n '@keyframes'` | **2** — `pulse` `:182`, `fadeIn` `:191` |
| Light-mode support | `grep -c 'prefers-color-scheme\|data-theme'` | **0** — dark-only, single palette |

---

## 0. Foundation — design tokens (`:13–50`)

Not a component, but every recipe below dereferences these, so they are the contract.

```css
:root {
  --bg:           #080C12;   --bg-2:         #0D1320;   --bg-3:         #111827;
  --surface:      #141E2E;   --surface-2:    #1A2740;   --surface-3:    #1E2E48;
  --border:       #1F2E45;   --border-2:     #263850;
  --primary:      #E8A045;   --primary-dim:  #C4822E;
  --primary-glow: rgba(232,160,69,0.15);  --primary-soft: rgba(232,160,69,0.08);
  --teal:   #2DD4BF;  --teal-dim: #0D9488;  --teal-soft:   rgba(45,212,191,0.08);
  --blue:   #60A5FA;                        --blue-soft:   rgba(96,165,250,0.08);
  --red:    #F87171;                        --red-soft:    rgba(248,113,113,0.08);
  --green:  #4ADE80;                        --green-soft:  rgba(74,222,128,0.08);
  --purple: #A78BFA;                        --purple-soft: rgba(167,139,250,0.08);
  --text:   #F0F4FF;  --text-2: #94A3B8;  --text-3: #5A6E8A;
  --font-display: 'Fraunces', Georgia, serif;
  --font-body:    'Sora', sans-serif;
  --font-mono:    'DM Mono', monospace;
  --radius: 10px;  --radius-lg: 16px;  --radius-xl: 22px;
  --t-fast: 150ms ease;  --t-med: 250ms ease;  --t-slow: 400ms ease;
  --shadow:       0 4px 24px rgba(0,0,0,0.4);
  --shadow-lg:    0 8px 48px rgba(0,0,0,0.6);
  --glow-primary: 0 0 32px rgba(232,160,69,0.2);
}
```

Six-hue accent system: **gold** (`--primary`, brand + money), **teal** (positive/live), **blue** (informational), **red** (danger), **green** (success), **purple** (people/loyalty). Every `-soft` is the same hue at **8% alpha** — one uniform tinting rule, no per-component alpha guesses.

Three fonts, three jobs: `--font-display` (Fraunces, serif) is used **only** on `.page-title` (`:197`) and `.kpi-value` (`:248`) and `.logo-mark` (`:93`). `--font-mono` (DM Mono) carries every number. `--font-body` (Sora) everything else. `--radius-xl: 22px` is declared and **never referenced** (`grep -c 'radius-xl' → 1`, the declaration itself).

Base reset (`:55–60`): `html { font-size: 14px }` — the whole demo's `px` values are against a **14px root**, not 16px. `button { cursor:pointer; font-family: var(--font-body); border:none; background:none }`.

Reduced motion (`:53`):
```css
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }
```

Scrollbar (`:492–495`): `::-webkit-scrollbar { width:4px; height:4px }`, transparent track, `--border-2` thumb → `--text-3` on hover. A 4px scrollbar is a deliberate choice to keep dense panels from losing 15px of width.

---

## 1. Layout shell

### `.app-shell` — `:65` · used 1×
```html
<div class="app-shell"> <nav class="sidebar">…</nav> <div class="main-area">…</div> </div>
```
```css
.app-shell { display: flex; height: 100vh; overflow: hidden; }
```
**Intent:** a fixed-viewport application frame — the page itself never scrolls, only the one designated pane does.

### `.main-area` — `:148` · used 1×
```css
.main-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
```

### `.content-area` — `:184` · used 1×
```css
.content-area { flex: 1; overflow-y: auto; padding: 24px; }
```
**Intent:** the single scroll container in the app; sidebar and topbar are always on screen.

### `.screen` / `.screen.active` — `:189–191` · used 11× (one per module)
```html
<div id="screen-dashboard" class="screen active">…</div>
```
```css
.screen { display: none; animation: fadeIn 0.25s ease; }
.screen.active { display: block; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
```
**Intent:** an SPA route swap that costs one class toggle and announces itself with a 6px rise so the eye knows content changed rather than re-flowed.

---

## 2. Sidebar

### `.sidebar` + `.sidebar::after` — `:68–83` · used 1×
```html
<nav class="sidebar">
  <div class="sidebar-logo">…</div>
  <div class="sidebar-nav">…nav-groups…</div>
  <div class="sidebar-footer">…</div>
</nav>
```
```css
.sidebar {
  width: 240px; min-width: 240px;
  background: var(--bg-2);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
  transition: width var(--t-med);
  z-index: 100;
  position: relative;
}
.sidebar::after {
  content: '';
  position: absolute; top: 0; right: 0; bottom: 0;
  width: 1px;
  background: linear-gradient(180deg, transparent, var(--primary) 40%, var(--teal) 70%, transparent);
  opacity: 0.3;
}
```
**Intent:** a fixed 240px rail whose edge carries a faint gold→teal gradient seam — a single decorative gesture that signs the product without costing any content space. (`transition: width` is present but nothing ever changes the width — collapse is not implemented.)

### `.sidebar-logo` / `.logo-mark` / `.logo-text` / `.logo-sub` — `:85–99` · 1× each
```html
<div class="sidebar-logo">
  <div class="logo-mark">N</div>
  <div>
    <div class="logo-text">NEXUS</div>
    <div class="logo-sub">Restaurant ERP</div>
  </div>
</div>
```
```css
.sidebar-logo { padding: 20px 20px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; }
.logo-mark {
  width: 34px; height: 34px; border-radius: 8px;
  background: linear-gradient(135deg, var(--primary), var(--primary-dim));
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-weight: 800; font-size: 16px; color: var(--bg);
  box-shadow: 0 2px 12px rgba(232,160,69,0.3);
  flex-shrink: 0;
}
.logo-text { font-size: 13px; font-weight: 700; letter-spacing: 0.08em; color: var(--text); }
.logo-sub  { font-size: 10px; color: var(--text-3); font-weight: 400; letter-spacing: 0.05em; }
```
**Intent:** a monogram tile — gradient fill plus its own coloured glow — so the brand reads as an object rather than a wordmark, with the product category demoted to a 10px sub-line.

### `.sidebar-nav` / `.nav-group` / `.nav-group-label` — `:101–106` · 1× / 10× / 5×
```html
<div class="sidebar-nav">
  <div class="nav-group">
    <div class="nav-group-label">Operations</div>
    <div class="nav-item">…</div>
  </div>
</div>
```
```css
.sidebar-nav { flex: 1; overflow-y: auto; padding: 10px 0; }
.nav-group { margin-bottom: 4px; }
.nav-group-label {
  font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: var(--text-3);
  padding: 10px 20px 4px; text-transform: uppercase;
}
```
Measured group set (`:583–719`): **Overview, Operations, Business, Insights, System** — 5 labels over 11 nav items.
**Intent:** letterspaced 10px caps at the dimmest text tier — a label that organises without competing with the items beneath it.

### `.nav-item` (+ `.active`, `::before` rail, `svg`) — `:107–125` · used 11×
```html
<div class="nav-item active" onclick="showScreen('dashboard')">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">…</svg>
  Dashboard
  <span class="nav-badge gold">3</span>
</div>
```
```css
.nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 20px; cursor: pointer; border-radius: 0;
  color: var(--text-2); font-size: 13px; font-weight: 400;
  transition: all var(--t-fast); position: relative;
}
.nav-item:hover { color: var(--text); background: var(--surface); }
.nav-item.active {
  color: var(--primary);
  background: var(--primary-soft);
}
.nav-item.active::before {
  content: ''; position: absolute; left: 0; top: 4px; bottom: 4px;
  width: 3px; border-radius: 0 3px 3px 0;
  background: var(--primary);
  box-shadow: 0 0 8px var(--primary);
}
.nav-item svg { width: 16px; height: 16px; flex-shrink: 0; opacity: 0.8; }
.nav-item.active svg { opacity: 1; }
```
| state | color | background | rail | icon opacity |
|---|---|---|---|---|
| rest | `--text-2` | none | — | 0.8 |
| `:hover` | `--text` | `--surface` | — | 0.8 |
| `.active` | `--primary` | `--primary-soft` | 3px gold, `0 0 8px` glow, inset 4px top/bottom | 1 |

**Intent:** active state fires on four channels at once (hue, tint, a glowing left rail, icon opacity) so the current module is unmistakable in peripheral vision; `border-radius: 0` and full-bleed padding make the row read as a slab, which is what lets the rail sit flush at `left: 0`.

### `.nav-badge` / `.nav-badge.gold` — `:126–131` · used 2×
```html
<span class="nav-badge gold">3</span>   <!-- POS Terminal -->
<span class="nav-badge">5</span>        <!-- Inventory -->
```
```css
.nav-badge {
  margin-left: auto; font-size: 10px; font-weight: 600;
  background: var(--red); color: white;
  padding: 1px 6px; border-radius: 10px;
}
.nav-badge.gold { background: var(--primary); color: var(--bg); }
```
**Intent:** two severities only — red is "something is wrong", gold is "something is waiting for you" — and `margin-left:auto` pins it to the rail edge so the count column is scannable down the whole nav.

### `.sidebar-footer` / `.avatar-sm` / `.user-info-sm` / `.user-name-sm` / `.user-role-sm` — `:133–145`
```html
<div class="sidebar-footer">
  <div class="avatar-sm">AR</div>
  <div class="user-info-sm">
    <div class="user-name-sm">Ahmed Raza</div>
    <div class="user-role-sm">Super Admin</div>
  </div>
  <svg width="14" height="14" …stroke="#5A6E8A"…/>
</div>
```
```css
.sidebar-footer { padding: 12px 16px; border-top: 1px solid var(--border); display: flex; align-items: center; gap: 10px; }
.avatar-sm {
  width: 30px; height: 30px; border-radius: 50%;
  background: linear-gradient(135deg, var(--primary), var(--teal));
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; color: var(--bg); flex-shrink: 0;
}
.user-info-sm { flex: 1; min-width: 0; }
.user-name-sm { font-size: 12px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.user-role-sm { font-size: 10px; color: var(--text-3); }
```
`.avatar-sm` is used **10×** total — once in the footer at 30px, and 9× inside tables, each overriding size and gradient inline, e.g. `:1002`: `style="width:28px;height:28px;font-size:11px;background:linear-gradient(135deg,#2DD4BF,#0D9488)"`. **Measured: the demo has no avatar colour variants in CSS — every table avatar hardcodes a two-stop gradient inline (7 distinct gradients across HR `:1002–1006` and Admin `:1284–1287`).**
**Intent:** identity as a gold→teal gradient initials disc; the footer pins "who am I / what can I do" to the bottom of the rail where it never scrolls away.

---

## 3. Topbar

### `.topbar` — `:150–156` · 1×
```html
<div class="topbar">
  <div class="topbar-breadcrumb">…</div>
  <div class="topbar-right">…</div>
</div>
```
```css
.topbar {
  height: 56px; min-height: 56px;
  background: var(--bg-2);
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 16px;
  padding: 0 24px;
}
```
Note the demo hardcodes this 56px into `.pos-layout` (`:360`, `calc(100vh - 56px - 48px)`) — a coupling, not a token.

### `.topbar-breadcrumb` / `.current` / `.topbar-sep` — `:157–159`
```html
<div class="topbar-breadcrumb">
  <span>NEXUS</span><span class="topbar-sep">/</span><span class="current" id="topbar-current">Dashboard</span>
</div>
```
```css
.topbar-breadcrumb { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-2); }
.topbar-breadcrumb .current { color: var(--text); font-weight: 600; }
.topbar-sep { opacity: 0.3; }
```
**Intent:** two levels max, separator dimmed to 30% so the slash never reads as content; JS rewrites `#topbar-current` from a `screenNames` map (`:1319–1324, :1333`).

### `.topbar-right` / `.topbar-time` — `:161–162`
```css
.topbar-right { margin-left: auto; display: flex; align-items: center; gap: 12px; }
.topbar-time { font-family: var(--font-mono); font-size: 12px; color: var(--text-3); }
```
`.topbar-time` is driven by `setInterval(updateClock, 1000)` (`:1344`) rendering `toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})`.
**Intent:** a live wall clock in mono at the dimmest tier — ambient, never a focal point, but present because shift-based operations reason in clock time.

### `.topbar-btn` + `.notif-dot` — `:163–174` · 2× / 1×
```html
<button class="topbar-btn" style="position:relative">
  <svg width="15" height="15" …/>
  <div class="notif-dot"></div>
</button>
```
```css
.topbar-btn {
  width: 32px; height: 32px; border-radius: 8px;
  background: var(--surface); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  color: var(--text-2); transition: all var(--t-fast); position: relative;
}
.topbar-btn:hover { color: var(--text); border-color: var(--border-2); }
.notif-dot {
  position: absolute; top: 6px; right: 6px;
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--red); border: 1px solid var(--bg-2);
}
```
**Intent:** a 32px square icon affordance whose hover lifts *border* and *text* only (no fill change) so the chrome stays quiet; the dot carries a 1px `--bg-2` ring so it stays legible where it overlaps the glyph.

### `.live-pill` / `.live-dot` + `@keyframes pulse` — `:175–182` · 1× each
```html
<div class="live-pill"><div class="live-dot"></div>LIVE</div>
```
```css
.live-pill {
  display: flex; align-items: center; gap: 5px;
  background: var(--green-soft); border: 1px solid rgba(74,222,128,0.2);
  padding: 3px 10px; border-radius: 20px;
  font-size: 11px; font-weight: 600; color: var(--green); letter-spacing: 0.05em;
}
.live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); animation: pulse 2s infinite; }
@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.8)} }
```
**Intent:** the only perpetual animation in the product — a 2s breath that says "this data is arriving, not cached", earned because staleness is the one thing a live ops dashboard must never fake.

---

## 4. Page-level primitives

### `.page-header` / `.page-title` / `.page-subtitle` — `:196–198` · 11× each
```html
<div class="page-header flex-between">
  <div>
    <div class="page-title">Good morning, Ahmed ☕</div>
    <div class="page-subtitle">Monday, 14 April 2025 — Al-Baik Restaurant, Branch 1</div>
  </div>
  <div class="flex gap-2">
    <button class="btn btn-ghost btn-sm">…Export</button>
    <button class="btn btn-primary btn-sm">…New Order</button>
  </div>
</div>
```
```css
.page-header  { margin-bottom: 24px; }
.page-title   { font-family: var(--font-display); font-size: 26px; font-weight: 600; color: var(--text); line-height: 1; }
.page-subtitle{ font-size: 12px; color: var(--text-3); margin-top: 4px; }
```
`.page-header` is composed with `.flex-between` in **all 11** occurrences. Measured subtitle content pattern: a `·`-joined fact list, e.g. `:761` `"138 ingredients · 5 alerts · Last count: Today 08:00"`, `:874` `"127 orders today · $4,218 revenue · 3 active"`. Title uses **no `<h1>`** — every one is a `<div>` (`grep -c '<h1' → 0`).
**Intent:** the one serif moment per screen, sized 26px against a 12px dim fact-line, so the page announces itself in a different voice from its data and the action pair sits on the same optical baseline.

### `.card` / `.card-sm` / `.card-title` — `:200–207` · 34× / **0×** / 32×
```html
<div class="card">
  <div class="card-title">Live Operations</div>
  …
</div>
```
```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);   /* 16px */
  padding: 20px;
}
.card-sm { padding: 16px; }
.card-title { font-size: 12px; font-weight: 600; color: var(--text-2); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px; }
```
Two recurring composition idioms, both measured:
- **Table card** — `class="card" style="padding:0;overflow:hidden"` (`:830`, `:903`, `:1029`, `:1094`, `:1157`…): kills padding so a `.data-table` can bleed edge to edge, then a header strip is hand-rolled as `style="padding:16px 20px;border-bottom:1px solid var(--border)"` with the title overridden to `style="margin:0"`.
- **Inset row card** — `style="padding:10px;background:var(--bg-3);border-radius:8px;border:1px solid var(--border)"`, repeated **21×** (`grep -c 'padding:10px;background:var(--bg-3)'`) across Vendors/CRM/Reports/Admin as an ad-hoc list-row surface with **no class of its own** — the single largest un-componentised pattern in the demo.

**Intent:** one flat surface at one elevation for everything; hierarchy comes from the uppercase micro-label, not from shadows or nesting.

### `.grid-2` / `.grid-3` / `.grid-4` / `.grid-auto` — `:209–212` · 8× / 3× / 6× / **0×**
```css
.grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.grid-auto { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
```
**Measured: 7 of the 8 `.grid-2` uses immediately override the template inline** (`awk 'NR>=519' … | grep -c 'class="grid-2[^"]*"[^>]*grid-template-columns'` → 7): `2fr 1fr` at `:678`, `:852`, `:1039`; `3fr 2fr` at `:937`, `:1148`, `:1283`; `2fr 1fr;margin-bottom:16px` at `:995`. Only `:1098` (CRM) uses the bare 1:1. So `.grid-2` in practice means "a two-column region at 16px gutter", and the ratio is a per-screen decision.
**Intent:** a fixed 16px gutter is the only shared rule; column ratios are treated as content decisions rather than layout tokens. `.grid-4` is exclusively the KPI strip.

---

## 5. KPI card family

### `.kpi-card` (+ 6 hue variants) — `:215–232` · 24×
```html
<div class="kpi-card gold">
  <div class="kpi-icon gold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">…</svg></div>
  <div class="kpi-label">Today's Revenue</div>
  <div class="kpi-value">$4,218</div>
  <div class="kpi-change up">
    <svg width="12" height="12" … stroke-width="3"><polyline points="18 15 12 9 6 15"/></svg>
    +12.4% <span class="kpi-meta">vs last Mon</span>
  </div>
</div>
```
```css
.kpi-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px;
  position: relative; overflow: hidden;
  transition: all var(--t-fast);
}
.kpi-card:hover { border-color: var(--border-2); transform: translateY(-1px); box-shadow: var(--shadow); }
.kpi-card::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
}
.kpi-card.gold::before   { background: linear-gradient(90deg, var(--primary), transparent); }
.kpi-card.teal::before   { background: linear-gradient(90deg, var(--teal),    transparent); }
.kpi-card.blue::before   { background: linear-gradient(90deg, var(--blue),    transparent); }
.kpi-card.red::before    { background: linear-gradient(90deg, var(--red),     transparent); }
.kpi-card.green::before  { background: linear-gradient(90deg, var(--green),   transparent); }
.kpi-card.purple::before { background: linear-gradient(90deg, var(--purple),  transparent); }
```
Note: the base `::before` declares **no background**, so a `.kpi-card` with no hue class renders a 2px transparent strip — the rail is opt-in per variant. Hue distribution across the 24 instances (`grep -oE 'kpi-card (gold|teal|blue|red|green|purple)' | sort | uniq -c`): **gold 5, teal 5, blue 5, red 4, green 3, purple 2**.

### `.kpi-icon` (+ 6 hue variants) — `:234–245` · 24×
```css
.kpi-icon {
  width: 36px; height: 36px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 12px;
}
.kpi-icon.gold   { background: var(--primary-soft); color: var(--primary); }
.kpi-icon.teal   { background: var(--teal-soft);    color: var(--teal); }
.kpi-icon.blue   { background: var(--blue-soft);    color: var(--blue); }
.kpi-icon.red    { background: var(--red-soft);     color: var(--red); }
.kpi-icon.green  { background: var(--green-soft);   color: var(--green); }
.kpi-icon.purple { background: var(--purple-soft);  color: var(--purple); }
.kpi-icon svg { width: 18px; height: 18px; }
```
The hue class is always repeated on card and icon (`kpi-card gold` + `kpi-icon gold`) — the demo never mixes them.

### `.kpi-label` / `.kpi-value` / `.kpi-change` / `.kpi-meta` — `:247–252`
```css
.kpi-label { font-size: 11px; color: var(--text-3); font-weight: 500; letter-spacing: 0.05em; margin-bottom: 4px; }
.kpi-value { font-family: var(--font-display); font-size: 28px; font-weight: 600; color: var(--text); line-height: 1; }
.kpi-change { display: flex; align-items: center; gap: 4px; margin-top: 6px; font-size: 11px; font-weight: 600; }
.kpi-change.up   { color: var(--green); }
.kpi-change.down { color: var(--red); }
.kpi-change .kpi-meta { color: var(--text-3); font-weight: 400; }
```
Counts: `.kpi-label` 24, `.kpi-value` 24, `.kpi-change` 16, `.kpi-meta` 16, `.up` 13, `.down` 3 — so **8 of 24 KPI cards deliberately carry no delta row** (all four Orders KPIs `:898–901`, three of four HR `:1054–1056`, one CRM `:1121`).

`.up`/`.down` control colour only; the chevron direction is chosen by the **author in the markup** — `points="18 15 12 9 6 15"` (up) vs `points="18 9 12 15 6 9"` (down). **Measured semantic inversion:** `:667` Food-Cost-% uses `.down` for `−1.2% vs budget 30%` (falling cost = good, shown red) while `:788` Waste uses `.up` for `−32% vs last week` (falling waste = good, shown green). So the class encodes *sentiment*, not arithmetic direction — and the demo is inconsistent about which.

**Intent:** a four-line vertical read — tinted icon chip → dim label → oversized serif number → coloured delta with a grey comparison basis — so the number is legible from across a room and the context is available on approach without ever competing with it.

---

## 6. Badges & status marks

### `.badge` (+ 6 tones) / `.badge-dot` — `:255–265` · 58× / 17×
```html
<span class="badge green"><span class="badge-dot"></span>OK</span>
<span class="badge teal">Dine-in</span>
<span class="badge gray">Served</span>
```
```css
.badge {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 20px;
}
.badge.green { background: var(--green-soft);        color: var(--green);  border: 1px solid rgba(74,222,128,0.2); }
.badge.red   { background: var(--red-soft);          color: var(--red);    border: 1px solid rgba(248,113,113,0.2); }
.badge.gold  { background: var(--primary-soft);      color: var(--primary);border: 1px solid rgba(232,160,69,0.2); }
.badge.blue  { background: var(--blue-soft);         color: var(--blue);   border: 1px solid rgba(96,165,250,0.2); }
.badge.teal  { background: var(--teal-soft);         color: var(--teal);   border: 1px solid rgba(45,212,191,0.2); }
.badge.gray  { background: rgba(255,255,255,0.04);   color: var(--text-2); border: 1px solid var(--border); }
.badge-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
```
Tone distribution across the 58 badges (`awk 'NR>=519' … | grep -oE 'class="badge ([a-z]+)"' | sort | uniq -c`): **green 29, teal 11, gold 9, blue 5, gray 3, red 1**. Green is half of all badges — the demo's tables are overwhelmingly in a good state, which is a data choice, not a design one. `.badge-dot` inherits its fill from `currentColor`, so one element serves all six tones.
**Measured convention:** `.badge-dot` appears on **live/transitional** states (`In Kitchen`, `Ready`, `On Shift`, `Critical`, `Low`, `Open`) and is **absent** on terminal/classificatory ones (`Served`, `Dine-in`, `Takeaway`, `Active`, `Super Admin`).
**Intent:** the pill carries category, the dot carries "this is still moving" — two independent channels in one 11px object.

### `.stock-status` (+ `.ok` / `.low` / `.critical`) — `:432–435` · 7×
```html
<td><div class="stock-status critical"></div></td>
```
```css
.stock-status { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.stock-status.ok       { background: var(--green);   box-shadow: 0 0 6px rgba(74,222,128,0.4); }
.stock-status.low      { background: var(--primary); box-shadow: 0 0 6px rgba(232,160,69,0.4); }
.stock-status.critical { background: var(--red);     box-shadow: 0 0 6px rgba(248,113,113,0.4); }
```
**Intent:** a glowing 8px LED in the table's first column so a 7-row stock list can be triaged in one downward glance, before any text is read.

### `.avail-dot` (+ `.low` / `.out`) — `:385–387` · 1× (JS template, `:1432`)
```css
.avail-dot     { width: 5px; height: 5px; border-radius: 50%; background: var(--green); }
.avail-dot.low { background: var(--primary); }
.avail-dot.out { background: var(--red); }
```
Paired with a label from `item.avail === 'ok' ? 'Available' : 'low' ? 'Low Stock' : 'Out'` (`:1432`) — colour is never the sole channel here.

### `.loyalty-tier` / `.tier-gold` / `.tier-silver` / `.tier-bronze` — `:471–477` · 5×
```html
<div class="loyalty-tier tier-gold">★ Gold</div>
<div class="loyalty-tier tier-silver">◆ Silver</div>
<div class="loyalty-tier tier-bronze">● Bronze</div>
```
```css
.loyalty-tier { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px; }
.tier-gold   { background: rgba(212,175,55,0.15);  color: #D4AF37; border: 1px solid rgba(212,175,55,0.3); }
.tier-silver { background: rgba(180,180,200,0.15); color: #B0B4C8; border: 1px solid rgba(180,180,200,0.25); }
.tier-bronze { background: rgba(176,112,60,0.15);  color: #CD7F32; border: 1px solid rgba(176,112,60,0.25); }
```
**These are the only three raw hex colours in the component layer that are not in `:root`** — real metal colours (#D4AF37 / #B0B4C8 / #CD7F32), deliberately outside the six-hue system. Each also carries a distinct glyph (★ / ◆ / ●).
**Intent:** loyalty tiers borrow the cultural colour of the metal itself rather than the product palette, because customers already know what gold means; the glyph makes the tier readable without colour.

### `.score-circle` — `:481–486` · 5×
```html
<div class="score-circle" style="background:var(--green-soft);color:var(--green)">94</div>
```
```css
.score-circle { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; font-family: var(--font-mono); }
```
**Measured: it has no colour variants** — all 5 uses set `background`/`color` inline, banded by score (`94`,`91`,`88` → green-soft; `78` → primary-soft; `62` → red-soft, `:1073–1077`).
**Intent:** a vendor scorecard as a mono numeral inside a tinted disc — the shape says "grade", the tint says "how worried to be".

---

## 7. Buttons

### `.btn` + `.btn-primary` / `.btn-ghost` / `.btn-teal` / `.btn-sm` — `:268–280`
Counts: `.btn` 55, `.btn-sm` 55, `.btn-ghost` 44, `.btn-primary` 11, `.btn-teal` **0**.
```html
<button class="btn btn-primary btn-sm"><svg …/>New Order</button>
<button class="btn btn-ghost btn-sm">View</button>
```
```css
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;
  transition: all var(--t-fast); cursor: pointer;
}
.btn-primary { background: var(--primary); color: var(--bg); }
.btn-primary:hover { background: #F0AE56; box-shadow: 0 0 20px rgba(232,160,69,0.3); }
.btn-ghost { background: transparent; color: var(--text-2); border: 1px solid var(--border); }
.btn-ghost:hover { color: var(--text); border-color: var(--border-2); background: var(--surface); }
.btn-teal { background: var(--teal); color: var(--bg); }
.btn-teal:hover { background: #38E2CD; }
.btn-sm { padding: 5px 10px; font-size: 12px; border-radius: 6px; }
.btn svg { width: 14px; height: 14px; }
```
| variant | rest | hover |
|---|---|---|
| `.btn-primary` | gold fill, `--bg` text | `#F0AE56` + `0 0 20px rgba(232,160,69,0.3)` glow |
| `.btn-ghost` | transparent, `--text-2`, 1px `--border` | `--text`, `--border-2`, `--surface` fill |
| `.btn-teal` (unused) | teal fill | `#38E2CD` |

**Measured: `.btn` is essentially never used at its default size — 55 of 55 uses also carry `.btn-sm`.** The 8px/16px/13px base recipe is dead in practice.
**Intent:** exactly one gold button per screen region (measured: every `.page-header` has 0–1 `.btn-primary`), and the gold one is the only control that emits light on hover — the glow *is* the primary-action signal.

### `.pay-btn` (+ `.cash` / `.card` / `.hold`) — `:411–420` · 3×
```html
<div class="ticket-actions">
  <button class="pay-btn cash" onclick="processPayment()">💳 Charge $<span id="chargeAmt">0.00</span></button>
  <button class="pay-btn card">Card</button>
  <button class="pay-btn hold">Hold</button>
</div>
```
```css
.ticket-actions { padding: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; border-top: 1px solid var(--border); }
.pay-btn { padding: 10px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; transition: all var(--t-fast); border: none; font-family: var(--font-body); }
.pay-btn.cash { background: var(--primary); color: var(--bg); grid-column: span 2; }
.pay-btn.cash:hover { background: #F0AE56; box-shadow: 0 0 16px rgba(232,160,69,0.3); }
.pay-btn.card { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
.pay-btn.card:hover { border-color: var(--teal); color: var(--teal); }
.pay-btn.hold { background: var(--surface-2); color: var(--text-2); border: 1px solid var(--border); }
```
`.hold` has **no declared hover state** — the only interactive element in the demo without one.
**Intent:** a 2-column footer where the money button spans both cells and is twice the width of its alternatives, so the highest-frequency action is also the largest target.

### `.qty-btn` / `.qty-ctrl` / `.qty-num` — `:396–399`
```html
<div class="qty-ctrl">
  <div class="qty-btn" onclick="changeQty(1,-1)">−</div>
  <div class="qty-num">2</div>
  <div class="qty-btn" onclick="changeQty(1,1)">+</div>
</div>
```
```css
.qty-ctrl { display: flex; align-items: center; gap: 4px; }
.qty-btn { width: 22px; height: 22px; border-radius: 5px; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-2); font-size: 14px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all var(--t-fast); }
.qty-btn:hover { background: var(--surface-3); color: var(--text); }
.qty-num { width: 20px; text-align: center; font-size: 13px; font-weight: 700; color: var(--text); font-family: var(--font-mono); }
```
**Intent:** a fixed-width mono numeral between two 22px steppers so the digit never shifts position as it changes — but at 22px these are far below any touch-target floor, which is a demo-only affordance.

### `.cat-btn` (+ `.active`) — `:365–371` · 5×
```html
<div class="menu-cats">
  <div class="cat-btn active" onclick="filterMenu('all',this)">All Items</div>
  <div class="cat-btn" onclick="filterMenu('mains',this)">Mains</div>
</div>
```
```css
.menu-cats { display: flex; gap: 6px; flex-wrap: wrap; }
.cat-btn {
  padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 600;
  background: var(--surface); border: 1px solid var(--border); color: var(--text-2);
  cursor: pointer; transition: all var(--t-fast);
}
.cat-btn:hover { color: var(--text); border-color: var(--border-2); }
.cat-btn.active { background: var(--primary); color: var(--bg); border-color: var(--primary); }
```
**Intent:** fully-rounded filter chips whose selected state inverts to solid gold — a single-select filter that reads as "this is the lens you're looking through", not as a button you press.

### `.tabs` / `.tab` (+ `.active`) — `:304–310` · 3× / 9×
```html
<div class="tabs"><div class="tab active">Week</div><div class="tab">Month</div><div class="tab">Year</div></div>
```
```css
.tabs { display: flex; gap: 4px; background: var(--bg-3); border: 1px solid var(--border); border-radius: 10px; padding: 4px; }
.tab { padding: 6px 14px; border-radius: 7px; font-size: 12px; font-weight: 600; color: var(--text-3); transition: all var(--t-fast); cursor: pointer; }
.tab.active { background: var(--surface); color: var(--text); box-shadow: 0 1px 4px rgba(0,0,0,0.3); }
.tab:hover:not(.active) { color: var(--text-2); }
```
**Intent:** a recessed track (darker than the card it sits in) with the active tab *raised* out of it by a lighter fill plus a small drop shadow — an inverted-elevation segmented control that reads as a physical switch. Note: `.tab` clicks are **not wired to any handler** in the demo (`grep -c 'tab.*onclick' → 0`); it is a visual state only.

### `.table-chip` (+ `.occupied` / `.active`) — `:423–426` · 7×
```html
<div class="table-selector">
  <div class="table-chip">1</div><div class="table-chip occupied">2</div><div class="table-chip active">5</div>
</div>
```
```css
.table-selector { display: flex; gap: 6px; flex-wrap: wrap; }
.table-chip { width: 38px; height: 38px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; cursor: pointer; transition: all var(--t-fast); color: var(--text-2); }
.table-chip.occupied { background: var(--primary-soft); border-color: var(--primary); color: var(--primary); }
.table-chip.active   { background: var(--primary); color: var(--bg); border-color: var(--primary); }
.table-chip:hover:not(.active) { border-color: var(--border-2); color: var(--text); }
```
Three states on one hue at three intensities: free = neutral surface, occupied = 8% gold tint + gold border, selected = solid gold.
**Intent:** occupancy and selection share the gold channel but differ in *saturation*, so the floor plan reads as a heat map where the one you're serving is the brightest cell; `:hover:not(.active)` keeps the selected chip from flickering under the cursor.

### `.input` — `:313–319` · 3×
```html
<input class="input" style="width:180px" placeholder="🔍 Search ingredient...">
```
```css
.input {
  background: var(--bg-3); border: 1px solid var(--border); border-radius: 8px;
  color: var(--text); padding: 8px 12px; font-size: 13px; font-family: var(--font-body);
  outline: none; transition: border-color var(--t-fast);
}
.input:focus { border-color: var(--primary); }
.input::placeholder { color: var(--text-3); }
```
`outline: none` with border-only focus — **an accessibility regression the real product must not copy.** Field is recessed (`--bg-3`, darker than its `--surface` card).
**Intent:** an inset well that lights its border gold on focus — the same gold that means "active" everywhere else.

---

## 8. Data table

### `.data-table` + `th` / `td` / row hover / edge padding — `:283–297` · 10 tables
```html
<div class="card" style="padding:0;overflow:hidden">
  <table class="data-table">
    <thead><tr><th>Order #</th><th>Table</th><th>Total</th><th>Status</th><th></th></tr></thead>
    <tbody>
      <tr>
        <td class="td-primary td-mono">#2147</td>
        <td>Table 5</td>
        <td class="td-mono text-primary">$87.40</td>
        <td><span class="badge gold"><span class="badge-dot"></span>In Kitchen</span></td>
        <td><button class="btn btn-ghost btn-sm">View</button></td>
      </tr>
    </tbody>
  </table>
</div>
```
```css
.data-table { width: 100%; border-collapse: collapse; }
.data-table th {
  text-align: left; padding: 10px 14px;
  font-size: 11px; font-weight: 600; color: var(--text-3); letter-spacing: 0.07em; text-transform: uppercase;
  border-bottom: 1px solid var(--border); background: var(--bg-3);
}
.data-table td {
  padding: 11px 14px; font-size: 13px; color: var(--text-2);
  border-bottom: 1px solid rgba(255,255,255,0.03);
}
.data-table tr:hover td { background: var(--surface-2); }
.data-table td:first-child, .data-table th:first-child { padding-left: 20px; }
.data-table td:last-child,  .data-table th:last-child  { padding-right: 20px; text-align: right; }
.td-primary { color: var(--text) !important; font-weight: 500; }
.td-mono    { font-family: var(--font-mono); }
```
Counts: `.td-primary` **55**, `.td-mono` **93** — mono is the most-used component class in the entire demo after `.text-dim`.

Design rules measured in the markup:
- **Header** is a recessed `--bg-3` strip (darker than the card) with 11px uppercase letterspaced labels at the dimmest tier.
- **Row separators are `rgba(255,255,255,0.03)`, not `--border`** — hairlines an order of magnitude softer than structural borders, so rows group without ruling.
- **Body text defaults to `--text-2`** (secondary). `.td-primary` promotes the identifying column to full `--text` — so exactly one cell per row is "the thing", everything else is attribute. Uses `!important` because it must beat `.text-dim` etc. when both are applied.
- **Last column right-aligns automatically** — an action column needs no class.
- The header row is *not sticky* (`grep -c 'position: *sticky' → 0`).
- Trailing `<th></th>` for the action column is the demo's idiom for "this column has no name".

**Intent:** the table is the product's primary surface, so its type is doing the hierarchy work — mono for anything comparable digit-by-digit, one promoted column per row, and separators quiet enough that a 7-row list reads as a block rather than a grid.

### `.progress-bar` / `.progress-fill` — `:300–301` · 12× each
```html
<div class="flex-between text-sm" style="margin-bottom:6px"><span class="text-muted">Tables Occupied</span><span class="text-bold">8 / 14</span></div>
<div class="progress-bar"><div class="progress-fill" style="width:57%;background:var(--primary)"></div></div>
```
```css
.progress-bar  { height: 5px; background: var(--surface-2); border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; border-radius: 3px; transition: width 0.8s ease; }
```
**Measured: `.progress-fill` has no colour of its own — all 12 uses set `width` and `background` inline.** Two fill idioms:
- flat token fill — `style="width:57%;background:var(--primary)"` (`:687`, Dashboard/Finance)
- two-stop gradient — `style="width:56%;background:linear-gradient(90deg,var(--green),var(--teal))"` (`:1156–1159`, Analytics ratios), plus `height:8px` override on the track.

`transition: width 0.8s ease` is the slowest transition in the demo (5.3× `--t-slow`).
**Intent:** a 5px hairline meter that is always paired with an explicit "x / y" or "%" label above it — the bar is a glanceable second channel, never the only reading of the number; the long 0.8s ease makes a value change read as *filling*, not jumping.

---

## 9. Alerts / activity feed

### `.alert-item` / `.alert-icon` / `.alert-text` / `.alert-time` — `:347–355` · 5× each
```html
<div class="alert-item">
  <div class="alert-icon" style="background:var(--red-soft);color:var(--red)"><svg width="13" height="13" … stroke-width="2.5">…</svg></div>
  <div class="alert-text"><strong>Salmon fillet</strong> below reorder point (320g left)</div>
  <div class="alert-time">2m ago</div>
</div>
```
```css
.alert-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.04);
}
.alert-item:last-child { border-bottom: none; }
.alert-icon { width: 28px; height: 28px; border-radius: 7px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.alert-text { font-size: 12px; color: var(--text-2); }
.alert-text strong { color: var(--text); font-weight: 600; }
.alert-time { margin-left: auto; font-size: 10px; color: var(--text-3); white-space: nowrap; }
```
**Measured: `.alert-icon` has no severity variants** — all 5 instances set the tint pair inline (`:770` red-soft/red, `:774` primary-soft/primary, `:778` blue-soft/blue, `:782` green-soft/green, `:786` purple-soft/purple), one hue per alert kind.
**Intent:** a three-zone row — severity chip, sentence with the *subject* bolded to full brightness, right-pinned relative timestamp — so a feed is scannable by subject alone, and the icon hue answers "how bad" before the sentence is read.

---

## 10. POS screen

### `.pos-layout` / `.pos-left` / `.pos-right` — `:360–362` · 1× each
```html
<div class="pos-layout">
  <div class="pos-left">
    <div class="menu-cats">…</div>
    <div class="menu-grid" id="menuGrid"></div>
  </div>
  <div class="pos-right">
    <div class="ticket-header">…</div>
    <div class="ticket-items" id="ticketItems"></div>
    <hr class="ticket-divider">
    <div class="ticket-summary">…</div>
    <div class="ticket-actions">…</div>
  </div>
</div>
```
```css
.pos-layout { display: grid; grid-template-columns: 1fr 340px; gap: 16px; height: calc(100vh - 56px - 48px); }
.pos-left   { display: flex; flex-direction: column; gap: 12px; overflow: hidden; }
.pos-right  { display: flex; flex-direction: column; gap: 0; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
```
The `calc(100vh - 56px - 48px)` hardcodes topbar height (56) + `.content-area` vertical padding (24×2).
**Intent:** a fixed 340px ticket rail against a fluid menu field, both locked to viewport height so the order total never scrolls out of sight while the operator hunts for an item; `.pos-right` is a single continuous card with internal dividers rather than stacked cards, so the ticket reads as one document.

### `.menu-grid` / `.menu-item-card` and children — `:373–387`
Rendered from JS template `:1427–1435`:
```html
<div class="menu-item-card" onclick="addToCart(1)">
  <div class="menu-item-emoji">🍽</div>
  <div class="menu-item-name">Grilled Salmon</div>
  <div class="menu-item-price">$28.00</div>
  <div class="menu-item-avail"><div class="avail-dot ok"></div><span style="font-size:10px;color:var(--text-3)">Available</span></div>
</div>
```
```css
.menu-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; overflow-y: auto; flex: 1; }
.menu-item-card {
  background: var(--bg-3); border: 1px solid var(--border); border-radius: var(--radius);  /* 10px */
  padding: 12px; cursor: pointer; transition: all var(--t-fast);
  display: flex; flex-direction: column; gap: 6px;
}
.menu-item-card:hover  { border-color: var(--primary); background: var(--surface); transform: translateY(-1px); }
.menu-item-card:active { transform: translateY(0); }
.menu-item-emoji { font-size: 24px; line-height: 1; }
.menu-item-name  { font-size: 12px; font-weight: 600; color: var(--text); line-height: 1.3; }
.menu-item-price { font-size: 13px; font-weight: 700; color: var(--primary); font-family: var(--font-mono); }
.menu-item-avail { display: flex; align-items: center; gap: 3px; font-size: 10px; }
```
Emoji comes from a category map, not per-item (`:1416`: `{mains:'🍽',starters:'🥗',beverages:'🥤',desserts:'🍰'}`) — 17 items, 4 glyphs.
**Intent:** the only component in the demo with a **press** state — `:hover` lifts 1px and `:active` returns it to 0, so a tap is physically acknowledged; price is the one gold element on the tile because price is what the operator is confirming.

### Ticket / cart rows — `:390–409`
```html
<div class="ticket-header">
  <div class="flex-between">
    <div><div class="ticket-title">Table 5 — Order</div><div class="ticket-meta">Server: Omar K. · 19:42</div></div>
    <span class="badge teal"><span class="badge-dot"></span>Open</span>
  </div>
</div>
<div class="ticket-items">
  <div class="ticket-item">
    <div class="ticket-item-name">Grilled Salmon</div>
    <div class="qty-ctrl">…</div>
    <div class="ticket-price">$28.00</div>
  </div>
</div>
<hr class="ticket-divider">
<div class="ticket-summary">
  <div class="summary-row"><span class="lbl">Subtotal</span><span class="val" id="subtotal">$0.00</span></div>
  <div class="summary-row"><span class="lbl">Discount (10%)</span><span class="val" id="discountAmt" style="color:var(--green)">−$0.00</span></div>
  <div class="summary-row"><span class="lbl">Tax (15%)</span><span class="val" id="taxAmt">$0.00</span></div>
  <div class="summary-row total"><span class="lbl">Total Due</span><span class="val" id="totalAmt">$0.00</span></div>
</div>
```
```css
.ticket-header { padding: 14px 16px; border-bottom: 1px solid var(--border); background: var(--bg-3); }
.ticket-title  { font-size: 13px; font-weight: 700; color: var(--text); }
.ticket-meta   { font-size: 11px; color: var(--text-3); }
.ticket-items  { flex: 1; overflow-y: auto; padding: 10px 0; }
.ticket-item   { display: flex; align-items: center; padding: 8px 14px; gap: 8px; }
.ticket-item-name { flex: 1; font-size: 12px; color: var(--text); font-weight: 500; }
.ticket-price  { font-size: 12px; font-weight: 600; color: var(--primary); font-family: var(--font-mono); min-width: 50px; text-align: right; }

.ticket-divider { border: none; border-top: 1px dashed var(--border); margin: 8px 14px; opacity: 0.5; }
.ticket-summary { padding: 10px 16px; }
.summary-row { display: flex; justify-content: space-between; font-size: 12px; padding: 3px 0; }
.summary-row .lbl { color: var(--text-3); }
.summary-row .val { color: var(--text-2); font-family: var(--font-mono); }
.summary-row.total { font-size: 15px; font-weight: 700; padding-top: 8px; margin-top: 4px; border-top: 1px solid var(--border); }
.summary-row.total .lbl { color: var(--text); }
.summary-row.total .val { color: var(--primary); }
```
`.ticket-price` reserves `min-width: 50px` right-aligned so the money column never ragged-edges as quantities change. `.ticket-divider` is the **only dashed rule in the demo** — a paper-receipt tear line. The `.total` row escalates on four channels at once: size 12→15px, weight →700, label `--text-3`→`--text`, value `--text-2`→`--primary`.
**Intent:** the ticket is styled as a receipt — dashed tear, mono column, one escalating total — so the operator's mental model matches the paper artefact they are replacing.

---

## 11. Domain one-offs

### `.fin-stat-row` / `-label` / `-value` (+ `.total`) — `:440–446` · 7× each (P&L summary)
```html
<div class="fin-stat-row"><span class="fin-stat-label">Gross Revenue</span><span class="fin-stat-value" style="color:var(--green)">$68,420</span></div>
<div class="fin-stat-row total"><span class="fin-stat-label">Net Income</span><span class="fin-stat-value">$26,808</span></div>
```
```css
.fin-stat-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
.fin-stat-row:last-child { border-bottom: none; }
.fin-stat-label { font-size: 13px; color: var(--text-2); }
.fin-stat-value { font-size: 14px; font-weight: 700; font-family: var(--font-mono); }
.fin-stat-row.total { margin-top: 4px; padding-top: 14px; border-top: 1px solid var(--border-2); }
.fin-stat-row.total .fin-stat-label { color: var(--text); font-weight: 600; font-size: 14px; }
.fin-stat-row.total .fin-stat-value { font-size: 18px; color: var(--teal); }
```
Negative amounts are written in accounting parentheses with `.text-red`: `<span class="fin-stat-value text-red">($19,432)</span>` (`:1097`).
**Intent:** a P&L rendered as a ledger — mono values, parenthesised negatives, and a `--border-2` rule (heavier than the row hairlines) above the bottom line, exactly as an accountant would draw it.

### `.chart-container` — `:466` · 9×
```html
<div class="chart-container" style="height:200px"><canvas id="revenueChart"></canvas></div>
```
```css
.chart-container { position: relative; }
```
**Measured: this class contributes exactly one declaration.** All 9 uses set `height` inline (`grep -oE 'chart-container" style="height:[0-9]+px'`): 220, 200, 160×3, 150, 140×2, 120. It exists solely to give Chart.js's `responsive: true` a positioned parent to measure.

Chart.js global config (`:1487–1489`): `Chart.defaults.color = '#5A6E8A'` (= `--text-3`), `font.family = "'Sora', sans-serif"`, `font.size = 11`. Every tooltip in all 9 charts uses `backgroundColor:'#1A2740'` (= `--surface-2`) + `borderColor:'#263850'` (= `--border-2`). Grid lines are always `rgba(255,255,255,0.04)` or `display:false`. Series colours are the six accent hex values verbatim. Bars carry `borderRadius: 4–6`.
**Intent:** charts are told the design system in hex because they cannot read CSS variables — every hardcoded value here is a token duplicated into JS, which is the maintenance cost the real implementation must avoid.

### `.toast` / `.toast-icon` (+ `.show`) — `:499–512` · 1×
```html
<div id="toast" class="toast">
  <div class="toast-icon"><svg width="12" height="12" … stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
  <span id="toast-msg">Action completed</span>
</div>
```
```css
.toast {
  position: fixed; bottom: 24px; right: 24px;
  background: var(--surface-3); border: 1px solid var(--border-2);
  border-radius: 10px; padding: 12px 16px;
  display: flex; align-items: center; gap: 10px;
  font-size: 13px; color: var(--text);
  box-shadow: var(--shadow-lg); z-index: 9999;
  transform: translateY(100px); opacity: 0;
  transition: all 0.3s ease;
}
.toast.show { transform: translateY(0); opacity: 1; }
.toast-icon { width: 22px; height: 22px; border-radius: 50%; background: var(--green-soft); display: flex; align-items: center; justify-content: center; color: var(--green); }
```
Single instance, message swapped by `showToast(msg)` (`:1350–1357`), auto-dismiss at **2800ms**. Called **26×** across the demo (`grep -oE 'showToast\(' | wc -l` → 28, minus the definition and its own recursion-free body reference). `.toast-icon` is always green — success is the only outcome the demo models.
**Intent:** one persistent DOM node that slides 100px up from the corner — a receipt for an action, never a dialog, and never blocking.

### Declared-but-unused domain classes
`.staff-card` `:451–456`, `.staff-avatar` `:457`, `.staff-name` `:458`, `.staff-role` `:459`, `.shift-bar` `:460`, `.shift-segment` `:461`, `.sparkline` `:515`, `.spark-bar` `:516`. Plus `.card-sm` `:206`, `.grid-auto` `:212`, `.btn-teal` `:277`. Verified zero occurrences in the body:
```
awk 'NR>=519' Docs/NEXUS_ERP_Demo.html | grep -c 'staff-card'   → 0   (same for all eight)
```
The HR screen renders a `.data-table` instead of `.staff-card`. These are **abandoned drafts, not vocabulary** — do not port them.

---

## 12. Utility classes (`:322–342`)

```css
.mt-4 { margin-top: 16px; }          /* used 0× */
.mt-6 { margin-top: 24px; }          /* used 0× */
.mb-4 { margin-bottom: 16px; }       /* used 20× */
.flex        { display: flex; }                                           /* 10× */
.flex-between{ display: flex; align-items: center; justify-content: space-between; }  /* 60× */
.flex-center { display: flex; align-items: center; gap: 8px; }            /* 13× */
.flex-col    { flex-direction: column; }                                  /* 0× */
.gap-2 { gap: 8px; }                 /* 14× */
.gap-3 { gap: 12px; }                /* 0× */
.ml-auto { margin-left: auto; }      /* 0× */
.text-sm { font-size: 12px; }        /* 31× */
.text-xs { font-size: 11px; }        /* 51× */
.text-muted   { color: var(--text-2); }   /* 29× */
.text-dim     { color: var(--text-3); }   /* 97× — most-used class in the demo */
.text-primary { color: var(--primary); }  /* 37× */
.text-teal    { color: var(--teal); }     /* 3× */
.text-green   { color: var(--green); }    /* 1× */
.text-red     { color: var(--red); }      /* 10× */
.text-bold    { font-weight: 600; }       /* 34× */
.font-mono    { font-family: var(--font-mono); }  /* 0× — .td-mono is used instead, 93× */
.w-full { width: 100%; }             /* 1× */
```

Observations, all measured:
- **`.text-dim` (97) + `.td-mono` (93) + `.flex-between` (60) are the three load-bearing utilities.** Almost every row in the product is "a flex-between of a dim label and a mono number".
- The scale is **not** Tailwind's: `.text-sm` = 12px and `.text-xs` = 11px against a 14px root — i.e. 0.857rem and 0.786rem. `.mb-4` = 16px, not 1rem.
- **7 of 21 utilities are dead** (`.mt-4`, `.mt-6`, `.flex-col`, `.gap-3`, `.ml-auto`, `.font-mono`, plus `.text-green` at a single use).
- `.text-purple` is used **once** (`:1159`, `<span class="text-bold text-purple">48 min</span>`) and is **never defined** — `grep -n 'text-purple'` returns exactly one line, the usage. That span renders at inherited colour. A real bug in the demo.

---

## 13. Interaction model (JS, `:1315–1560`)

| Behaviour | Line | Mechanism |
|---|---|---|
| Screen switch | `:1326–1335` | toggles `.active` on `.screen` and `.nav-item`, rewrites `#topbar-current` from `screenNames` map |
| Clock | `:1341–1345` | `setInterval(updateClock, 1000)` |
| Toast | `:1350–1357` | adds `.show`, clears after 2800ms |
| Menu filter | `:1437–1442` | `filterMenu(cat, el)` — clears `.active` on all `.cat-btn`, sets it on `el`, re-renders grid |
| Add to cart | `:1444–1452` | increments existing line or pushes new, re-renders ticket, fires toast |
| Qty change | `:1454–1458` | `changeQty(id, delta)`; removing at qty ≤ 0 |
| Ticket totals | `:1460–1478` | `disc = sub*0.10; tax = (sub-disc)*0.15; total = sub-disc+tax` — discount before tax |
| Payment | `:1480–1484` | toast + `cart = []` + re-render |

`onclick` attributes in the body: **48** (`awk 'NR>=519' … | grep -oE 'onclick=' | wc -l`). No event delegation, no framework. The Reports screen also uses inline `onmouseover`/`onmouseout` to swap `borderColor` — a hover state authored in JS rather than CSS, **12 occurrences** (`grep -oE 'onmouseover=' | wc -l`), `:1216–1258`.

---

## 14. Gaps the demo does not address (measured absences)

| Concern | Proof of absence |
|---|---|
| Light theme | `grep -c 'prefers-color-scheme\|data-theme' → 0` |
| Responsive breakpoints | `grep -n '@media'` → 1 hit, `prefers-reduced-motion` only. Fixed 240px sidebar, fixed 340px POS rail, `grid-4` never collapses |
| Focus-visible styling | `grep -c 'focus-visible' → 0`; `.input` sets `outline: none` (`:317`) with no replacement |
| Semantic headings | `grep -c '<h1' → 0`; every title is a `<div>` |
| ARIA | `grep -c 'aria-' → 0` |
| Real buttons for interactive rows | `.nav-item`, `.tab`, `.cat-btn`, `.table-chip`, `.qty-btn`, `.menu-item-card` are all `<div onclick>` |
| Loading / empty / error states | no skeleton, spinner, or empty-state class exists |
| Disabled states | `grep -c ':disabled\|\[disabled\]' → 0` |
| Modal / dialog / drawer | none — `.toast` is the only overlay |
| Touch targets | `.qty-btn` 22px, `.topbar-btn` 32px, `.table-chip` 38px — all below 44px |

---

## 15. Mapping — demo component → existing frontend component

Scope of the search, as instructed, is `frontend/components/ui/` (28 files + `surface/`, `data-grid/`) and `frontend/components/shared/` (16 files). Where the closest match lives **outside** those two directories it is named and flagged, because "NO EQUIVALENT in ui/ or shared/" and "does not exist anywhere" are different facts. Searches run as `grep -rniE '<pattern>' frontend/components --include='*.tsx' --include='*.ts' -l`.

| Demo component | Closest existing component | Verdict / delta |
|---|---|---|
| `.app-shell` | `frontend/app/(tenant)/layout.tsx:82` — `<div className="flex h-screen overflow-hidden">` | **Equivalent.** Same flex/100vh/overflow-hidden contract. Not a component, a layout. |
| `.main-area` | `app/(tenant)/layout.tsx:96` — `flex flex-1 flex-col overflow-hidden` | **Equivalent.** |
| `.content-area` | `app/(tenant)/layout.tsx:103` — `<main className="flex-1 overflow-y-auto p-4 lg:p-6 pb-20 md:pb-6">` | **Equivalent, and better** — responsive padding + mobile bottom-nav clearance the demo has no concept of. |
| `.screen` / `.screen.active` + `fadeIn` | `components/shared/page-transition.tsx`, `page-transition-motion.tsx` | **Exists but deliberately unwired.** `app/(tenant)/layout.tsx:113–135` documents removing the shell-level transition: "an operator navigates ~200 times a shift and pays the duration every time." Porting `fadeIn` to the shell reverses a recorded decision (D-34-02 / UI-SPEC §3.12). |
| `.sidebar` + `::after` gradient seam | `components/shared/sidebar.tsx:162–169` — `flex flex-col border-r bg-background`, `w-64` / `w-16` collapsed | **Structural equivalent; decorative seam has NO EQUIVALENT.** Real sidebar is 16rem, collapsible (demo's `transition: width` is dead), and has a mobile overlay mode the demo lacks. |
| `.sidebar-logo` / `.logo-mark` / `.logo-text` / `.logo-sub` | `sidebar.tsx:173–181` — `<ChefHat className="size-6 text-primary" />` + `{brandName}` | **Partial.** No gradient monogram tile, no glow, no `.logo-sub` category line. |
| `.nav-group` / `.nav-group-label` | `sidebar.tsx:139` — `mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground`; groups from `components/shared/sidebar-nav-items.ts:185` `navGroups` | **Equivalent.** Same uppercase/tracked/muted recipe. Real app has far more groups (`sidebar-nav-items.ts` is 600+ lines vs the demo's 5 labels / 11 items). |
| `.nav-item` (+ `.active`) | `sidebar.tsx:63–80` — `<Link>` with `active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"` | **Present but weaker.** Real active state is a neutral `bg-muted` tint — **no accent hue, no accent text, no left rail.** One channel vs the demo's four. Also a real `<Link>` with `aria-current="page"`, which the demo's `<div onclick>` is not. |
| `.nav-item.active::before` (3px glowing gold rail) | — | **NO EQUIVALENT** (`grep -rn 'before:.*w-\[3px\]\|before:w-1' components/shared/sidebar.tsx` → 0). |
| `.nav-badge` / `.nav-badge.gold` | `sidebar.tsx:76–78` — `flex h-5 min-w-5 … rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground` | **Partial.** Destructive tone only; **no gold "awaiting you" variant.** Badge data comes from `NavItem.badge` (`sidebar-nav-items.ts:45`). |
| `.sidebar-footer` / `.user-info-sm` | — | **NO EQUIVALENT.** Identity lives in the TopBar profile dropdown (`components/shared/top-bar.tsx:255–264`), not the rail. Sidebar footer is a collapse toggle (`sidebar.tsx:203–222`). |
| `.avatar-sm` (gradient initials disc) | `top-bar.tsx:258` — `size-8 … rounded-full bg-primary text-primary-foreground text-sm font-semibold` | **Partial and unshared.** It is an inline `<button>` class list, not an exported component; flat primary fill, no gradient; **cannot be reused in table cells** (the demo uses avatars 10×, 9 of them in tables). |
| `.topbar` | `top-bar.tsx:184` — `sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-4 shadow-elev-1 lg:px-6` | **Equivalent.** `h-14` = 56px, same as demo. Real one is sticky + shadowed. |
| `.topbar-breadcrumb` / `.current` / `.topbar-sep` | `top-bar.tsx:95–120` — internal `Breadcrumb()`, `<nav aria-label="Breadcrumb">`, `ChevronRight` separators, last crumb `font-medium text-foreground` | **Equivalent, and better** — derived from `usePathname()`, N levels, real `<nav>` landmark. **Not exported**, so it cannot be reused. |
| `.topbar-time` (live clock) | — | **NO EQUIVALENT** anywhere (`grep -rn 'toLocaleTimeString' components/shared/` → 0). |
| `.topbar-btn` | `top-bar.tsx:229` (search), `:188` (mobile menu) — `touch-target inline-flex … rounded-md p-2 text-muted-foreground hover:bg-accent` | **Partial.** Same role, but hover changes *fill* not border, and there is no shared icon-button class in the shell — each is hand-written. `components/ui/button.tsx` `size="icon"` / `"icon-sm"` is the real primitive. |
| `.notif-dot` | — | **NO EQUIVALENT — and deliberately so.** `top-bar.tsx:236–248` records the removal: the bell "was a `<button>` with NO `onClick` … carrying a permanent destructive red dot and the literal `aria-label='Notifications (3 unread)'` … A control that cannot act, advertising a count that is not real … is a standing lie." Re-adding a demo notif dot would re-introduce that exact defect. |
| `.live-pill` / `.live-dot` (+ `pulse`) | `components/pos/pos-connection-badge.tsx:81–83` — `inline-flex items-center gap-1.5 text-small font-medium` + `h-2 w-2 rounded-full`; also `pos/sync-status-badge.tsx`, `pos/offline-indicator.tsx` | **NO EQUIVALENT in ui/ or shared/** — three separate ad-hoc dot+label badges live in `components/pos/`. No pill chrome (no tinted fill/border/radius), no pulse. `components/ui/status-badge.tsx` has a `pulse` flag but only for the `PREPARING` line-item status. |
| `.page-header` / `.page-title` / `.page-subtitle` | `components/ui/page-header.tsx:52` — `PageHeader({title, description, meta, actions, overflow})` | **Equivalent, and better.** Real `<h1>` at `text-h1` (demo uses `<div>`, `grep -c '<h1' → 0`); splits `description` vs `meta` (the demo's `·`-joined subtitle); enforces *one* `actions` slot with the rest in `overflow`, which is the rule the demo follows informally. **Delta: no serif display face** — `app/layout.tsx:2` loads only `Geist`/`Geist_Mono`, and `globals.css:28` sets `--font-heading: var(--font-sans)`. |
| `.card` / `.card-title` | `components/ui/card.tsx` — `Card` (+ `size`, `depth` 1–3, `interactive`), `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`, `CardAction` | **Superset.** Real Card is `rounded-xl … ring-1 ring-foreground/10` with opt-in `shadow-depth-*` and `vdl-lift`. **Delta: `CardTitle` is not the demo's uppercase/tracked/11px micro-label** — that eyebrow treatment has no equivalent. |
| `.card` + `style="padding:0;overflow:hidden"` (table card) | `components/ui/card.tsx` `[--card-spacing]` custom property | **Equivalent mechanism** — override the spacing var rather than inline `padding:0`. |
| Inset row card (`padding:10px;background:var(--bg-3);border:1px solid var(--border)`, 21×) | — | **NO EQUIVALENT.** Closest is `components/dashboard/portlets/portlet.tsx` `RecordList` / `ExceptionList` (divide-y lists, not bordered tiles). This is the demo's biggest un-named pattern and needs a real component. |
| `.grid-2` / `.grid-3` / `.grid-4` | — | **NO EQUIVALENT as components** — Tailwind `grid-cols-*` is used directly (e.g. `components/pos/menu-grid.tsx:296`, `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3`). Correct: the real app's grids are responsive; the demo's are not. |
| `.kpi-card` + `.kpi-icon` / `-label` / `-value` / `-change` / `-meta` | `components/dashboard/portlets/portlet.tsx:122` — `KpiTile({id, label, value, deltaPct, higherIsBetter, spark, unavailableReason})`, wrapped by `PortletShell:37` | **NO EQUIVALENT in ui/ or shared/ — but a strong one exists in `components/dashboard/portlets/`.** `KpiTile` already solves the demo's worst bug: `higherIsBetter` (`portlet.tsx:38`) computes sentiment from the metric, whereas the demo hand-picks `.up`/`.down` and gets it inconsistent (see §5). **Deltas:** no hue variants, no 2px gradient top rail, no tinted 36px icon chip, no serif value; it adds a `Sparkline` (`portlet.tsx:200`) the demo's KPI card lacks. |
| `.badge` (6 tones) + `.badge-dot` | `components/ui/status-badge.tsx:227` — `StatusBadge({status, label})`, 15 domain statuses + 7 legacy variants | **Structurally equivalent, philosophically stricter.** Tones are `bg-*/15 text-* border-*/30` (the demo's 8%/20% at different ratios). Real one pairs **every** status with a distinct lucide icon *and* a text label ("color is never the sole channel", `status-badge.tsx:92–94`); the demo's `.badge-dot` is a same-colour dot, which is not a second channel. **Delta: `StatusBadge` is closed over a fixed status union — there is no open/generic `<Badge tone="gold">`.** |
| `.stock-status` / `.avail-dot` (glowing LED) | `components/ui/status-badge.tsx` (as a full badge) | **NO EQUIVALENT** as a bare column dot with glow. |
| `.loyalty-tier` / `.tier-gold` / `-silver` / `-bronze` | — | **NO EQUIVALENT.** `grep -rniE 'tier|loyalty' components/ui components/shared` returns 6 hits, all prose in comments (`sidebar-nav-items.ts:175`, `data-grid/columns.ts:64`, …) — no component. |
| `.score-circle` | — | **NO EQUIVALENT.** |
| `.btn` / `.btn-primary` / `.btn-ghost` / `.btn-sm` | `components/ui/button.tsx:74` — `Button` + `buttonVariants` (7 variants × 8 sizes) | **Superset.** `default` ≈ `.btn-primary`, `ghost`/`outline` ≈ `.btn-ghost`, `size="sm"` (h-7) ≈ `.btn-sm`. Real one adds `secondary`, `destructive`, `link`, icon sizes, `asChild`, disabled, `aria-invalid`, and a real focus outline (`button.tsx:8–11` explains why the ring is an `outline`, not a `box-shadow`). **Delta: no gold hover glow** — `.btn-primary:hover` emits `0 0 20px rgba(232,160,69,0.3)`; `Button` default hover is `hover:bg-primary/80`. |
| `.pay-btn` (`.cash` / `.card` / `.hold`) | `components/pos/settlement-actions.tsx`, `components/pos/charge-summary.tsx` | **NO EQUIVALENT in ui/ or shared/**; real settlement actions exist in `components/pos/`. |
| `.qty-ctrl` / `.qty-btn` / `.qty-num` | `components/pos/order-panel.tsx:326` — `CartLineRow({onIncrement, onDecrement, onRemove})`, `:723` "Qty display (≥40px touch area)" | **NO EQUIVALENT in ui/ or shared/**; exists in `components/pos/` and is **better** — the demo's 22px steppers fail every touch-target rule. |
| `.cat-btn` (+ `.active`) | `components/pos/menu-grid.tsx:205–213` — inline `rounded-full border px-4 py-2 text-sm font-medium` chips | **NO EQUIVALENT in ui/ or shared/**; the pattern exists inline in `menu-grid.tsx` with the same pill/active-fill idea, plus horizontal scroll on mobile (`:186`, `flex-1 gap-2 overflow-x-auto lg:flex-wrap`) which the demo has no equivalent of. |
| `.tabs` / `.tab` (+ `.active`) | `components/shared/section-switcher.tsx:24` — `SectionSwitcher`, `role="tablist"` / `role="tab"` / `aria-selected` | **Equivalent, and better** (real ARIA + wired `onChange`; the demo's tabs have **zero** click handlers). **Delta: inverted elevation.** Demo track is `--bg-3` (recessed) with the active tab raised (`--surface` + shadow); `SectionSwitcher` track is `bg-muted` with the active tab a solid `bg-primary` fill. There is **no shadcn `Tabs`/radix Tabs primitive** in `ui/` (`ls components/ui | grep -i tab` → only `data-table.tsx`). |
| `.table-chip` (+ `.occupied` / `.active`) | `components/pos/table-floor-view.tsx:159` — `TableTile`, grid `grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3` | **NO EQUIVALENT in ui/ or shared/**; the real one is a taller info tile (name + status icon + `StatusBadge` + capacity), not a 38px numeric chip. Different density decision. |
| `.input` | `components/ui/input.tsx:34` — `Input` | **Equivalent, and better** — real focus styling instead of `outline: none`. |
| `.data-table` (th / td / hover / edge padding) | `components/ui/data-table.tsx:38` `DataTable`; `components/ui/data-grid/data-grid.tsx:128` `DataGrid` (density, card renderers, `ROW_HEIGHT`) | **Superset.** `data-table.tsx:20` explicitly records fixing "`thead th { position: static }` and row heights of 65px and 81px inside a single table". **Deltas to port from the demo:** the 3%-alpha row separator, the recessed uppercase header strip, `.td-primary` single-promoted-column rule, and last-column auto-right-align. |
| `.td-mono` (93×) | `components/ui/money-display.tsx:29` — `MoneyDisplay` (`tabular-nums font-medium`, `formatPaisa`) | **Partial and better-scoped.** Real app uses `tabular-nums` (correct for aligned digits) rather than switching to a mono *family*, and centralises currency formatting. **Delta: no general `.td-mono` for non-money numerics** (quantities, IDs, times) — the demo monospaces all of them. |
| `.progress-bar` / `.progress-fill` | `components/dashboard/portlets/portlet.tsx:280–284` — `h-1.5 w-full overflow-hidden rounded-full bg-muted` + `h-full rounded-full bg-primary-700` | **NO EQUIVALENT in ui/ or shared/** (`grep -rn 'role="progressbar"' components/ui components/shared` → 0). One inline instance in `RankedList`. No `<Progress>` primitive, no gradient fill, no `transition: width`. |
| `.alert-item` / `.alert-icon` / `.alert-text` / `.alert-time` | `components/ui/alert.tsx:69` — `Alert`, `AlertTitle`, `AlertDescription`, `AlertAction`; `components/dashboard/portlets/portlet.tsx:311` `ExceptionList` | **Different component wearing the same word.** `ui/alert.tsx` is a *bordered box* notice with `default`/`destructive` only. The demo's `.alert-item` is a **feed row** — 6-hue icon chip, bolded subject, right-pinned relative time. `ExceptionList` is the nearest real feed but has no hue system and no timestamp column. |
| `.chart-container` + Chart.js theming | `components/dashboard/portlets/trend-chart.tsx` — a hand-drawn inline-SVG two-series line chart | **Partial, and philosophically opposite.** `grep -iE 'recharts\|chart\|d3\|victory\|nivo\|visx' frontend/package.json` returns **nothing — the real app has no charting library at all.** `trend-chart.tsx:14` types `colorVar` as `"--chart-1"…"--chart-5"` (tokens, not hex) and `:17` adds a `dash` pattern because "§3.4 … no five-colour categorical palette is CVD-safe by colour alone" — the demo's 6 hardcoded hex series have no second channel. **Delta: the demo draws 9 charts of 6 types (bar, bar+line combo, doughnut ×2, area-line ×3, horizontal bar); the real app has exactly one chart component, a line/area trend.** |
| `.toast` / `.toast-icon` (+ `.show`) | `components/ui/sonner.tsx:75` — `Toaster` (sonner) with typed icons: success/info/warning/error/loading | **Superset.** Real one has 5 severities; the demo's toast is success-only (`.toast-icon` is always green-soft). |
| `.fin-stat-row` / `-label` / `-value` (+ `.total`) | — | **NO EQUIVALENT.** `grep -rniE 'fin-stat|ledger|profit' components/ui components/shared` returns 5 hits, all comments and nav labels (`top-bar.tsx:50` `gl: "General Ledger"`, `sidebar-nav-items.ts:404`) — no ledger component. Closest is `portlet.tsx:374` `RecordList` (`divide-y`, label/value rows), which has no `.total` escalation and no accounting-parenthesis convention. |
| `.pos-layout` / `.pos-left` / `.pos-right` | `components/pos/pos-terminal.tsx` | **NO EQUIVALENT in ui/ or shared/**; the real POS shell lives in `components/pos/`. |
| `.menu-grid` / `.menu-item-card` + children | `components/pos/menu-grid.tsx:308–370` | **NO EQUIVALENT in ui/ or shared/**; real grid is responsive (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`), carries real images (`aspect-[4/3]`), a qty pip, and a remove affordance — richer than the demo's 130px emoji tile. |
| `.ticket-*` / `.summary-row` (receipt) | `components/pos/order-panel.tsx:150` `PreSendCart`, `components/pos/charge-summary.tsx` | **NO EQUIVALENT in ui/ or shared/**; exists in `components/pos/`. **Delta: no dashed tear-line divider anywhere** (`grep -rn 'border-dashed' components/pos` — the demo's `.ticket-divider` is its only dashed rule). |
| `.staff-card` / `.shift-bar` / `.sparkline` (dead in demo) | `portlet.tsx:200` `Sparkline` (real, SVG polyline) | **Do not port** — these are unused drafts in the demo (§11), and the real app already has a working sparkline. |
| Utilities `.flex-between` / `.text-muted` / `.text-dim` / `.text-mono` / `.gap-*` / `.mb-*` | Tailwind v4 + semantic tokens in `frontend/app/globals.css` (1151 lines) | **Equivalent by construction.** Map: `.text-muted` → `text-foreground-secondary`, `.text-dim` → `text-foreground-tertiary`, `.flex-between` → `flex items-center justify-between`, `.font-mono`/`.td-mono` → `tabular-nums` (or `font-mono`). **Do not port the raw scale** — the demo's `.text-sm` is 12px at a **14px root** (0.857rem); the real app's `text-sm` is 0.875rem at 16px. |

### Token-level gaps the mapping exposes

| Demo needs | Present in `frontend/app/globals.css`? | Proof |
|---|---|---|
| gold `--primary` | yes, as a hue-parametric ramp `--primary-50…950` off `--brand-h` | `globals.css:318–328` |
| green / amber / blue semantic ramps | yes — `--success-*`, `--warning-*`, `--info-*`, `--destructive-*` | `:348–396` |
| **teal** accent | **absent** | `grep -c '\-\-teal' globals.css` → **0** |
| **purple** accent | **absent** | `grep -c '\-\-purple' globals.css` → **0** |
| serif display face | **absent** | `app/layout.tsx:2` imports `Geist`, `Geist_Mono` only; `globals.css:28` `--font-heading: var(--font-sans)` |
| mono face | yes | `globals.css:27` `--font-mono: var(--font-geist-mono)` |
| chart series palette | yes — `--chart-1…5` (light `:397–401`, dark `:685–689`) | 5 series vs the demo's 6 hues; and no charting library is installed (`grep -iE 'recharts|chart|d3|victory|nivo|visx' package.json` → no match) |


---

## 16. Summary of the porting decision

**Adopt from the demo** (real vocabulary the product lacks): the KPI hue system (`.kpi-card` rail + `.kpi-icon` chip + serif value), the `.nav-item.active` four-channel treatment including the rail, the `.card-title` uppercase eyebrow, the `.data-table` header/hairline/`.td-primary` recipe, `.alert-item` as a feed row, `.progress-bar` as a real primitive, the receipt-styled ticket summary, and the inset-row card that appears 21× with no name.

**Reject from the demo** (recorded decisions or defects it would reverse): the shell fade transition (`app/(tenant)/layout.tsx:113–135`), the notification dot (`top-bar.tsx:236–248`), `outline: none` on inputs (`:317`), `<div onclick>` in place of buttons and links, `<div>` page titles instead of `<h1>`, hardcoded hex duplicated into chart JS, 22–38px touch targets, and the fixed 240px / 340px / `grid-4` layout with zero breakpoints.

**Resolve before porting** (the demo is internally inconsistent): `.kpi-change.up/.down` encodes sentiment but is applied inconsistently (§5) — `KpiTile`'s `higherIsBetter` already models this correctly; `.badge` tone is an open 6-hue set while `StatusBadge` is a closed status union, so one of the two contracts has to give.
