# Business Operating Models — a tenant-configurable service model for ResturantOS POS

Research date: 2026-08-07
Branch read: `phase-13-access-repair` @ `5fba4a9`
Scope: `services/pos-service` (order/payment/till/state machine), `services/kitchen-service`
consumers, `gateway` feature enforcement, `services/platform-admin-service` tier/feature state,
and the `frontend` POS surfaces.

Every claim about this repository cites a file I opened. Claims I could not verify are marked
**UNVERIFIED**. Claims about third-party POS products cite the vendor doc I read.

**Parallel research streams this document depends on and does NOT duplicate:** FBR e-invoicing,
POS thermal printing, biometric attendance, ERP module gaps
(`.planning/research/erp-completion/erp-gap-modules.md`), cross-module integration gaps,
UI/UX visual direction (`uiux-direction.md`), frontend component stack (`uiux-stack.md`),
current tenant configurability (`.planning/research/erp-completion/tenant-configurability.md`),
and testing strategy.

---

## 0. The headline finding, in one paragraph

ResturantOS today implements **exactly one** operating model — order-first table service — and it
implements it *well*. Four things are hardcoded that make every other model either impossible or
silently broken: (1) `sendToKds` has **no payment precondition of any kind**, so pay-before-fire
exists only as JavaScript in the customer's browser
(`frontend/components/pos/charge-summary.tsx:162-176`); (2) `maybeCloseOrder` requires
`derivedStatus == SERVED`, and *nothing but a human tapping "Mark Served" per line* ever produces
that — so a fully-paid QSR, kiosk or retail sale **never closes, never posts revenue, and blocks
its cashier's till from closing**; (3) the till requirement is welded to `PaymentMethod.CASH`, which
is right for a counter and wrong for a kiosk where the payer is a customer with no drawer; (4)
`OrderType` conflates *where the food goes* with *who entered the order*, which is why drive-thru
and aggregator orders have nowhere to live. The fix is a tenant-owned **service profile** —
a named preset that resolves to an explicit knob-set, resolved per branch / per POS profile /
per order type, read by pos-service on the order hot path, with `ORDER_FIRST` as the fail-safe
default so a missing row can never change what a running restaurant does.

---

## 1. How real POS products express this

The dominant pattern across every product I looked at is **a mode, plus individually-overridable
knobs** — never a pure enum, never a pure bag of switches. This matters because it is the single
biggest design decision below.

### 1.1 Toast — the closest match to what we need

Toast splits it into an order-screen *mode* and a small set of UI options
([Toast platform guide, UI options settings](https://doc.toasttab.com/doc/platformguide/adminUiOptionsReference.html);
[Manage Orders With Toast POS](https://support.toasttab.com/en/article/New-POS-Experience-Ordering-Screens)):

| Toast setting | Effect | Our equivalent |
|---|---|---|
| **Quick Order** vs **Table Service** screens | Quick Order suits quick-service/fast-casual; Table Service focuses on table actions | `service_model` preset |
| **"Orders send only after check is paid"** | When On, *only* the Pay button appears and "Employees must receive payment to send tickets to the kitchen." When Off, Send/Stay/Hold appear | `fire_trigger = ON_FULL_PAYMENT` vs `MANUAL` |
| **"Show Send, Stay, and Hold buttons"** | Only applies when the above is Off. Send = fire without payment; Stay = fire partial and keep entering; Hold = save without sending or payment | which terminal actions render |
| **"Prompt for dining option? (Quick Order only)"** | forces the order type choice at send time | `requires_explicit_order_type` |
| **Course firing** ([Course Firing Options](https://support.toasttab.com/en/article/Course-Firing-Options)) | hold courses until manually fired | out of scope this round; noted in §11 |

The load-bearing observation: **Toast enforces pay-before-fire by removing the Send button** and by
the server refusing tickets — it is a property of the check, not of the client screen. We currently
have it as a `if (willBeFullyPaid && order.sentToKdsAt === null)` in React.

### 1.2 Lightspeed Restaurant — mode as a first-class install-time choice

[About Quick Service mode (L-Series)](https://resto-support.lightspeedhq.com/hc/en-us/articles/360039212374-About-Quick-Service-mode):
Quick Service mode "is designed for restaurants that have a pay-at-order workflow" and collapses
order → payment → bill into one screen. Table Service mode is the default, with editable seating,
coursing, check splitting and payment after service
([Adding orders in Table Service mode, K-Series](https://k-series-support.lightspeedhq.com/hc/en-us/articles/360051089273-Adding-orders-in-Table-Service-mode)).
Confirms: mode is a *venue* property, not a per-transaction toggle.

### 1.3 Odoo — a boolean that unlocks a whole feature family

[Odoo 19 Restaurant features](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/restaurant.html):
"Is a Bar/Restaurant" on the POS config unlocks floors/tables, courses and preparation printers.
Ordering is explicit and staged — `Course` groups items, `Order` sends to the kitchen and fires
course 1, `Fire Course 2` fires the next. Odoo's model is a **per-POS-config** object, not
per-company: one Odoo database routinely runs a restaurant POS *and* a bar POS *and* a shop POS
with different settings. That is the precedent for our per-POS-profile resolution layer (§4.2).

### 1.4 Loyverse — the retail/quick-bill baseline

[How to Work with Open Tickets](https://help.loyverse.com/help/open-tickets): "Open Tickets" is a
Back Office → Settings → **Features** toggle. Off = every sale is scan-and-pay (a Pay button only).
On = a **Save** button appears and an "Open tickets" list becomes reachable; with *predefined
tickets* you pick from a list ("Table 1", "Table 2") instead of typing a name
([predefined open tickets](https://help.loyverse.com/help/how-use-predefined-open-tickets)).
Shifts record opening cash, pay-ins/pay-outs, cash sales and refunds
([Shift Management](https://help.loyverse.com/help/shift-management-loyverse-pos)); the drawer opens
on shift open, shift close, and on completing a cash sale
([Connect a Cash Drawer](https://help.loyverse.com/help/connect-cash-drawer)).
This is exactly our `allows_open_tab` knob, and it validates our D-30 rule that the drawer is a
**cash** concept, not an order concept.

### 1.5 Square — per-check firing control

[Set up coursing for checks](https://squareup.com/help/us/en/article/7748-coursing-with-square-kds)
(Dashboard → Restaurants → Service Settings → Coursing): courses can auto-fire on item prep time,
or all courses can be **held until manually fired**; tickets print/display at *firing* time, not
at order-entry time. Square's self-serve Kiosk requires payment from the customer before the order
can be submitted at all
([Self-Service Kiosk explainer](https://squareup.com/us/en/the-bottom-line/selling-anywhere/self-serve-kiosks-businesses-explainer)),
and the Square community confirms QR self-serve has **no open-tab option**
([Self Serve QR ordering pay later](https://community.squareup.com/t5/Orders-Menu-Items-Catalog/Self-Serve-QR-ordering-pay-later/td-p/794292)).

### 1.6 Petpooja — the KOT/bill split we already have, named

Petpooja's QSR and restaurant products both centre on **KOT** as a separate artefact from the
**bill**: "take orders, print KOT and print bills in three simple clicks", KOTs routed per station
with a unique printer per station, and KOT generated on one terminal while the bill prints on
another ([Petpooja restaurant billing](https://www.petpooja.com/poss/restaurant-billing-software),
[Petpooja QSR](https://www.petpooja.com/poss/quick-service-restaurant-software)). Our
`sendToKds` **is** the KOT event and our `Order` **is** the bill — the separation is already right;
what is missing is a rule about their ordering.

I could not find public Petpooja documentation that names a "Quick Bill vs KOT mode" setting
explicitly — **UNVERIFIED**. The KOT/bill separation above is documented; the mode toggle is not.

### 1.7 Self-service, kiosk and QR — the industry consensus

Kiosk systems inject the order into the KDS **on payment authorisation**, not on submit
([Chowbus](https://www.chowbus.com/hardware/restaurant-kiosk),
[Toast kiosk](https://pos.toasttab.com/hardware/restaurant-kiosk)). For QR at table, quick-service
and takeaway venues use pay-at-order and sit-down venues prefer pay-at-table
([Order and Pay at the Table guide](https://www.finedinemenu.com/en/blog/qr-code-ordering-and-fast-checkout-a-complete-guide-for-restaurants/);
[Toast Mobile Order & Pay FAQ](https://support.toasttab.com/en/article/Toast-Mobile-Order-and-Pay-FAQs)).
So **QR-at-table is not one model — it is two**, and which one a venue wants is exactly the
configuration this document is about.

### 1.8 Aggregators — an accept/reject window before anything else

Aggregator integrations (Deliverect, Cuboh, Sapaad, KitchenHub) all describe the same lifecycle:
inject → validate/map → **accept (often auto-accept in ~0.1s to protect app ranking)** → fire →
status callbacks → pickup/delivery
([Deliverect](https://www.deliverect.com/en-us/what-is),
[Cuboh](https://www.cuboh.com/blog/benefits-of-using-a-food-delivery-aggregator),
[Sapaad](https://www.sapaad.com/automate-your-online-delivery-business-with-the-power-of-pos-integration/)).
The order arrives **already paid, by someone who is not a user of our system, with no till** — the
single hardest case for our current code.

---

## 2. The models, and what changes in the lifecycle for each

The five columns the brief asks for, for every model. "Till" means an OPEN `TillSession`
(`services/pos-service/src/main/java/io/restaurantos/pos/domain/model/TillSession.java`).

### 2.1 ORDER-FIRST — table service (the current, and default, model)

| Question | Answer |
|---|---|
| Order created when | Waiter taps **Send to Kitchen** or **Save as Draft** — the cart is client-only until then (`frontend/components/pos/pos-terminal.tsx:34-38, 127-150`) |
| Fires to KDS when | Explicitly, on `POST /orders/{id}/send-to-kds`; repeatable per revision (`OrderServiceImpl.sendToKds`, self-loop transitions in `OrderStateMachine:27-42`) |
| Payment required | **After** service. Multiple partial tenders allowed; order closes only when Paid **and** Served |
| Till required | Only for CASH, of the *settling* user (D-30, `PaymentServiceImpl:92-104`). The waiter needs none |
| Receipt flow | Pre-bill ("check") on request before payment → final receipt at close. Two documents |

This is the model the code was built for and the one 13-16 repaired. It stays the fail-safe default.

### 2.2 BILL-FIRST / pay-first — QSR counter, café

| Question | Answer |
|---|---|
| Order created when | Cashier taps **Charge** — cart persisted, no fire (`pos-terminal.tsx:172-182`) |
| Fires to KDS when | **On full payment**, and never before. Today this is a client-side `if` in `charge-summary.tsx:169`; it must move server-side |
| Payment required | Before fire. Partial tenders allowed *only* as split tender within one settlement; the order does not reach the kitchen until the balance is zero |
| Till required | Yes for CASH (same D-30 rule). Card-only counters legitimately need none |
| Receipt flow | One document at payment: customer receipt **+ queue token**. KOT prints at the same instant, to the kitchen |
| Close condition | Payment alone (optionally payment + KDS ready). **Not** `derivedStatus == SERVED` — nobody marks a burger "served" at a counter |

### 2.3 SELF-CHECKOUT — kiosk, QR-at-table (pay-first variant)

| Question | Answer |
|---|---|
| Order created when | Customer submits the cart from the kiosk/phone. Order is created by a **device principal**, not a staff user |
| Fires to KDS when | On payment authorisation only |
| Payment required | Always, up front. No open tab (matches Square's kiosk behaviour) |
| Till required | **None** — there is no drawer and no cashier. `tillRequirement = NONE`, and CASH must therefore be excluded from the profile's allowed tenders or D-30's hole reopens (§6.7) |
| Receipt flow | Digital: on-screen token + emailed/SMS receipt; optional printed token slip. No pre-bill |
| Special | `cashierId` is null. Every guard that assumes a user id must be re-read — `PaymentServiceImpl:93` currently throws `NoOpenTillException("<unauthenticated>")` when there is no user |

### 2.4 QR-AT-TABLE, open-tab variant

Distinct from 2.3 and deliberately so: the guest scans, orders, food fires immediately, the guest
keeps ordering, and a waiter or the guest settles at the end.

| Question | Answer |
|---|---|
| Order created when | First submit from the guest's phone, bound to the table's QR token |
| Fires to KDS when | On each submit (`fire_trigger = ON_ITEM_ADD` at the *submission* granularity, one revision per submit) |
| Payment required | At the end — same as order-first |
| Till required | For CASH only, of whoever settles |
| Receipt flow | Digital pre-bill on the guest's phone; final receipt on close |

### 2.5 Drive-thru

The genuinely awkward one, because the *order point* and the *payment point* are different physical
stations, often different staff, and sometimes a shared drawer.

| Question | Answer |
|---|---|
| Order created when | At the speaker/lane terminal — order-first |
| Fires to KDS when | Immediately on confirm at the lane (`fire_trigger = MANUAL`, fired at the order window). Food must be cooking while the car moves to the window |
| Payment required | At the pay window, before handover |
| Till required | Yes for CASH — but the drawer belongs to the **pay window**, not to the lane operator |
| Receipt flow | Order token/screen at the lane; receipt at the pay window |
| Blocker in our code | `TillSession` is keyed on `cashierId` only, and `TillServiceImpl.openTill:72-75` refuses a second OPEN till for the same user. A window-bound / terminal-bound till does not exist. See §6.10 |

### 2.6 Takeaway and pickup (counter-collected)

Mechanically BILL_FIRST or ORDER_FIRST depending on the venue; the real difference is fulfilment,
not lifecycle. `OrderType.TAKEAWAY` and `OrderType.PICKUP` already exist
(`domain/enums/OrderType.java`, widened in `db/migration/V6__order_type_pickup.sql`). What is
missing is that they cannot *change the lifecycle* — see §6.1.

### 2.7 Delivery — own fleet

Order-first or bill-first; adds a post-close fulfilment leg (dispatch → out for delivery →
delivered) that the current `OrderStatus` has no room for and that our KDS lifecycle stops short of.
`OrderType.DELIVERY` exists on the backend enum but is **deliberately not exposed** in the terminal
(`frontend/components/pos/order-type-toggle.tsx:12-19` — "DELIVERY exists on the backend enum for
other callers but is deliberately not exposed here").

### 2.8 Aggregator / channel-injected

| Question | Answer |
|---|---|
| Order created when | Pushed in by an integration service over `/internal/**` (guarded by `PosInternalServiceFilter`'s constant-time `X-Internal-Service` check) — **not** by a user |
| Fires to KDS when | On **accept**. Auto-accept is the norm; manual accept is a configurable window |
| Payment required | Never, by us. The platform already collected it. Settlement is a receivable, reconciled by payout, not a drawer event |
| Till required | **None**, and must never be |
| Receipt flow | KOT + a packing label. The customer's receipt is the platform's |
| Blocker | No `PENDING_ACCEPT` status; and `DRAFT` cannot be reused because `OrderServiceImpl.listOrderSummaries:602-611` deliberately **excludes DRAFT** from the default list ("a client-only cart never persists a DB order, so DRAFT rows are stale abandoned carts"). An unaccepted Foodpanda order that nobody can see is a lost order |

There is no aggregator integration in this repo — confirmed by the parallel ERP-gap research
(`.planning/research/erp-completion/erp-gap-modules.md:265`, row 52: `ABSENT`, grep → 0 hits) and by
my own grep for `aggregator|foodpanda|deliveroo|ubereats`, which returns only documentation hits.

### 2.9 QUICK-BILL — retail-style scan-and-go

Bottled water, cigarettes, a bag of coffee beans. No kitchen at all.

| Question | Answer |
|---|---|
| Order created when | On the first scan/tap (or on Pay, for a truly client-only cart) |
| Fires to KDS when | **Never** (`fire_trigger = NEVER`) |
| Payment required | Immediately; that *is* the transaction |
| Till required | For CASH |
| Receipt flow | One receipt at payment. No KOT, no token |
| Blocker | An order that never fires has all lines `PENDING`, so `OrderStatusDerivationService.derive` returns `DRAFT` (`OrderStatusDerivationService:38-41`), so `maybeCloseOrder`'s `derivedStatus == SERVED` test can never pass. **A retail sale can be paid in full and never close.** See §3.2 |

---

## 3. What the code actually does today (verified)

### 3.1 The as-built lifecycle

```
client-only cart  ──(Send to Kitchen | Save as Draft | Charge Now)──▶  POST /orders   → DRAFT
                                                                       (till bound opportunistically)
DRAFT ──addItem (first)──▶ OPEN   [orderNo assigned, ORDER_CREATED published, table → OCCUPIED]
OPEN  ──sendToKds────────▶ SENT_TO_KDS   [PENDING lines → SENT, revisionNo++, ORDER_SENT_TO_KDS]
      ◀── kitchen events: ACCEPTED / PREPARING / READY on individual lines
      ── markItemServed (per line, manual) ──▶ line SERVED
                                    derivedStatus = derive(lines)
recordPayment ──▶ OrderPayment row; PaymentStatus derived from sum vs total
maybeCloseOrder ──▶ CLOSED  IFF  paymentStatus == PAID  AND  derivedStatus == SERVED
```

Sources: `OrderServiceImpl.createOrder:136-205`, `addItem:279-311`, `sendToKds:405-537`,
`markItemServed:787-823`, `maybeCloseOrder:697-722`, `performClose:731-784`;
`PaymentServiceImpl.recordPayment:53-168`; `OrderStateMachine:21-49`.

`OrderStateMachine` is a `@Component` holding a **`static final` `EnumMap`** initialised in a static
block (`OrderStateMachine:19-49`). It has no tenant parameter and cannot acquire one without a
signature change.

### 3.2 Two confirmed dead ends for non-table-service models

**(a) Paid-but-never-closed.** `maybeCloseOrder:709-713` requires
`paymentStatus == PAID && derivedStatus == DerivedOrderStatus.SERVED`. `derivedStatus` only reaches
`SERVED` when *every* non-cancelled line is `OrderItemStatus.SERVED`
(`OrderStatusDerivationService:43-45`). The kitchen can never produce that: `KitchenItemStatusConsumer`'s
`STATUS_MAP` (lines 51-56) tops out at `READY`, and `applyItemStatus:128-131` explicitly refuses to
touch a line that is already `SERVED`. The **only** writer of `SERVED` is
`OrderServiceImpl.markItemServed`, reachable from exactly one UI control — the "Mark Served" button
inside `frontend/components/pos/order-table-detail-drawer.tsx:282-291`, one tap per line.

Consequence chain, all in shipped code:
1. QSR / kiosk / retail order is fully paid → `maybeCloseOrder` returns unchanged.
2. Order stays `SENT_TO_KDS` (or `OPEN` for quick-bill) — non-terminal.
3. `performClose` never runs → **`ORDER_CLOSED` is never published** → finance never posts the
   revenue journal entry (`performClose:762-781` is the sole publisher in this class).
4. `TillServiceImpl.closeTill:103-108` computes `hasOpenOrders` over
   `orderRepository.findByTillSessionId(tillId)` and throws `TillHasOpenOrdersException` for any
   non-terminal order → **the cashier cannot close their drawer at end of shift.**

This is not a hypothetical: it is the guaranteed outcome of running today's code in bill-first mode,
which today's frontend already offers via the "Charge Now" button.

**(b) Pay-before-fire lives in the browser.** The entire bill-first guarantee is
`frontend/components/pos/charge-summary.tsx:162-176`:

```ts
const willBeFullyPaid = totalPaisa > 0 && amountPaidPaisa + submittedTotal >= totalPaisa;
const pendingUnfired = order?.items.filter((i) => i.itemStatus === "PENDING") ?? [];
if (willBeFullyPaid && order && order.sentToKdsAt === null && pendingUnfired.length > 0) {
  try { await sendToKds.mutateAsync(); toast.success("Sent to kitchen"); }
  catch { toast.error("Paid, but sending to kitchen failed — retry from Order Management."); }
}
```

Two independent failures follow. First, **the customer pays and the kitchen never hears** if the tab
closes, the device sleeps, or the network drops between the two calls — the toast is an apology, not
a mechanism. Second, `OrderServiceImpl.sendToKds:405-537` contains **no payment check whatsoever**;
any holder of `pos.order.send_to_kds` (which includes every WAITER —
`services/auth-service/src/main/resources/db/changelog/v1.0.0/055-waiter-role-and-tenant-admin-authority.xml`)
can fire an unpaid order in a pay-first venue by calling the endpoint directly.

### 3.3 What 13-16 established, and why it is the right base

`.planning/phases/13-platform-tenant-access-repair/13-16-SUMMARY.md` moved the till requirement off
order creation and onto CASH settlement (decision D-30). The two halves are now:

- `OrderServiceImpl.createOrder:190-201` — binds the creator's OPEN till **if they have one**, else
  `tillSessionId` stays null.
- `PaymentServiceImpl.recordPayment:92-104` — `if (method == PaymentMethod.CASH)` requires an OPEN
  till for the paying user, else `NoOpenTillException` → 409 `NO_OPEN_TILL`. Non-cash keeps a
  best-effort backfill (lines 105-114).

That is exactly the right shape to generalise: the rule is stated at the point where the constraint
is physically real, and it already varies by **tender**. Making it vary by **service model** as well
is a widening of an existing axis, not a new concept. `PosExceptions.NoOpenTillException`'s javadoc
already records the reasoning.

### 3.4 What tenant configurability exists today

None that is relevant. Per the parallel research
(`.planning/research/erp-completion/tenant-configurability.md`), the entire tenant control plane is
20 boolean feature flags in `TierFeatureDefaults`, settable via
`PATCH /api/v1/platform/tenants/{id}/features/{code}` with `is_override=true`. My own greps confirm:

- No `settings` / `config` / `policy` / `preference` table exists in any Flyway migration across
  `services/*/src/main/resources/db/migration/`.
- Across all Liquibase changelogs, the only config-shaped table in the system is
  `loyalty_tier_config` (`services/crm-service/.../010-create-crm-tables.xml`).
- The tenant frontend has one settings route in total:
  `frontend/app/(tenant)/settings/appearance/page.tsx`.
- `FEATURE_POS` is in the tier matrix but has **no `RouteFeatureMap` entry**
  (`gateway/src/main/java/io/restaurantos/gateway/support/RouteFeatureMap.java:32-51`), so
  `/api/v1/pos/` is ungated at the edge. `@RequiresFeature("FEATURE_POS")` on `OrderController:22`
  is enforced in-service by `shared-lib`'s `FeatureFlagAspect`, not at the gateway.

There is therefore nothing to extend. This design creates the first real tenant configuration
surface in the product, and it should be built as a pattern others reuse.

### 3.5 Incidental finding: `serviceChargePaisa` is a dead column

`Order.serviceChargePaisa` (`domain/model/Order.java:69`, `@Getter @Setter`) is read by
`recomputeOrderTotals:1013` and shipped in the `ORDER_CLOSED` payload
(`performClose:769`), but `setServiceChargePaisa` is **never called anywhere under `services/`**
(grep, excluding `target/`). It is always 0. A 10% service charge is standard for Pakistani table
service and is a headline table-service setting in every product in §1 — it belongs in the service
profile (§4.3) and its absence should be recorded as a real gap, not inherited silently.

---

## 4. The design: a tenant-owned Service Profile

### 4.1 Ownership — pos-service, not platform-admin-service

**Decision: `service_profiles` lives in `pos_db`, owned by pos-service.**

Reasons, each grounded:

1. **Shape.** `TenantFeatureEntity` stores `is_enabled BOOLEAN` + `is_override BOOLEAN`. A service
   model is an enum plus ~12 typed knobs plus money. Encoding that as booleans would need ~30 flags
   and would still not express `service_charge_pct`.
2. **Hot path.** The profile is read on *every* `createOrder`, `sendToKds`, `recordPayment`. A Feign
   hop to platform-admin on order creation is a new outage mode on the most latency-sensitive path
   in the product. pos-service already resolves branch scope locally.
3. **Semantics.** Feature flags answer "what did this tenant buy" (platform's business).
   Service model answers "how does this restaurant work" (the tenant's business). Different owner,
   different change cadence, different audit trail. `FeatureFlagAdminService` is `SUPER_ADMIN`-only;
   a restaurant owner must be able to change their own service model.

**But the two must interlock.** The *availability* of the premium models stays a platform decision:

| Model | Gating feature code |
|---|---|
| `ORDER_FIRST`, `BILL_FIRST`, `QUICK_BILL` | `FEATURE_POS` (all tiers) |
| `SELF_SERVICE` (kiosk / QR) | new `FEATURE_SELF_SERVICE` — GROWTH+ |
| `CHANNEL_INJECTED` (aggregator) | new `FEATURE_CHANNEL_ORDERS` — GROWTH+ |

Adding those two codes to `TierFeatureDefaults` is mandatory, not optional:
`FeatureCodeClosureTest` fails the build on a code that a route gates but no tier grants — the
"phantom flag" bug documented at length in `TierFeatureDefaults`'s class javadoc, which has shipped
twice. Write them in that file **in split form** (`"FEATURE_" + "X"`) inside comments, per the same
javadoc, or `frontend/__tests__/lib/nav-feature-flags.test.ts`'s regex scrape silently admits them.

### 4.2 Resolution order

Most specific wins; the chain **must** terminate at a value that equals today's behaviour.

```
1. order-type rule      service_profile_rules  (profile_id, order_type, channel) → overrides
2. POS profile / terminal   service_profiles.code = <terminal's assigned profile>
3. branch                   service_profiles WHERE branch_id = :branchId AND code = 'DEFAULT'
4. tenant                   service_profiles WHERE branch_id IS NULL  AND code = 'DEFAULT'
5. hardcoded fallback       ORDER_FIRST preset  (== the behaviour shipped today)
```

Layer 1 is the one that makes this design actually usable: the overwhelmingly common Pakistani
café/restaurant runs **dine-in order-first and takeaway bill-first on the same terminal**. Without a
per-order-type rule, that venue has to pick one and suffer. Odoo solves it with separate POS configs
(§1.3); we can do better because our order type is already on the order.

The fallback at layer 5 is a hard requirement, not a nicety: this project has shipped features that
were structurally present and dead. A profile lookup that returns `Optional.empty()` and is handled
by throwing would take down every restaurant on deploy day.

### 4.3 Schema

`services/pos-service/src/main/resources/db/migration/V11__service_profiles.sql`

```sql
CREATE TABLE service_profiles (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                UUID         NOT NULL,
    branch_id                UUID,                          -- NULL = tenant-wide default
    code                     VARCHAR(40)  NOT NULL,         -- 'DEFAULT','COUNTER','BAR','DRIVE_THRU','KIOSK'
    name                     VARCHAR(80)  NOT NULL,
    preset                   VARCHAR(24)  NOT NULL          -- provenance only; NEVER re-read at runtime
        CHECK (preset IN ('ORDER_FIRST','BILL_FIRST','SELF_SERVICE','CHANNEL_INJECTED','QUICK_BILL','CUSTOM')),

    -- ── lifecycle knobs (the resolved, authoritative values) ────────────────
    fire_trigger             VARCHAR(24)  NOT NULL DEFAULT 'MANUAL'
        CHECK (fire_trigger IN ('MANUAL','ON_ITEM_ADD','ON_FULL_PAYMENT','ON_ACCEPT','NEVER')),
    payment_timing           VARCHAR(24)  NOT NULL DEFAULT 'AFTER_SERVICE'
        CHECK (payment_timing IN ('BEFORE_FIRE','AFTER_SERVICE','EXTERNAL')),
    till_requirement         VARCHAR(24)  NOT NULL DEFAULT 'CASH_ONLY'
        CHECK (till_requirement IN ('NONE','CASH_ONLY','ANY_TENDER')),
    close_condition          VARCHAR(24)  NOT NULL DEFAULT 'PAID_AND_SERVED'
        CHECK (close_condition IN ('PAID_AND_SERVED','PAID_AND_KDS_READY','PAID_ONLY','FULFILLED_ONLY')),
    allows_open_tab          BOOLEAN      NOT NULL DEFAULT TRUE,
    requires_table           BOOLEAN      NOT NULL DEFAULT FALSE,
    default_order_type       VARCHAR(20)  NOT NULL DEFAULT 'DINE_IN',
    allowed_order_types      TEXT[]       NOT NULL DEFAULT ARRAY['DINE_IN','TAKEAWAY','PICKUP'],
    allowed_tenders          TEXT[]       NOT NULL DEFAULT
                             ARRAY['CASH','CARD','LOYALTY_POINTS','BANK_TRANSFER','VOUCHER'],
    receipt_trigger          VARCHAR(24)  NOT NULL DEFAULT 'ON_CLOSE'
        CHECK (receipt_trigger IN ('ON_CLOSE','ON_PAYMENT','ON_FIRE','NONE')),
    prints_kot               BOOLEAN      NOT NULL DEFAULT TRUE,
    prints_queue_token       BOOLEAN      NOT NULL DEFAULT FALSE,
    close_till_blocks_on     VARCHAR(24)  NOT NULL DEFAULT 'ANY_NON_TERMINAL'
        CHECK (close_till_blocks_on IN ('ANY_NON_TERMINAL','UNSETTLED_ONLY')),

    -- ── money: BIGINT paisa only, never a decimal ──────────────────────────
    service_charge_bps       INT          NOT NULL DEFAULT 0
        CHECK (service_charge_bps BETWEEN 0 AND 10000),     -- basis points; 1000 = 10%
    auto_gratuity_paisa      BIGINT       NOT NULL DEFAULT 0
        CHECK (auto_gratuity_paisa >= 0),

    active                   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID, updated_by UUID, deleted_at TIMESTAMPTZ,

    CONSTRAINT uq_service_profile UNIQUE (tenant_id, branch_id, code),
    -- D-30 must not be reopenable by configuration: no drawer ⇒ no cash.
    CONSTRAINT ck_no_till_no_cash CHECK (
        till_requirement <> 'NONE' OR NOT ('CASH' = ANY(allowed_tenders))
    )
);

ALTER TABLE service_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON service_profiles
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

CREATE TABLE service_profile_rules (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    profile_id   UUID NOT NULL REFERENCES service_profiles(id) ON DELETE CASCADE,
    order_type   VARCHAR(20),   -- NULL = any
    channel      VARCHAR(24),   -- NULL = any
    override_profile_id UUID NOT NULL REFERENCES service_profiles(id),
    priority     INT NOT NULL DEFAULT 0,
    CONSTRAINT uq_service_profile_rule UNIQUE (tenant_id, profile_id, order_type, channel)
);
ALTER TABLE service_profile_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON service_profile_rules
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
```

Three schema decisions worth defending:

- **`preset` is provenance, not behaviour.** The resolved knobs are stored on the row. If a future
  release changes what `BILL_FIRST` means, no live restaurant's behaviour changes. Re-reading a
  preset at runtime is how a "harmless" default change silently re-configures 200 venues at 7pm.
- **`service_charge_bps`, not a percentage decimal.** Basis points are an integer; the money rule
  ("BIGINT paisa, never a float, never a decimal in an event payload") extends naturally to rates.
  `serviceChargePaisa = subtotal * bps / 10000` with `Math.floorDiv`, computed inside
  `OrderPricingCalculator` where the rest of the rounding discipline lives.
- **RLS is `ENABLE`, matching every other pos table.** Note honestly: `pos_db` RLS is **inert** for
  the application connection — the application owns these tables and no `FORCE ROW LEVEL SECURITY`
  exists in any pos migration (only `V7__stations.sql:18` mentions it, to say it was deferred).
  `OrderRepository`'s javadoc says so explicitly: *"pos_db's tables are ENABLE (not FORCE) ROW LEVEL
  SECURITY and the application owns them, so RLS is inert on this connection."* Therefore
  **tenant scoping for `service_profiles` must be in the query predicate**, exactly as
  `findByTenantIdAndBranchIdAndStatusIn` does — the RLS policy is defence in depth for a future
  non-owner role, not the mechanism. Any resolver that relies on RLS alone will leak across tenants.

### 4.4 The five presets

| Knob | ORDER_FIRST | BILL_FIRST | SELF_SERVICE | CHANNEL_INJECTED | QUICK_BILL |
|---|---|---|---|---|---|
| `fire_trigger` | `MANUAL` | `ON_FULL_PAYMENT` | `ON_FULL_PAYMENT` | `ON_ACCEPT` | `NEVER` |
| `payment_timing` | `AFTER_SERVICE` | `BEFORE_FIRE` | `BEFORE_FIRE` | `EXTERNAL` | `BEFORE_FIRE` |
| `till_requirement` | `CASH_ONLY` | `CASH_ONLY` | `NONE` | `NONE` | `CASH_ONLY` |
| `close_condition` | `PAID_AND_SERVED` | `PAID_AND_KDS_READY` | `PAID_AND_KDS_READY` | `FULFILLED_ONLY` | `PAID_ONLY` |
| `allows_open_tab` | true | false | false | false | false |
| `requires_table` | false¹ | false | false² | false | false |
| `default_order_type` | `DINE_IN` | `TAKEAWAY` | `TAKEAWAY` | `DELIVERY` | `TAKEAWAY` |
| `allowed_tenders` | all | all | non-cash only³ | `[]`⁴ | all |
| `receipt_trigger` | `ON_CLOSE` | `ON_PAYMENT` | `ON_PAYMENT` | `NONE` | `ON_PAYMENT` |
| `prints_kot` | true | true | true | true | **false** |
| `prints_queue_token` | false | true | true | false | false |
| `close_till_blocks_on` | `ANY_NON_TERMINAL` | `UNSETTLED_ONLY` | n/a | n/a | `UNSETTLED_ONLY` |

¹ true for a strict fine-dining tenant; the knob exists so they can set it.
² true for the QR-at-table variant, which is `SELF_SERVICE` + `requires_table` + `allows_open_tab`.
³ forced by the `ck_no_till_no_cash` constraint.
⁴ channel orders record no tender with us at all; settlement is a receivable (see §7.4).

### 4.5 API surface

`services/pos-service/.../web/ServiceProfileController.java`, `@RequiresFeature("FEATURE_POS")`:

| Method + path | Permission | Purpose |
|---|---|---|
| `GET /api/v1/pos/service-profiles?branchId=` | `pos.settings.view` | list profiles for a branch |
| `GET /api/v1/pos/service-profiles/effective?branchId=&profileCode=&orderType=&channel=` | `pos.menu.view` | **the terminal's read** — the fully resolved knob-set for one context |
| `POST /api/v1/pos/service-profiles` | `pos.settings.manage` | create from a preset |
| `PATCH /api/v1/pos/service-profiles/{id}` | `pos.settings.manage` | override individual knobs (`preset` → `CUSTOM`) |
| `PUT /api/v1/pos/service-profiles/{id}/rules` | `pos.settings.manage` | replace the order-type/channel rule set |
| `DELETE /api/v1/pos/service-profiles/{id}` | `pos.settings.manage` | soft-delete; `DEFAULT` refuses |

Two new permissions (`pos.settings.view`, `pos.settings.manage`) must be added to the catalog in
`services/auth-service/src/main/resources/db/changelog/v1.0.0/` and granted to
`TENANT_ADMIN`/`OWNER`/`MANAGER`. **This is the exact class of bug that has bitten this project
repeatedly** — `PermissionCatalogClosureTest`'s javadoc lists `pos.order.view.all`,
`pos.order.void.any` and `pos.order.void.own` as permissions that were granted or checked but never
inserted, each producing a silently-unreachable feature. A `@PreAuthorize` naming a permission that
no role holds is an API that exists and does nothing.

`GET /effective` must be **cheap and cached** (it is on the terminal boot path and re-read on order
type change). Redis, keyed `pos:service_profile:{tenantId}:{branchId}:{code}:{orderType}:{channel}`,
5-minute TTL, invalidated on write — the same shape `FeatureFlagAdminService` already uses for
`tenant_features:{tenantId}:{featureCode}`. **Fail-closed differs here**: a feature flag that cannot
be resolved must 503; a service profile that cannot be resolved must fall back to `ORDER_FIRST`,
because refusing to sell food is worse than selling it the old way.

### 4.6 Frontend, within the 4-layer rule

The ESLint `no-restricted-imports` boundary (api-client → repositories → adapters/schemas → hooks)
is satisfied by adding one file per layer, mirroring what already exists for orders:

| Layer | File | Content |
|---|---|---|
| schema | `frontend/lib/api-client/schemas/pos.schema.ts` | `serviceProfileSchema` (zod), alongside the existing `sentToKdsAt` order schema at line 147 |
| model | `frontend/lib/models/pos.model.ts` | `ServiceProfile`, `ServiceModel`, `FireTrigger` types |
| adapter | `frontend/lib/adapters/pos.adapter.ts` | `toServiceProfile(raw)` |
| repository | `frontend/lib/repositories/pos.repository.ts` | `getEffectiveServiceProfile({branchId, profileCode, orderType})` |
| hook | `frontend/lib/hooks/pos/use-service-profile.ts` | `useServiceProfile()` — TanStack Query, `staleTime` long |
| component | `pos-terminal.tsx`, `order-panel.tsx`, `order-type-toggle.tsx`, `charge-summary.tsx` | read the hook; render actions from it |

A settings surface goes at `frontend/app/(tenant)/settings/service-model/page.tsx` — the
`(tenant)/settings` segment already exists with exactly one child (`appearance`), so this is the
second tenant setting in the product and should establish the pattern (a preset picker with a plain
one-line description of each, then an "Advanced" disclosure over the individual knobs — Toast's
information architecture, and the only one non-technical owners cope with). Visual direction is the
UI/UX research stream's call, not this document's.

---

## 5. State-machine differences per model

### 5.1 The seam

`OrderStateMachine` should keep doing exactly what it does — **structural** legality (you cannot go
`CLOSED → OPEN`; `VOIDED` is terminal). That genuinely does not vary by venue. What varies are the
**business preconditions and the automatic next steps**, and those belong in a new component:

```java
// services/pos-service/src/main/java/io/restaurantos/pos/service/ServiceModelPolicy.java
public interface ServiceModelPolicy {
    ServiceProfile resolve(UUID branchId, String profileCode, OrderType type, OrderChannel channel);

    void assertCanFire(Order order, long paidPaisa, ServiceProfile p);   // BEFORE_FIRE ⇒ must be PAID
    void assertCanTakePayment(Order order, PaymentMethod m, ServiceProfile p); // tender allow-list
    TillRequirement tillRequirementFor(PaymentMethod m, ServiceProfile p);
    boolean isSettlementComplete(Order order, PaymentStatus ps, ServiceProfile p); // close_condition
    boolean shouldAutoFireAfterPayment(Order order, ServiceProfile p);
    boolean shouldAutoFireOnItemAdd(Order order, ServiceProfile p);
}
```

`OrderStateMachine` stays a pure function; `ServiceModelPolicy` is the only place that reads a
profile. This keeps the existing single-seam discipline the codebase already enforces for
`OrderStatusDerivationService` ("computed, never hand-set", POS-11) and
`TableService.syncStatusForOrder` ("single derivation seam, Pitfall 5").

**`OrderStatusDerivationService.derive` must not be made configurable.** It answers "how far has the
kitchen got", which is a fact about the kitchen, not about the venue. `close_condition` is the
configurable question ("is this order finished enough to close"), and it belongs to
`ServiceModelPolicy.isSettlementComplete`, consulted by `maybeCloseOrder`. Making `derive` take a
profile would put venue policy inside the one function three consumers rely on being pure.

### 5.2 Per-model transition tables

**ORDER_FIRST** — unchanged from today.

```
DRAFT → OPEN → SENT_TO_KDS ⟲ → (PARTIAL_READY | READY) → SERVED → CLOSED
                                                       ↘ CLOSED  (paid+served, via maybeCloseOrder)
any non-terminal → VOIDED;  CLOSED → REFUNDED
```

**BILL_FIRST** — the fire edge acquires a payment guard, and close no longer waits for a human.

```
DRAFT → OPEN ──[payment recorded, balance = 0]──▶ SENT_TO_KDS      ← auto-fired server-side
                     ▲ assertCanFire refuses OPEN→SENT_TO_KDS while balance > 0
SENT_TO_KDS → READY ──[close_condition = PAID_AND_KDS_READY]──▶ CLOSED
```

New/changed edges: `OPEN → SENT_TO_KDS` gains a guard; `READY → CLOSED` becomes reachable without
passing through `SERVED` (the edge already exists — `OrderStateMachine:38-42` — it is
`maybeCloseOrder` that blocks it).

**SELF_SERVICE** — as BILL_FIRST, plus the order is created by a device principal and `cashierId`
is null throughout. `assertCanTakePayment` refuses CASH by tender allow-list, so
`tillRequirement = NONE` is safe.

**CHANNEL_INJECTED** — needs one new status.

```
PENDING_ACCEPT ──accept──▶ OPEN → SENT_TO_KDS ⟲ → READY → CLOSED   (close_condition = FULFILLED_ONLY)
PENDING_ACCEPT ──reject──▶ VOIDED   (voidReason = channel rejection code)
```

`PENDING_ACCEPT` is a genuinely new `OrderStatus` value. `DRAFT` cannot be reused:
`listOrderSummaries:602-611` deliberately excludes `DRAFT` from the default filter because DRAFT
rows are abandoned client carts. An unaccepted aggregator order must be the *most* visible thing on
the screen. Adding it costs: the `orders_status_check` CHECK constraint (widen with the drop+re-add
pattern `V5__widen_status_check_constraints.sql` and `V6` already establish), the enum, the state
machine map, `isTerminal`, and the frontend `getOrderDisplayStatus`. Reject maps to `VOIDED` — a
second terminal state buys nothing.

**QUICK_BILL** — no kitchen at all.

```
DRAFT → OPEN ──[payment recorded, balance = 0, close_condition = PAID_ONLY]──▶ CLOSED
```

`OPEN → CLOSED` already exists in the transition map (`OrderStateMachine:23-26`). The blocker is
purely `maybeCloseOrder`'s `derivedStatus == SERVED` test.

### 5.3 Summary of state-machine deltas

| Change | Why |
|---|---|
| Add `OrderStatus.PENDING_ACCEPT` | channel orders need a visible pre-accept state that `DRAFT` cannot provide |
| Add transitions `PENDING_ACCEPT → {OPEN, VOIDED}` | accept / reject |
| Guard `* → SENT_TO_KDS` on `payment_timing = BEFORE_FIRE` | make pay-before-fire a server invariant |
| Replace `maybeCloseOrder`'s fixed `PAID && SERVED` with `close_condition` | unblock every non-table-service model |
| Leave the structural map otherwise untouched | the edges are already right; only the guards were missing |

---

## 6. Exactly which existing code must become configurable

Ordered by blast radius. File paths absolute from the repo root.

### 6.1 `OrderServiceImpl.createOrder:156` — hardcoded `DINE_IN` default

```java
order.setType(request.type() != null ? request.type() : OrderType.DINE_IN);
```
A QSR counter's default is `TAKEAWAY`; a drive-thru lane's is `DRIVE_THRU`. → `profile.defaultOrderType()`.
Also validate `request.type()` against `profile.allowedOrderTypes()` — a kiosk must not be able to
create a `DINE_IN` order that occupies a table nobody assigned.

### 6.2 `OrderServiceImpl.createOrder:190-201` — opportunistic till binding

The 13-16 behaviour becomes **one** of three options, selected by `till_requirement`:

| Value | createOrder behaviour |
|---|---|
| `NONE` | never look for a till (skip the lookup entirely — kiosk/channel) |
| `CASH_ONLY` | **today's exact code**: bind if the creator has one, else null |
| `ANY_TENDER` | hard-require the creator's OPEN till, throwing `NoOpenTillException` — the pre-13-16 behaviour, restored as a *choice* for cash-cage operations |

Note the pleasing symmetry: 13-16 did not delete a rule, it discovered the rule was
model-dependent. `NoOpenTillException`'s javadoc should record that.

### 6.3 `OrderServiceImpl.addItem:279-311` — first-item transition and the fire point

`DRAFT → OPEN`, `orderNo` assignment and the `ORDER_CREATED` publish all hang off `firstItem`. For
`fire_trigger = ON_ITEM_ADD` (bar service; Odoo's per-line send) this is also where the KDS fire
happens. The fire must be invoked through the existing `sendToKds` seam, not inlined — that method
owns the fire-only-unfired-items rule (`sendToKds:436-438`, "the ONLY seam that builds the KDS
payload item list — never `order.getItems()` wholesale (Pitfall 1)"), and duplicating it is exactly
the Pitfall-1 bug.

### 6.4 `OrderServiceImpl.sendToKds:432` — **the highest-value change in this document**

```java
stateMachine.assertTransition(order.getStatus(), OrderStatus.SENT_TO_KDS);
```
There is no payment precondition. Insert, immediately above:

```java
long paidPaisa = orderPaymentRepository.sumAmountByOrderId(orderId);
serviceModelPolicy.assertCanFire(order, paidPaisa, profile);   // throws 409 PAYMENT_REQUIRED_BEFORE_FIRE
```
`orderPaymentRepository` is already injected into `OrderServiceImpl` (constructor line 93) and
already used for exactly this sum in `maybeCloseOrder:705`. No new dependency.

New exception: `PosExceptions.PaymentRequiredBeforeFireException` → 409 `PAYMENT_REQUIRED_BEFORE_FIRE`
in `PosGlobalExceptionHandler`. (13-16 recorded that `NoOpenTillException` already had a correct
mapping at `PosGlobalExceptionHandler.java:83-89` — verify, don't assume, that a new one is added.)

### 6.5 `PaymentServiceImpl.recordPayment` — auto-fire after full payment

The pay-then-fire orchestration currently in `charge-summary.tsx:162-176` moves here, right after
`orderService.maybeCloseOrder(orderId)` (line 165), inside the same `@Transactional` boundary:

```java
if (serviceModelPolicy.shouldAutoFireAfterPayment(order, profile)) {
    orderService.sendToKds(orderId, "autofire:" + orderId + ":" + payment.getId());
}
```
The synthetic `clientFireId` reuses `sendToKds`'s existing per-fire idempotency namespace
(`sendToKds:411-425`), so a retried payment cannot double-fire. The frontend block is then deleted,
not left as a belt-and-braces duplicate — two independent fire triggers is how a kitchen gets two
tickets.

Ordering caveat worth stating: `maybeCloseOrder` runs before the fire today. Under
`close_condition = PAID_AND_KDS_READY` it will no-op (nothing is READY yet), and the order closes
later off the kitchen's READY event. That requires `maybeCloseOrder` to also be called from
`OrderReadyConsumer` — it is **not** today (`OrderReadyConsumer` updates item status and derived
status, and pushes over WebSocket, but never calls `maybeCloseOrder`). **This is a required
addition, and it is easy to miss.**

### 6.6 `OrderServiceImpl.maybeCloseOrder:709-713` — the close condition

```java
boolean fullyPaidAndServed = paymentStatus == PaymentStatus.PAID
        && order.getDerivedStatus() == DerivedOrderStatus.SERVED;
```
→ `serviceModelPolicy.isSettlementComplete(order, paymentStatus, profile)`:

| `close_condition` | Test |
|---|---|
| `PAID_AND_SERVED` | today's expression, unchanged |
| `PAID_AND_KDS_READY` | `PAID && derivedStatus ∈ {IN_PROGRESS with all lines READY, SERVED}` — needs a `allLinesAtLeastReady` helper, or a new `DerivedOrderStatus.READY` value |
| `PAID_ONLY` | `paymentStatus == PAID` |
| `FULFILLED_ONLY` | channel order marked fulfilled by the integration callback |

`DerivedOrderStatus` currently has no `READY` value (`DRAFT, IN_PROGRESS, PARTIALLY_SERVED, SERVED`)
— `derive` collapses every fired-but-unserved state into `IN_PROGRESS` (`OrderStatusDerivationService:47-48`).
Adding `READY` to that enum is the cleanest route and is additive for the frontend.

### 6.7 `PaymentServiceImpl.recordPayment:92-114` — the till requirement

```java
if (method == PaymentMethod.CASH) { ...require OPEN till... } else { ...best-effort backfill... }
```
→ driven by `profile.tillRequirement()`. **The `NONE` case is where this design can go badly wrong.**
`NONE` must never be reachable for a CASH tender, or D-30's "charged but the drawer shows 0" gap
reopens under a new name. Three independent guards:

1. The DB `CHECK ck_no_till_no_cash` (§4.3) — a profile with `till_requirement = NONE` cannot list
   `CASH` in `allowed_tenders`.
2. `assertCanTakePayment` rejects a tender outside the allow-list before any amount is applied.
3. A defensive belt in `recordPayment`: `if (method == CASH && requirement == NONE) throw` —
   because a config table is data and data can be wrong.

Pin all three with tests named after the failure, in the style 13-16 established
(`cashPayment_withNoTillAtAll_isRefused_andNothingIsApplied`).

### 6.8 `PaymentServiceImpl.recordPayment:93` — the unauthenticated payer

```java
UUID payingUserId = tenantContext.getUserId()
        .orElseThrow(() -> new PosExceptions.NoOpenTillException("<unauthenticated>"));
```
A kiosk or QR customer has no user id. Under `till_requirement = NONE` this lookup must not happen
at all. Beyond that, self-service needs a **device principal**: `TenantContext` carries only
`(tenantId, branchId, userId, impersonatedBy)`
(`shared-lib/src/main/java/io/restaurantos/shared/tenant/TenantContext.java:20`). Precedent exists —
the gateway already routes a device-authenticated, user-JWT-less attendance ingest and gates it on a
feature flag (`RouteFeatureMap:39-41`, `/iclock/` → `FEATURE_HR`).

**UNVERIFIED:** I did not read auth-service's token minting path, so I cannot say what shape a
device/kiosk token would take or whether `JwtAuthenticationFilter` tolerates a missing `sub`.
Treat "can auth-service mint a non-human, branch-scoped, device-bound token" as an open question,
not a solved one.

### 6.9 `TillServiceImpl.closeTill:103-108` — what blocks a drawer close

```java
boolean hasOpenOrders = orderRepository.findByTillSessionId(tillId).stream()
        .anyMatch(order -> !TERMINAL_STATUSES.contains(order.getStatus()));
```
Under `close_till_blocks_on = UNSETTLED_ONLY`, block only on orders with an outstanding balance. A
bill-first order that is paid in full but whose last line has not been marked served is not a
financial risk to the drawer — the cash is counted, the food is a kitchen problem. Under
`ANY_NON_TERMINAL` (table service) keep today's behaviour: an open tab genuinely is money at risk.

The cash sum itself (`closeTill:110-116`) stays exactly as it is. Summing `PaymentMethod.CASH` over
orders bound to the till is the correct definition of expected closing and must not become
configurable.

### 6.10 `TillSession` is keyed on `cashierId` only — drive-thru and shared drawers

`TillServiceImpl.openTill:69-75` derives the cashier from `tenantContext.getUserId()` and refuses a
second OPEN session for that user. There is no terminal/station binding. A drive-thru pay window
staffed by two people across a shift break, or a bar with one drawer and three bartenders, cannot be
modelled. `Station` already exists as an entity (`domain/model/Station.java`, `V7__stations.sql`) and
`OrderItem` snapshots `stationId` — extending `TillSession` with a nullable `station_id` and letting
`recordPayment` resolve "the till for my station" instead of "my till" is the natural next step.
**Out of scope for the first cut**, but it is the reason drive-thru cannot be fully delivered by the
service-profile work alone. Flagged as a dependency, not hand-waved.

### 6.11 `OrderType` conflates fulfilment with origin — add `OrderChannel`

`OrderType` is `{DINE_IN, TAKEAWAY, DELIVERY, PICKUP}`. Drive-thru is a fulfilment mode (order at a
lane, collect at a window) and belongs there. Kiosk, QR, aggregator and online are **origins** and do
not: a kiosk order can be takeaway *or* dine-in.

```java
public enum OrderType    { DINE_IN, TAKEAWAY, DELIVERY, PICKUP, DRIVE_THRU }
public enum OrderChannel { POS_TERMINAL, KIOSK, QR_TABLE, DRIVE_THRU_LANE, ONLINE, AGGREGATOR }
```
`orders.type` CHECK widens by the established drop+re-add pattern
(`V6__order_type_pickup.sql:12-14`); `orders.channel` is a new NOT NULL column defaulting to
`POS_TERMINAL` so every existing row is correct without a backfill. `channel` joins
`ServiceModelPolicy.resolve`'s key and must be added to `OrderSentToKdsPayload` (which already
carries `order.getType().name()`, `OrderServiceImpl:527`) so the KDS can badge an aggregator ticket
differently. That is an **additive** event-contract change — coordinate with kitchen-service's
consumer, since a field-name mismatch there is a documented past failure
(`sendToKds:509-511`: *"Field NAME must match the kitchen-service consumer's matching field exactly"*).

### 6.12 `OrderStateMachine:19-49` — `static final` transitions

The map is a static initialiser inside a `@Component`. Adding `PENDING_ACCEPT` is a static edit; the
structural map genuinely need not vary per tenant, so this file should **stay static**. Resist the
temptation to make it profile-driven — a per-tenant transition graph is a configuration surface with
no legitimate use case and an unbounded test matrix.

### 6.13 Frontend hardcodes

| File:line | Hardcode | Becomes |
|---|---|---|
| `frontend/components/pos/charge-summary.tsx:162-176` | client-orchestrated pay-then-fire | **deleted**; server-side (§6.5) |
| `frontend/components/pos/order-type-toggle.tsx:16-20` | 3 literal options, DELIVERY excluded | `profile.allowedOrderTypes` |
| `frontend/components/pos/pos-terminal.tsx:44` | `useState<OrderType>("DINE_IN")` | `profile.defaultOrderType` |
| `frontend/components/pos/pos-terminal.tsx:112, 197` | reset to `"DINE_IN"` | same |
| `frontend/components/pos/pos-terminal.tsx:152-208` | Send / Save Draft / Charge always all rendered | rendered per `fire_trigger` + `allows_open_tab` (Toast's Send/Hold/Stay pattern, §1.1) |
| `frontend/components/pos/charge-summary.tsx:23-29` | `PAYMENT_METHODS` literal, omits `CHARGE_TO_ACCOUNT` | `profile.allowedTenders` |

### 6.14 Receipts — nothing exists to make configurable

A grep for `receipt` under `services/` returns purchasing-service GRN classes only. There is no
receipt entity, endpoint, template or print seam in pos-service. `receipt_trigger` and
`prints_queue_token` are therefore **forward-declared** knobs for the parallel POS-thermal-printing
work, not knobs over existing behaviour. Say so plainly in the phase plan rather than shipping a
setting that changes nothing.

**Cross-stream conflict to resolve:** FBR e-invoicing must issue a fiscal invoice number at a
defined lifecycle point. For `ORDER_FIRST` that is naturally `ORDER_CLOSED`. For `BILL_FIRST` the
customer walks away with a printed receipt **before the food is cooked** — the fiscal document is
issued at payment, and any later void/refund is a fiscal credit note, not a deletion. The FBR
research stream and this one must agree on which event carries the invoice trigger; if it is wired
to `ORDER_CLOSED` only, every bill-first tenant hands out a non-fiscal slip.

---

## 7. Cross-cutting concerns

### 7.1 Multi-tenancy

- `service_profiles` and `service_profile_rules` carry `tenant_id`, RLS policy, and — because
  pos_db RLS is inert for the app connection (§4.3) — an **explicit `tenant_id` predicate in every
  repository query**, following `OrderRepository.findByTenantIdAndBranchIdAndStatusIn`'s precedent.
- The `branchId` in every profile request must go through the same `requireOwnBranch` check the rest
  of pos-service uses (`OrderServiceImpl:557-563`, `TillServiceImpl:219-225`,
  `TableServiceImpl:103-109`) — a client-supplied `branchId` must never widen scope.
- The Redis cache key must include `tenantId` **first**. A cache key of
  `pos:service_profile:{branchId}` would be a cross-tenant leak the moment two tenants share a
  branch-id UUID space, and would be indistinguishable from correct behaviour in single-tenant tests.

### 7.2 Money

`service_charge_bps` is an `INT` in basis points; `auto_gratuity_paisa` is `BIGINT` paisa. No float,
no `BigDecimal`, nothing decimal in an event payload. Computation lands in `OrderPricingCalculator`
next to the existing discount/tax rounding, and `recomputeOrderTotals:1013` (which already reads
`order.getServiceChargePaisa()`) starts receiving a non-zero value for the first time. That changes
`totalPaisa` for any tenant who sets it — a deliberate, opt-in behaviour change that must be
recorded, since `total` feeds `maybeCloseOrder`'s `PaymentStatus` derivation and the `ORDER_CLOSED`
revenue posting.

### 7.3 Events

- `ORDER_CREATED` (`PosEventPayloads.OrderCreatedPayload`) gains `channel`.
- `ORDER_SENT_TO_KDS` (`OrderSentToKdsPayload`) gains `channel`; it already carries `type`.
- `ORDER_CLOSED` (`PosEventContract.OrderClosedPayload`) is a **shared** contract in `shared-lib` —
  adding `serviceModel`/`channel` touches finance-service and reporting-service consumers. Additive
  only; do not reorder the record components.
- A new `SERVICE_PROFILE_CHANGED` event is *not* needed. Cache invalidation on write plus a 5-minute
  TTL is sufficient, and an event nobody consumes is exactly the kind of structurally-present dead
  code this project has shipped before.

### 7.4 Aggregator settlement is a receivable, not a tender

A channel order arrives paid. Recording a fake `CASH` or `CARD` `OrderPayment` would corrupt
`closeTill`'s expected-closing sum and the revenue journal. The right shape is the one
`PaymentMethod.CHARGE_TO_ACCOUNT` already uses: `PaymentServiceImpl.chargeToAccount:176-197` calls
finance's AR seam first and lets a refusal propagate, and finance is idempotent on
`(tenantId, POS_ORDER, orderId)`. A new `PaymentMethod.CHANNEL_SETTLEMENT` following that exact
pattern, posting a receivable against the aggregator's account, is the honest model. **Depends on
the aggregator integration existing at all**, which it does not (§2.8).

---

## 8. What I could not verify

1. **Device/kiosk authentication.** I did not read auth-service's token minting. Whether a
   non-human, branch-scoped principal can be issued, and whether `JwtAuthenticationFilter` and
   `TenantContext` tolerate a null `userId` end-to-end, is unverified (§6.8).
2. **Petpooja's "Quick Bill vs KOT mode".** The KOT/bill separation is documented; a named mode
   toggle is not, in any public source I found (§1.6).
3. **`@RequiresFeature` — traced, and it is live, with one caveat.** I initially flagged this as
   unverified; on tracing it: `FeatureFlagAspect` is registered **unconditionally** as a bean by
   `shared-lib/src/main/java/io/restaurantos/shared/config/SharedAutoConfiguration.java:156-158`,
   which is listed in
   `shared-lib/src/main/resources/META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`.
   `FeatureFlagAspect:19-26` throws `FeatureDisabledException` when the flag is off. So
   `@RequiresFeature("FEATURE_POS")` on `OrderController:22`, `PaymentController:21`,
   `TillController:27` and `MenuController:24` **does** enforce, and `/api/v1/pos/` having no
   `RouteFeatureMap` entry is not a hole — it just means enforcement is in-service rather than at
   the edge. **Caveat:** `RedisFeatureFlagService` reads key `feature:{tenantId}:{code}` while the
   gateway reads `tenant_features:{tenantId}:{code}`; `FeatureFlagAdminService` writes both via
   `invalidateBothKeyShapes`, and its javadoc explicitly warns that writing one shape leaves the
   other serving the previous answer. Any new code (`FEATURE_SELF_SERVICE`,
   `FEATURE_CHANNEL_ORDERS`) inherits that two-key contract. It also **fails closed** with no
   `TenantFeatureResolver` wired (`RedisFeatureFlagService:52-56`), so a misconfigured deployment
   403s the whole POS — which is the correct behaviour for a paid module and the wrong behaviour
   for a service profile (§4.5).
4. **`markItemServed` reachability for tableless orders.** `OrderTableDetailDrawer` is rendered from
   both `table-floor-view.tsx:82` and `order-management.tsx:382`, and its props document an
   order-centric mode, so a takeaway order *should* be openable there. I did not run it. The
   lifecycle problem in §3.2 does not depend on this — even if the path works, one manual tap per
   line is not a QSR workflow.
5. **Aggregator/kiosk behaviour of any competitor at the API level.** Everything in §1 is vendor
   documentation and support-article behaviour, not observed API contracts.

---

## 9. Suggested phasing

| Wave | Content | Rationale |
|---|---|---|
| **1** | `service_profiles` + `service_profile_rules` schema, `ServiceProfileResolver` with the 5-layer fallback, `GET /effective`, Redis cache, `pos.settings.*` permissions + catalog rows | Nothing behaves differently yet. Ships the config plane and proves the fallback equals today |
| **2** | `ServiceModelPolicy`; `close_condition` in `maybeCloseOrder`; `maybeCloseOrder` called from `OrderReadyConsumer`; `close_till_blocks_on` | **Fixes the paid-but-never-closed bug (§3.2a) for real.** Highest value, no new UI |
| **3** | `assertCanFire` in `sendToKds`; server-side auto-fire in `recordPayment`; delete the client-side pay-then-fire | Moves the bill-first guarantee out of the browser (§3.2b) |
| **4** | `till_requirement` variants incl. `NONE` + the three-guard cash interlock; `allowed_tenders` | Unblocks self-service without reopening D-30 |
| **5** | `OrderChannel`, `OrderType.DRIVE_THRU`, `PENDING_ACCEPT`, event payload additions | Prepares for kiosk/QR/aggregator surfaces that do not exist yet |
| **6** | Settings UI at `(tenant)/settings/service-model`, terminal reads the profile, `service_charge_bps` | The owner-facing half |

Waves 2 and 3 are worth doing even if the rest is deferred: they fix shipped bugs.

---

## 10. Open questions for the phase plan

1. Should `FEATURE_SELF_SERVICE` / `FEATURE_CHANNEL_ORDERS` be enforced in-service (like
   `FEATURE_POS`, via `@RequiresFeature` — verified live, §8.3) or at the gateway (via
   `RouteFeatureMap`)? Either works; mixing them per code is what produced the phantom-flag bugs
   `TierFeatureDefaults`'s javadoc documents. Whichever is chosen, `FeatureCodeClosureTest` must
   pass and the code must be written in split form in comments.
2. Can auth-service mint a device-bound, user-less, branch-scoped token for a kiosk? (§6.8) If not,
   self-service is blocked on an auth-service change, not a pos-service one.
3. Is per-order-type resolution (layer 1) in the first cut, or deferred? It is the difference
   between "a café can run dine-in and takeaway differently" and "a café picks one".
4. Where does the FBR fiscal invoice number get issued for `BILL_FIRST`? (§6.14) This must be settled
   jointly with the FBR research stream before either design freezes.
5. Does `close_condition = PAID_AND_KDS_READY` need a new `DerivedOrderStatus.READY`, or a helper
   predicate over line statuses? (§6.6) The enum addition is cleaner but touches the frontend model.
6. Is a station/terminal-bound `TillSession` in scope? (§6.10) Drive-thru and shared bar drawers
   cannot be delivered without it.
7. Should `service_charge_bps` apply pre- or post-discount, and is it taxable? Tax treatment of
   service charge in Pakistan is a finance question this document cannot answer.
