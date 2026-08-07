# Multi-POS Terminals & Independent Station Routing

**Research doc — adaptivity workstream. Feeds Phase 16 (`Multi-POS Terminals & KDS/BDS Routing`).**
Date: 2026-08-07 · Branch at time of writing: `phase-13-access-repair` @ `5fba4a9`

---

## 0. The requirement, restated

> "A combined food+drink POS, OR a separate food POS and bar counter; orders route to KDS or BDS;
> the admin decides the configuration."

Decomposed, that is five independent knobs the admin must be able to turn, per branch:

| # | Knob | Today |
|---|------|-------|
| 1 | How many POS surfaces exist, and what each is called | Not modelled at all |
| 2 | What each POS surface is allowed to sell (all categories, or food-only, or drink-only) | Not modelled |
| 3 | Where a given item's ticket goes (kitchen line, bar, expo) | Modelled, but tenant-scoped assignment on a branch-scoped station — structurally wrong for multi-branch |
| 4 | Which physical display shows which station's tickets | Works by accident (`station_code` is opaque); no way to say "this board is a bar board" |
| 5 | Whether a given POS needs a cash drawer to operate | Just changed globally by 13-16; not per-POS |

This document states what is verifiably in the repo for each, then designs the missing parts.

**Verification discipline.** Every claim about the repo below cites a file I opened in this session.
Where I could not verify something (runtime behaviour, production data), it is labelled
**[UNVERIFIED]**. This project has repeatedly shipped structurally-present, functionally-dead code —
`TierFeatureDefaults.java:17-18` names two such incidents in its own javadoc — so "the class exists"
is treated as evidence of nothing.

---

## 1. Ground truth — what exists

### 1.1 Station CRUD: real, complete, and unreachable from the UI

`Station` (`services/pos-service/src/main/java/io/restaurantos/pos/domain/model/Station.java`) is a
tenant + branch scoped entity with exactly four business fields: `branchId`, `code`, `name`,
`active`. `StationServiceImpl` implements list/create/update/deactivate, each guarded by
`requireOwnBranch(branchId)` which compares the request parameter against the JWT branch
(`StationServiceImpl.java:87-93`). `StationController` exposes all four at `/api/v1/pos/stations`
under `pos.menu.manage` (writes) / `pos.menu.view`+`pos.kds.view` (reads).

The DDL is `services/pos-service/src/main/resources/db/migration/V7__stations.sql`, with
`uq_station_tenant_branch_code UNIQUE (tenant_id, branch_id, code)` and an `idx_stations_branch`.

`StationAdminIT` covers all of it, including the two foreign-branch denial cases and the two
sendToKds event-shape cases (9 tests). Commit `5fba4a9` fixed the three that were silently failing
on a missing SecurityContext.

**But:** grep across `frontend/lib/repositories/pos.repository.ts` returns **zero** matches for
`station`. The only station-aware frontend code is `kds.repository.ts:82` → `getStations()`, which
reads the *kitchen-service projection*, not the pos-owned canonical table. So the admin CRUD is
reachable only by curl. The audit says the same thing
(`AUDIT-REPORT-2026-08-06.md` §2.4: *"the backend CRUD exists and is completely unused by the
frontend"*).

### 1.2 Item → station assignment: works, and has a live cross-branch corruption path

`MenuServiceImpl.assignStation` (`MenuServiceImpl.java:137-162`) requires `pos.menu.manage`,
requires a non-null `branchId`, validates the station via `findByIdAndBranchId(stationId, branchId)`
so a sibling branch's station cannot be assigned, then sets `menu_items.station_id` **and** mirrors
the station's code into the retained free-text `menu_items.kds_station`.

The problem is one level up, and V7's own comment states it
(`V7__stations.sql:43-45`): *"menu items are tenant-scoped while stations are branch-scoped, so a
shared menu item has no single 'correct' branch-station."*

`MenuItem` (`domain/model/MenuItem.java`) has no `branchId` — it hangs off `MenuCategory`, which
`V1__pos_schema.sql:23` keys `UNIQUE (tenant_id, name)`. So a two-branch tenant has **one** row for
"Chicken Karahi" and **one** `station_id` column on it.

Consequence, which is worse than a gap:

> An admin at Branch B assigning "Chicken Karahi → B's GRILL" **silently re-points the same item for
> Branch A**, and overwrites `kds_station` with B's code. Branch A's tickets start routing to a code
> that may not exist in Branch A — falling through to `DEFAULT`
> (`TicketRoutingService.groupByStation`, line 235-243).

Each write passes its own branch guard. There is no guard against the *last writer winning across
branches*, because the row is not branch-scoped in the first place. This is a real data-integrity
bug in shipped code, not just a missing feature. It is currently masked only because no UI calls the
endpoint (§1.1) — i.e. the bug is latent precisely because the feature is dead.

### 1.3 The fire path and the `ORDER_SENT_TO_KDS` contract

`OrderServiceImpl.addItem` snapshots **both** routing keys onto the line at add time
(`OrderServiceImpl.java:240-244`), with an explicit rationale: *"both captured at add-item time
(never at fire time) so a later menu re-assignment never retroactively re-routes an already-added
line."* Any new routing design must preserve that.

`sendToKds` (`OrderServiceImpl.java:405-537`):

- fires only `OrderItemStatus.PENDING` lines, stamps them `SENT` + `revisionNo` + `firedAt`;
- batches one `stationRepository.findAllById(firedStationIds)` for the whole fire (line 475-482);
- per line: canonical `station.getCode()` when the FK resolved, else the free-text snapshot, else
  `"DEFAULT"` (line 487-492);
- emits `ORDER_SENT_TO_KDS` with `revisionNo`, `orderNotes`, `tableNumber`, `orderType`.

`PosEventPayloads.KdsItemPayload` (`event/PosEventPayloads.java:67-77`) carries
`(orderItemId, menuItemId, name, qty, kdsStation, modifiers, notes, stationId, stationName)`. Its
javadoc is emphatic and correct: *"Field names+order MUST stay byte-identical to kitchen-service
`KitchenEventPayloads.OrderSentToKdsItem` — never reorder/rename; only append."* A mismatch silently
drops every message (Pitfall 4 / the Phase-7 cold-start bug).

`kdsStation` — the **code string** — is still load-bearing. `stationId` is additive and is not yet
the routing key anywhere.

### 1.4 The kitchen consumer and the KDS board

`OrderSentToKdsConsumer` (kitchen-service) → `ProcessedEventService.tryProcess` (eventId dedup) →
`TenantAwareMessageProcessor.process` → `TicketRoutingService.route`.

`TicketRoutingService.route` (`service/TicketRoutingService.java:60-83`):

- **groups by `kdsStation` CODE**, one `KdsTicket` per `(orderId, stationCode)` — this is the split
  ticket, and it already works;
- appends to an existing ticket on a revision fire, reopening `READY → PENDING` (line 101-137);
- upserts a `kds_stations` **projection** row per code, promoting a placeholder name to the real
  canonical name and backfilling `source_station_id` (line 178-213).

The grouping comment (line 67-71) is explicit that code, not id, stays the ticket + WebSocket key
"until Stage D".

`KdsController.getTickets` with **no** `stationCode` already returns the branch-wide active board
(`KdsController.java:62-69`) — that is a working expo/pass view today, whether or not it was
designed as one. `getStations` auto-seeds a `DEFAULT` station when a branch has none (line 154-164).

The board is `frontend/components/kds/station-board.tsx` — four item-status columns, always-dark,
polling + WebSocket, with a `StationSwitcher` that lets one physical screen hop between stations.

### 1.5 The till rule that just changed (13-16 / D-30)

Read from `.planning/phases/13-platform-tenant-access-repair/13-16-SUMMARY.md`:

- `createOrder` **no longer requires** an open till. It binds one *opportunistically* if the creating
  user happens to have one (`OrderServiceImpl.java` create block; comment "TILL BINDING IS
  OPPORTUNISTIC HERE").
- `PaymentServiceImpl.recordPayment` **refuses `PaymentMethod.CASH`** without an `OPEN` till for the
  paying user → 409 `NO_OPEN_TILL`. Card/wallet are exempt and keep best-effort backfill.
- An order already bound at creation keeps its till; the settling cashier's drawer is not
  re-pointed.
- The lookup is `findByCashierIdAndStatus(uid, TillStatus.OPEN)`, returning `Optional`.

And, load-bearing for this document, the summary's own closing section:

> "Making 'orders require a till at creation' a **per-POS-profile** setting — a combined food+drink
> counter versus a separate food POS and bar — is Phase 16 work, per D-30 … This plan establishes
> the correct default so the seed script and the waiter persona work; it builds no configuration
> surface, and none was added."

So §5 of this document is the explicitly-deferred continuation of 13-16, not a re-litigation of it.

### 1.6 Offline: more exists than the audit implies, and one piece of it is dead

`frontend/lib/offline/` contains a real implementation, not a stub:

| File | What it does | Wired? |
|---|---|---|
| `db.ts` | IndexedDB `restaurantos-pos` v1, stores `outbox` / `menu_cache` / `meta` | yes |
| `types.ts` | `OutboxOpType = CREATE_ORDER \| APPEND_ITEMS \| UPDATE_INSTRUCTIONS`; statuses incl. terminal `DEAD` | yes |
| `outbox.ts` | `enqueue`, status transitions, `repointQueuedOps` | yes — called from `lib/hooks/pos/use-orders.ts:99,152,264` |
| `sync-engine.ts` | FIFO drain, single-flight, `requeueRetriable`, in-pass `idRemap` for offline-created orders, dead-letter at MAX_ATTEMPTS | yes |
| `use-online-status.ts`, `sw-register.ts` | online events; SW registered **production only** (dev is deliberately skipped — stale-chunk trap documented in the file) | yes |
| `menu-cache.ts` | `saveMenu` / `getMenu` | **NO — zero callers** |

The dedup contract is sound: `CreateOrderRequest.clientOrderId` is `@NotNull`,
`OrderServiceImpl.createOrder` returns the existing order on a repeat
(`findByClientOrderId`), and `uq_orders_client_order_id UNIQUE (client_order_id)` backstops it
(`V1__pos_schema.sql:171`).

**Verified dead:** a full-frontend grep for `menu-cache` / `saveMenu` outside the module itself
returns exactly one hit — a comment in `e2e/pos-settlement.spec.ts:622` reading
*"menu-item-first not available offline (menu-cache/IndexedDB not warmed)"*. Nothing writes the
cache. A terminal that loses network **cannot render the menu**, so the outbox that would have
queued the order has nothing to queue from. The queue is real; the thing that feeds it is not.

**Also not queued:** `sendToKds`, payments, till open/close. `useFireToKitchen`
(`lib/hooks/pos/use-fire-to-kitchen.ts:26`) and `useSendToKds` (`use-orders.ts:208`) both call
`PosRepository.sendToKds(orderId, crypto.randomUUID())` directly — the per-fire idempotency key is
minted at click time and lost on failure. §7 argues this is *correct* for fire and *incorrect* for
cash.

### 1.7 Four structural facts that contradict the standing brief

These matter because a design that assumes them will be wrong.

**(a) `pos_db` and `kitchen_db` have `ENABLE`, not `FORCE`, row-level security — and the app owns
the tables, so RLS is inert there.**

Every pos migration uses `ALTER TABLE … ENABLE ROW LEVEL SECURITY`
(`V1__pos_schema.sql:26,49,71,91,110,134,174,204,225,247,260`; `V3`:28,56,76; `V7`:34; `V9`:20), and
`V7__stations.sql:18` says so out loud: *"No FORCE ROW LEVEL SECURITY (deferred decision — matches
existing tables)."* Same in kitchen (`V1__kitchen_schema.sql:21,45,70`). `FORCE` **does** exist in
this repo — auth-service (`050`, `056`, `058`, `030`) and crm-service (`011`) use it — so this is a
per-service gap, not a platform-wide absence.

pos-service has a single datasource, `pos_user` (`application.yml:9-12`), and Flyway runs on it
(`spring.flyway.enabled: true`, no separate migration user). `pos_user` therefore **owns** the
tables, and PostgreSQL exempts the owner from `ENABLE`-only RLS. `OrderServiceImpl.java:573-575`
states the conclusion directly:

> *"pos_db's tables are ENABLE (not FORCE) ROW LEVEL SECURITY and the application owns them, so RLS
> is inert for this connection and isolation here is service-layer only."*

**Design consequence:** every new table in this design gets `FORCE ROW LEVEL SECURITY`, and every
new query is written as if there were no database backstop — because for pos_db there is not one.
[UNVERIFIED] whether production runs the same role topology as `deploy/init/02-create-roles.sql`; if
a separate owner is used there, RLS would be live in prod and inert in dev/test, which is worse than
either. Worth confirming before Phase 16 starts. (Task #7 in the session task list already tracks
the Testcontainers half of this.)

**(b) `/api/v1/pos/` has no gateway feature gate — deliberately.**

`RouteFeatureMap` (`gateway/src/main/java/io/restaurantos/gateway/support/RouteFeatureMap.java:32-51`)
maps finance/purchasing/hr/crm/nlq/payroll/analytics/loyalty/kds/kitchen/ecommerce/inventory. There
is **no** `/api/v1/pos/` entry; `application.yml:275-278` routes it with a circuit breaker only, and
the reporting route's comment (line 383-385) cites *"same rationale as pos-route"* — POS is core for
every ACTIVE tenant.

`@RequiresFeature("FEATURE_POS")` on the POS controllers is enforced **in-process** by
`FeatureFlagAspect` (`shared-lib/.../feature/FeatureFlagAspect.java:18-24`), registered at
`SharedAutoConfiguration.java:156`, reading Redis via `RedisFeatureFlagService`. So the flag is real,
just not at the edge.

**Design consequence:** do not add a new `FEATURE_*` code for terminals or BDS without adding it to
`TierFeatureDefaults` in the same commit. `TierFeatureDefaults.java:14-18` documents that this exact
mistake has shipped twice, and `FeatureCodeClosureTest` now fails the build on it. §4.4 recommends
adding no new code at all.

**(c) The KDS WebSocket does not validate the branch claim. The POS one does.**

`KdsWebSocketHandler.validateJwtAndPermission(token, branchId)`
(`kitchen-service/.../ws/KdsWebSocketHandler.java:127-147`) takes `branchId` as a parameter **and
never reads it** — the body checks only that `permissions` contains `pos.kds.view`. Compare
`PosOrderWebSocketHandler.validateJwt` (`pos-service/.../ws/PosOrderWebSocketHandler.java:167-171`),
which explicitly compares `claims.get("branch_id")` to the path variable.

So any `pos.kds.view` holder — **including one from another tenant**, since the tenant is likewise
unchecked — can subscribe to `/api/v1/kitchen/kds/{anyBranchId}/{anyStationCode}` and receive that
branch's live ticket stream. This is a cross-tenant read on a live socket. It is Phase 16 SC5 in the
roadmap; given BDS multiplies the number of boards, it should be fixed **before** BDS ships, not
alongside it.

**(d) `orders.client_order_id` is globally unique and looked up without a tenant predicate.**

`V1__pos_schema.sql:171` is `UNIQUE (client_order_id)` — not `(tenant_id, client_order_id)` — and
`OrderRepository.findByClientOrderId` is `SELECT o FROM Order o WHERE o.clientOrderId = :clientOrderId`
with no tenant filter. With RLS inert (fact **a**), a caller who knows another tenant's
`clientOrderId` gets that tenant's order DTO back from `createOrder`'s idempotency branch. Guessing a
v4 UUID is not a practical attack, so this is low severity — but the *shape* is wrong, and the
multi-terminal work multiplies the number of client-generated ids in flight. Fold the composite-key
fix into the same migration wave.

### 1.8 Summary scorecard

| Capability | State | Evidence |
|---|---|---|
| Station entity, branch-scoped, CRUD | **Built** | `Station.java`, `StationServiceImpl.java`, `V7` |
| Station admin UI | **Missing** | zero `station` refs in `pos.repository.ts` |
| Item → station assignment | **Built, cross-branch unsafe** | `MenuServiceImpl.java:137-162` + `V7:43-45` |
| Per-branch routing for a shared item | **Structurally impossible** | `MenuItem` has no `branchId` |
| Split ticket (one per order×station) | **Built** | `TicketRoutingService.java:60-83` |
| Expo / all-stations board | **Built (incidentally)** | `KdsController.java:62-69` |
| Station type (KITCHEN/BAR/EXPO) | **Missing** | `Station.java` has 4 fields, none is a type |
| BDS | **Works by accident, undirectable** | opaque `station_code`; no filter |
| POS terminal / register entity | **Missing entirely** | no such class in `services/pos-service` |
| Order → terminal attribution | **Missing** | `Order.java` has `cashierId`, `tillSessionId`, no terminal |
| Till ↔ terminal binding | **Missing** | `uq_open_till_per_cashier` is `(tenant_id, cashier_id)` |
| Per-terminal till requirement | **Missing (explicitly deferred)** | 13-16-SUMMARY "What this does not do" |
| Course / fire timing | **Missing** | `OrderItem.java` has `revisionNo`, no course |
| Offline order capture | **Built** | `lib/offline/*` + `use-orders.ts` |
| Offline menu | **Dead code** | `menu-cache.ts` has zero callers |
| KDS WS branch isolation | **Absent** | `KdsWebSocketHandler.java:127-147` |

---

## 2. Design overview

Six pieces, in dependency order. A/B/D are independently shippable; C is the one that touches money
and must not ship half-done.

```
                    ┌─────────────────────────┐
                    │  A. pos_terminals       │  profile: name, branch, till policy,
                    │     (+ devices)         │  service model, printer, categories served
                    └───────────┬─────────────┘
                                │
        ┌───────────────────────┼────────────────────────┐
        │                       │                        │
┌───────▼────────┐   ┌──────────▼──────────┐   ┌─────────▼──────────┐
│ B. routing     │   │ C. till / drawer    │   │ E. course & fire   │
│  item→station  │   │  binding + handover │   │  timing            │
│  per BRANCH    │   │  (breaking index)   │   │  (additive)        │
└───────┬────────┘   └─────────────────────┘   └────────────────────┘
        │
┌───────▼──────────────────────────────┐
│ D. station_type → KDS | BDS | EXPO   │
│    same service, filtered boards     │
└──────────────────────────────────────┘
```

**The organising principle:** a *terminal* answers "where did this order come from and how does this
POS behave"; a *station* answers "where does this food get made"; a *display* answers "which cook is
looking at it". They are three separate axes and the current codebase collapses the second and third
into one opaque string. Keep them separate.

---

## 3. Part A — the POS profile / terminal entity

### 3.1 Two entities, not one

A single `pos_terminals` row conflates two things that change at different rates:

- the **profile** — "Bar Counter": what it sells, whether it needs a drawer, which printer, which
  service model. Changes when the restaurant reorganises. Referenced by orders forever.
- the **device** — the specific iPad with a specific browser. Replaced when it breaks. Must never
  invalidate historical order attribution.

hr-service already has this shape and it is the right precedent:
`AttendanceDeviceEntity` (`services/hr-service/.../entity/AttendanceDeviceEntity.java`) keeps a
tenant+branch scoped registry with a `serialNo` lookup key and a field-encrypted `deviceToken`,
separate from what the device is used *for*. Mirror it.

So: `pos_terminals` (profile) + `pos_terminal_devices` (binding).

### 3.2 `pos_terminals` — fields and why each earns its place

| Column | Type | Rationale |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id`, `branch_id` | UUID NOT NULL | Same scoping as `stations`. Terminals are physical, so branch-scoped is not a choice. |
| `code` | VARCHAR(20) NOT NULL | Short, operator-facing: `T1`, `BAR`. Unique on `(tenant_id, branch_id, code)`, mirroring `uq_station_tenant_branch_code`. Feeds the order-number prefix (§3.6). |
| `name` | VARCHAR(100) NOT NULL | "Bar Counter", "Front Till 1". |
| `service_model` | VARCHAR(20) NOT NULL | `COUNTER` \| `TABLE_SERVICE` \| `SELF_SERVE`. Drives default `OrderType` and whether the table picker is shown. Not a security control. |
| `requires_till` | BOOLEAN NOT NULL DEFAULT true | **The 13-16 continuation.** See §5.2. |
| `has_cash_drawer` | BOOLEAN NOT NULL DEFAULT true | A handheld has none. Distinct from `requires_till`: a terminal may require a till session for accountability while the physical drawer lives elsewhere. |
| `default_order_type` | VARCHAR(20) NULL | `DINE_IN`/`TAKEAWAY`/… — prefills, never overrides an explicit choice. Reuses `OrderType`. |
| `opening_float_default_paisa` | BIGINT NOT NULL DEFAULT 0 | **BIGINT paisa**, per house rule. Prefills the open-till form. |
| `receipt_printer_ref` | VARCHAR(120) NULL | Opaque handle. **Deliberately not a structured type** — see §3.5. |
| `is_active` | BOOLEAN NOT NULL DEFAULT true | Deactivate, never delete: orders reference it. |
| audit columns | | `TenantAuditableEntity` set, matching `Station`. |

`stations` gained `station_type` in Part D; terminals do **not** get a type. A terminal's character
is fully described by `service_model` + the categories it serves + `requires_till`. Adding a
`terminal_type` enum would immediately need `FOOD_AND_DRINK`, which is the union of the other two and
therefore not a type.

### 3.3 What a terminal serves — `pos_terminal_categories`

Requirement knob #2: "a combined food+drink POS, OR a separate food POS and bar counter."

```
pos_terminal_categories (tenant_id, terminal_id, category_id)
  PK (terminal_id, category_id)
```

**Empty set means "serves everything."** This is the single most important default in the design: a
tenant who never opens the config screen must keep today's behaviour exactly, and today's behaviour
is "one POS, whole menu". An empty join table is the only encoding where the do-nothing path is the
compatible path. A `serves_all BOOLEAN` flag would be a second source of truth that can disagree
with the rows.

Category-level, not item-level, because `MenuCategory` is the granularity the menu grid already
groups by (`components/pos/menu-grid.tsx`) and because per-item allow-lists are an admin burden with
no matching operator benefit.

This is a **UI filter, not an authorization boundary.** The server does not reject an add-item for an
unlisted category. Stating that explicitly matters: an ambiguous half-enforcement is how you get a
guard that "only fires when a userId is present" — the exact failure 13-16 documented in
`createOrder`. If a hard boundary is ever wanted it belongs in OPA with its own rego rule and its own
tests, not as a side effect of a display filter.

### 3.4 Device binding — `pos_terminal_devices`

```
pos_terminal_devices
  id, tenant_id, terminal_id,
  device_fingerprint  VARCHAR(64) NOT NULL,   -- client-generated uuid v4, persisted in the SW/IDB `meta` store
  label               VARCHAR(100),           -- "iPad by the window"
  pairing_code        CHAR(6) NULL,           -- short-lived, admin-issued
  pairing_expires_at  TIMESTAMPTZ NULL,
  bound_at            TIMESTAMPTZ NULL,
  last_seen_at        TIMESTAMPTZ NULL,
  is_active           BOOLEAN NOT NULL DEFAULT true
  UNIQUE (tenant_id, device_fingerprint)
```

Pairing flow: admin creates a terminal → issues a 6-digit code with a short TTL → the device posts
`{pairingCode, deviceFingerprint}` to a **bearer-authenticated** endpoint → server binds and returns
`terminalId`. The device stores `terminalId` in the existing IndexedDB `meta` store (`db.ts:17-20`
already has it, unused).

**The trust rule, stated once so it is not eroded later:**

> `terminalId` arriving from a client is an **attribution hint**, never an authorization input.

The precedent is fresh and in-repo: commit `6da5fb2` — *"mint TOTP step-up as a JWT claim; the header
is no longer an input."* The general lesson is that anything the client can type must not be trusted
for a decision the server cares about. Applied here:

- The server validates a supplied `terminalId` **belongs to the caller's JWT branch**, exactly as
  `StationServiceImpl.requireOwnBranch` does — a `requireOwnBranchTerminal(terminalId)` helper in the
  same shape, so the codebase has one pattern and not two.
- For **financial** decisions (which drawer this cash lands in), the terminal is **not** read from
  the request at all. It is read from `till_sessions.terminal_id`, which was set at till-open time
  under the same guard. §5.3.

Putting `terminal_id` in the JWT was considered and rejected: it would require re-issuing a token on
every re-pairing, and auth-service has no notion of a device session. `JwtClaims`
(`shared-lib/.../security/JwtClaims.java:16-19`) is `(subject, tenantId, branchId, roles,
permissions, attributes, impersonatedBy, totpVerified)` — adding a ninth positional component is a
wide blast radius for a field that is not a security boundary. The `attributes` map is available if a
future need arises without a signature change.

### 3.5 Printer: a reference, not a model

`receipt_printer_ref` is an opaque string. Thermal printing is owned by a parallel research track
(**POS thermal printing**) and it will decide whether the transport is ESC/POS over WebUSB, a LAN
print server, or an OS print queue. Modelling a `printer_ip` / `printer_model` here would either
duplicate or contradict that decision. One nullable opaque handle is the correct amount of coupling
today.

**Dependency:** whichever identifier scheme that track lands, `receipt_printer_ref` holds it.

### 3.6 Order attribution

```
ALTER TABLE orders ADD COLUMN terminal_id UUID NULL REFERENCES pos_terminals(id);
ALTER TABLE orders ADD COLUMN source      VARCHAR(20) NOT NULL DEFAULT 'POS';
```

`source` ∈ `POS | KIOSK | ONLINE | PHONE | THIRD_PARTY`. Nullable `terminal_id` because every
existing row has none and because an ONLINE order legitimately has none.

**`orders.terminal_id` is the ORIGIN terminal. It is not the settlement terminal.**

This distinction is forced by 13-16 and is easy to get wrong. A waiter takes an order on handheld
`T3` (no till, per D-30); a cashier settles it at `T1`. Those are two different true facts:

- origin = `orders.terminal_id` = `T3`
- settlement = `orders.till_session_id → till_sessions.terminal_id` = `T1`

Do not overwrite one with the other. The Z-report needs settlement; "which POS is busiest" needs
origin. Reporting (Phase 17) consumes both.

**Order numbering — recommend NOT changing the sequence key.**
`generateOrderNo` (`OrderServiceImpl.java:1050-1063`) does `findForUpdate(tenant, branch, today)` and
formats `ORD-YYYYMMDD-0001`. Keying it by terminal would remove row contention but produce one series
per terminal. At restaurant volumes (hundreds/day) a `SELECT … FOR UPDATE` on one row per branch per
day is not a bottleneck, and a gapless per-branch series is what a tax authority expects.

Recommendation: keep the branch-level counter; add the terminal code as a **display prefix** only
(`T1/ORD-20260807-0042`), derived, not stored.

**Dependency — do not decide this here.** Whether FBR invoice numbering permits a terminal prefix, or
requires its own per-POS series (many jurisdictions require exactly that), is owned by the parallel
**FBR e-invoicing** track. Flag as an open question (§11 Q1).

---

## 4. Part B/D — routing rules and the KDS/BDS split

### 4.1 `stations.station_type`

```
ALTER TABLE stations ADD COLUMN station_type VARCHAR(20) NOT NULL DEFAULT 'KITCHEN'
  CHECK (station_type IN ('KITCHEN','BAR','EXPO'));
```

`DEFAULT 'KITCHEN'` is the whole back-compat story: today every station renders on the KDS, so
every existing row must become `KITCHEN` and nothing moves.

Three values only. `PREP` / `DESSERT` / `COLD` are *names of kitchen stations*, not display types —
they belong in `name`. The type exists solely to answer "which board shows this", and there are three
boards.

`EXPO` is the pass. A station of type `EXPO` shows **every** ticket for the branch regardless of
station — which `KdsController.getTickets` already implements when `stationCode` is omitted
(`KdsController.java:62-69`). So EXPO is a routing *label*, and no item ever routes *to* it.

### 4.2 Projecting the type into kitchen-service

`kds_stations` (`kitchen-service/.../domain/model/KdsStation.java`) is an event-fed projection —
`Station.java:12-14` says so explicitly ("no SQL FK across services"). The type must travel on the
event and land in `TicketRoutingService.upsertStation`, alongside the existing `stationName` /
`sourceStationId` promotion logic (line 178-213).

Two additive trailing fields on `PosEventPayloads.KdsItemPayload`:

```java
public record KdsItemPayload(
        UUID orderItemId, UUID menuItemId, String name, int qty,
        String kdsStation, List<String> modifiers, String notes,
        UUID stationId, String stationName,
        String stationType,   // NEW — "KITCHEN" | "BAR" | "EXPO"
        Short courseNo        // NEW — see §6
) {}
```

**Non-negotiable process constraint:** the identically-named fields must be appended to
`kitchen-service`'s `KitchenEventPayloads.OrderSentToKdsItem` in the **same commit**. The payload's
own javadoc (`PosEventPayloads.java:63-65`) states that field-name parity is the only contract
enforcement and a mismatch *silently drops every message*. A staged rollout across two commits is a
guaranteed outage.

Backfill on the kitchen side: `kds_stations.station_type VARCHAR(20) NOT NULL DEFAULT 'KITCHEN'`,
same reasoning.

### 4.3 Per-branch routing — `menu_item_station_routes`

This fixes §1.2.

```sql
CREATE TABLE menu_item_station_routes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,
    branch_id     UUID NOT NULL,
    menu_item_id  UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    station_id    UUID NOT NULL REFERENCES stations(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID, updated_by UUID, deleted_at TIMESTAMPTZ,
    CONSTRAINT uq_mi_route UNIQUE (tenant_id, branch_id, menu_item_id)
);
ALTER TABLE menu_item_station_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_item_station_routes FORCE  ROW LEVEL SECURITY;   -- see §1.7(a)
CREATE POLICY tenant_isolation ON menu_item_station_routes
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
GRANT SELECT, INSERT, UPDATE, DELETE ON menu_item_station_routes TO pos_user;
```

Plus the category-level fallback, identical shape, keyed `(tenant_id, branch_id, category_id)` —
`menu_category_station_routes`. Categories are how a real admin thinks ("everything in Drinks goes to
the bar"), and it collapses a 200-row chore into one row.

> **The FORCE caveat, said plainly.** `FORCE ROW LEVEL SECURITY` binds the table owner too. Since
> `pos_user` both owns and queries these tables (§1.7a), FORCE is what makes the policy real — and it
> will also bite any future migration that needs to touch rows across tenants. auth-service already
> handles this by toggling `NO FORCE` / `FORCE` around such a migration
> (`058-users-tenant-email-uniqueness.xml:56-62,117`). Follow that pattern, do not silently drop
> FORCE.

### 4.4 Resolution order

Resolved **at add-item time**, in `OrderServiceImpl.addItem`, preserving the snapshot invariant at
line 241-244. Extracted into a `StationRoutingResolver` so it is unit-testable without an order:

```
resolveStation(menuItem, branchId) →
  1. menu_item_station_routes   (branch, item)                        ← per-branch, authoritative
  2. menu_category_station_routes (branch, item.category)             ← per-branch fallback
  3. menu_items.station_id      — ONLY IF that station's branch_id == branchId   ← legacy, now safe
  4. menu_items.kds_station     — matched against a station CODE in THIS branch  ← legacy free-text
  5. null → "DEFAULT"                                                 ← unchanged today's behaviour
```

Step 3's branch check is the fix for §1.2: the legacy tenant-scoped FK stops applying to the wrong
branch instead of mis-routing it. Steps 4 and 5 reproduce today's behaviour byte-for-byte for a
tenant who configures nothing.

Once steps 1–2 exist, `MenuServiceImpl.assignStation` should write a **route row for the caller's
branch**, not `menu_items.station_id`. Keep the column and keep writing the `kds_station` mirror for
one release (the mirror is still read by `OrderReadyConsumer`, §4.6), then retire in a later phase.

### 4.5 Split tickets across kitchen and bar

**Already works.** `TicketRoutingService.groupByStation` (line 235-243) emits one `KdsTicket` per
`(orderId, stationCode)`, and `route` (line 60-83) appends-or-creates per group. An order with a
burger (GRILL) and a mojito (BAR) produces two tickets on the first fire; a revision fire appends to
each and reopens a `READY` one to `PENDING`.

What Part D changes is only *who sees them*: the GRILL ticket on boards filtered to `KITCHEN`, the
BAR ticket on boards filtered to `BAR`, both on an `EXPO` board.

Not in scope and worth naming: **course-aware coordination between stations** (hold the bar's dessert
cocktail until the kitchen plates mains) is a fire-timing problem, §6, not a routing problem.

### 4.6 The ORDER_READY half-signal on split orders

`TicketServiceImpl.checkAndPublishOrderReady` (`TicketServiceImpl.java:244-264`) fires `ORDER_READY`
only when zero tickets for the order are `PENDING`/`COOKING` — correct. But the payload is
`new OrderReadyPayload(orderId, readyTicket.getStationCode(), readyTicket.getReadyAt())`: it carries
**the code of whichever station happened to finish last**.

On the POS side, `OrderReadyConsumer.markOrderReady` then advances only the lines whose
`kdsStation` equals that one code:

```java
String itemStation = item.getKdsStation() != null ? item.getKdsStation() : DEFAULT_KDS_STATION;
if (readiedStation.equals(itemStation) && ELIGIBLE_FOR_READY.contains(item.getItemStatus())) { … }
```

So for a two-station order, `ORDER_READY` advances one station's lines and silently ignores the
other's. **It is not currently a visible bug** because `KITCHEN_ITEM_STATUS_CHANGED` is published on
*every* per-item transition (`TicketServiceImpl.java:89-100`) and `KitchenItemStatusConsumer` applies
each one with a monotonic ordinal guard. The per-item path does the real work; `ORDER_READY` is a
redundant aggregate that happens to be wrong.

Multi-station is exactly the configuration where a regression in the per-item path would stop being
masked. Two options, and I recommend the first:

- **(recommended) Make the aggregate station-agnostic on the POS side.** Treat `ORDER_READY` as
  "every station for this order is done" and advance *all* `ELIGIBLE_FOR_READY` lines. No event
  change, no parity risk, and it becomes a correct backstop for a dropped per-item message.
- Add `stationCodes: List<String>` to the payload — more precise, but it is a contract change on both
  sides with the parity constraint of §4.2 for a field nothing needs.

Either way, add an IT that fires a two-station order and asserts both stations' lines reach `READY`.
No such test exists today (`kitchen-service/src/test/.../TicketRoutingIT.java` covers routing, not the
cross-station ready aggregate).

### 4.7 BDS: is a display-type discriminator needed?

**Direct answer: kitchen-service already handles a bar board, and a discriminator is still needed.**

It handles it because `station_code` is opaque all the way down — `TicketRoutingService` groups by
string, `KdsTicket.stationCode` stores a string, `KdsWebSocketHandler` keys subscribers on
`branchId + ":" + stationCode`, and `StationBoard` renders whatever it is given. Create a station
coded `BAR` today and it renders on the existing board with zero code changes. The audit says the
same (`AUDIT-REPORT §2.4`).

The discriminator is needed for four things that string-opacity cannot give you:

1. **Board scoping.** A bar screen must show bar tickets *only*, and must not need someone to
   remember to navigate to the right code. `GET /stations?type=BAR` is that.
2. **Permissioning.** A bartender should not need `pos.kds.view`, which today grants the food board
   too (and, per §1.7c, every branch's food board).
3. **Analytics.** "Average drink ticket time vs food ticket time" requires knowing which is which.
   Phase 17 will want it.
4. **The admin's mental model.** The requirement is literally "orders route to KDS **or** BDS". A
   config UI cannot express that over an opaque string.

**BDS is therefore not a new service.** It is:

- `stations.station_type = 'BAR'` (§4.1), projected to `kds_stations` (§4.2);
- `GET /api/v1/kitchen/kds/stations?type=BAR` — one optional filter parameter on an existing endpoint;
- a `frontend/app/(tenant)/app/bar/[stationCode]/page.tsx` route that renders the **same**
  `StationBoard` component with a bar-scoped station list.

Reusing `StationBoard` is deliberate: it already carries the always-dark decision (readability at 2m,
07-04-D), the shared `KdsClockProvider` single-interval optimisation (KDS-05/D-13), the
polling+WebSocket combination, and the stable sort. A parallel "BDS board" component would fork all
of it and drift.

**Two traps to avoid, both of which this repo has already fallen into once:**

- **Do not add `FEATURE_BDS`.** A code that `RouteFeatureMap` gates on but that no tier grants is
  refused for everyone with a confident 403 — `TierFeatureDefaults.java:14-18` names two shipped
  instances (purchasing, NLQ). BDS is part of KDS; `/api/v1/kitchen/` already gates on `FEATURE_KDS`
  (`RouteFeatureMap.java:47-48`) and `FEATURE_KDS` is in `ALL_TIERS_ON`
  (`TierFeatureDefaults.java:50`). Nothing to add.
- **Seed `pos.bds.view` / `pos.bds.update` in the same changelog that starts checking them,** granted
  to every role that today holds `pos.kds.view` / `pos.kds.update`
  (`042-kds-permissions-kitchen-role.xml`, plus WAITER via
  `055-waiter-role-and-tenant-admin-authority.xml:103`). For a transition release the check is
  `hasAnyAuthority('pos.bds.view','pos.kds.view')`. A bar board that 403s every existing user on day
  one is the same class of failure as the phantom feature flag.

### 4.8 The KDS WebSocket branch check (do this first)

Before BDS multiplies the number of live boards, close §1.7(c). The fix is small and the correct
version is already written next door:

```java
// KdsWebSocketHandler.validateJwtAndPermission — currently ignores branchId entirely
String tokenBranchId = claims.get("branch_id", String.class);
return tokenBranchId != null && tokenBranchId.equals(branchId);
```

verbatim from `PosOrderWebSocketHandler.java:167-171`. Add `KdsWebSocketBranchIsolationIT` asserting
a foreign-branch subscribe is closed with 1008, mirroring whatever `PosOrderWebSocketPushIT` does for
the POS socket. Roadmap SC5.

---

## 5. Part C — per-terminal till/drawer binding and shift handover

This is the only part that touches money. It should be planned as its own plan with its own RED tests,
the way 13-16 was.

### 5.1 The constraint being changed

```sql
-- V3__pos_tills_payments.sql:33
CREATE UNIQUE INDEX uq_open_till_per_cashier
  ON till_sessions (tenant_id, cashier_id) WHERE status = 'OPEN';
```

One open till per cashier per tenant. A cashier cannot run two drawers; a drawer is not a thing the
model knows about.

### 5.2 `requires_till` per terminal — the 13-16 continuation

13-16 made the rule global: **CASH requires an OPEN till for the paying user**, card/wallet exempt.
That is the correct default and this design does not weaken it. `pos_terminals.requires_till` narrows
it further, never widens it:

| Terminal | `requires_till` | Effect |
|---|---|---|
| Front counter | `true` (default) | Unchanged from 13-16. Cash needs a drawer. |
| Waiter handheld | `false` | Cannot take cash at all — the terminal has no drawer, so a cash tender is refused *at the terminal*, before the till check, with a message that says "settle at a counter" rather than "open a till". |
| Bar counter | `true` | Its own drawer, its own reconciliation. |

The key property: `requires_till = false` **removes the ability to take cash**, it does not remove the
requirement for cash. There is no configuration in which cash is accepted with no drawer behind it.
That preserves D-30's invariant exactly, which is the bar any change here has to clear.

### 5.3 The index swap and the `Optional` that stops being safe

```sql
ALTER TABLE till_sessions ADD COLUMN terminal_id UUID NULL REFERENCES pos_terminals(id);

CREATE UNIQUE INDEX CONCURRENTLY uq_open_till_per_terminal
  ON till_sessions (tenant_id, terminal_id)
  WHERE status = 'OPEN' AND terminal_id IS NOT NULL;
-- then, only after verification:
DROP INDEX uq_open_till_per_cashier;
```

**Data risk: none, in that direction.** The new index can never be violated by existing rows, because
the old index already forbade two OPEN tills per cashier — so no branch can have two OPEN rows that
would now collide on a terminal. Verified by reading the constraint, not assumed.

**Code risk: high, and this is the real work.** Dropping the old index removes the guarantee that
`findByCashierIdAndStatus(uid, OPEN)` returns at most one row. That method returns `Optional` and has
four call sites:

| Call site | Today | After |
|---|---|---|
| `TillServiceImpl.openTill` (`:71-75`) | duplicate-open check | must become `(cashier, terminal)` |
| `OrderServiceImpl.createOrder` | opportunistic bind (D-30) | resolve by the order's terminal; else leave null |
| `PaymentServiceImpl.recordPayment` | **the CASH guard (D-30)** | **must** resolve by terminal |
| `TillServiceImpl.listTills` (`:154-163`) | read | needs a list-returning variant |

`recordPayment` is the one that matters. It has no terminal input today. Design:

```
resolveOpenTill(cashierId, terminalId):
  terminalId != null  → findByCashierIdAndTerminalIdAndStatus(cashierId, terminalId, OPEN)
  terminalId == null  → findAllByCashierIdAndStatus(cashierId, OPEN)
                          0 → throw NoOpenTillException      (unchanged 409 NO_OPEN_TILL)
                          1 → that one                        (unchanged behaviour)
                         >1 → throw AmbiguousTillException    (NEW 409 AMBIGUOUS_TILL)
```

Refusing on ambiguity rather than picking arbitrarily is the whole point. Silently posting cash into
whichever drawer the query happened to order first is strictly worse than the bug 13-16 fixed: that
one made money invisible to reconciliation; this one would make it visible **in the wrong drawer**,
which is indistinguishable from theft in a variance report.

Migration sequencing:

1. **Additive** — `pos_terminals` table + `till_sessions.terminal_id` nullable. Nothing reads it.
2. **Seed** — one `DEFAULT` terminal per branch that has ever had a till row. Backfill `terminal_id`
   on **OPEN** rows only. CLOSED rows stay NULL: there is no correct answer for a historical session
   and inventing one corrupts a signed-off reconciliation. Say so in the migration comment.
3. **Code** — `resolveOpenTill` above, with tests, while the old index is still in place. Every new
   test passes under the old constraint too.
4. **Swap** — create new index `CONCURRENTLY`, verify, drop old.
5. **Config** — expose `requires_till` in the admin UI.

Steps 1–3 are individually revertible. Step 4 is the one-way door.

### 5.4 Shift handover

Today: `openTill` → `closeTill` with `declaredClosingPaisa`, DB-computed `variance_paisa`
(`TillSession.java:44-46`), `reviewStatus` defaulting to `PENDING_REVIEW`, and a `TillReviewService`
+ `TillReviewAction` audit trail. `closeTill` refuses while any bound order is non-terminal
(`TillServiceImpl.java:101-106`).

That is a *close*, not a *handover*. A handover is: cashier A stops, cashier B starts, **the same
physical drawer keeps running**, and every open table stays open. Today that is impossible — A's
close is blocked by the open orders.

Minimal honest design, one new operation:

```
POST /api/v1/pos/tills/{id}/handover   { incomingCashierId, declaredCashPaisa, note }
```

- Closes A's session with `declaredClosingPaisa = declaredCashPaisa`, computing variance normally.
- Opens B's session on the **same terminal** with `openingFloatPaisa = declaredCashPaisa` — the
  counted cash becomes B's float, so the drawer's running total is continuous and each cashier is
  accountable only for their own window.
- **Reassigns open orders' `till_session_id` to the new session.** This is the part that makes it a
  handover rather than two closes, and it is also the part that needs care: 13-16 deliberately
  established that an order already bound keeps its till, because "re-pointing a bound order at the
  settling user's drawer would move cash that a second cashier never physically received." Handover
  is the one case where re-pointing is *correct*, because no cash has been received yet on those
  orders — they are open. Restrict the re-point to orders with **zero payments recorded**; an order
  with a partial payment stays with A, and A's close is blocked until it settles. That keeps the
  13-16 invariant intact instead of carving an exception out of it.
- Emits `TILL_HANDOVER` alongside the existing `TILL_CLOSED`/`TILL_OPENED`
  (`TillServiceImpl.java:34-37`), so reporting sees an unbroken drawer.
- Requires `pos.till.close` **and** `pos.till.open`. No new permission code — see the phantom-flag
  discipline in §4.7.

**Two-person verification is out of scope** (both cashiers authenticating to the handover). It needs
a second-principal mechanism auth-service does not have. Note it and move on.

---

## 6. Part E — course and fire timing

### 6.1 What is already there

`OrderItem.revisionNo` + `firedAt` (`OrderItem.java:67-71`), `sendToKds` firing only `PENDING` lines,
`TicketRoutingService.appendToExistingTicket` reopening a `READY` ticket. Multi-fire is fully built;
it is just untyped — the second fire means "the guest ordered more", not "fire the mains now".

### 6.2 Design — a course number and a scoped fire

```sql
ALTER TABLE order_items ADD COLUMN course_no SMALLINT NOT NULL DEFAULT 1;
```

`SMALLINT`, default 1, so every existing line is course 1 and a tenant who ignores the feature sees
no change. No `courses` table: the number *is* the course, and naming ("Starters", "Mains") is a
per-terminal display concern (§9.3), not a row.

Fire becomes course-scoped, additively:

```java
OrderDto sendToKds(UUID orderId, String clientFireId, Integer courseNo);
//  courseNo == null → fire ALL PENDING lines   ← byte-identical to today
//  courseNo != null → fire PENDING lines of that course only
```

Null-means-all keeps `OrderController.sendToKds` and every existing IT working unchanged, including
`sendToKds_withNoNewPendingItems_throwsZeroValueOrderException`
(`OrderRevisionIT`) — with a course filter that now applies per course, which is the right semantics.

`courseNo` rides on `KdsItemPayload` as the additive trailing field already listed in §4.2, with the
same same-commit parity requirement, and lands on `KdsTicketItem` so the board can group/label.

### 6.3 What is deliberately excluded

- **Timed auto-fire** ("fire mains 12 minutes after starters go ready"). That needs a durable
  scheduler with tenant-scoped jobs, at-least-once semantics, and a story for a service restart
  mid-service. It is a subsystem, not a field. Manual per-course fire covers the workflow the
  requirement actually names ("starters now, mains later").
- **Cross-station course coordination** (bar holds the dessert cocktail until the kitchen plates).
  Requires a coordinator that owns "the order's current course" across independent boards. Real, and
  a phase of its own.
- **Seat numbers.** Adjacent, frequently asked for together, genuinely separate. `OrderItem` would
  need `seat_no` and the whole split-bill path would need to consume it.

---

## 7. Part F — offline resilience, honestly scoped

### 7.1 What actually happens today when the network drops mid-service

Traced through the code in §1.6:

| Action | Offline behaviour today |
|---|---|
| Render the menu | **Fails.** `menu_cache` has no writer; the e2e suite documents this at `e2e/pos-settlement.spec.ts:622`. |
| Create an order | Queued (`use-orders.ts:99`), deduped on replay by `clientOrderId`. |
| Add items | Queued (`:152`), re-pointed to the real order id by `idRemap`/`repointQueuedOps`. |
| Edit instructions | Queued (`:264`). |
| **Fire to kitchen** | **Not queued.** Direct call; on failure the key is lost. And per `AUDIT §112-114`, `handleSendToKitchen` has `try/finally` with no `catch` and clears the cart *before* firing — cashier gets an empty cart, no error, and a ticket the kitchen never saw. |
| Take payment | Not queued. Fails. |
| Open/close till | Not queued. Fails. |
| Banner | Correct (`components/pos/offline-indicator.tsx`). |
| Service worker | Registered **production only** (`sw-register.ts`) — so offline is untestable in `next dev` by design. |

So the honest summary is: **the queue is well built and the terminal cannot reach it, because it
cannot draw a menu.**

### 7.2 In scope for Phase 16 (small, high value)

**(a) Warm the menu cache.** Call `saveMenu(branchId, {categories, items})` from the menu-list hook's
`onSuccess`, and read `getMenu` when `!isOnline`. The module, the store, and the types all already
exist — this is wiring, not building, and it converts the entire offline stack from decorative to
functional. **Highest value-per-line item in this document.**

Under this design the cached snapshot must include, per item: `stationId`, `stationCode`,
`stationType`, `courseNo` default, and the terminal's category allow-list — so the offline UI can
still show "→ Bar" and still filter the grid.

**(b) Cache the terminal profile.** `pos_terminals` row + `pos_terminal_categories` into the existing
`meta` store at pairing time. A terminal that reboots offline must still know it is the bar counter.

**(c) Resolve routing at replay, not at capture.** Because `addItem` snapshots the station
server-side (`OrderServiceImpl.java:240-244`), a queued `APPEND_ITEMS` op resolves against the menu as
it is *at replay*. That is the correct behaviour — a station renamed during the outage routes to the
new one — and it needs **no code change**. It is worth writing down precisely so nobody "fixes" it by
sending a client-computed `stationId` in the payload, which would let a client dictate routing.

### 7.3 Explicitly NOT in scope, with reasons

**Queueing `sendToKds`. Recommend never.** Firing is a message to a human standing at a different
machine. Queueing it means the cashier sees "sent", the kitchen sees nothing, and the divergence is
discovered when the guest asks where their food is. A visible failure is strictly better than a
silent lie. **The correct offline behaviour for fire is to refuse loudly and keep the cart**, which is
exactly the Phase 14 fix (`AUDIT §114`). Phase 16 depends on it landing; it does not duplicate it.

**Offline card/wallet payments. Impossible.** The payment terminal is the authority; the POS cannot
know the result.

**Offline cash payments. Deferred, and here is the shape when it is picked up.** Cash is the one
tender that genuinely completes offline — the money physically moved. But:

- D-30 requires an OPEN till for the paying user, and that cannot be *verified* offline. It can only
  be asserted from local state ("this terminal had till X open before the drop").
- Replay must not double-apply. `recordPayment` has no idempotency key today (unlike `sendToKds` and
  `voidOrder`, which take one — `OrderController.java`). One would have to be added first.
- Reconciliation is wrong for the duration of the outage, so `closeTill` must refuse while any
  payment op is unsynced.

That is a plan of its own with its own financial-invariant tests. Do not bolt it onto Phase 16.

**Full offline mode (a terminal that runs a whole service disconnected).** Requires local pricing,
local tax, local sequence allocation, and conflict resolution on reconnect. Different product.

### 7.4 The honest one-line answer

> After Phase 16, a terminal that loses the network can **keep taking orders** (menu from cache, order
> and items queued, replayed and deduped on reconnect) but **cannot fire to the kitchen, take
> payment, or open/close a till.** It says so, loudly, instead of pretending.

---

## 8. Data model summary

New tables (all in `pos_db`, all `ENABLE` + `FORCE ROW LEVEL SECURITY` per §1.7a, all
`GRANT … TO pos_user`, all with the `TenantAuditableEntity` audit columns):

| Table | Key | Purpose |
|---|---|---|
| `pos_terminals` | `UNIQUE (tenant_id, branch_id, code)` | Terminal profile (§3.2) |
| `pos_terminal_categories` | `PK (terminal_id, category_id)` | What it sells; empty = everything (§3.3) |
| `pos_terminal_devices` | `UNIQUE (tenant_id, device_fingerprint)` | Device pairing (§3.4) |
| `menu_item_station_routes` | `UNIQUE (tenant_id, branch_id, menu_item_id)` | Per-branch item routing (§4.3) |
| `menu_category_station_routes` | `UNIQUE (tenant_id, branch_id, category_id)` | Per-branch category fallback (§4.3) |

Altered:

| Table | Change | Note |
|---|---|---|
| `stations` | `+ station_type VARCHAR(20) NOT NULL DEFAULT 'KITCHEN' CHECK (…)` | §4.1 |
| `orders` | `+ terminal_id UUID NULL REFERENCES pos_terminals(id)`, `+ source VARCHAR(20) NOT NULL DEFAULT 'POS'` | §3.6 |
| `order_items` | `+ course_no SMALLINT NOT NULL DEFAULT 1` | §6.2 |
| `till_sessions` | `+ terminal_id UUID NULL REFERENCES pos_terminals(id)`; index swap | §5.3 |
| `orders` (fix) | `uq_orders_client_order_id` → `UNIQUE (tenant_id, client_order_id)` + tenant predicate on `findByClientOrderId` | §1.7d |
| `kds_stations` (kitchen_db) | `+ station_type VARCHAR(20) NOT NULL DEFAULT 'KITCHEN'` | §4.2 projection |
| `kds_ticket_items` (kitchen_db) | `+ course_no SMALLINT` | §6.2 |

**Money:** the only monetary field added is `pos_terminals.opening_float_default_paisa`, `BIGINT`
paisa. No new event payload carries an amount, so no float or decimal can enter one.

---

## 9. API and UI surface

### 9.1 New endpoints

All under existing gateway routes, so **no `RouteFeatureMap` change** and no new `FEATURE_*` code
(§1.7b, §4.7).

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/pos/terminals?branchId=` | `pos.menu.view` |
| POST | `/api/v1/pos/terminals?branchId=` | `pos.menu.manage` |
| PUT | `/api/v1/pos/terminals/{id}?branchId=` | `pos.menu.manage` |
| DELETE | `/api/v1/pos/terminals/{id}?branchId=` (deactivate) | `pos.menu.manage` |
| PUT | `/api/v1/pos/terminals/{id}/categories?branchId=` | `pos.menu.manage` |
| POST | `/api/v1/pos/terminals/{id}/pairing-code?branchId=` | `pos.menu.manage` |
| POST | `/api/v1/pos/terminals/pair` (body: code + fingerprint) | authenticated |
| GET | `/api/v1/pos/terminals/me` (resolve bound terminal) | authenticated |
| PUT | `/api/v1/pos/menu-items/{id}/route?branchId=` | `pos.menu.manage` |
| PUT | `/api/v1/pos/menu-categories/{id}/route?branchId=` | `pos.menu.manage` |
| POST | `/api/v1/pos/tills/{id}/handover` | `pos.till.open` + `pos.till.close` |
| GET | `/api/v1/kitchen/kds/stations?branchId=&type=BAR` | `pos.kds.view` \| `pos.bds.view` |

`branchId` stays an explicit request parameter validated against the JWT branch inside the service —
the convention every existing POS controller follows (`StationController.java:18-22`) — rather than
being inferred. Consistency beats cleverness here; a mixed convention is how a guard gets skipped.

`PUT /terminals/{id}/categories` replaces the whole set in one call. A per-row add/remove API invites
partial states with no transaction around them.

`POST /terminals/pair` is the one endpoint whose body carries a secret-ish value (the pairing code).
Short TTL, single use, and it must be rate-limited — otherwise six digits is 10^6 guesses against an
endpoint that hands out a terminal binding.

### 9.2 Event contract changes

| Event | Change | Constraint |
|---|---|---|
| `ORDER_SENT_TO_KDS` → `KdsItemPayload` | append `stationType`, `courseNo` | **Same commit** as the identically-named fields on `KitchenEventPayloads.OrderSentToKdsItem`, or every message silently drops (`PosEventPayloads.java:63-65`) |
| `ORDER_CREATED` → `OrderCreatedPayload` | append `terminalId`, `source` | Consumed by inventory/finance/CRM/reporting — append only, never reorder |
| `TILL_HANDOVER` | new | `Map`-based like the existing `TILL_OPENED`/`TILL_CLOSED` (`TillServiceImpl.java:82-89`) |
| `ORDER_READY` | **no change** — fix on the consumer side (§4.6) | avoids a parity risk for zero benefit |

### 9.3 Frontend, within the 4-layer rule

The ESLint rule (`frontend/eslint.config.mjs:15-35`) restricts `components/**` from importing
`@/lib/api-client*` or `@/lib/repositories*`. Every new surface follows
api-client → repositories → adapters/schemas → hooks → components.

| Layer | Additions |
|---|---|
| schemas | `apiPosTerminalSchema`, `apiStationSchema` (pos-owned — distinct from the existing `apiKdsStationSchema`, which is the kitchen projection), `apiMenuItemRouteSchema` |
| adapters | `adaptPosTerminal`, `adaptStation`, `adaptMenuItemRoute` — Instant→Date, paisa stays a number |
| repositories | extend `pos.repository.ts` with terminals + stations + routes; extend `kds.repository.ts` `getStations(branchId, type?)` |
| hooks | `lib/hooks/pos/use-terminals.ts`, `use-stations.ts`, `use-item-routes.ts`; `lib/hooks/kds/use-bds-tickets.ts` (thin wrapper) |
| query keys | `queryKeys.pos.terminals(branchId)`, `.stations(branchId)`, `.itemRoutes(branchId)` — branch-scoped second segment, per the registry's own convention (`query-keys.ts:1-6`) |
| components | `components/pos/admin/terminal-list.tsx`, `terminal-form.tsx`, `terminal-categories-picker.tsx`, `station-list.tsx`, `station-form.tsx`, `menu-item-station-picker.tsx` |
| routes | `app/(tenant)/app/menu/stations/page.tsx`, `app/(tenant)/app/pos/terminals/page.tsx`, `app/(tenant)/app/bar/[stationCode]/page.tsx` |

The bar route renders the existing `StationBoard` (§4.7). Visual treatment of the new admin screens is
owned by the parallel **UI/UX visual direction** and **frontend component stack** tracks; this design
specifies structure and data flow only, and should adopt whatever `Select`/`DataTable` primitives
those tracks land rather than adding to the 45 hand-rolled `<select>` the audit counted
(`AUDIT §118`).

**Sequencing note:** the station admin UI + item→station picker are the "cheap 80%" the audit calls
out (`AUDIT §137`). They depend on nothing in Parts A/C/E. Ship them first — they make an already-built,
already-tested backend reachable, which is the highest-confidence work in the phase.

---

## 10. Tenant-configurable settings this unlocks

Per branch, by a tenant admin holding `pos.menu.manage`:

- number, code and name of POS terminals
- per terminal: service model (counter / table service / self-serve)
- per terminal: `requires_till`, `has_cash_drawer`, default opening float (paisa)
- per terminal: default order type
- per terminal: which menu categories it sells (empty = all)
- per terminal: receipt printer reference
- per terminal: device pairing / unpairing
- per branch: stations, each typed KITCHEN / BAR / EXPO
- per branch: item → station route, with category-level fallback
- per station: escalation threshold (already exists — `KdsStation.escalationThresholdSeconds`, unused
  by any admin UI)

By a SuperAdmin: nothing new. No new `FEATURE_*` code (§4.7), so `tenant_features` and
`is_override` are untouched. That is a deliberate outcome, not an omission — every new feature code
is a new way to 403 an entire module.

**Dependency:** whether these live in a generic per-branch settings store or as dedicated tables is
owned by the parallel **current tenant configurability** track. This design assumes dedicated tables
because they carry FKs (`terminal_id` on orders and tills) that a JSON settings blob cannot.

---

## 11. Open questions

1. **FBR invoice numbering vs per-terminal series.** §3.6 recommends a branch-level sequence with a
   terminal display prefix. If FBR requires a distinct series per point of sale, `order_sequences` must
   be re-keyed to `(tenant, branch, terminal, business_date)` — a PK change on a table that
   `generateOrderNo` locks with `findForUpdate`. **Owned by the FBR e-invoicing track. Blocks §3.6.**
2. **Is `terminal_id` ever an authorization boundary?** This design says no (§3.4). If a tenant wants
   "the bar terminal physically cannot ring up food", that is an OPA rule with its own rego and tests,
   not a UI filter. Needs a product decision before someone implements it as a filter and calls it
   enforcement.
3. **Does production run the same DB role topology as `deploy/init/`?** §1.7(a) concludes RLS is inert
   in pos_db because `pos_user` owns the tables. If production uses a separate owner, RLS is live in
   prod and inert in dev/test — the worst combination. **[UNVERIFIED] — confirm before Phase 16.**
4. **Handover with partial payments.** §5.4 restricts re-pointing to orders with zero payments. Is
   blocking A's close on a partially-paid order acceptable operationally, or does it need a split
   settlement? Ask an operator.
5. **Should EXPO be a station type or a board mode?** It is currently modelled as a type, but no item
   routes to it — it is a view over all stations. A `board_mode` on the *display* would be more honest.
   Kept as a type because the roadmap names it that way (SC2) and the difference is one enum value.
6. **Two-person till handover verification.** Out of scope (§5.4). Needs a second-principal auth
   mechanism that does not exist.
7. **`kds_station` free-text retirement.** Steps 4–5 of the resolver (§4.4) and
   `OrderReadyConsumer`'s matching (§4.6) both still read the code string. A dedicated cleanup phase
   should move the ticket/WS key from code to `stationId` — the "Stage D" that `TicketRoutingService`'s
   comment (line 67-71) already anticipates.

---

## 12. Effort

Assumes one agent, TDD to the standard of 13-16 (RED tests first, real `mvn verify` output), and that
Phase 13 has landed.

| Workstream | Days | Notes |
|---|---|---|
| Station admin UI + item→station picker (backend already done) | 3 | The "cheap 80%". No backend work beyond the route endpoints. |
| KDS WebSocket branch validation + IT | 0.5 | Copy `PosOrderWebSocketHandler.validateJwt`. Do first. |
| `station_type` + projection + BDS route + permissions seed | 3 | Includes the same-commit event parity and the `pos.bds.*` seed |
| `menu_item_station_routes` + category fallback + resolver + tests | 3 | Includes fixing the §1.2 cross-branch path |
| `pos_terminals` + devices + categories + CRUD + admin UI | 4 | Largest single piece |
| `orders.terminal_id` / `source` + event append | 1 | |
| Till/terminal binding + `resolveOpenTill` + index swap + migration | 3 | **Highest risk.** Own plan, own RED tests. |
| Course number + course-scoped fire + KDS display | 2 | |
| Offline: warm menu cache, cache terminal profile | 1.5 | Wiring existing modules |
| ORDER_READY split-order consumer fix + IT | 0.5 | |
| `client_order_id` composite key + tenant predicate | 0.5 | Fold into a migration wave |
| **Total** | **~22** | |

Realistic band **19–24 days**. The till index swap is the schedule risk: if `resolveOpenTill` uncovers
a fifth call site or the `Optional` assumption is baked into a test fixture the way it was in the 13
ITs that 13-16 had to update, that item alone can double.

**Suggested split into shippable increments:**

- **16a (≈4d, zero risk):** station admin UI + item→station picker + KDS WS branch fix. Makes existing
  tested code reachable and closes a cross-tenant socket leak.
- **16b (≈6d):** `station_type` + per-branch routing + BDS board. Delivers "food POS and bar counter →
  KDS or BDS" end to end.
- **16c (≈6d):** terminals + attribution + admin UI + offline cache warm.
- **16d (≈4d):** till/terminal binding + handover. The money-touching one, alone, with its own review.
- **16e (≈2d):** courses.

16a and 16b together already satisfy the user's stated requirement for the *routing* half. 16c/16d are
what make "multiple POS" true rather than "one POS with several boards".

---

## 13. Cross-references

Depends on / defers to these parallel research tracks — **not re-researched here**:

| Track | This document's dependency |
|---|---|
| FBR e-invoicing | Order numbering per terminal (§3.6, Q1) |
| POS thermal printing | `receipt_printer_ref` semantics (§3.5); per-station print routing |
| ERP module gaps | Whether terminal-level reporting is in Phase 17's scope |
| Cross-module integration gaps | `ORDER_CREATED` payload append (§9.2) — inventory/finance/CRM/reporting consumers |
| UI/UX visual direction | Visual treatment of the admin screens (§9.3) |
| Frontend component stack | `Select` / `DataTable` primitives the new screens use (§9.3) |
| Current tenant configurability | Where terminal settings live in the wider config model (§10) |
| Testing strategy | IT patterns for the till index swap and the event-parity guard |
| Biometric attendance | `AttendanceDeviceEntity` cited only as a *precedent* for device registration (§3.1) |

**Phase dependencies:** Phase 13 (access repair) is a hard blocker per `ROADMAP.md:715`. Phase 14 owns
the fire-to-kitchen `catch` fix (`AUDIT §114`) that §7.3 relies on. Phase 15 owns the design system
the admin screens should adopt. The roadmap states Phase 16 may run in parallel with 14/15 once 13
lands.

---

## Appendix — file index

Read and cited in this document:

**pos-service**
`domain/model/Station.java` · `domain/model/MenuItem.java` · `domain/model/OrderItem.java` ·
`domain/model/Order.java` · `domain/model/TillSession.java` · `domain/enums/OrderItemStatus.java` ·
`domain/enums/OrderType.java` · `service/StationServiceImpl.java` · `service/MenuServiceImpl.java` ·
`service/OrderServiceImpl.java` · `service/TillServiceImpl.java` · `authz/PosAuthorizationService.java` ·
`web/StationController.java` · `web/OrderController.java` · `consumer/OrderReadyConsumer.java` ·
`consumer/KitchenItemStatusConsumer.java` · `event/PosEventPayloads.java` ·
`repository/OrderRepository.java` · `dto/CreateOrderRequest.java` · `ws/PosOrderWebSocketHandler.java` ·
`src/test/java/io/restaurantos/pos/StationAdminIT.java` ·
`src/main/resources/application.yml` ·
`src/main/resources/db/migration/{V1__pos_schema,V3__pos_tills_payments,V7__stations}.sql`

**kitchen-service**
`service/TicketRoutingService.java` · `service/TicketServiceImpl.java` ·
`consumer/OrderSentToKdsConsumer.java` · `domain/model/KdsStation.java` · `domain/model/KdsTicket.java` ·
`domain/enums/TicketItemStatus.java` · `web/KdsController.java` · `ws/KdsWebSocketHandler.java` ·
`src/main/resources/db/migration/V1__kitchen_schema.sql`

**gateway / shared-lib / platform-admin / auth**
`gateway/src/main/java/io/restaurantos/gateway/support/RouteFeatureMap.java` ·
`gateway/src/main/resources/application.yml` ·
`shared-lib/src/main/java/io/restaurantos/shared/feature/FeatureFlagAspect.java` ·
`shared-lib/src/main/java/io/restaurantos/shared/config/SharedAutoConfiguration.java` ·
`shared-lib/src/main/java/io/restaurantos/shared/security/JwtClaims.java` ·
`platform-admin-service/src/main/java/io/restaurantos/platform/config/TierFeatureDefaults.java` ·
`auth-service/src/main/resources/db/changelog/v1.0.0/{042-kds-permissions-kitchen-role,055-waiter-role-and-tenant-admin-authority,058-users-tenant-email-uniqueness}.xml`

**hr-service (precedent only)**
`entity/AttendanceDeviceEntity.java`

**frontend**
`eslint.config.mjs` · `lib/offline/{db,types,outbox,sync-engine,menu-cache,sw-register}.ts` ·
`lib/hooks/pos/{use-orders,use-fire-to-kitchen}.ts` · `lib/hooks/query-keys.ts` ·
`lib/repositories/{pos,kds}.repository.ts` · `components/kds/station-board.tsx` ·
`components/pos/offline-indicator.tsx` · `e2e/pos-settlement.spec.ts`

**planning**
`.planning/ROADMAP.md` · `.planning/phases/13-platform-tenant-access-repair/13-16-SUMMARY.md` ·
`AUDIT-REPORT-2026-08-06.md` §2.4

**deploy**
`deploy/init/{02-create-roles,03-grant-schema-privileges}.sql`
