# Phase 21 — Screen Rebuilds: Context

**Status:** Plan 01 complete (KDS board + role dashboards)
**Branch:** `phase-13-access-repair`
**Depends on:** Phase 20 (design system — `UI-SPEC.md`, tokens shipped in `globals.css`)
**Tenant used for verification:** `floating-terrace` (78 menu items, 106 orders, 42 ingredients)

---

## Why this phase exists

Phase 20 produced a 1,824-line design contract and a token layer, and proved the tokens are
correct by measurement (`__tests__/lib/theme/design-tokens.test.ts` re-derives all 53 §3.8
contrast pairings from the OKLCH in `globals.css`). What it did not do — deliberately, per its
own §10.2 sequencing — is apply any of it to a screen.

A design system that no screen uses is a document. Phase 21 is the first application, and it
was scoped to the two surfaces where the contract has the most to say and where the existing
code diverged from it most sharply:

- **§7.2 KDS / BDS station board.** The screen with the weakest measured colour separation in
  the entire system, and the only one read across a room under time pressure.
- **§7.3 Role dashboards.** The screen that showed four roles the same four numbers.

## The three decisions that shaped the work

### D-21-01 — Ageing is encoded in four channels, and colour is the least of them

§3.7 measured `--kds-fresh` against `--kds-warn` at **ΔE2000 8.3 under protanopia**. That is
the weakest pairing anywhere in the system, and it sits on the most time-critical screen. The
contract's response is not "pick better colours" — no pair of hues at those luminances
separates reliably under protanopia — it is to stop relying on hue at all.

So ageing carries, per state:

| State | Border | Icon | Chip text | Card fill |
|---|---|---|---|---|
| Fresh (`< 0.66`) | 2px | `Clock` outline | `mm:ss` | `--kds-card` |
| Warn (`0.66–1.0`) | 4px | `AlertTriangle` | `mm:ss` + **DUE** | `--kds-card` |
| Late (`≥ 1.0`) | 6px | `Flame`, **filled** | `mm:ss` + **LATE** | **`--kds-late-fill`** |

Each channel is independently sufficient. The greyscale screenshot in `evidence/` is the
proof, and the matching before-shot is the counter-proof: with the old card, three tickets
whose ages span 3 minutes to 106 hours are pixel-identical once colour is removed.

The fraction logic itself is untouched. It scales with each station's own
`escalationThresholdSeconds` rather than the industry's fixed 5/8-minute convention, which
§7.2 correctly identifies as the more principled rule.

### D-21-02 — Dashboard layout ships as data, not as JSX branches

§7.3: "Owner and manager do not get the same page with different numbers — they get different
portlet sets. Presets ship as **data**, not as `if (permissions.includes(...))` branches."

The reason to obey this is testability. The pre-21 dashboard's entire notion of who was
reading was one `if (!canViewOrders) return <KitchenDashboard/>`, and no test could have
caught that owner and manager were identical, because there was nothing to compare — the
difference lived, or did not, inside a render tree. `presets.ts` makes it a table, and
`dashboard-presets.test.ts` asserts over it: that the first rows differ, that zero portlet ids
are shared, that the time frames differ, that the densities differ.

### D-21-03 — A number the system does not know renders as `—` with a reason

The audit found journal detail rendering raw paisa, every total 100× too large, and a "Closed
sales: Rs 0.00" tile that was a query bug rather than a quiet day. Both are the same failure:
the UI stating something it does not know.

`sales-by-item` returns `cogs_paisa: null` — a declared Phase-8 deferral that
`reporting.schema.ts` types nullable specifically so it can never be defaulted to zero. The
owner's gross-margin tile therefore renders `—` and says why. A 100% margin printed to an
owner is worse than no margin: the first is a number they will act on.

The same rule governs `deltaPct == null` ("No comparable prior period", never "0%") and the
manager's till variance ("No till has been counted yet today", never "Rs 0.00").

## Scope boundary

This plan owned `frontend/app/(tenant)/app/{kds,kitchen,dashboard}/**`,
`frontend/components/kds/**`, `frontend/components/dashboard/**`, and this phase directory.
Four other agents were working concurrently on users/settings/profile, pos-service and the
menu/table screens, the platform console, and finance/reporting backends.

Two consequences worth recording, because they shaped the design rather than merely
constraining it:

1. **`lib/hooks/**` was out of scope**, so both dashboards are built entirely from hooks that
   already existed. Nothing was added to Layer 3. Where a number was not reachable through an
   existing hook it is absent from the preset, not faked.
2. **`globals.css` was out of scope** (phase 20 owns the tokens), so the type scale — which
   §3.11 deliberately does not bridge into `@theme` — is referenced through
   `text-[length:var(--text-kds)]` constants in `kds-type.ts` / `dashboard-type.ts` rather
   than by adding utilities.

## Open items carried forward

- **The KDS board renders inside the tenant app shell** (sidebar, breadcrumb, search). §4.1
  calls for three shells, and a wall-mounted kitchen display should be full-bleed. The shell
  lives in `app/(tenant)/layout.tsx`, outside this plan's file list.
- **§7.2's paging rule is self-contradictory** and is recorded as such in the summary: it asks
  to keep `sortKdsTickets` (newest-first, with a documented rationale and a test pinning it)
  *and* for "the oldest page is always page 1". Both cannot hold. The tested behaviour was kept.
- **`M` (ticket menu — Rush / Print) is unbound.** There is no backend for either action, and
  a menu that opens onto two dead entries is worse than a key that does nothing.
- **Routing mode (`All items` / `By category`) and "Only my station"** from §7.2's station
  filtering paragraph are likewise unbacked and were not faked.
