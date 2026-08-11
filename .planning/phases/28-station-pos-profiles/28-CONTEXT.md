# Phase 28 — Stations, POS Profiles & Staff Assignment · CONTEXT

**Depends on:** 19b (tables + station CRUD, landed), 13-02 (WAITER role, landed)

## Why

The user, precisely: *"they should be able to add specific screen (or station) or dedicated POS
which should be selecting respective menu. I think current one is right but need slight
modification, don't have the exact capacity to select the specific screen/station for that
account he is creating."*

So the station model is broadly right, and the missing capability is **binding a person and a
terminal to a station**. Today a kitchen user sees every ticket for the branch, and a POS terminal
shows the whole menu, regardless of whether that terminal is the bar or the counter.

## What already exists — verify before building

- `Station` CRUD and `MenuService.assignStation` (item → station) — plan 13-16 / phase 19b.
- `ORDER_SENT_TO_KDS` already carries `stationId`, `stationName` and the canonical `kdsStation`.
- kitchen-service consumes tickets and the KDS board filters by station code.
- `dining_tables` now has real CRUD (phase 19b).

**Read `.planning/research/adaptivity/multi-pos-stations.md`** — the design research is done. Do
not re-research it.

## Locked decisions

**D-28-01 — A station is a first-class destination with a TYPE.**
`KITCHEN`, `BAR`, `PANTRY`, `EXPO`, `DESSERT` — and the type drives which display it appears on.
A bar ticket must not land on the kitchen board. The type is an enum in the domain, extensible by
migration, **not** free text — free text is how "Bar", "bar" and "BAR " become three stations.

**D-28-02 — A user is assigned to zero or more stations, and that assignment filters what they
see.** This is the user's stated gap. Assignment happens **at user creation and at edit**, in the
same form as role assignment. A KITCHEN_STAFF user assigned to BAR sees bar tickets only. A user
assigned to no station sees all stations for their branch — that is the safe default for a small
restaurant with one screen, and it must be the default so existing users are unaffected.

**D-28-03 — A POS terminal is a named profile, and it selects its own menu scope.**
A terminal has: a name, a branch, a station set it fires to, a menu scope (which categories it
offers), and a service model. A bar terminal offers drinks and fires to BAR. A counter terminal
offers everything. **This is what "dedicated POS selecting respective menu" means.**

**D-28-04 — Split tickets are required, not optional.**
One order spanning food and drink produces a kitchen ticket AND a bar ticket, each carrying only
its own lines. A single ticket listing both, sent to both, is wrong — the bar does not need to see
the biryani, and the kitchen must not wait on a mojito. Assert this with an order that spans both.

**D-28-05 — Everything is tenant-manageable. No developer, no seed, no support ticket.**
The user was explicit: *"Nothing should be needed to seed directly via developers or support
team."* Creating a station, a terminal, a menu scope and a staff assignment are all owner/admin UI
operations. If a step needs SQL, the phase is not done.

**D-28-06 — Do not weaken what is already proven.** `pos.tables.admin` vs `pos.tables.manage`
(phase 19b deliberately separated them so a waiter can seat without editing the floor plan), FORCE
RLS on all `pos_db` tables, and the POS WebSocket path. `WS_UPGRADE_PATHS` is not to be touched.

## Definition of done

1. An owner creates a BAR station, a bar POS terminal scoped to drinks, and a bartender user
   assigned to it — entirely in the UI.
2. That bartender sees bar tickets only; the kitchen user does not see them.
3. An order spanning food and drink produces two tickets, each with only its own lines.
4. The bar terminal offers only its scoped categories.
5. A user with no station assignment still sees everything — no existing user is broken.
6. Every step above is reachable from the UI with no SQL. Proven in a browser.
