# DEMO-STATS — Complete stat inventory of `Docs/NEXUS_ERP_Demo.html`

**Source:** `/Users/muhammadumer/Documents/Projects/ResturantOS/Docs/NEXUS_ERP_Demo.html` (1562 lines)
**Cross-referenced against:** `/Users/muhammadumer/Documents/Projects/ResturantOS/frontend/components/dashboard/presets.ts` (332 lines)
**Method:** read-only. Every value below was read out of the file; line numbers are `sed -n`-verifiable. Nothing is inferred unless labelled INFERRED. Absences are proven with the command that proved them.

## Measured shape of the demo

| Surface | Count | Proof |
|---|---|---|
| Screens | 11 | `grep -c 'class="screen' → 11` (ids at L638, 783, 836, 890, 920, 979, 1031, 1083, 1139, 1204, 1277) |
| KPI cards (`.kpi-card`) | 24 | `grep -o 'class="kpi-card' \| wc -l → 24` |
| KPI values (`.kpi-value`) | 24 | `grep -o 'class="kpi-value"' \| wc -l → 24` |
| Progress rows (`.progress-bar`) | 12 | `grep -o 'class="progress-bar"' \| wc -l → 12` |
| Data tables | 10 | `grep -o 'class="data-table"' \| wc -l → 10` |
| Chart canvases | 9 | `grep -o '<canvas id=' \| wc -l → 9` |
| Mono-spaced cells (`td-mono`) | 94 | `grep -o 'td-mono' \| wc -l → 94` |

Only 15 of the 24 KPI cards carry a delta (`.kpi-change`); 9 are bare values.

---

## Section 1 — Direction semantics (the good/bad inversion rule)

This is the design rule the brief asked to capture. **The demo does not implement it consistently.** What is actually in the file:

The colour machine is two CSS rules, `Docs/NEXUS_ERP_Demo.html:250-251`:

```
.kpi-change.up   { color: var(--green); }   /* #4ADE80 */
.kpi-change.down { color: var(--red);   }   /* #F87171 */
```

`up` / `down` therefore encode **sentiment**, not arithmetic direction — the chevron glyph is chosen separately (`polyline points="18 15 12 9 6 15"` = up-chevron, `"18 9 12 15 6 9"` = down-chevron). So an author *can* render "−32%" in green by tagging it `up`. Four cards need that inversion. Two get it; two do not.

| Metric | Line | Delta text | Class used | Renders | Correct? |
|---|---|---|---|---|---|
| **Food Cost %** (Dashboard) | 674 | `−1.2%` vs budget 30% | `kpi-change down` + down-chevron | **RED** | ❌ **WRONG** — cost falling below budget is good, shown as bad |
| **Waste This Week** (Inventory) | 849 | `−32%` vs last week | `kpi-change up` + up-chevron | **GREEN** | ✅ correctly inverted |
| **Labour Cost %** (HR) | 992 | `Under budget (20%)` | `kpi-change up` + up-chevron | **GREEN** | ✅ correctly inverted (delta is a *word*, not a number) |
| **Stock Value** (Inventory) | 847 | `−$420` today | `kpi-change down` | **RED** | ❌ ambiguous — stock drawdown during service is normal, not a loss |
| **Low / Critical** (Inventory) | 848 | `2 need PO` urgent | `kpi-change down` | **RED** | ✅ genuinely bad |
| **COGS (MTD)** (Finance) | 932 | `28.4%` food cost % | `kpi-change up` | **GREEN** | ⚠️ green on a cost card, and the "delta" is a derived ratio, not a change |
| **Operating Expenses** (Finance) | 933 | `32.4%` of revenue | `kpi-change up` | **GREEN** | ⚠️ same — a composition ratio wearing a delta's clothes |

**The same metric is coloured two different ways on two screens.** Food Cost % 28.4%:
- Dashboard KPI card, L672-674 → red (`kpi-change down`)
- Analytics "Key Performance Ratios" row, L1156 → `style="color:var(--green)"` with a `✓` glyph and caption `Budget: 30%`

**Inside the Analytics ratios card there is no sentiment encoding at all** (L1156-1159) — the four rows cycle brand colours:

| Row | Value | Colour | Target caption | Actually good? |
|---|---|---|---|---|
| Food Cost % | `28.4% ✓` | green | Budget: 30% | yes — under budget |
| Labour Cost % | `18.2%` | gold/amber | Budget: 20% | yes — also under budget, but painted amber |
| Net Margin | `39.2%` | teal | Target: 35% | yes — above target |
| Avg. Table Turn Time | `48 min` | purple | Target: 45 min | **no — 3 min over target, painted a neutral brand colour** |

The one place the inversion is expressed *correctly and legibly* is the **Menu Margin Ranking** table (L1181-1187), where `Cost%` is coloured low-is-good: `21%`→green, `24%`→green, `28%`→gold, `35%`→gold, `42%`→red.

### Design rule to carry forward (what the demo *meant*)

1. Sentiment and arithmetic direction are independent axes. A tile needs `polarity: "higher-is-better" | "lower-is-better"` as data, not a hand-picked CSS class.
2. **`lower-is-better` metrics in the demo:** Food Cost %, Labour Cost %, COGS, Operating Expenses, Waste, Avg. Prep Time, Avg. Table Turn Time, Voids/Refunds, Low/Critical count, AP 30/60-day buckets, menu item Cost%, vendor Lead Time.
3. **`higher-is-better`:** Revenue, Orders, AOV, Net Income, Gross Profit, Net Margin, Covers, NPS, Members, Gold Members, Points Redeemed, Vendor Score, On-Shift coverage, Table occupancy.
4. **Neutral / no polarity:** Stock Value, Inventory Value, Total Ingredients, Total Staff, Monthly Payroll, Points balance, Completed orders.
5. A metric with a **budget/target** gets a *third* state: the comparison is to the target, not to the prior period. Six stats do this (`vs budget 30%`, `Budget: 30%`, `Budget: 20%`, `Target: 35%`, `Target: 45 min`, `Under budget (20%)`).

---

## Section 2 — Full stat inventory, screen by screen

Format legend for **Treatment**: `kpi` = `.kpi-card` (28px Fraunces display value) · `progress` = label/value row over a 5–8px `.progress-bar` · `table` = `.data-table` cell · `chart` = Chart.js canvas · `subtitle` = `.page-subtitle` micro-stat · `alert` = `.alert-item` inline number · `badge` = sidebar/nav badge · `summary` = POS `.summary-row` / Finance `.fin-stat-row`.

### S1 · Dashboard — `#screen-dashboard` (L638-781)
Header: "Good morning, Ahmed ☕" / "Monday, 14 April 2025 — Al-Baik Restaurant, Branch 1" (L642-643)

| # | Exact label | Value | Format | Delta | Baseline (words) | Polarity | Treatment | Line |
|---|---|---|---|---|---|---|---|---|
| 1 | Today's Revenue | `$4,218` | currency, 0dp, thousands sep | `+12.4%` green ▲ | vs last Mon | higher-better | kpi (gold) | 654-656 |
| 2 | Orders Today | `127` | count | `+8` green ▲ | vs yesterday | higher-better | kpi (teal) | 660-662 |
| 3 | Avg. Order Value | `$33.2` | currency, **1dp** | `+3.1%` green ▲ | vs last week | higher-better | kpi (blue) | 666-668 |
| 4 | Food Cost % | `28.4%` | percent, 1dp | `−1.2%` **red ▼** | vs budget 30% | **lower-better (mis-coloured)** | kpi (red) | 672-674 |
| 5 | Tables Occupied | `8 / 14` | **ratio** `n / d` | — | — | higher-better | progress, 57% gold | 698-699 |
| 6 | Labour Cost % | `18.2%` | percent, 1dp, forced green inline | — | — | lower-better | progress, 61% green | 701-702 |
| 7 | Inventory Value | `$12,840` | currency 0dp | — | — | neutral | progress, 78% blue | 705-706 |
| 8 | Loyalty Members Active | `342` | count | — | — | higher-better | progress, 45% teal | 709-710 |
| 9 | Staff On Shift | `11 / 14` | **ratio** | — | — | higher-better | progress, 79% purple | 713-714 |
| 10 | Revenue This Week — Revenue | `3820, 4240, 3980, 4680, 5120, 6240, 5840` | currency series, Mon–Sun, y-axis `$`-formatted | — | overlaid **Budget line** `4000×4, 5000, 5500, 5500` | higher-better | chart `#revenueChart`, bars + line | 688, 1503-1509 |
| 11 | Top Menu Items Today | Grilled Salmon `34` / `$952`; Chicken Shawarma `28` / `$532`; Beef Burger `22` / `$418`; Pasta Primavera `19` / `$342`; Caesar Salad `16` / `$224` | qty = plain count; revenue = **mono, gold** | — | implicit rank order | higher-better | table (3 col: Item/Qty/Revenue) | 722-732 |
| 12 | Sales by Category | Mains `42%`, Beverages `24%`, Starters `18%`, Desserts `16%` | percent, 0dp, sums to 100 | — | — | neutral | donut `#categoryChart` cutout 72% + legend chips | 766-778, 1512 |
| 13 | Alert: reorder | `320g` left (Salmon fillet) | qty + unit, inline bold | — | "below reorder point" | lower-worse | alert, red icon, `2m ago` | 741 |
| 14 | Alert: PO approval | `PO #2041` | identifier | — | "awaiting your approval" | — | alert, gold icon, `14m ago` | 746 |
| 15 | Alert: payroll | `3 days`, `14 staff pending` | duration + count | — | due date | — | alert, blue icon, `1h ago` | 751 |
| 16 | Alert: revenue target | `84% reached at 6pm` | **percent-of-target** | — | today's revenue target | higher-better | alert, green icon, `3h ago` | 756 |
| 17 | Alert: loyalty | Gold status earned | categorical | — | — | — | alert, purple icon, `5h ago` | 761 |

*Bar-width audit (L699-714):* `8/14 = 57%` ✅ exact, `11/14 = 79%` ✅ exact, Labour `18.2%` → 61% (= 18.2/30, an **unstated 0–30% axis**), Inventory `$12,840` → 78% (**denominator never stated**), Loyalty `342` → 45% (**denominator never stated**). Two of five bars are decorative.

### S2 · POS Terminal — `#screen-pos` (L783-834)
Subtitle: "Dine-In · Table 5 · Server: Omar K." (L787)

| # | Exact label | Value | Format | Delta | Polarity | Treatment | Line |
|---|---|---|---|---|---|---|---|
| 18 | (table chips) | 7 tables, 3 `occupied`, 1 `active` | state, no number | — | — | 38px chips | 793 |
| 19 | Subtotal | `$0.00` (seed cart → `$64.00`) | currency, **mono**, 2dp | — | neutral | summary | 816 |
| 20 | Discount (10%) | `−$0.00` (seed `−$6.40`) | currency mono, **signed, green** | — | — | summary | 817 |
| 21 | Tax (15%) | `$0.00` (seed `$8.64`) | currency mono | — | — | summary | 818 |
| 22 | Total Due | `$0.00` (seed `$66.24`) | currency mono **15px bold gold**, top-bordered | — | — | summary `.total` | 819 |
| 23 | Charge $ | mirrors Total Due | button label carries the number | — | — | primary pay button | 822 |
| 24 | menu item price | `$28.00` … `$4.00` (17 items) | currency mono **gold** 2dp | — | — | menu card | 1428, 1402-1418 |
| 25 | availability | `Available` / `Low Stock` / `Out` | categorical dot (green/gold/red) | — | — | menu card | 1429 |
| 26 | line qty | integer, mono, ± steppers | count | — | — | ticket row | 1466 |
| 27 | ticket meta | `19:42` | 24h clock | — | — | ticket header | 811 |

*Money maths, L1470:* `disc = sub × 0.10; tax = (sub − disc) × 0.15; total = sub − disc + tax` — **tax is computed on the discounted subtotal**, which is a real rule, not cosmetics.

### S3 · Inventory — `#screen-inventory` (L836-888)
Subtitle: `138 ingredients · 5 alerts · Last count: Today 08:00` (L839)

| # | Exact label | Value | Format | Delta | Baseline | Polarity | Treatment | Line |
|---|---|---|---|---|---|---|---|---|
| 28 | Total Ingredients | `138` | count | `3 new` green ▲ | this week | neutral | kpi (teal) | 846 |
| 29 | Stock Value | `$12,840` | currency 0dp | `−$420` **red ▼** | today | neutral (mis-coloured) | kpi (gold) | 847 |
| 30 | Low / Critical | `5` | count | `2 need PO` **red ▼** | urgent | lower-better | kpi (red) | 848 |
| 31 | Waste This Week | `$184` | currency 0dp | `−32%` **green ▲** | vs last week | **lower-better, correctly inverted** | kpi (green) | 849 |
| 32 | Stock Levels · On Hand | `0.32 kg`, `1.2 L`, `8.4 kg`, `14.0 kg`, `6.5 kg`, `0.8 kg`, `4.2 L` | **qty + unit**, mono, 1–2dp | — | vs Par Level in the adjacent cell | higher-better | table | 864-870 |
| 33 | Stock Levels · Par Level | `2.0 kg`, `5.0 L`, `5.0 kg`, `8.0 kg`, `4.0 kg`, `2.0 kg`, `2.0 L` | qty + unit, mono | — | the threshold itself | — | table | 864-870 |
| 34 | Stock Levels · Unit Cost | `$28.00`, `$4.20`, `$12.50`, `$2.80`, `$3.40`, `$22.00`, `$9.80` | currency mono 2dp | — | — | lower-better | table | 864-870 |
| 35 | Stock Levels · Status | `Critical` / `Low` / `OK` | badge + 8px glowing dot | — | derived from On Hand ÷ Par | — | table + `.stock-status` | 864-870 |
| 36 | AI Forecast — Next 7 Days | Chicken (kg) `8.2, 7.8, 9.1, 10.4, 9.8, 12.2, 11.6`; Salmon (kg) `3.2, 4.1, 4.4, 3.8, 5.2, 6.8, 6.2` | **decimal qty, 1dp, unit in the series name** | — | Today→Sun | — | filled line `#forecastChart` | 875, 1518 |
| 37 | AI Recommendation | "Order **4kg** Salmon + **6L** Cream by Wednesday" | qty+unit inside prose | — | "weekend demand pattern" | — | tinted callout, gold | 878 |
| 38 | Wastage This Week | `$42, 38, 54, 28, 22, 18, 12` Mon–Sun | currency series, `$`-ticked | — | — | lower-better | red bars `#wasteChart` | 883, 1522 |

### S4 · Orders — `#screen-orders` (L890-918)
Subtitle: `127 orders today · $4,218 revenue · 3 active` (L893)

| # | Exact label | Value | Format | Delta | Polarity | Treatment | Line |
|---|---|---|---|---|---|---|---|
| 39 | Active Orders | `3` | count | **none** | lower-better(ish) | kpi (teal) | 899 |
| 40 | Completed | `121` | count | **none** | higher-better | kpi (gold) | 900 |
| 41 | Avg. Prep Time | `14 min` | **duration + unit** | **none** | lower-better | kpi (blue) | 901 |
| 42 | Voids / Refunds | `3` | count | **none** | lower-better | kpi (red) | 902 |
| 43 | Order # | `#2147 … #2142` | identifier, **mono** | — | — | table | 907-912 |
| 44 | Items | `3 items`, `5 items`, `2 items`, `4 items`, `6 items`, `3 items` | count + noun | — | — | table | 907-912 |
| 45 | Time | `19:42 … 18:55` | 24h clock | — | — | table | 907-912 |
| 46 | Prep | `12, 18, 10, 16, 22, 30 min` | duration | — | lower-better | table | 907-912 |
| 47 | Total | `$87.40, $124.60, $42.00, $98.20, $156.80, $68.50` | currency mono **gold** 2dp | — | — | table | 907-912 |
| 48 | Status | In Kitchen / Ready / Served / Completed | badge, gold/green/gray | — | — | table | 907-912 |
| 49 | Type | Dine-in / Takeaway / Delivery | badge, teal/blue | — | — | table | 907-912 |

*Arithmetic check:* `121 completed + 3 active + 3 voids = 127` ✅ matches the subtitle.

### S5 · Finance — `#screen-finance` (L920-977)
Subtitle: `April 2025 · All figures in USD` (L923)

| # | Exact label | Value | Format | Delta | Baseline | Polarity | Treatment | Line |
|---|---|---|---|---|---|---|---|---|
| 50 | Revenue (MTD) | `$68,420` | currency 0dp | `+11.2%` green ▲ | vs budget | higher-better | kpi (green) | 931 |
| 51 | COGS (MTD) | `$19,432` | currency 0dp | `28.4%` **green ▲** | "food cost %" — a **derived ratio, not a change** | lower-better | kpi (red) | 932 |
| 52 | Operating Expenses | `$22,180` | currency 0dp | `32.4%` **green ▲** | "of revenue" — composition ratio | lower-better | kpi (blue) | 933 |
| 53 | Net Income (MTD) | `$26,808` | currency 0dp | `39.2%` green ▲ | "net margin" — derived ratio | higher-better | kpi (teal) | 934 |
| 54 | Recent Transactions · Amount | `+$4,218`, `−$840`, `+$5,124`, `−$3,220`, `−$1,240`, `+$4,892` | **signed currency, mono, green for +, red for −** | — | — | sign carries polarity | table | 947-952 |
| 55 | Transaction Reference | `#INV-2041`, `PO-1094`, `PR-W15` … | identifier, mono, dim | — | — | table | 947-952 |
| 56 | P&L · Gross Revenue | `$68,420` | currency mono 14px **green** | — | — | higher-better | fin-stat-row | 959 |
| 57 | P&L · Cost of Goods Sold | `($19,432)` | **accounting parentheses**, mono, red | — | — | lower-better | fin-stat-row | 960 |
| 58 | P&L · Gross Profit | `$48,988` | currency mono gold | — | — | higher-better | fin-stat-row | 961 |
| 59 | P&L · Labour Cost | `($12,460)` | parentheses, red | — | — | lower-better | fin-stat-row | 962 |
| 60 | P&L · Rent & Utilities | `($6,200)` | parentheses, red | — | — | lower-better | fin-stat-row | 963 |
| 61 | P&L · Other OpEx | `($3,520)` | parentheses, red | — | — | lower-better | fin-stat-row | 964 |
| 62 | P&L · Net Income | `$26,808` | mono **18px teal**, top-border total row | — | — | higher-better | `.fin-stat-row.total` | 965 |
| 63 | AP Aging · Current | `$4,820` | currency mono **green** | — | — | neutral | progress 72% green | 970 |
| 64 | AP Aging · 30 Days | `$1,240` | currency mono **gold** | — | — | lower-better | progress 20% gold | 971 |
| 65 | AP Aging · 60 Days | `$380` | currency mono **red** | — | — | lower-better | progress 8% red | 972 |

*The P&L model is fully self-consistent* — `68,420 − 19,432 = 48,988`; `48,988 − 12,460 − 6,200 − 3,520 = 26,808`; `19,432/68,420 = 28.40%` (= Food Cost %); `12,460/68,420 = 18.21%` (= Labour Cost %); `26,808/68,420 = 39.18%` (= Net Margin); `12,460+6,200+3,520 = 22,180` (= OpEx) and `22,180/68,420 = 32.42%`. **Every ratio on every screen derives from one seven-line P&L.**

### S6 · HR & Payroll — `#screen-hr` (L979-1029)
Subtitle: `14 staff · 11 on shift today · Payroll due Apr 20` (L982)

| # | Exact label | Value | Format | Delta | Polarity | Treatment | Line |
|---|---|---|---|---|---|---|---|
| 66 | Total Staff | `14` | count | none | neutral | kpi (blue) | 989 |
| 67 | On Shift Now | `11` | count | none | higher-better | kpi (green) | 990 |
| 68 | Monthly Payroll | `$22,400` | currency 0dp | none | neutral | kpi (gold) | 991 |
| 69 | Labour Cost % | `18.2%` | percent 1dp | `Under budget` **green ▲**, meta `(20%)` | **lower-better, correctly inverted; delta is a WORD** | kpi (purple) | 992 |
| 70 | Staff · Hours (Month) | `168h, 160h, 154h, 140h, 168h` | **hours + `h` suffix**, mono | — | — | table | 1001-1005 |
| 71 | Staff · Salary | `$3,200, $2,400, $1,600, $1,400, $1,800` | currency mono **gold** 0dp | — | — | table | 1001-1005 |
| 72 | Staff · Status | On Shift / Off Today | badge green/gray | — | — | table | 1001-1005 |
| 73 | Labour Cost Trend | `21.4, 20.8, 19.6, 18.9, 18.4, 18.2` (W10–W15) | percent series, y clamped **min 16 / max 24** | vs **dashed flat Budget % = 20** | lower-better | line `#labourChart` | 1013, 1526 |
| 74 | Morning (07:00–15:00) | `5 / 5` | **ratio**, bold **green** | — | higher-better | shift row | 1018 |
| 75 | Afternoon (12:00–20:00) | `4 / 5` | ratio, bold **gold** | — | higher-better | shift row | 1019 |
| 76 | Evening (17:00–23:00) | `3 / 4` | ratio, bold **gold** | — | higher-better | shift row | 1020 |
| 77 | coverage nudge | "Afternoon short **1** staff — Fatima available, confirm shift?" | count inside a call-to-action | — | — | gold tinted callout | 1022 |

⚠️ Two internal inconsistencies worth not copying: shift ratios sum to **12** on-shift (5+4+3) but "On Shift Now" says **11**; and Monthly Payroll `$22,400` (L991) contradicts the P&L Labour Cost `$12,460` (L962).

### S7 · Vendors — `#screen-vendors` (L1031-1081)
Subtitle: `12 active vendors · 3 open POs · $6,440 outstanding` (L1034). **No KPI row on this screen.**

| # | Exact label | Value | Format | Polarity | Treatment | Line |
|---|---|---|---|---|---|---|
| 78 | Lead Time | `2 days, 1 day, 1 day, 3 days, 4 days` | duration + unit, mono | lower-better | table | 1043-1047 |
| 79 | Score | `94, 91, 78, 88, 62` | **0–100 index in a 40px `.score-circle`** — ≥88 green, 78 gold, 62 red | higher-better | table, circular chip | 1043-1047 |
| 80 | Outstanding | `$1,240` red, `$840` gold, `$620` gold, `$0` dim, `$380` dim | currency mono, **colour by magnitude** | lower-better | table | 1043-1047 |
| 81 | Vendor Status | Active ×4 / **Review** ×1 | badge green/gold | — | table | 1043-1047 |
| 82 | PO-1094 | `Est. $448` · Pending Approval | currency, "Est." prefix = estimate | — | PO card + Approve button | 1055-1057 |
| 83 | PO-1093 | `$184 · ETA: Tomorrow` · In Transit | currency + relative ETA | — | PO card | 1060-1062 |
| 84 | PO-1092 | `$208 · Received today` · Delivered | currency + relative date | — | PO card | 1065-1067 |
| 85 | Monthly Spend by Vendor | `3240, 1840, 1220, 880, 460` | currency series, **horizontal bars** (`indexAxis:'y'`), `$` ticks | — | `#vendorChart` | 1073, 1530 |

⚠️ Outstanding column sums to `$3,080`, not the `$6,440` in the subtitle (L1034).

### S8 · CRM & Loyalty — `#screen-crm` (L1083-1137)
Subtitle: `1,842 customers · 342 active this month · NPS: 72` (L1086)

| # | Exact label | Value | Format | Delta | Baseline | Polarity | Treatment | Line |
|---|---|---|---|---|---|---|---|---|
| 86 | Total Members | `1,842` | count, thousands sep | `+28` green ▲ | this week | higher-better | kpi (teal) | 1092 |
| 87 | Gold Members | `184` | count | `+3` green ▲ | upgraded | higher-better | kpi (gold) | 1093 |
| 88 | Points Redeemed | `8,420` | count, thousands sep | **none** | — | higher-better | kpi (purple) | 1094 |
| 89 | NPS Score | `72` | **index −100..100** | `+4` green ▲ | vs last month | higher-better | kpi (blue) | 1095 |
| 90 | Customer · Visits | `42, 38, 24, 18, 11` | count | — | — | higher-better | table | 1105-1109 |
| 91 | Customer · Lifetime Value | `$2,840, $2,210, $1,440, $980, $540` | currency mono **gold** 0dp | — | — | higher-better | table | 1105-1109 |
| 92 | Customer · Points | `12,400, 9,800, 5,200, 3,600, 1,200` | count mono, **coloured by tier** (teal / #B0B4C8 / #CD7F32) | — | — | higher-better | table | 1105-1109 |
| 93 | Customer · Tier | ★ Gold ×2 / ◆ Silver ×2 / ● Bronze ×1 | **glyph + metallic pill** | — | — | ordinal | `.loyalty-tier` | 1105-1109 |
| 94 | Loyalty Tier Distribution | Gold (184) `10%`, Silver (528) `29%`, Bronze (1130) `61%` | **count in the legend label, percent in the arc** | — | — | — | donut `#loyaltyChart`, legend bottom | 1116, 1534 |
| 95 | Weekend Double Points | `2×` earn · `284 redemptions` | multiplier + count in prose | — | — | higher-better | campaign card, Live badge | 1122 |
| 96 | Birthday Free Dessert | `42 sent this month` | count in prose | — | — | — | campaign card, Live badge | 1126 |
| 97 | Win-Back — 60 Days Silent | `15% voucher · 38 customers targeted` | percent + count | — | — | — | campaign card, Scheduled badge | 1130 |

*Tier counts reconcile:* `184 + 528 + 1130 = 1,842` ✅.

### S9 · Analytics & Intelligence — `#screen-analytics` (L1139-1202)

| # | Exact label | Value | Format | Comparison | Polarity | Treatment | Line |
|---|---|---|---|---|---|---|---|
| 98 | Revenue vs COGS — Daily | Revenue `4820…4218` (14 pts), COGS `1370…1198` | dual currency series, `$` ticks, x-title "April (Day)" | **two series in one frame** — COGS is a flat 28.4% of revenue every day | — | filled lines `#revCOGSChart` + `Live` badge | 1151, 1543 |
| 99 | Food Cost % (ratios) | `28.4% ✓` | percent + **✓ glyph**, green | caption `Budget: 30%`, bar 56% (0–50% axis) | lower-better | progress 8px, green→teal gradient | 1156 |
| 100 | Labour Cost % (ratios) | `18.2%` | percent, gold | caption `Budget: 20%`, bar 36% | lower-better | progress 8px | 1157 |
| 101 | Net Margin | `39.2%` | percent, teal | caption `Target: 35%`, bar 78% | higher-better | progress 8px | 1158 |
| 102 | Avg. Table Turn Time | `48 min` | duration, purple | caption `Target: 45 min`, bar 60% (0–80 min axis) | **lower-better — currently over target and not flagged** | progress 8px | 1159 |
| 103 | Revenue by Hour (Today) | `120, 240, 580, 640, 420, 280, 320, 480, 820, 960, 840, 560` for hours 10–21 | currency series, `$` ticks, x-title "Hour" | reveals the **double peak** (13:00 and 19:00) | higher-better | gradient bars `#hourlyChart` | 1167, 1551 |
| 104 | Menu Margin · Cost% | `21%` grn, `24%` grn, `28%` gold, `35%` gold, `42%` **red** | percent 0dp mono, **low-is-good colour ramp** | — | **lower-better — the one correct inversion in the file** | table | 1181-1187 |
| 105 | Menu Margin · Margin | `$15.00, $13.60, $13.70, $18.20, $8.10` | currency mono gold 2dp; worst row demoted to `--text-2` | per-unit gross margin | higher-better | table | 1181-1187 |
| 106 | AI answer | "Beef Burger — **79%** gross margin (**$15.00**/unit), sold **22** units, generated **$330** gross profit on Tuesday April 8" | percent + currency-per-unit + count + currency, **inside prose** | one named day | — | gold tinted AI callout | 1196 |

*The AI answer is arithmetically real:* menu price `$19` (L1404) × 79% ≈ `$15.00` margin; `22 × $15.00 = $330` ✅; `100% − 79% = 21%` = the Cost% in row 1 ✅.

⚠️ Hourly revenue sums to `$6,260`, not the `$4,218` on the dashboard.

### S10 · Reports — `#screen-reports` (L1204-1275)
Subtitle: `50+ pre-built reports · Scheduled delivery · Export ready` (L1207). Only one number on the screen (`50+`). **12 report cards** in 3 columns, each with a **status badge** — `Ready` (green) ×7, `Live` (teal) ×3, `Scheduled` (gold) ×1 — plus a one-line "cut by" caption (`Monthly, Quarterly, Annual · By branch`; `By item, category, and period`; `Cost % by shift and department`). The stat here is **freshness**, not a number.

### S11 · Admin & Access Control — `#screen-admin` (L1277-1348)

| # | Exact label | Value | Format | Treatment | Line |
|---|---|---|---|---|---|
| 107 | Last Active | `Now`, `2h ago`, `1h ago`, `Active now` | **relative time** | table cell, dim 11px | 1288-1292 |
| 108 | 2FA | `On` ×3 / `Off` ×1 | boolean badge green/gold | table | 1288-1292 |
| 109 | Branch 1 — Main | `14 Staff · 14 Tables` | two counts in a caption | branch card | 1302 |
| 110 | Audit Log | 5 rows, each `actor · HH:MM`; includes `Salmon −2kg` | signed qty + unit inside prose | log rows | 1313-1317 |
| 111 | Role Permission Matrix | 7 permissions × 5 roles = **35 cells**: `✓` / `—` / `View` / `Summary` | **glyph matrix with two partial-grant words** | table | 1327-1345 |

**The RBAC matrix is the only place role differentiation appears in the demo.** Roles: Super Admin, Branch Mgr, Accountant, Cashier, Kitchen. Partial grants: Kitchen gets `View` on POS-Process-Orders; Branch Mgr gets `Summary` on Finance-View-P&L.

### Global chrome (all screens)

| # | Exact label | Value | Format | Treatment | Line |
|---|---|---|---|---|---|
| 112 | nav badge — POS Terminal | `3` | count, **gold** pill | `.nav-badge.gold` | 547 |
| 113 | nav badge — Inventory | `5` | count, **red** pill | `.nav-badge` | 552 |
| 114 | LIVE pill | — | pulsing green dot + `LIVE` | topbar | 619 |
| 115 | clock | `HH:MM` | **mono**, `toLocaleTimeString`, 1s tick | topbar | 620, 1362 |
| 116 | notification dot | — | red dot, **no count** | topbar button | 623 |

**Design rule:** the nav badges are the *same numbers* as KPI tiles — `3` = Active Orders (L899), `5` = Low/Critical (L848). Counts that need action are mirrored into the nav; counts that don't (127 orders, 138 ingredients) are not.

---

## Section 3 — Taxonomy: what question does each stat answer?

### A. MONEY — "Is the business healthy?" (owner-altitude, period-based)
Today's Revenue · Revenue (MTD) · Net Income (MTD) · Gross Profit · Gross Revenue · COGS (MTD) · Operating Expenses · Labour Cost (P&L) · Rent & Utilities · Other OpEx · Avg. Order Value · Monthly Payroll · Top Menu Items revenue · Transaction amounts · Monthly Spend by Vendor · Revenue This Week (vs budget) · Revenue vs COGS Daily · Revenue by Hour · Menu Margin ($/unit) · Customer Lifetime Value

> **Question:** *Did we make money, and where did it come from or leak out?*
> Every one of these is money-denominated, all read over a **period**, and none of them is actionable inside a shift.

### B. VOLUME — "How much did we move?"
Orders Today · Completed (121) · Active Orders (3) · Top Menu Items qty · Order line-item counts · Points Redeemed · Total Members · Gold Members · Loyalty Members Active · Visits · Total Ingredients · Total Staff · campaign redemption/send/target counts

> **Question:** *How much throughput happened, independent of what it was worth?*
> Volume is the denominator that makes money stats interpretable — revenue up 12% means one thing at flat covers and another at +30% covers.

### C. EFFICIENCY / RATIO — "Are we converting inputs into output well?"
Food Cost % · Labour Cost % · Net Margin · Operating Expenses % of revenue · Menu item Cost% · Sales by Category % · Loyalty Tier Distribution % · Revenue-target % (84%) · Waste % change

> **Question:** *For every dollar that came in, how much stayed?*
> **This is the class that carries the good/bad inversion**, and it is the only class where a *budget or target* is the right baseline rather than a prior period. Every ratio here is derivable from the seven-line P&L (see S5) — they should be computed from one source, not fetched independently.

### D. OPERATIONAL-LIVE — "What needs me in the next five minutes?"
Active Orders · Tables Occupied `8/14` · Avg. Prep Time · per-order Prep minutes · Order Status · Avg. Table Turn Time · Alerts & Actions (5 items) · nav badges (3, 5) · POS table chips · order clock times · LIVE pill

> **Question:** *What is happening right now that I can still change?*
> Defining property: **the number is different in five minutes**. A period-scoped number on a live dashboard is decoration; a live number on a period dashboard is noise.

### E. PEOPLE — "Am I staffed and paid correctly?"
Total Staff · On Shift Now `11` · Staff On Shift `11/14` · shift coverage `5/5`, `4/5`, `3/4` · Hours (Month) · Salary · Monthly Payroll · Labour Cost % · Labour Cost Trend · payroll-due alert · coverage nudge · Last Active · 2FA

> **Question:** *Do I have the right number of people on the floor, and does that cost what it should?*
> Split personality: coverage ratios are **operational-live**; payroll and Labour Cost % are **money/efficiency**. They co-occur on one screen but belong on two dashboards.

### F. INVENTORY-HEALTH — "What am I about to run out of, and what am I throwing away?"
Low / Critical `5` · On Hand vs Par Level · stock Status dot · Stock Value / Inventory Value · Waste This Week · Wastage series · AI Forecast (kg/day) · AI Recommendation · reorder alert (320g) · availability dot on menu items · Unit Cost · vendor Lead Time · Vendor Score · Outstanding · open PO values · audit `Salmon −2kg`

> **Question:** *Will I be able to serve the menu tomorrow, and at what cost?*
> This is the only class where the **stat and its threshold are shown together** (On Hand next to Par Level). That pairing is what makes the status colour honest, and it is the pattern the ratio cards should copy.

### G. CUSTOMER — "Are people coming back?"
NPS Score `72` · Total Members · Gold Members · Points Redeemed / Points balance · Visits · Lifetime Value · Tier · Tier Distribution · active campaigns · loyalty alert

> **Question:** *Is the next month's revenue already secured by people who like us?*
> Every one of these is a **leading** indicator of section A; none is actionable inside a shift.

### Cross-cutting: which class answers which dashboard question

| Class | "Is the business healthy?" (owner) | "What needs me in 5 min?" (manager) | "Where is my till?" (cashier) | "What's on the pass?" (kitchen) |
|---|---|---|---|---|
| A Money | **primary** | no | order total only | no |
| B Volume | supporting | supporting | own count | ticket count |
| C Efficiency/Ratio | **primary** | no | no | no |
| D Operational-live | no | **primary** | own orders | **primary** |
| E People | payroll/labour % | coverage ratios | no | no |
| F Inventory-health | value + waste £ | Low/Critical, 86'd | availability dot | availability dot |
| G Customer | **primary** | no | no | no |

---

## Section 4 — Demo stat → shipped portlet mapping

Portlet vocabulary read from `frontend/components/dashboard/presets.ts`: types `KpiTile | TrendChart | RankedList | ExceptionList | RecordList | Shortcuts` (L32-38); 21 portlet ids across 4 presets (owner 7, manager 8, cashier 3, kitchen 3).

### 4a. Demo stats that map onto an existing portlet

| Demo stat (screen) | Existing portlet id | Type | Fit | Note |
|---|---|---|---|---|
| Avg. Order Value (Dashboard) | `owner-avg-order` | KpiTile | **exact** | Demo adds the format the preset lacks: `$33.2`, 1dp, `+3.1% vs last week` |
| Today's Revenue / Revenue (MTD) | `owner-net-sales` | KpiTile | **near** | Preset timeframe is "Last 30 days vs the 30 before" (L85); demo shows *today* vs *last Mon*. Demo wants **both**, at different altitudes |
| Orders Today (127) | `owner-covers` | KpiTile | **approximate** | Covers ≠ orders. Demo has no cover count anywhere (`grep -ic 'cover' → 1`, and that hit is "Shift Coverage" at L1016). Either rename the portlet to "Orders" or add a real cover count |
| Menu Margin · Cost% / Margin | `owner-gross-margin` | KpiTile | **complement** | Demo never shows a gross-margin *tile*; it shows Net Margin 39.2% (L1158) and per-item margin (L1181-1187). Gross margin = `48,988/68,420 = 71.6%` is derivable but never displayed |
| Revenue This Week + Budget line | `owner-sales-trend` | TrendChart | **exact + extension** | Preset title is "Sales and order volume"; demo overlays **budget as a line over actual bars** (L1503-1509). Adopt the budget overlay |
| Top Menu Items Today | `owner-top-items` | RankedList | **exact** | Demo specifies the columns: Item / Qty / Revenue, revenue mono+gold |
| Alerts & Actions (5 items) | `owner-exceptions` / `manager-exceptions` | ExceptionList | **exact** | Demo supplies the missing item vocabulary: stock-below-reorder, PO-awaiting-approval, payroll-due, target-progress, loyalty-event — each with icon colour + relative timestamp |
| Active Orders (3) | `manager-open-orders` | KpiTile | **exact** | Demo also mirrors the count into the nav badge (L547) |
| Tables Occupied `8 / 14` | `manager-tables-occupied` | KpiTile | **exact + format** | Demo pins the format: **ratio `n / d` with a proportional bar**, not a bare count |
| Orders table (#2147…) | `manager-live-orders` | RecordList | **exact** | Demo specifies columns: Order# / Table / Items / Type / Time / **Prep** / Total / Status |
| Low / Critical (5) + stock table | `manager-86d` | RankedList | **adjacent, NOT the same** | 86'd = unsellable now; Low/Critical = below par. Demo has no 86 concept (`grep -n '86' → 2 hits, both CSS/colour noise`). Keep `manager-86d`, add a separate stock-exception portlet |
| Avg. Prep Time (14 min) | `manager-late-tickets` / `kitchen-late-tickets` | KpiTile | **adjacent, NOT the same** | Preset counts breaches; demo shows a **mean**. Both are needed — a mean hides the tail, a count hides the trend |

### 4b. Demo stats with NO portlet — proposed as NEW

| # | Demo stat | Proposed type | Role(s) | Why that role |
|---|---|---|---|---|
| N1 | **Food Cost %** (28.4% vs budget 30%) | KpiTile w/ target | **owner** (+ manager read-only) | The single most-repeated number in the demo — appears on 3 screens (L672, L932, L1156) and as a report (L1235). It is *the* restaurant health metric and it carries the inversion rule. Manager can't move it inside a shift, so it is a period tile, not a live one |
| N2 | **Labour Cost %** (18.2% vs budget 20%) | KpiTile w/ target + TrendChart | **owner** | Second-most repeated (L701, L992, L1157, trend at L1013). Pairs with N1 as prime cost. Trend needs the dashed budget line from L1526 |
| N3 | **Net margin** (39.2% vs target 35%) | KpiTile w/ target | **owner** | Completes the ratio triad; already computable from the same P&L as N1/N2 |
| N4 | **Net income (MTD)** / P&L summary | KpiTile + RecordList | **owner** (and a missing **accountant** preset) | The demo's Finance screen is an accountant's screen. `presets.ts` has no accountant preset, but the RBAC matrix (L1331) gives Accountant full `Finance — View P&L` while Branch Mgr gets only `Summary` — that "Summary vs full" distinction has no representation in the preset table |
| N5 | **AP Aging** (Current / 30 / 60 days) | RankedList | **owner** / accountant | Money owed is a decision the owner makes; a manager cannot pay a vendor |
| N6 | **Waste this week** ($184, −32%) | KpiTile (lower-better) | **owner** + **manager** | Owner reads the $ and trend; manager reads today's contributors. Second correctly-inverted tile in the demo |
| N7 | **Low / Critical stock count** + On-Hand-vs-Par list | KpiTile + ExceptionList | **manager** (+ owner exception feed) | Actionable in-shift ("2 need PO urgent"), which is exactly manager altitude. Distinct from `manager-86d` |
| N8 | **Stock / Inventory value** ($12,840) | KpiTile (neutral) | **owner** | Balance-sheet-flavoured; appears twice (L705, L847). Explicitly **no polarity** — mark it neutral or it will be mis-coloured the way L847 already is |
| N9 | **Voids / Refunds** (3) | KpiTile (lower-better) | **manager** | A cash-control metric. `manager-till-variance` covers drawer money, not void abuse. RBAC treats Void/Refund as its own permission (L1332) |
| N10 | **Staff on shift `11 / 14`** + shift-coverage ratios | KpiTile (ratio) + RankedList | **manager** | Purely live; the demo even attaches the action ("Afternoon short 1 staff — confirm shift?", L1022) |
| N11 | **Sales by category** (42/24/18/16) | RankedList or donut | **owner** | Mix explains margin movement; nothing a manager acts on mid-service |
| N12 | **Revenue by hour** (double peak 13:00 / 19:00) | TrendChart | **owner** (staffing) + **manager** (today's curve) | The only stat in the demo that directly informs rota decisions |
| N13 | **NPS score** (72, +4 vs last month) | KpiTile | **owner** | Leading indicator of revenue; monthly cadence |
| N14 | **Loyalty members / Gold members / points redeemed** | KpiTile ×3 or one RankedList | **owner** | "Loyalty Members Active 342" already sits on the demo's *main* dashboard (L709) — the demo treats loyalty as a first-screen owner metric, not a CRM-only one |
| N15 | **Vendor score (0–100) + lead time + outstanding** | RankedList | **owner** (approve) + **manager** (chase) | Vendor score is a compound index — the demo's only such metric and the only stat rendered as a circular chip (L1043) |
| N16 | **Open POs awaiting approval** | ExceptionList | **owner** | RBAC gives Approve-PO to Super Admin + Branch Mgr only (L1336). The demo surfaces it as an *alert* on the main dashboard (L746) — approval queues belong in the exception feed, not a KPI |
| N17 | **Avg. table turn time** (48 min vs 45 target) | KpiTile w/ target (lower-better) | **manager** | Directly controllable in-service; currently the demo's worst-encoded stat (over target, painted neutral purple) |
| N18 | **Revenue-target progress** ("84% reached at 6pm") | KpiTile / meter | **manager** + **owner** | The only *pacing* stat in the demo (progress-against-goal at a point in the day). Distinct from every other stat class |
| N19 | **Order-mix by type** (Dine-in / Takeaway / Delivery) | RankedList | **owner** | Present only as badges in the orders table (L907-912); never aggregated anywhere |
| N20 | **Prep-time distribution per order** | RankedList | **kitchen** + manager | Demo has per-order Prep minutes (12/18/10/16/22/30) but never a kitchen view of them |

### 4c. REVERSE gaps — shipped portlets the demo does not cover at all

Proven absences (`grep -ci` over `Docs/NEXUS_ERP_Demo.html`):

| Portlet id | Demo counterpart | Proof |
|---|---|---|
| `manager-till-variance` | **absent** | `grep -ci till → 0`, `grep -ci variance → 0`, `grep -ci drawer → 0` |
| `cashier-till` | **absent** | same |
| `manager-late-tickets` | **absent** (only a *mean* prep time) | `grep -ci kds → 0`; `grep -in kitchen` → 4 hits, all the "In Kitchen" order badge (L908-909), the RBAC column header (L1329) and a toast string (L1481) |
| `kitchen-late-tickets`, `kitchen-open-tickets`, `kitchen-shortcuts` | **absent — there is no kitchen screen** | `grep -c 'class="screen'` → 11 screens, none is a KDS |
| `manager-86d` | **absent** | `grep -n '86'` → 2 hits, both inside CSS/colour tokens |
| `owner-covers` | **absent as a cover count** | `grep -ci cover → 1`, and that hit is "Today's Shift Coverage" (L1016) |
| `cashier-shortcuts` | **absent** | no shift/shortcut surface anywhere; POS is the whole cashier story in the demo |

**The demo is a super-admin's tour of eleven modules, not a set of four role dashboards.** There is one persona throughout — "Ahmed Raza / Super Admin" (L604-605) — and the only role differentiation in the entire file is the 35-cell RBAC matrix at L1327-1345. The product-owner framing ("what stats SHOULD be there per role") is therefore a *reading* of the demo, not something the demo states; the assignment in §4b is this document's proposal, grounded in the RBAC matrix's own role list.

---

## Section 5 — Format vocabulary to standardise

| Format | Demo instances | Rule observed |
|---|---|---|
| Currency, 0dp | `$4,218`, `$68,420`, `$12,840`, `$184` | Dashboard/summary money never shows cents |
| Currency, 1dp | `$33.2` (AOV only) | Averages keep one decimal |
| Currency, 2dp | `$87.40`, `$28.00`, `$15.00` | Transaction-level and per-unit money keeps cents |
| Currency, signed | `+$4,218` green / `−$840` red | Ledger rows; sign carries the colour |
| Currency, accounting parens | `($19,432)` | **P&L only** — deductions in parentheses, never a minus sign |
| Percent, 1dp | `28.4%`, `18.2%`, `39.2%`, `12.4%` | All ratios and deltas |
| Percent, 0dp | `42%`, `21%`, `61%`, `84%` | Composition/mix and item cost% |
| Ratio `n / d` | `8 / 14`, `11 / 14`, `5 / 5`, `4 / 5`, `3 / 4` | Occupancy and coverage — **spaces around the slash** |
| Count | `127`, `138`, `1,842`, `8,420` | Thousands separator from 1,000 up |
| Duration | `14 min`, `48 min`, `2 days`, `168h`, `1 day` | Unit always suffixed, never an icon |
| Qty + unit | `0.32 kg`, `1.2 L`, `320g`, `−2kg`, `4kg` | Space before unit in tables, no space in prose |
| Index | `72` (NPS), `94` (vendor score) | Bare integer; vendor score gets a circular chip, NPS a plain tile |
| Relative time | `2m ago`, `14m ago`, `1h ago`, `Now`, `Active now` | Alerts and audit only |
| Clock | `19:42`, `08:00` | 24-hour, mono |
| Word-as-delta | `Under budget`, `3 new`, `2 need PO` | A delta slot may hold prose |

**Mono-spacing rule (94 `td-mono` cells):** every number that a reader might scan down a column is mono (`DM Mono`) — prices, quantities, hours, identifiers, points. KPI values are *not* mono; they are 28px `Fraunces` display (L248). Labels are 11px uppercase with `letter-spacing: 0.05em` (L247).

---

## Section 6 — Internal inconsistencies not to copy

Measured contradictions in the demo's own numbers:

1. **Food Cost % coloured red on Dashboard (L674) and green on Analytics (L1156)** — same metric, same value, opposite sentiment.
2. **Shift coverage sums to 12** (5+4+3, L1018-1020) vs **"On Shift Now: 11"** (L990) and **"Staff On Shift 11 / 14"** (L713).
3. **Monthly Payroll `$22,400`** (L991) vs **P&L Labour Cost `$12,460`** (L962).
4. **Vendor Outstanding column sums to `$3,080`** (L1043-1047) vs subtitle **"$6,440 outstanding"** (L1034).
5. **Revenue by Hour sums to `$6,260`** (L1551) vs **Today's Revenue `$4,218`** (L654).
6. **Three of five Live-Operations bars have no stated denominator** (L702, L706, L710).
7. **"Delta" slots holding non-deltas**: COGS shows `28.4% food cost %` and OpEx shows `32.4% of revenue` (L932-933) — composition ratios rendered in the change slot, in green.

By contrast the **P&L, the loyalty tiers, the order counts, and the AI answer all reconcile exactly** (see S5, S8, S4, S9), so the model underneath is sound — it is the *presentation layer* that drifts.
