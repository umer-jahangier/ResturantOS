# Customer-Facing Ordering Surfaces — QR-at-Table, Kiosk, Online Ordering

Research + design date: 2026-08-07
Branch read: `phase-13-access-repair` @ `5fba4a9`
Author scope: self-checkout kiosk, QR-at-table ordering, online ordering, customer order-status
display, guest session/cart lifecycle, and the security model for an unauthenticated public
surface into a multi-tenant system.

**Discipline note.** Every claim about this repository below names a file I actually opened, with
a line reference where the exact text matters. Where I could not verify something without running
the stack, it is marked **UNVERIFIED** and says what experiment would settle it. This project has
repeatedly shipped code that was structurally present and completely dead — §1.4 documents four
such defects I found while reading for this design, three of which this feature would inherit
directly.

Out of scope (covered by the parallel swarm): FBR e-invoicing, POS thermal printing, biometric
attendance, ERP module gaps, cross-module integration gaps, UI/UX visual direction, frontend
component stack, current tenant configurability, testing strategy. Cross-references to those are
marked → **[swarm: …]**.

---

## Table of contents

1. [What exists in the repo today](#1-what-exists-in-the-repo-today)
2. [How real products do this](#2-how-real-products-do-this)
3. [The central decision: guests get a real, signed, tenant-scoped JWT](#3-the-central-decision-guests-get-a-real-signed-tenant-scoped-jwt)
4. [QR-at-table](#4-qr-at-table)
5. [Kiosk mode](#5-kiosk-mode)
6. [Online ordering](#6-online-ordering)
7. [Customer order-status display](#7-customer-order-status-display)
8. [Session and cart lifecycle, and abandonment](#8-session-and-cart-lifecycle-and-abandonment)
9. [Entering the existing order pipeline](#9-entering-the-existing-order-pipeline)
10. [Data model](#10-data-model)
11. [API surface](#11-api-surface)
12. [Threat model — the crux](#12-threat-model--the-crux)
13. [Rate limiting, in full](#13-rate-limiting-in-full)
14. [Frontend design](#14-frontend-design)
15. [Tenant configurability](#15-tenant-configurability)
16. [What I could not verify](#16-what-i-could-not-verify)
17. [Phasing and effort](#17-phasing-and-effort)

---

## 1. What exists in the repo today

### 1.1 The order pipeline (this is what the new surfaces must reuse)

`services/pos-service/src/main/resources/db/migration/V1__pos_schema.sql` defines the whole
order model. Money is `BIGINT` paisa everywhere — `orders.subtotal_paisa`, `tax_paisa`,
`discount_paisa`, `service_charge_paisa`, `total_paisa` (lines 153-157);
`order_items.unit_price_snapshot`, `discount_paisa`, `tax_paisa`, `line_total_paisa` (lines
188-195); `order_item_modifiers.price_delta_paisa` (line 217); `menu_items.base_price_paisa`
(line 37); `modifiers.price_delta_paisa` (line 101); `branch_menu_overrides.price_paisa` (line
61). No float, no decimal anywhere in the money path except `tax_rate_pct NUMERIC(5,2)` and
`order_discounts.value NUMERIC(12,4)`, which are rates, not amounts.

The lifecycle, from `services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java`:

| Step | Method | What it does |
|---|---|---|
| create | `createOrder` (L136) | idempotent on `clientOrderId`; validates `requireOwnBranch`; status `DRAFT` |
| add item | `addItem` (L208) | server resolves price via `OrderPricingCalculator.effectiveUnitPrice`; DRAFT→OPEN on first item; assigns `order_no`; publishes `ORDER_CREATED` |
| fire | `sendToKds` (L405) | fires only `PENDING` lines, bumps `revisionNo`, publishes `ORDER_SENT_TO_KDS` |
| pay | `PaymentServiceImpl.recordPayment` | caps applied amount at outstanding; calls `maybeCloseOrder` |
| close | `maybeCloseOrder` (L697) → `performClose` (L731) | closes ONLY when `paymentStatus == PAID && derivedStatus == SERVED`; publishes `ORDER_CLOSED` |

**Prices are already resolved server-side.** `OrderPricingCalculator.effectiveUnitPrice(menuItem,
override)` (`OrderPricingCalculator.java` L24) returns the branch override if present else the base
price. `AddOrderItemRequest` (`dto/AddOrderItemRequest.java`) is
`(menuItemId, branchId, quantity, modifierIds, notes)` — **there is no price field on the wire.**
This is the single most important property the new surfaces must preserve.

Events go out through a transactional outbox:
`shared-lib/.../event/DomainEventPublisher.java` INSERTs an `OutboxEntry` inside the caller's
transaction (L35-64) and `OutboxRelay` delivers to RabbitMQ after commit. `kitchen-service`
consumes `ORDER_SENT_TO_KDS` in
`services/kitchen-service/src/main/java/io/restaurantos/kitchen/consumer/OrderSentToKdsConsumer.java`
and routes to tickets via `TicketRoutingService`. **No new event type is needed for guest orders.**

### 1.2 The gateway authentication boundary

`gateway/src/main/java/io/restaurantos/gateway/filter/JwtGlobalFilter.java`. Filter order matters:

| Order | Filter | Effect |
|---|---|---|
| `HIGHEST_PRECEDENCE + 5` | `StripInternalHeaderFilter` | unconditionally removes `X-Internal-Service`, `X-TOTP-Verified`, `X-Acting-User-Id` from every inbound request |
| `HIGHEST_PRECEDENCE + 10` | `JwtGlobalFilter` | validates RS256 + expiry against JWKS; resolves tenant; injects `X-Tenant-Id`, `X-User-Id`, `X-TOTP-Verified` |
| `HIGHEST_PRECEDENCE + 20` | `FeatureFlagGlobalFilter` | tenant status + `FEATURE_*` + NLQ quota |

Three lists govern the boundary:

- `PUBLIC_PATHS` (L52-81) — no token at all. Matched with bare `startsWith`. Currently 11 entries,
  each with a written justification. The javadoc on
  `/api/v1/auth/change-password/forced` (L76-80) states the design rule explicitly: register the
  fully qualified form, because `startsWith` would otherwise expose a sibling authenticated path.
- `TENANT_OPTIONAL_PATHS` (L98) — **exactly `/api/v1/platform`, and the javadoc says it should stay
  that way** (L83-97). Matched on a segment boundary with `..` refused (`isTenantOptionalPath`,
  L335-341).
- `WS_UPGRADE_PATHS` (L110-113) — `/api/v1/reporting/dashboard/` and `/api/v1/kitchen/` only.
  A `?token=` query param is accepted **only** for genuine `Upgrade: websocket` requests on those
  two prefixes.

`authorizeAndForward` (L179-205) has two branches: tenant-less token on a tenant-optional path
(forward with **no** `X-Tenant-Id`), or resolve a tenant and inject it. The comment at L186-189 is
load-bearing: *"The upstream must therefore treat an ABSENT X-Tenant-Id as 'no tenant', never as a
default one."*

**The design in §3 does not touch `TENANT_OPTIONAL_PATHS`, does not touch `WS_UPGRADE_PATHS`, and
adds exactly two fully-qualified `PUBLIC_PATHS` entries, each self-authenticating.**

### 1.3 What does not exist

I searched `services/`, `gateway/`, `shared-lib/`, `frontend/app`, `frontend/lib`,
`frontend/components`, `deploy/` for `kiosk|self.?checkout|qr.?code|guest.?order|online.?order|
ecommerce|self.?service`. **Zero hits for any customer-facing ordering concept.** Nothing about
kiosk, QR ordering, or online ordering appears in `Docs/RestaurantERP_SaaS_Specification.md` or
`Docs/RestaurantERP_UserStories_FlowDiagrams.md` either. This is genuinely greenfield.

Two near-misses that are *not* an implementation:

- `gateway/.../support/RouteFeatureMap.java` L49 maps `/api/v1/ecommerce/` → `FEATURE_ECOMMERCE`.
- `services/platform-admin-service/.../config/TierFeatureDefaults.java` L71-75 defines
  `FEATURE_ECOMMERCE` at GROWTH+, with the comment: *"Ecommerce is unbuilt: no service, no route,
  no frontend surface. It is defined here only so the gateway's mapping names a code that exists."*

So the feature code exists to satisfy `FeatureCodeClosureTest`, and nothing else.

The closest working precedent for an unauthenticated device surface is the HR attendance ingest:
`services/hr-service/.../adms/DeviceAuthResolver.java` resolves a device by serial + token,
**then** binds tenant context and sets the GUC (L53-58). Its supporting
`SECURITY DEFINER` lookup function is in
`services/hr-service/src/main/resources/db/changelog/v1.0.0/031-device-resolve-fn.xml`, with an
explicit deploy note about function ownership vs. FORCE RLS. **This design reuses that shape twice.**

### 1.4 Four verified defects this design must not inherit or repeat

These are all live on `phase-13-access-repair` @ `5fba4a9`. Three of them are blocking
prerequisites for the guest surfaces.

---

**D1 — the feature gate on the existing token-free path is dead.** *(Precedent, not a blocker.)*

`JwtGlobalFilter.PUBLIC_PATHS` includes `/iclock` and `/internal/attendance/ingest` (L68-69), with
the comment: *"these paths stay FEATURE_HR-gated (RouteFeatureMap) + per-device rate-limited."*
`RouteFeatureMap` L40-41 does map both prefixes to `FEATURE_HR`.

But `FeatureFlagGlobalFilter.filter` reads `X-Tenant-Id` and, at L128-132:

```java
String tenantIdHeader = exchange.getRequest().getHeaders().getFirst("X-Tenant-Id");
if (tenantIdHeader == null) {
    // JwtGlobalFilter would have blocked this — safety check only
    return chain.filter(exchange);
}
```

A public path never reaches `JwtGlobalFilter`'s injection step, so `X-Tenant-Id` is always null on
`/iclock`, so the filter returns early and **the `FEATURE_HR` gate on the device ingest path never
runs.** The comment that claims otherwise is wrong, and the "safety check only" comment is the
reason nobody noticed. A biometric push to an HR-disabled tenant is accepted today.

**Consequence for this design:** the gateway's feature filter *cannot* gate any token-free path.
The guest-session mint endpoint must therefore check tenant status and the feature flag **inside
pos-service**, after it resolves the tenant. §3.3 does exactly that, and §12 T-15/T-16 name the
tests that pin it.

---

**D2 — the POS order WebSocket is unreachable through the gateway.** *(Precedent + a real bug.)*

`frontend/lib/hooks/pos/use-pos-orders-socket.ts` L53 builds
`wsUrl('/api/v1/pos/ws/orders/${branchId}?token=${accessToken}')`, and
`frontend/lib/hooks/ws-base-url.ts` points that at the gateway. `pos-service` is ready for it:
`PosSecurityConfig` L59 permits `/api/v1/pos/ws/**` and `PosOrderWebSocketHandler` authenticates
the `?token=` param itself.

But `JwtGlobalFilter.WS_UPGRADE_PATHS` (L110-113) contains only `/api/v1/reporting/dashboard/` and
`/api/v1/kitchen/`. Trace a browser WS upgrade to `/api/v1/pos/ws/orders/{branchId}`:
`isPublicPath` → false; `isWebSocketUpgrade && isWsUpgradePath` → false (neither prefix matches);
falls through to the `Authorization` header check at L156 — which a browser `WebSocket` cannot set
— → **401**. The POS live order stream is dead through the gateway.

**Consequence for this design:** do not put the customer status display on a WebSocket without
also adding the prefix to `WS_UPGRADE_PATHS` *and* pinning it with a test. §7 avoids WebSockets on
the guest surface entirely, for this reason and one more (§7.3).

---

**D3 — order modifiers are never priced and never named.** *(Hard blocker for kiosk and QR.)*

`OrderServiceImpl.addItem` L247-262:

```java
for (UUID modifierId : request.modifierIds()) {
    OrderItemModifier oim = new OrderItemModifier();
    oim.setModifierId(modifierId);
    oim.setModifierNameSnapshot(modifierId.toString());
    oim.setPriceDeltaPaisa(0L);
    item.getModifiers().add(oim);
    modifierDeltas.add(0L);
}
```

Every modifier is stored with a **price delta of zero** and a **name that is the raw UUID string**.
There is no `ModifierRepository` or `ModifierGroupRepository` in
`services/pos-service/src/main/java/io/restaurantos/pos/repository/` — I listed the directory; the
entities `Modifier` and `ModifierGroup` exist with no repository to load them.

Three consequences, all of which land on the guest surfaces harder than on POS (a cashier notices a
wrong price; a kiosk does not):

1. **Revenue leak.** "Add cheese +Rs 50" charges Rs 0. Upsell prompts — the entire commercial point
   of a kiosk — are free.
2. **Kitchen error.** The KDS ticket prints a UUID. `OrderServiceImpl.sendToKds` L499-501 maps
   `OrderItemModifier::getModifierNameSnapshot` straight into the KDS payload, so the cook sees
   `3f1a…-…` instead of "no onions".
3. **No validation.** `addItem` never checks that a submitted `modifierId` belongs to the item's own
   `modifier_groups`, nor that `required` / `min_select` / `max_select`
   (`V1__pos_schema.sql` L81-83) are satisfied. Any tenant-visible modifier UUID can be attached to
   any item.

**This must be fixed before any customer-facing surface ships.** §12 T-8 specifies the fix.

---

**D4 — pos_db row-level security is inert.** *(Changes the threat model materially.)*

Every pos table is `ENABLE ROW LEVEL SECURITY`, never `FORCE` — `V1__pos_schema.sql` L26, 49, 71,
91, 110, 134, 174, 204, 225, 247, 260; `V3` L28, 56, 76; `V7` L34; `V9` L20. `V7__stations.sql` L18
says so out loud: *"No FORCE ROW LEVEL SECURITY (deferred decision — matches existing tables)."*

`deploy/init/02-create-roles.sql` L19 creates `pos_user` as `NOSUPERUSER NOBYPASSRLS`, and
`services/pos-service/src/main/resources/application.yml` L11-12 runs both Flyway and the runtime
pool as `pos_user`. Flyway creates the tables, so `pos_user` **owns** them — and a table owner is
exempt from non-FORCE RLS regardless of the `BYPASSRLS` role attribute.

The codebase already knows: `OrderServiceImpl.listOrders` L573-575 —
*"There is no database backstop to fall back on: pos_db's tables are ENABLE (not FORCE) ROW LEVEL
SECURITY and the application owns them, so RLS is inert for this connection and isolation here is
service-layer only."*

**Consequence for this design, and it is the single most important one:** for the guest surfaces,
tenant isolation in pos-service is **100% service-layer**. There is no second line of defence. A
missing `WHERE tenant_id = ?` on a guest-reachable query is a cross-tenant data breach on a
surface reachable by anyone with a phone. Every control in §12 that says "scoped by tenant" must be
enforced in code and pinned by a test, and §17 makes converting pos_db to `FORCE` RLS with a
non-owner runtime role a prerequisite, not a follow-up.

---

## 2. How real products do this

### 2.1 QR-at-table

The dominant pattern (Square, Toast, Jamezz, Restolabs, me&u/MrYum-class products):

- The QR encodes a URL, not data. It resolves to a menu scoped to a specific venue + table.
- The identifier in the QR is a high-entropy UUID/GUID precisely so it cannot be brute-forced —
  [USPTO 12561730](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12561730)
  describes 128-bit random identifiers for exactly this reason.
- On scan, the server checks the identifier maps to an *available* table and opens a session.
- The same printed code is reused across seatings — the *session* is regenerated, not the code —
  so guests can order repeatedly through a meal without rescanning
  ([Restolabs](https://www.restolabs.com/blog/restaurant-qr-code-table-ordering-guide),
  [Jamezz](https://jamezz.com/blog/qr-ordering-implementation-guide)).
- Payment runs through the same PCI-scoped processor as the countertop terminal
  ([Square](https://squareup.com/us/en/online-ordering/qr-code-ordering)).

Two operating modes exist in the market and tenants want both:

- **Order-and-pay-now** (fast casual, bars): guest pays at placement; the order fires on payment
  confirmation. No table risk.
- **Order-now-pay-later** (full service): the order fires immediately, the bill settles at the
  table. Higher trust, higher walk-out risk, needs a staff-acceptance step in most venues.

This is a per-tenant, per-branch policy, not a product decision (§15).

### 2.2 Kiosk

[Toast](https://pos.toasttab.com/hardware/restaurant-kiosk) and
[Square Kiosk](https://squareup.com/help/us/en/article/8313-customize-self-serve-ordering-with-square-kiosk)
converge on the same shape:

- The kiosk is **provisioned from the merchant account** — it is a registered device, not an
  anonymous browser. Orders flow into the same POS and the same kitchen display in real time, with
  no re-keying.
- **Required modifiers block checkout.** Toast's flow explicitly asks the guest to choose required
  modifiers before the item can be added.
- **Smart upsells** are a configurable prompt shown before checkout, and paid modifiers are the
  upsell mechanism. This is why D3 is a blocker rather than a polish item.
- **Order-ready notification** is by name, table number, or order number — Square makes which one
  a per-merchant setting.
- Kiosks are single-purpose devices in guided-access/kiosk-browser mode; the software assumes it
  cannot navigate away.

### 2.3 Online ordering, Pakistan-specific

Card + wallet + bank rails are fragmented; the practical integration surface is an aggregator that
unifies Visa/Mastercard, Raast, JazzCash, Easypaisa and IBFT behind one REST API with webhooks
([XSTAK](https://www.xstak.com/blog/payment-gateways-in-pakistan),
[Rapid Gateway](https://rapidgateway.pk/resources/best-payment-gateway-pakistan)). JazzCash and
Easypaisa carry the wallet volume. The design in §6.3 therefore treats the PSP as a pluggable
adapter with a signed-webhook contract, and never as a client-side "payment succeeded" assertion.

### 2.4 The attack the market actually suffers

"Quishing" — a printed sticker pasted over the genuine table QR, redirecting to a lookalike page
that harvests card details. Warned about by the FBI/FTC and widely reported through 2024-2026;
restaurant tables are named as a primary target
([Cybernexora](https://blog.cybernexora.com/qr-code-phishing-attacks-quishing-scams-2026/),
[2b1](https://2b1inc.com/scan-with-caution-how-fake-qr-codes-turn-convenience-into-a-cyber-risk/),
[arXiv field study](https://arxiv.org/pdf/2204.04086)).

**This is a physical attack that no server-side control can prevent.** It can only be *detected*
and *contained*. §12 T-12 specifies the containment (never handle raw PAN, brand-verifiable
landing page, tamper-evident QR plates, staff peel-test in the opening checklist, and a scan-rate
anomaly alert that catches a table whose scans suddenly go to zero).

---

## 3. The central decision: guests get a real, signed, tenant-scoped JWT

### 3.1 The question, stated precisely

"No login" means the guest presents **no credential and no identity**. It does not mean the
*request* carries no token. Those are different properties, and conflating them is what would force
a gateway weakening.

### 3.2 Options considered

| # | Option | Verdict |
|---|---|---|
| A | Add `/api/v1/guest/**` to `PUBLIC_PATHS` | **Rejected.** Every guest request would then reach pos-service with no `X-Tenant-Id`, so `FeatureFlagGlobalFilter` returns early (D1) — no tenant-status check, no feature gate, on the *largest* public surface in the system. Also loses per-tenant rate limiting at the edge. |
| B | Add `/api/v1/guest` to `TENANT_OPTIONAL_PATHS` | **Rejected outright.** The javadoc at `JwtGlobalFilter.java` L83-97 says this set is closed by construction and names threat T-13-01-A. Widening it re-opens exactly the hole that audit blocker B1 was about. Non-negotiable. |
| C | Resolve the tenant from the `Host` subdomain and let the request through token-less | **Rejected.** `TenantResolutionSupport.extractSlug` (L92-103) already supports slug→tenant, but making it the *authentication* for a write path means any request to `acme.restaurantos.io` is an authenticated Acme request. That is a tenant-wide unauthenticated write surface. |
| D | Opaque server-side session cookie, validated in pos-service | **Rejected.** The gateway cannot validate it, so the gateway must let the request through token-less → collapses to option A. |
| E | **Mint a real RS256 JWT for the guest session** | **Chosen.** |

### 3.3 The chosen design

**A guest session is an identity the platform issues to a device, not a credential the guest
presents.** The guest never authenticates. The device proves it is physically at a table (or is a
registered kiosk, or is completing a checkout it started) and receives a short-lived, narrowly
scoped, signed token.

The guest token is a normal tenant-bearing access token:

```
sub          = guest_sessions.id          (a UUID that is NOT a users.id)
tenant_id    = resolved from the QR / kiosk registration — never from the request
branch_id    = same
roles        = []                          (compiled-in, empty)
permissions  = ["guest.menu.view","guest.cart.write","guest.order.create",
                "guest.order.view","guest.payment.initiate"]   (compiled-in, fixed)
attributes   = { "surface": "QR_TABLE" | "KIOSK" | "ONLINE",
                 "table_id": "<uuid>" | null,
                 "table_session_id": "<uuid>" | null }
totp_verified= false                       (explicit, per the repo's fail-closed idiom)
token_type   = "guest"
exp          = now + 30 min                (QR/online) / now + 5 min (kiosk, see §5.3)
```

Everything then works **unchanged**:

| Existing mechanism | Behaviour with a guest token |
|---|---|
| `JwtGlobalFilter` L156-170 | ordinary header path; RS256 + expiry verified against JWKS |
| `TenantResolutionSupport.resolve` L54-56 | returns the `tenant_id` claim — the fast path |
| `identityHeaders` L214-230 | injects `X-Tenant-Id`, `X-User-Id`, `X-TOTP-Verified: false` |
| `FeatureFlagGlobalFilter` | **runs.** Tenant suspension enforced. `FEATURE_GUEST_ORDERING` enforced (new `RouteFeatureMap` entry). |
| `JwtAuthenticationFilter` (pos-service) L59-81 | populates `TenantContext` → `TenantAwareDataSource` sets `app.current_tenant_id` on the connection |
| `@RequiresFeature("FEATURE_POS")` / `FeatureFlagAspect` L20 | works — it calls `tenantContext.requireTenantId()` |
| `@PreAuthorize` on every existing POS endpoint | **denies.** See §3.4. |

**Nothing in the gateway is weakened.** `TENANT_OPTIONAL_PATHS` stays one entry.
`WS_UPGRADE_PATHS` is untouched. The guest token is a tenant-bearing token on a tenant route,
which is the case the gateway was built for.

### 3.4 Why a guest token cannot reach a staff endpoint

I audited every controller in `services/pos-service/src/main/java/io/restaurantos/pos/web/`.
**Every single mapping under `/api/v1/pos/**` carries a `@PreAuthorize`** — `MenuController` (16
mappings), `OrderController` (14), `PaymentController` (4), `StationController` (4),
`TableController` (3), `TillController` (9). `PosSecurityConfig` L51-60 additionally requires
`.anyRequest().authenticated()`. `InternalPosController` is under `/internal` and is gated by
`PosInternalServiceFilter`'s constant-time shared-secret check.

A guest token holds no `pos.*` authority, so every one of those 50 mappings 403s. This is a
property that can be *asserted*, not merely intended:

> **Test GS-01** — `GuestTokenCannotReachStaffEndpointsIT`: mint a guest token, then call every
> `@RequestMapping` under `/api/v1/pos/**` (enumerated by reflection over the `web` package, so
> a new endpoint cannot be added without the test seeing it) and assert 403 on all of them.

### 3.5 The `guest.*` permission codes

`services/auth-service/src/test/java/io/restaurantos/auth/PermissionCatalogClosureTest.java`
scans `@PreAuthorize` expressions across every service and Rego policy and requires each code to
exist as a `permissions` insert in the Liquibase changelog. Its javadoc lists five prior outages of
exactly this shape. So the five `guest.*` codes need a catalog changeset —
`auth-service/src/main/resources/db/changelog/v1.0.0/0NN-guest-permissions.xml`.

They must be granted to **no role, ever**. Add the inverse test:

> **Test GS-02** — `GuestPermissionsAreUngrantedTest`: no `role_permissions` insert in any
> changelog references a code starting `guest.`. A `guest.*` code on a staff role would give a
> human the guest surface's ability to bypass staff controls (e.g. `guest.order.create` bypasses
> till binding).

### 3.6 The two new public paths

Both are self-authenticating — the same justification the file already uses for
`/api/v1/auth/change-password/forced` (`JwtGlobalFilter.java` L76-80).

```java
private static final List<String> PUBLIC_PATHS = List.of(
    ...
    // Guest-session mint. Public for the same reason /login is: the caller has no token and
    // cannot obtain one until this succeeds. Self-authenticating: the body must carry a valid,
    // active, non-rotated QR token (or kiosk device token), which pos-service resolves through a
    // SECURITY DEFINER lookup and verifies in constant time before minting anything.
    //
    // FULLY QUALIFIED and childless BY CONSTRUCTION: isPublicPath uses startsWith, so every guest
    // endpoint that requires a token lives under /api/v1/guest/<other-segment>/…, never under
    // /api/v1/guest/sessions/…. GuestPublicPathTest asserts both halves.
    //
    // Tenant status and FEATURE_GUEST_ORDERING are checked INSIDE pos-service on this path, not
    // at the gateway: FeatureFlagGlobalFilter returns early when X-Tenant-Id is absent
    // (FeatureFlagGlobalFilter.java:128-132), which is why the /iclock feature gate has never
    // actually run. Do not repeat that here.
    "/api/v1/guest/sessions",

    // PSP payment callback. Public because the payment service provider holds no JWT and cannot
    // be given one. Self-authenticating: HMAC-SHA256 over the RAW request body against the
    // per-tenant PSP webhook secret, constant-time compared, before the body is parsed.
    // Fully qualified for the same reason as above.
    "/api/v1/guest/payments/callback"
);
```

**Recommended hardening (optional, strictly tightening).** `isPublicPath` uses a bare
`startsWith`, while `isTenantOptionalPath` already uses segment-boundary matching with `..`
refused. Making `isPublicPath` use the same predicate is safe for every current entry — I checked
each: `/iclock/cdata` and `/.well-known/jwks.json` both satisfy `startsWith(prefix + "/")`;
`/actuator/health`, `/fallback/service-unavailable` and all six auth paths either match exactly or
have a `/`-delimited child. It removes the entire class of "a sibling path inherited the
exemption" bug. Cheap, and it makes the childless-by-construction rule above structural rather
than reviewed.

### 3.7 The mint flow

auth-service is the only holder of the RSA private key
(`services/auth-service/src/main/java/io/restaurantos/auth/service/JwtSigningService.java`), and
per-service databases forbid auth-service from reading `pos_db`. The existing precedent is exactly
this split: `PlatformTokenService`'s javadoc explains that platform-admin-service authenticates and
auth-service signs, over the internal channel, *"only platform-admin-service connects to
platform_db."*

```
  Browser                Gateway              pos-service                 auth-service
     │                      │                      │                            │
     │ POST /api/v1/guest/sessions  {qrToken}      │                            │
     ├─────────────────────►│                      │                            │
     │                      │ PUBLIC_PATHS → no JWT check                       │
     │                      │ guest-session-route rate limit (per IP, tight)    │
     │                      ├─────────────────────►│                            │
     │                      │                      │ 1. resolve_guest_qr(hash)  │  SECURITY DEFINER
     │                      │                      │    → tenant, branch, table │  (RLS-safe pre-context read)
     │                      │                      │ 2. constant-time token cmp │
     │                      │                      │ 3. tenant ACTIVE?          │  ← platform-admin, cached
     │                      │                      │ 4. FEATURE_GUEST_ORDERING? │  ← RedisFeatureFlagService
     │                      │                      │ 5. table not force-closed? │
     │                      │                      │ 6. per-table mint budget?  │
     │                      │                      │ 7. TenantContext.set(...)  │  ← only now
     │                      │                      │ 8. INSERT guest_sessions   │
     │                      │                      │                            │
     │                      │                      │ POST /internal/auth/guest-token
     │                      │                      │   X-Internal-Service: <secret>
     │                      │                      ├───────────────────────────►│
     │                      │                      │                            │ signGuestToken(...)
     │                      │                      │◄───────────────────────────┤ permissions HARDCODED
     │                      │◄─────────────────────┤                            │
     │◄─────────────────────┤  { token, expiresIn, session:{…}, brand:{…} }     │
```

Steps 1-6 all run **before** any tenant context is bound, mirroring `DeviceAuthResolver` L53
(*"Only now bind tenant/branch from the registry (so failures above never leak context)"*).

`signGuestToken` must hardcode the permission list, exactly as `signPlatformToken`
(`JwtSigningService.java` L96-117) hardcodes the role into both claims:

```java
/**
 * Mints a guest-session token: a tenant-scoped identity with NO user behind it.
 *
 * <p>The permission set is COMPILED IN and is not a parameter. A mint endpoint that accepted a
 * caller-supplied permission list would let anyone holding the internal secret mint an arbitrary
 * tenant identity — which is exactly the property PlatformTokenService's javadoc warns about for
 * the platform token, except that this endpoint is one internal hop away from a PUBLIC path.
 *
 * <p>{@code sub} is guest_sessions.id, NOT a users.id. Downstream code must never treat it as a
 * user: OrderServiceImpl.createOrder would otherwise write it into orders.cashier_id and look up
 * a till against it. See GuestOrderService, which never reads TenantContext.getUserId().
 */
public String signGuestToken(UUID guestSessionId, UUID tenantId, UUID branchId,
                             String surface, Map<String, Object> attributes, Duration ttl)
```

---

## 4. QR-at-table

### 4.1 The QR itself

```
https://{tenant-slug}.restaurantos.io/t/{qrToken}
```

- `{tenant-slug}` gives brand trust in the URL bar (a guest can see it is *their* restaurant), lets
  the Next.js app theme itself before any API call, and matches the slug shape
  `TenantResolutionSupport.extractSlug` already understands (L92-103). It is **display and routing
  only** — the tenant is authoritative from the QR token, never from the Host, on this path.
- `{qrToken}` is 160 bits of `SecureRandom`, base64url, no padding — 27 characters. Generated by
  the same helper shape as `AttendanceDeviceService.generateToken()`
  (`services/hr-service/.../service/AttendanceDeviceService.java` L93-97), widened from 32 bytes
  to reflect that this one is printed and long-lived.
- Stored as **SHA-256 hash only** in `dining_table_qr.token_hash`. Nothing in the database can be
  read to reprint a working QR — a DB read is not enough to attack the venue. Rotation issues a new
  token and requires reprinting; that is the intended cost.
- **Not a secret in the threat model.** Anyone seated at the table can read it. Its job is to be
  *unguessable*, so an attacker cannot enumerate tables or tenants, and *revocable*, so a
  compromised or photographed code can be killed without reprinting the whole floor.

The QR is durable across seatings. The *session* is minted per scan (§2.1).

**Deliberately not a signed/JWS payload.** A self-describing signed QR needs no DB lookup, but it
cannot be revoked without a revocation list — which reintroduces the lookup — and it leaks
`tenant_id` / `branch_id` / `table_id` to anyone who decodes it, giving an attacker a target list.
An opaque handle leaks nothing.

### 4.2 Table session vs. guest session

Two levels, because a table has several phones on it and one bill.

```
dining_tables (1) ──< table_sessions (per seating) ──< guest_sessions (per device)
                              │
                              └──< guest_carts (0..1 shared, or 1 per guest — tenant policy)
                              └──< orders (the real POS orders)
```

- **`table_sessions`** — opened by the first scan against an `AVAILABLE` table, or joined by
  subsequent scans of the same table while one is `OPEN`. Carries `cover_count`, the shared cart,
  and every order placed during the seating. Closed when the last order closes, when staff clear
  the table from the POS floor plan, or by the idle sweeper (§8.3).
- **`guest_sessions`** — one per device. Bound to exactly one `table_session_id`. Carries the JWT
  `sub`. Revocable individually (a guest leaves) or en masse (staff clear the table).

Shared-cart vs. per-guest-cart is a per-tenant setting (`guest.qr.cart_mode`, §15). Shared is the
me&u/MrYum default and is what most full-service venues want; per-guest suits bars.

### 4.3 The flow

```
Scan → GET  /t/{qrToken}                   (Next.js route, no API call yet)
     → POST /api/v1/guest/sessions          {qrToken}          → guest JWT + brand + table label
     → GET  /api/v1/guest/menu                                 → categories + items + modifier groups
                                                                 (branch-override prices resolved server-side)
     → POST /api/v1/guest/cart/items        {menuItemId, qty, modifierIds[], notes}
     → GET  /api/v1/guest/cart                                 → server-computed totals, BIGINT paisa
     → POST /api/v1/guest/orders            Idempotency-Key: <uuid>
            ├─ policy PAY_FIRST  → 201 with a payment intent; order stays DRAFT until the PSP webhook
            └─ policy FIRE_FIRST → 201, order OPEN→SENT_TO_KDS immediately (or PENDING_ACCEPTANCE)
     → GET  /api/v1/guest/orders/{id}       (poll, §7)
     → POST /api/v1/guest/orders/{id}/pay   (pay-later settlement)
```

**Reorder during the meal** is the same `POST /api/v1/guest/orders` again — a second order on the
same `table_session_id`. It becomes a separate POS order, which is the correct model: it fires as
its own KDS ticket and the existing `sendToKds` revision logic
(`OrderServiceImpl.sendToKds` L444-454) needs no change. Presenting several orders as one bill at
the table is a *display* concern, plus the existing split/settle flow on the POS side.

### 4.4 Who pays when — the policy that matters most

`guest.qr.payment_mode`, per tenant with per-branch override:

| Mode | Order fires | Walk-out risk | Fits |
|---|---|---|---|
| `PAY_FIRST` | on PSP webhook confirming full `total_paisa` | none | fast casual, bars, food courts |
| `FIRE_FIRST_PAY_AT_TABLE` | immediately on placement | full | full service with attentive staff |
| `FIRE_ON_STAFF_ACCEPT` | when a waiter taps Accept on the POS | none | the safe default |

**`FIRE_ON_STAFF_ACCEPT` is the shipped default.** It costs one tap and removes the entire
"unauthenticated stranger causes the kitchen to cook food" class of loss (§12 T-9). It also gives
staff a place to catch a nonsense order before the kitchen does. Tenants who want frictionless
service opt out deliberately.

`PENDING_ACCEPTANCE` is a guest-side state, not a new `OrderStatus`: the order sits at `OPEN` with
`orders.guest_accepted_at IS NULL` and simply has not had `sendToKds` called on it. **No change to
`OrderStatus`, `OrderStateMachine`, or any event contract.**

---

## 5. Kiosk mode

### 5.1 A kiosk is a registered device, not an anonymous browser

Both Toast and Square provision kiosks from the merchant account (§2.2). Precedent in this repo is
`attendance_devices` + `AttendanceDeviceService.register` (L42-64): a Tenant Admin registers the
device, the token is shown **once**, stored AES-256-GCM encrypted via
`EncryptedStringConverter`, and verified in constant time with `MessageDigest.isEqual` (L84-91).

`kiosk_devices` copies that shape exactly, with two differences: the token is stored as a
**SHA-256 hash** rather than reversibly encrypted (nothing ever needs to read it back — the
attendance design needs the plaintext only because the ADMS protocol echoes it), and it carries a
`station_label` for the order-number display.

Enrolment: Tenant Admin creates the kiosk in the back office → gets a one-time 8-character
enrolment code → types it into the kiosk browser once → the kiosk exchanges it for a long-lived
device token held in the device's `localStorage`, and the enrolment code is burned. This avoids
typing a 43-character token on a touchscreen.

### 5.2 The locked-down UI

Kiosk lockdown is device configuration, not application code, and the application must not pretend
otherwise:

- **Android:** a kiosk-browser app in Lock Task Mode / COSU, or Chrome in Guided Access equivalent.
- **iPad:** Guided Access, or Single App Mode under MDM.
- **Windows/Linux:** Chrome `--kiosk --incognito --disable-pinch --noerrdialogs`.

What the app contributes:

- Next.js route group `app/(kiosk)` with **no** navigation chrome, no links off-surface, and a
  service-worker-cached menu so a 10-second network blip does not blank the screen mid-order
  (`frontend/workbox` already exists in the tree).
- `viewport-fit=cover`, `user-select: none`, `touch-action: manipulation`, `overscroll-behavior:
  none`, all `<a>` internal.
- **Attract loop** — a full-screen idle screen after 45 s of no touch, which clears the cart and
  ends the guest session on tap-to-start. This is the primary defence against the previous guest's
  cart (and their session) being inherited by the next person (§12 T-10b).
- **Accessibility**: a reachability toggle that drops the whole UI into the bottom 60% of the
  screen for wheelchair users; minimum 48 px targets; no timed-out dialogs without an extend
  button. → **[swarm: UI/UX visual direction]** for the actual visual system.

### 5.3 Kiosk token lifetimes

Two tokens, deliberately different:

- **Device token** — long-lived, in `localStorage`, never leaves the device except to mint.
- **Guest session token** — minted per *customer*, TTL **5 minutes**, rotated on activity, killed
  by the attract loop. A kiosk is unattended in a public room; a 30-minute token sitting in a tab
  is a much worse exposure than the same token on a personal phone.

`POST /api/v1/guest/sessions` accepts either `{qrToken}` or `{deviceToken}` — one endpoint, one
public path, one rate-limit budget, two credential shapes. The `surface` attribute in the minted
token records which.

### 5.4 Modifiers and upsell

This is the commercial core of a kiosk and it is **blocked on D3**.

- **Required modifier groups block Add-to-cart.** `modifier_groups.required`, `min_select`,
  `max_select` already exist (`V1__pos_schema.sql` L81-83) and are currently enforced nowhere.
- **Upsell prompt** — shown once, at cart review, before checkout. Sourced from a new
  `menu_item_upsells (menu_item_id, suggested_item_id, sort_order)` table, editable in the back
  office. Deliberately **not** algorithmic in v1: a rule table a manager can edit beats a
  recommender nobody can explain, and "why is it suggesting that" is a support ticket.
- **Every upsell price is resolved server-side** on add, exactly like any other item. The prompt
  carries `menuItemId` only.

### 5.5 Kiosk payment

Cash is **not supported at a kiosk**, and the existing code already enforces the right thing for
the right reason: `PaymentServiceImpl.recordPayment` L92-97 refuses `CASH` without an OPEN till
bound to the paying user. A kiosk has no drawer and no user, so it would be refused — correctly.

Two supported tenders:

- **`KIOSK_TERMINAL`** — a semi-integrated bank POS terminal bolted to the kiosk. The kiosk asks
  the server for the amount, the server tells the terminal, the terminal returns an approval
  reference. The *server* records the payment against `order.total_paisa` (read from the DB), never
  an amount the kiosk asserts. Where the acquirer offers a query API, reconcile; where it does not,
  record with `reconciled = false` and surface it on the daily till review
  (`TillReviewService` already exists for exactly this kind of exception).
- **`WALLET_QR`** — a dynamic JazzCash/Easypaisa/Raast QR rendered on the kiosk screen, settled
  through the same PSP webhook as online (§6.3). Same code path, no kiosk-specific trust.

### 5.6 Order-number display

`orders.order_no` already exists as `ORD-20260807-0001` (`OrderServiceImpl.generateOrderNo`
L1050-1064) — correct for records, useless shouted across a room. Add
`orders.public_code VARCHAR(8)`: a short per-branch-per-day code such as `A47`, derived from the
same `order_sequences` row so it cannot drift from `order_no`.

**The public code is not a capability.** Knowing `A47` must never let anyone read the order. Order
reads are scoped to `guest_session_id` / `table_session_id` (§12 T-11). The in-store "now serving"
board is a **staff/device surface** (§7.2), not a public one.

---

## 6. Online ordering

### 6.1 What is different

No table, no physical presence, therefore no implicit accountability. Three consequences:

1. **Payment is always before fire.** `PAY_FIRST` is not a policy here, it is the only mode.
2. **The branch is chosen by the customer**, so it is client input and must be validated against
   the tenant's list of branches that have online ordering enabled — never accepted as given.
3. **PII appears** (name, phone, address). That is a new data class in pos_db and needs deliberate
   handling (§6.4).

### 6.2 Entry and session

```
https://{tenant-slug}.restaurantos.io/order            → branch picker (public, cached, no session)
                                    /order/{branchCode} → POST /api/v1/guest/sessions {branchCode, orderType}
```

Here the mint endpoint is genuinely open — there is no QR token and no device token, only a public
branch code. That is the weakest of the three surfaces and gets the tightest limits (§13). The
session is `surface: "ONLINE"`, `table_id: null`.

**A tenant that has not enabled online ordering must not be mintable.** `FEATURE_GUEST_ORDERING`
plus a separate `guest.online.enabled` tenant setting plus a per-branch
`branch_guest_config.online_enabled` — three gates, because this is the one surface with no
physical control at all.

### 6.3 Payment — the money control that matters most

**The browser never asserts that payment happened.**

```
1. POST /api/v1/guest/orders                      → order created, status DRAFT
2. Server creates guest_payment_intents row:
     amount_paisa = orders.total_paisa            ← read from the DB, in the same transaction
     intent_ref   = 160-bit random, globally unique
     status       = PENDING
3. Server calls the PSP with (intent_ref, amount_paisa, callback URL)
4. Browser is redirected to the PSP. It is now out of the trust path entirely.
5. PSP → POST /api/v1/guest/payments/callback     (server-to-server, PUBLIC_PATHS entry)
     a. HMAC-SHA256 over the RAW body vs. the per-tenant webhook secret, MessageDigest.isEqual
        — BEFORE parsing. A parse of an unverified body is an attack surface.
     b. resolve_guest_payment_intent(intent_ref)  ← SECURITY DEFINER, pre-tenant-context
     c. TenantContext.set(...)                     ← only now
     d. IdempotencyService.checkAndLock("psp:" + pspEventId)  — PSPs retry; this is not optional
     e. ASSERT psp.amount_paisa == intent.amount_paisa. Not >=, not "close enough".
        A mismatch is refused, logged at ERROR with the intent ref, and alerted.
     f. PaymentServiceImpl.recordPayment(orderId, method, intent.amount_paisa, ...)
     g. sendToKds(orderId)                         — the order fires HERE, and only here
6. Browser returns to /order/status/{opaqueStatusToken} and polls. It shows what the server says.
```

Steps 5e and 5f are the crux: the amount comes from `guest_payment_intents.amount_paisa`, which
was itself copied from `orders.total_paisa` server-side. **No number on this path ever originates
with a client.**

`PaymentMethod` needs three new values — `WALLET_JAZZCASH`, `WALLET_EASYPAISA`, `RAAST` — added to
the enum and to the `CHECK` constraint in a migration. `CARD` covers PSP card payments.
→ **[swarm: FBR e-invoicing]** for how these tenders must appear on the invoice.

### 6.4 PII and delivery

New nullable columns on `orders`, or better a side table `order_customer_details` so `orders` does
not grow a PII surface every query touches:

```
order_customer_details (order_id PK, tenant_id, customer_name, customer_phone_enc,
                        address_line, address_notes, geo_lat, geo_lng, created_at)
```

`customer_phone_enc` uses the existing `EncryptedStringConverter`
(`shared-lib/.../security/EncryptedStringConverter.java`), which is already used for device tokens.
Retention: purge details for orders closed more than N days ago (tenant setting, default 90).

**A phone number must not be a lookup key.** "Enter your phone to see your order" is a PII
enumeration oracle. Status lookup is by opaque `status_token` only (§7.1).

---

## 7. Customer order-status display

### 7.1 The guest's own device

`GET /api/v1/guest/orders/{orderId}` with the guest session token, scoped to
`guest_session_id` or `table_session_id`. Returns a **reduced** DTO — deliberately not `OrderDto`:

```
GuestOrderStatusDto {
  publicCode      "A47"
  status          PLACED | ACCEPTED | PREPARING | READY | SERVED | COMPLETED | CANCELLED
  items[]         { name, quantity, status }          // no menuItemId, no station, no unit price
  totalPaisa      long
  paidPaisa       long
  placedAt, estimatedReadyAt
}
```

The customer-facing status set is derived, not stored — a pure mapping seam over the existing
`OrderStatus` + `DerivedOrderStatus` + `PaymentStatus`, mirroring the repo's existing
`OrderStatusDerivationService` pattern:

| Internal | Guest sees |
|---|---|
| `OPEN` + `guest_accepted_at IS NULL` | PLACED |
| `OPEN` + accepted, or `SENT_TO_KDS` + `derived = DRAFT` | ACCEPTED |
| `SENT_TO_KDS` + `derived = IN_PROGRESS` | PREPARING |
| `PARTIAL_READY` / `READY` | READY |
| `derived = PARTIALLY_SERVED` / `SERVED` | SERVED |
| `CLOSED` | COMPLETED |
| `VOIDED` / `REFUNDED` | CANCELLED |

`OrderDto` (`dto/OrderDto.java`) must never be returned to a guest: it carries `cashierId`,
`kdsStation`, `unitPriceSnapshot` per line, and `clientOrderId`. A guest DTO built by *omitting*
fields from a staff DTO regresses the day someone adds a field to the staff DTO. **Build it as a
separate record, and pin it:**

> **Test GS-03** — `GuestDtoShapeTest`: every record under `dto/guest/` has a field set that is an
> explicit allow-list in the test. Adding a field fails the test until someone updates the list.

For online orders (no session on the return device — the customer may open the link on a laptop),
`GET /api/v1/guest/orders/by-token/{statusToken}` where `statusToken` is 160-bit random, stored
hashed, single-order-scoped, and expires 4 h after the order closes.

### 7.2 The in-store "now serving" board

This is a **staff/branch device surface, not a public one.** It runs on the branch's own display
with a device token (same `kiosk_devices` registry, `role = DISPLAY`). It shows `public_code` +
status only: no money, no names, no items. It can safely reuse the existing KDS WebSocket path,
which is one of the two prefixes actually in `WS_UPGRADE_PATHS`.

Treating it as public would be a mistake: a public board endpoint that lists every current order
code for a branch is a free enumeration oracle for §12 T-11.

### 7.3 Why polling, not WebSocket or SSE

**WebSocket:** blocked by D2. `/api/v1/pos/**` is not in `WS_UPGRADE_PATHS`, and adding
`/api/v1/guest/` would widen the one boundary where a JWT is accepted from a URL — on the surface
with the most hostile traffic. Not worth it.

**SSE:** structurally attractive (plain HTTP GET, `Authorization` header works via `fetch`-based
EventSource, so no gateway auth change at all, and `nginx.conf` L85 already sets
`proxy_buffering off`). But `gateway/src/main/resources/application.yml` L540-543 configures
`posCircuitBreaker` with `timeoutDuration: 5s, cancelRunningFuture: true`. A long-lived stream on
`pos-route` would be cut at 5 seconds. **UNVERIFIED** — the KDS WebSocket runs under an identically
configured `kitchenCircuitBreaker` and apparently works, so the interaction between the reactive
time limiter and long-lived responses needs an actual experiment before anyone designs on it. Given
D2 exists precisely because someone assumed a transport worked, I am not designing on an unverified
one.

**Shipped: adaptive polling.**

| Guest status | Interval |
|---|---|
| PLACED / ACCEPTED | 5 s |
| PREPARING | 5 s |
| READY | 3 s |
| SERVED / COMPLETED / CANCELLED | stop |
| tab hidden (`visibilitychange`) | pause entirely |

With `ETag` / `If-None-Match` on `GET /api/v1/guest/orders/{id}` a steady-state poll is a ~200-byte
304. A 40-table venue at peak is well under 20 req/s. This is cheap, works on bad mobile data,
degrades to a pull-to-refresh, and adds no new gateway surface. Revisit SSE once the time-limiter
question is settled experimentally.

---

## 8. Session and cart lifecycle, and abandonment

### 8.1 The cart is not a DRAFT order

`OrderServiceImpl.listOrderSummaries` L602-606 documents the existing position: *"a client-only
cart never persists a DB order, so DRAFT rows are stale abandoned carts, not active orders — they
must never surface in Order Management."*

A guest cart cannot be client-only (server-authoritative pricing is the whole point), but it must
also not be a DRAFT `orders` row, or every abandoned scan becomes a row that Order Management has to
filter out forever. So: a separate `guest_carts` / `guest_cart_items` pair with a TTL, converted to
a real `Order` only at placement.

Consequences, all good: abandoned carts never touch `order_sequences`, never take a `client_order_id`
(which is `UNIQUE` — `V1__pos_schema.sql` L171), never appear in any staff view, and can be swept
without reasoning about order state.

Cart totals are computed by the **same** `OrderPricingCalculator` the real order uses, so the price
a guest is shown is the price the order will carry. The cart is a *preview* of the priced order,
not a second pricing implementation.

### 8.2 Session states

```
guest_sessions.status:  ACTIVE → EXPIRED   (TTL elapsed, sweeper)
                        ACTIVE → CLOSED    (guest finished, or attract loop, or order closed)
                        ACTIVE → REVOKED   (staff cleared the table, or abuse)
```

`table_sessions.status: OPEN → CLOSED → (ABANDONED)`.

### 8.3 The sweeper

One `@Scheduled` job in pos-service, idempotent, safe to run on every replica (advisory-lock
guarded, like the existing `OutboxRelay` pattern):

| Age | Action |
|---|---|
| cart idle > 30 min | delete `guest_cart_items`, mark cart `ABANDONED` |
| guest session past `expires_at` | `EXPIRED`; drop the Redis validity key |
| table session `OPEN`, no order, all guest sessions dead, idle > 45 min | `ABANDONED`; release the table via `TableService.syncStatusForOrder` |
| table session `OPEN` with a `CLOSED` order and no activity > 15 min | `CLOSED` |
| `guest_payment_intents` `PENDING` > 30 min | `EXPIRED`; the order stays DRAFT and is voided by the next sweep |
| `DRAFT` guest order older than 2 h with no payment | void it |

**Revocation is a hard requirement and JWTs cannot be revoked at the gateway.** So pos-service
checks session validity on **every** guest request:

- `GuestSessionFilter` reads `sub`, checks Redis `guest_session:{id}` → `"ACTIVE"`.
- Cache miss → DB read → repopulate with TTL = remaining token life.
- **Redis unavailable → fall back to the DB, never to "allow".** The failure mode must be a slower
  request, not an unrevokable session. This is the same fail-closed judgement
  `FeatureFlagGlobalFilter`'s `StatusResolution.UNKNOWN` (L318-344) makes for tenant status, and
  for the same reason.
- Staff "clear table" deletes every `guest_session:{id}` key for that table session and marks the
  rows `REVOKED`, in that order (kill the fast path first).

### 8.4 Abandonment as a business signal

Cart abandonment on a QR surface is a real operational metric (guests who scanned, built a cart and
gave up usually did so because the menu was confusing or the wait was long). Emit
`GUEST_CART_ABANDONED` from the sweeper through the existing outbox so reporting can aggregate it.
→ **[swarm: cross-module integration gaps]** for the reporting-service fact-table side.

---

## 9. Entering the existing order pipeline

**Hard requirement: reuse, do not fork.** Concretely:

| Concern | Reused as-is |
|---|---|
| Order model | `orders`, `order_items`, `order_item_modifiers`, `order_discounts` — the same tables |
| Numbering | `OrderServiceImpl.generateOrderNo` + `order_sequences` |
| Pricing | `OrderPricingCalculator` — every method |
| State machine | `OrderStateMachine`, `OrderStatus`, `OrderStatusDerivationService` |
| KDS routing | `OrderServiceImpl.sendToKds` → `ORDER_SENT_TO_KDS` → `OrderSentToKdsConsumer` → `TicketRoutingService` |
| Payment | `PaymentServiceImpl.recordPayment` → `maybeCloseOrder` → `performClose` → `ORDER_CLOSED` |
| Tables | `TableService.syncStatusForOrder` — the single derivation seam |
| Events | `DomainEventPublisher` outbox. **Zero new event types for the kitchen.** |

`GuestOrderService` is a thin orchestrator, not a second implementation:

```java
@Transactional
public GuestOrderDto placeOrder(UUID guestSessionId, String idempotencyKey) {
    GuestSession s = requireActive(guestSessionId);          // §8.3
    GuestCart cart = requireNonEmptyCart(s);
    assertBranchOpen(s.branchId());                          // trading hours
    assertPerSessionOrderBudget(s);                          // §12 T-9

    // 1. Create through the SAME service, on a guest-specific entry point (see below).
    Order order = orderService.createGuestOrder(new CreateGuestOrderCommand(
            s.tenantId(), s.branchId(), s.tableId(),
            orderTypeFor(s.surface()), cart.coverCount(), s.id(), channelFor(s.surface())));

    // 2. Add every line through the SAME addItem path — server-side pricing, no exceptions.
    for (GuestCartItem line : cart.items()) {
        orderService.addItem(order.getId(), new AddOrderItemRequest(
                line.menuItemId(), s.branchId(), line.quantity(),
                line.modifierIds(), sanitize(line.notes())));   // §12 T-27
    }

    // 3. Fire according to policy — the SAME sendToKds.
    return switch (paymentMode(s)) {
        case FIRE_ON_STAFF_ACCEPT -> waitForAcceptance(order);
        case FIRE_FIRST           -> { orderService.sendToKds(order.getId(), idempotencyKey);
                                        yield toGuestDto(order); }
        case PAY_FIRST            -> createPaymentIntent(order);   // fires in the webhook, §6.3
    };
}
```

### 9.1 The one change needed in `OrderServiceImpl`

`createOrder` L190-201 reads `tenantContext.getUserId()` and, if present, sets `cashierId` and
binds an open till. For a guest token, `getUserId()` returns the **guest session id**, because
`JwtAuthenticationFilter` L59 sets it unconditionally from `sub`. That would write a guest session
id into `orders.cashier_id` (no FK — `V1__pos_schema.sql` L150 — so it would silently succeed) and
poison `listOrderSummaries`'s own-vs-all filter at L616-619.

So add a second entry point that never reads `getUserId()`, sharing a private seam so the two
cannot drift — the repo's own idiom, cf. `identityHeaders` in `JwtGlobalFilter` L207-213
(*"Extracted so the tenant-optional branch cannot drift from the tenant-bearing one"*):

```java
public OrderDto createOrder(CreateOrderRequest r)           { return newOrder(r, /*bindCashierAndTill*/ true); }
public OrderDto createGuestOrder(CreateGuestOrderCommand c) { return newOrder(c.toRequest(), false); }
```

`createGuestOrder` sets `cashier_id = NULL`, `till_session_id = NULL`,
`guest_session_id = <sub>`, `channel = QR_TABLE|KIOSK|ONLINE`.

Two knock-ons, both benign and both already handled by existing code:

- `PaymentServiceImpl.recordPayment` L92-97 refuses `CASH` without an open till → a guest order can
  never be settled in cash by the guest. Correct.
- `listOrderSummaries` L616-619 scopes to `cashierId` unless the caller holds `pos.order.view.all`.
  A guest order has `cashier_id = NULL`, so a cashier without the all-view permission would not see
  it. **Fix explicitly:** guest orders (`channel <> 'POS'`) are visible to any staff holding
  `pos.order.view` in the branch. Otherwise QR orders are invisible to the very people who must
  accept them — which is exactly the shape of the five outages `PermissionCatalogClosureTest`
  documents.

### 9.2 Nothing changes in kitchen-service

The KDS receives `ORDER_SENT_TO_KDS` with the same payload shape. `tableNumber` is already carried
(`OrderServiceImpl.sendToKds` L512-516) and is exactly what a QR order needs. **Optional additive
field:** `channel`, so the KDS can badge a ticket as kiosk/QR/online — additive only, and
`OrderSentToKdsConsumer` deserializes into its own `KitchenEventPayloads.OrderSentToKdsPayload`
record, which ignores unknown fields, so an additive field cannot break the consumer.

---

## 10. Data model

All new tables live in **pos_db** (pos-service owns tables, menu, orders and pricing — putting the
guest surface anywhere else would need cross-database reads). All money is `BIGINT` paisa. All
tenant tables get an RLS policy identical in shape to the existing ones — with the D4 caveat that
those policies are currently inert, which §17 makes a prerequisite to fix.

```sql
-- ── dining_table_qr ──────────────────────────────────────────────────────────
CREATE TABLE dining_table_qr (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    branch_id       UUID        NOT NULL,
    table_id        UUID        NOT NULL REFERENCES dining_tables(id),
    token_hash      TEXT        NOT NULL,          -- SHA-256 of the 160-bit token. Never the token.
    token_prefix    VARCHAR(8)  NOT NULL,          -- first 8 chars, for staff to identify a plate
    active          BOOLEAN     NOT NULL DEFAULT TRUE,
    rotated_from    UUID        REFERENCES dining_table_qr(id),
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_table_qr_hash UNIQUE (token_hash)   -- globally unique: the lookup has no tenant
);
CREATE UNIQUE INDEX uq_table_qr_active ON dining_table_qr (table_id) WHERE active;

-- ── kiosk_devices ────────────────────────────────────────────────────────────
CREATE TABLE kiosk_devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    branch_id       UUID        NOT NULL,
    label           VARCHAR(60) NOT NULL,
    role            VARCHAR(16) NOT NULL DEFAULT 'ORDER'
                    CHECK (role IN ('ORDER','DISPLAY')),
    token_hash      TEXT        NOT NULL,
    enrolment_code  VARCHAR(8),                    -- one-time, NULLed on use
    enrolment_expires_at TIMESTAMPTZ,
    active          BOOLEAN     NOT NULL DEFAULT TRUE,
    last_seen_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_kiosk_token UNIQUE (token_hash)
);

-- ── table_sessions ───────────────────────────────────────────────────────────
CREATE TABLE table_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    branch_id       UUID        NOT NULL,
    table_id        UUID        NOT NULL REFERENCES dining_tables(id),
    status          VARCHAR(12) NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN','CLOSED','ABANDONED')),
    cover_count     INT         NOT NULL DEFAULT 1,
    opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at       TIMESTAMPTZ,
    closed_by       UUID                            -- staff user id when force-closed
);
CREATE UNIQUE INDEX uq_open_table_session ON table_sessions (table_id) WHERE status = 'OPEN';

-- ── guest_sessions ───────────────────────────────────────────────────────────
CREATE TABLE guest_sessions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- == the JWT `sub`
    tenant_id         UUID        NOT NULL,
    branch_id         UUID        NOT NULL,
    surface           VARCHAR(12) NOT NULL CHECK (surface IN ('QR_TABLE','KIOSK','ONLINE')),
    table_session_id  UUID        REFERENCES table_sessions(id),
    table_id          UUID        REFERENCES dining_tables(id),
    kiosk_device_id   UUID        REFERENCES kiosk_devices(id),
    status            VARCHAR(10) NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE','EXPIRED','CLOSED','REVOKED')),
    ip_hash           TEXT,                          -- HMAC(ip, per-tenant pepper). Never raw IP.
    user_agent_hash   TEXT,
    orders_placed     INT         NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at        TIMESTAMPTZ NOT NULL,
    last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at        TIMESTAMPTZ,
    revoke_reason     TEXT
);
CREATE INDEX idx_guest_sessions_expiry ON guest_sessions (expires_at) WHERE status = 'ACTIVE';

-- ── guest_carts / guest_cart_items ───────────────────────────────────────────
CREATE TABLE guest_carts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL,
    branch_id         UUID        NOT NULL,
    table_session_id  UUID        REFERENCES table_sessions(id),
    guest_session_id  UUID        REFERENCES guest_sessions(id),
    status            VARCHAR(12) NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE','CONVERTED','ABANDONED')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_activity_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    converted_order_id UUID       REFERENCES orders(id)
);

CREATE TABLE guest_cart_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    cart_id         UUID        NOT NULL REFERENCES guest_carts(id) ON DELETE CASCADE,
    menu_item_id    UUID        NOT NULL REFERENCES menu_items(id),
    quantity        INT         NOT NULL CHECK (quantity BETWEEN 1 AND 99),
    modifier_ids    UUID[]      NOT NULL DEFAULT '{}',
    notes           VARCHAR(140),
    added_by_guest_session_id UUID REFERENCES guest_sessions(id),  -- who added it, for shared carts
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    -- NO PRICE COLUMN, DELIBERATELY. The cart stores intent; price is resolved at read and at
    -- placement by OrderPricingCalculator. A cached price here is a price that can go stale
    -- against a menu edit, and a column that exists is a column something will eventually trust.
);

-- ── guest_payment_intents ────────────────────────────────────────────────────
CREATE TABLE guest_payment_intents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    branch_id       UUID        NOT NULL,
    order_id        UUID        NOT NULL REFERENCES orders(id),
    guest_session_id UUID       REFERENCES guest_sessions(id),
    intent_ref      TEXT        NOT NULL,           -- 160-bit random; what the PSP echoes back
    psp             VARCHAR(24) NOT NULL,
    amount_paisa    BIGINT      NOT NULL CHECK (amount_paisa > 0),
    status          VARCHAR(12) NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','SUCCEEDED','FAILED','EXPIRED','MISMATCH')),
    psp_event_id    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    settled_at      TIMESTAMPTZ,
    CONSTRAINT uq_intent_ref UNIQUE (intent_ref)     -- globally unique: the lookup has no tenant
);

-- ── order_customer_details (online only) ─────────────────────────────────────
CREATE TABLE order_customer_details (
    order_id        UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    tenant_id       UUID        NOT NULL,
    customer_name   VARCHAR(120),
    customer_phone_enc TEXT,                        -- EncryptedStringConverter
    address_line    TEXT,
    address_notes   VARCHAR(240),
    geo_lat         NUMERIC(9,6),
    geo_lng         NUMERIC(9,6),
    status_token_hash TEXT NOT NULL,                -- SHA-256 of the opaque status token
    status_token_expires_at TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_status_token UNIQUE (status_token_hash)
);

-- ── menu_item_upsells ────────────────────────────────────────────────────────
CREATE TABLE menu_item_upsells (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    menu_item_id    UUID        NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    suggested_item_id UUID      NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    sort_order      INT         NOT NULL DEFAULT 0,
    CONSTRAINT uq_upsell UNIQUE (menu_item_id, suggested_item_id),
    CONSTRAINT chk_upsell_not_self CHECK (menu_item_id <> suggested_item_id)
);

-- ── branch_guest_config ──────────────────────────────────────────────────────
CREATE TABLE branch_guest_config (
    branch_id       UUID PRIMARY KEY,
    tenant_id       UUID        NOT NULL,
    qr_enabled      BOOLEAN     NOT NULL DEFAULT FALSE,
    kiosk_enabled   BOOLEAN     NOT NULL DEFAULT FALSE,
    online_enabled  BOOLEAN     NOT NULL DEFAULT FALSE,
    payment_mode    VARCHAR(24) NOT NULL DEFAULT 'FIRE_ON_STAFF_ACCEPT'
                    CHECK (payment_mode IN ('PAY_FIRST','FIRE_FIRST_PAY_AT_TABLE','FIRE_ON_STAFF_ACCEPT')),
    cart_mode       VARCHAR(12) NOT NULL DEFAULT 'SHARED'
                    CHECK (cart_mode IN ('SHARED','PER_GUEST')),
    service_charge_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
    max_order_value_paisa BIGINT NOT NULL DEFAULT 5000000,   -- Rs 50,000
    max_items_per_order   INT    NOT NULL DEFAULT 40,
    max_orders_per_session INT   NOT NULL DEFAULT 6,
    session_ttl_minutes    INT   NOT NULL DEFAULT 30,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 10.1 Changes to existing tables

```sql
ALTER TABLE orders
  ADD COLUMN channel VARCHAR(12) NOT NULL DEFAULT 'POS'
      CHECK (channel IN ('POS','QR_TABLE','KIOSK','ONLINE')),
  ADD COLUMN guest_session_id  UUID REFERENCES guest_sessions(id),
  ADD COLUMN table_session_id  UUID REFERENCES table_sessions(id),
  ADD COLUMN public_code       VARCHAR(8),
  ADD COLUMN guest_accepted_at TIMESTAMPTZ,
  ADD COLUMN guest_accepted_by UUID;

CREATE INDEX idx_orders_channel_branch ON orders (branch_id, channel, status);
CREATE UNIQUE INDEX uq_orders_public_code_day
  ON orders (branch_id, public_code, (created_at::date)) WHERE public_code IS NOT NULL;

-- New tenders (enum + CHECK constraint must move together)
ALTER TABLE order_payments DROP CONSTRAINT <existing_method_check>;
ALTER TABLE order_payments ADD CONSTRAINT chk_payment_method CHECK (method IN (
  'CASH','CARD','LOYALTY_POINTS','BANK_TRANSFER','VOUCHER','CHARGE_TO_ACCOUNT',
  'WALLET_JAZZCASH','WALLET_EASYPAISA','RAAST','KIOSK_TERMINAL'));
```

`channel` defaults to `'POS'` so every existing row is correct without a backfill.

### 10.2 The two SECURITY DEFINER lookups

Both are pre-tenant-context reads, both narrowly scoped to a single unique key, both modelled on
`031-device-resolve-fn.xml` — **including its deploy note**, which is the part that matters:

```sql
CREATE OR REPLACE FUNCTION resolve_guest_qr(p_token_hash TEXT)
RETURNS SETOF dining_table_qr
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM dining_table_qr WHERE token_hash = p_token_hash AND active $$;

CREATE OR REPLACE FUNCTION resolve_guest_payment_intent(p_intent_ref TEXT)
RETURNS SETOF guest_payment_intents
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM guest_payment_intents WHERE intent_ref = p_intent_ref $$;
```

> **DEPLOY GATE.** `SECURITY DEFINER` runs as the function OWNER and bypasses FORCE RLS only if the
> owner is a superuser or `BYPASSRLS`. The HR equivalent already carries this warning and a
> corresponding `deploy/init/05-hr-fn-owner.sql`. These two need the same treatment
> (`deploy/init/06-pos-guest-fn-owner.sql`), and it must be verified against a *production-shaped*
> role setup, not the Testcontainers harness where the migration role happens to be a superuser.
> That mismatch is already tracked as task #7 in this repo's task list.

Neither function takes a `tenant_id` argument, because at call time there is no tenant yet. Both
return exactly one row for a globally-unique high-entropy key and expose nothing else — the same
containment argument the HR function makes for serials.

---

## 11. API surface

`/api/v1/guest/**` → pos-service. New gateway route, declared **after** `guest-session-route` so
that route's tighter budget wins (the mechanism `platform-auth-route` depends on —
`application.yml` L159-173 explains it, and the ordering is load-bearing).

```yaml
# MUST stay declared BEFORE guest-route. Spring Cloud Gateway takes the first match, so declaration
# order IS the mechanism giving the mint its own budget — /api/v1/guest/sessions also matches
# guest-route's /api/v1/guest/** predicate. Moving this below silently removes the throttle.
# Same shape, same reason, as platform-auth-route (threat T-13-01-BF).
- id: guest-session-route
  uri: lb://pos-service
  predicates: [ Path=/api/v1/guest/sessions ]
  filters:
    - name: RequestRateLimiter
      args: { redis-rate-limiter.replenishRate: 1,
              redis-rate-limiter.burstCapacity: "${RATE_LIMIT_GUEST_MINT_PER_MIN:20}",
              key-resolver: "#{@ipKeyResolver}" }
    - name: CircuitBreaker
      args: { name: posCircuitBreaker, fallbackUri: 'forward:/fallback/service-unavailable',
              statusCodes: [503] }

# Also before guest-route: the PSP callback must not spend the guest browsing budget, and a PSP
# retry storm must not lock guests out of ordering.
- id: guest-payment-callback-route
  uri: lb://pos-service
  predicates: [ Path=/api/v1/guest/payments/callback ]
  filters:
    - name: RequestRateLimiter
      args: { redis-rate-limiter.replenishRate: 5,
              redis-rate-limiter.burstCapacity: "${RATE_LIMIT_GUEST_PSP_PER_MIN:300}",
              key-resolver: "#{@ipKeyResolver}" }
    - name: CircuitBreaker
      args: { name: posCircuitBreaker, fallbackUri: 'forward:/fallback/service-unavailable',
              statusCodes: [503] }

- id: guest-route
  uri: lb://pos-service
  predicates: [ Path=/api/v1/guest/** ]
  filters:
    - name: RequestRateLimiter
      args: { redis-rate-limiter.replenishRate: 3,
              redis-rate-limiter.burstCapacity: "${RATE_LIMIT_GUEST_PER_MIN:180}",
              key-resolver: "#{@ipKeyResolver}" }
    - name: CircuitBreaker
      args: { name: posCircuitBreaker, fallbackUri: 'forward:/fallback/service-unavailable',
              statusCodes: [503] }
```

Plus `RouteFeatureMap.PREFIX_TO_FEATURE.put("/api/v1/guest/", "FEATURE_GUEST_ORDERING")` and a new
`FEATURE_GUEST_ORDERING` in `TierFeatureDefaults` (`ALL_TIERS_ON` — QR ordering is table stakes,
not a premium upsell; and putting it in `GROWTH_AND_ABOVE` would mean STARTER tenants get a clean,
confident 403 that looks exactly like a bug). `FeatureCodeClosureTest` enforces this pairing.

> **Note on the gate.** The `RouteFeatureMap` entry gates `/api/v1/guest/**` only for
> **token-bearing** requests, because of D1. The two public paths are gated inside pos-service. Say
> so in the comment, or the next reader will believe the gate is universal — which is precisely how
> D1 came to exist.

### 11.1 Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/v1/guest/sessions` | **public** | `{qrToken}` \| `{deviceToken}` \| `{branchCode, orderType}` |
| POST | `/api/v1/guest/sessions/rotate` | guest | slides `exp`; requires an unexpired token |
| DELETE | `/api/v1/guest/sessions/current` | guest | end session (kiosk attract loop, "I'm done") |
| GET | `/api/v1/guest/menu` | guest | categories + active items + modifier groups; branch price resolved server-side |
| GET | `/api/v1/guest/menu/items/{id}` | guest | includes modifier groups with `required`/`min`/`max` |
| GET | `/api/v1/guest/cart` | guest | server-computed totals |
| POST | `/api/v1/guest/cart/items` | `guest.cart.write` | `{menuItemId, quantity, modifierIds[], notes}` |
| PATCH | `/api/v1/guest/cart/items/{id}` | `guest.cart.write` | quantity / notes only |
| DELETE | `/api/v1/guest/cart/items/{id}` | `guest.cart.write` | |
| POST | `/api/v1/guest/orders` | `guest.order.create` | `Idempotency-Key` **required** |
| GET | `/api/v1/guest/orders` | `guest.order.view` | orders on this table session |
| GET | `/api/v1/guest/orders/{id}` | `guest.order.view` | `ETag`; reduced DTO |
| GET | `/api/v1/guest/orders/by-token/{statusToken}` | **token-in-path** | online return path; opaque, hashed, expiring |
| POST | `/api/v1/guest/orders/{id}/pay` | `guest.payment.initiate` | creates an intent; returns a PSP redirect |
| POST | `/api/v1/guest/payments/callback` | **public** | HMAC-verified; the only thing that records a payment |
| GET | `/api/v1/guest/branches` | **public via mint** | online branch picker — see note |

**Note on the branch picker.** A public list of a tenant's branches is a mild information leak and a
scraping target. Serve it from the **Next.js server component** at build/ISR time via an internal
call, not as a public gateway endpoint. No new public path.

### 11.2 Staff-side additions

| Method | Path | Permission |
|---|---|---|
| POST | `/api/v1/pos/tables/{id}/qr` | `pos.tables.manage` — issue/rotate a QR, returns the token **once** |
| DELETE | `/api/v1/pos/tables/{id}/qr` | `pos.tables.manage` — revoke |
| POST | `/api/v1/pos/tables/{id}/clear-guests` | `pos.tables.manage` — revoke every guest session on the table |
| POST | `/api/v1/pos/orders/{id}/accept-guest` | `pos.order.send_to_kds` — the accept tap; calls the existing `sendToKds` |
| GET/POST | `/api/v1/pos/kiosks` | `pos.tables.manage` — kiosk registry |
| GET/PUT | `/api/v1/pos/guest-config` | `pos.menu.manage` — `branch_guest_config` |

All six need `permissions` catalog rows if they introduce new codes; the six above deliberately
reuse existing codes so they do not.

---

## 12. Threat model — the crux

**Assumption stated plainly.** Per D4, pos_db RLS is inert for pos-service. Every control below
that says "scoped by tenant" is **service-layer only** and has no database backstop. That is why
each row names a test.

### 12.1 Enumeration and discovery

| # | Threat | Control |
|---|---|---|
| **T-1** | Enumerate tables/tenants by guessing QR tokens | 160-bit `SecureRandom` token; stored SHA-256 hashed; `resolve_guest_qr` returns at most one row for an exact hash match. Mint failures return a **single** generic `GUEST_SESSION_UNAVAILABLE` with an identical body and a constant ~50 ms floor, whether the token is unknown, inactive, revoked, on a suspended tenant, or on a feature-disabled tenant. Guessing budget: 20/min/IP at the gateway plus a global mint-failure circuit (§13). **Test:** all five failure causes produce byte-identical responses. |
| **T-1b** | Enumerate via timing (hash lookup vs. tenant lookup vs. feature lookup) | The mint handler runs to a fixed minimum wall time before responding on **any** failure. Not perfect, but it removes the 3-order-of-magnitude signal between "no such hash" and "hash found, tenant suspended". |
| **T-11** | IDOR — read another guest's order by id | `GET /api/v1/guest/orders/{id}` filters on `(tenant_id, guest_session_id = sub OR table_session_id = session.table_session_id)`. A miss returns **404**, never 403 — a 403 confirms the order exists. **Test:** session A cannot read session B's order at a different table, and *can* read a co-diner's order at the same table. |
| **T-11b** | Enumerate orders via `public_code` | `public_code` is never a lookup key on any endpoint. The now-serving board is a staff/device surface (§7.2). **Test:** no controller method takes a `publicCode` parameter. |
| **T-21** | Scrape the menu for inactive items, station config, cost data | `GET /api/v1/guest/menu` returns a dedicated `GuestMenuDto` — `active` items only, no `kdsStation`, no `stationId`, no `taxRateCode`, no `createdBy`. **Test GS-03** pins the field set. Note `MenuServiceImpl.listItems` already filters to active (L100, L108); the risk is the DTO, not the query. |
| **T-22** | Harvest customer phone numbers via status lookup | Status lookup is by opaque hashed `status_token` only. No phone-number lookup exists. `order_customer_details.customer_phone_enc` is encrypted at rest and never returned to a guest DTO. |

### 12.2 Cross-tenant and cross-scope

| # | Threat | Control |
|---|---|---|
| **T-2** | Cross-tenant access with a guest token | `tenant_id` in the guest token comes from `dining_table_qr` / `kiosk_devices`, resolved server-side, never from the request. Gateway injects `X-Tenant-Id` from the signed claim. pos-service scopes every guest query on `tenantContext.requireTenantId()`. **Test:** mint against tenant A's QR, then attempt every guest endpoint with tenant B's menu-item / order / cart ids → 404 on all. |
| **T-3** | Cross-branch | `branch_id` likewise from the registry. `OrderServiceImpl.requireOwnBranch` (L557-563) already rejects a request branch that differs from the token branch, and the guest path passes the token branch. **Test:** a guest session for branch A cannot add branch B's branch-override-priced item. |
| **T-4** | Cross-table — order at table 5 from table 12's session | Every cart/order op asserts `order.table_session_id == session.table_session_id`. **Test:** two open table sessions in one branch; session A cannot add to, read, or pay B's cart or order. |
| **T-14** | Guest token used on a staff endpoint | Guest permissions are compiled in and contain no `pos.*`. All 50 `/api/v1/pos/**` mappings carry `@PreAuthorize` (§3.4, audited). **Test GS-01** enumerates them reflectively so a new unguarded endpoint fails the build. |
| **T-14b** | Staff token used on a guest endpoint to impersonate a session | Guest endpoints resolve the session by looking up `guest_sessions` **by the `sub` claim**. A staff `sub` is a `users.id` and matches no `guest_sessions` row → 401. Deliberately **not** keyed on a JWT `attributes` value, which would be a weaker binding. |
| **T-15** | Guest surface reachable on a tenant that has not bought it | Two independent gates: `RouteFeatureMap` → `FEATURE_GUEST_ORDERING` at the gateway (token-bearing requests), and an explicit `featureFlagService.isEnabled(tenantId, "FEATURE_GUEST_ORDERING")` call inside the mint handler (public path). **Test:** disable the flag → mint 403s **and** an already-minted token 403s at the gateway. Both halves, because D1 is exactly the case where only one half was believed to exist. |
| **T-16** | Suspended tenant still takes orders | `FeatureFlagGlobalFilter` handles token-bearing requests. The mint handler additionally calls `platformAdminClient.getStatus(tenantId)` and refuses anything but `ACTIVE`, **failing closed on an undetermined status** — matching `StatusResolution.UNKNOWN` (L318-344). **Test:** suspend the tenant → mint refused; and an in-flight guest token stops working at the gateway. |
| **T-30** | Redis key collision between guest limiters and tenant feature/quota keys | All guest keys are namespaced `guest:` (`guest:mint:{ipHash}`, `guest:sess:{id}`, `guest:table:{id}`, `guest:order:{sessionId}`). The existing shapes are `tenant:status:`, `tenant_features:`, `tenant:nlq_quota:`, `nlq_quota:`. **Test:** a constants-collision unit test over the prefix set. |

### 12.3 Money

| # | Threat | Control |
|---|---|---|
| **T-5** | Price tampering — client sends a price | No guest request DTO has a money field. Prices come from `OrderPricingCalculator.effectiveUnitPrice(menuItem, override)`. **Test GS-04:** reflect over every record in `dto/guest/` and fail if any field name matches `/(?i)paisa\|price\|amount\|total\|discount\|tax/`. This is the single highest-value test in the feature. |
| **T-5b** | Stale price — item repriced between cart-add and placement | `guest_cart_items` **has no price column** by design. Prices are resolved at cart-read and again at placement. If the total moves by more than `guest.price_drift_tolerance_paisa` (default 0) between the total the guest last saw (echoed back as an opaque signed `cartRevision`) and placement, the placement returns `409 PRICE_CHANGED` with the new total and requires re-confirmation. Never silently charge more than was displayed. |
| **T-6** | Discount / promo tampering | Guests hold no `pos.order.discount.*` authority and `GuestOrderService` never calls `applyDiscount`. Promotions, if enabled for guests, run through the existing `applyPromotions` seam (L336-375), which calls CRM server-side and **caps at subtotal** (L368). Coupon codes (if shipped) are validated server-side against CRM with a per-session redemption budget. |
| **T-7** | Quantity abuse — 0, negative, 10^9 | `guest_cart_items.quantity CHECK (BETWEEN 1 AND 99)` at the DB, `@Min(1) @Max(99)` at the DTO, and `branch_guest_config.max_items_per_order` (default 40) and `max_order_value_paisa` (default Rs 50,000) at placement. Three layers because `subtotal += unitPrice * quantity` in `recomputeOrderTotals` (L999) is a `long` multiply that a large enough quantity would overflow. **Test:** `Integer.MAX_VALUE` quantity is refused at the DTO, and a hand-built entity with a huge quantity is refused at placement. |
| **T-8** | Modifier price tampering / foreign modifiers | **Blocked on D3.** The fix: add `ModifierRepository` + `ModifierGroupRepository`; in `addItem`, load each `modifierId` and (a) assert it belongs to a `modifier_group` whose `menu_item_id` equals the line's item — otherwise 400; (b) assert it is `active`; (c) snapshot the real `name` and `price_delta_paisa`; (d) validate `required` / `min_select` / `max_select` per group. **Test:** attaching another item's modifier is refused; a required group omitted is refused; a `+Rs 50` modifier moves the line total by exactly 5000 paisa × quantity. |
| **T-17** | "Mark as paid" without paying | No guest endpoint records a payment. `PaymentServiceImpl.recordPayment` is reachable from the guest surface **only** from the PSP webhook handler, with the amount read from `guest_payment_intents.amount_paisa`. **Test:** `POST /api/v1/guest/orders/{id}/pay` returns an intent and changes no payment row; only a valid signed callback does. |
| **T-17b** | Forged PSP callback | HMAC-SHA256 over the **raw** body against a per-tenant webhook secret, `MessageDigest.isEqual`, verified before parsing. Plus `intent_ref` must exist and be `PENDING`, plus amount equality (§6.3 step 5e). A mismatch sets `status = MISMATCH` and alerts — it does not silently record a partial payment. **Test:** wrong signature → 401 and no payment row; right signature, wrong amount → 422, `MISMATCH`, no payment row. |
| **T-17c** | Replayed PSP callback | `IdempotencyService.checkAndLock("psp:" + pspEventId)` — the existing `DefaultIdempotencyService`, which also throws `IdempotencyConflictException` when the same key arrives with a different request hash. |
| **T-18** | Guest voids or refunds an order | `pos.order.void.*` and `pos.order.refund` are not in the guest permission set, and no guest endpoint calls `voidOrder` or `RefundService.refund`. Guest-initiated cancellation is a **request**, surfaced to staff, who void with their own authority and their own audit trail. |
| **T-26** | Paying someone else's bill | Within one table session this is a feature. Across table sessions it is refused by T-4's assertion. |
| **T-23** | Card data / PCI | The platform **never** sees a PAN. Card entry happens on the PSP's hosted page or on the bank terminal. No card field exists in any DTO or table. The kiosk browser must not host an iframe that accepts card data (that would pull the surface into PCI scope). |

### 12.4 Abuse and availability

| # | Threat | Control |
|---|---|---|
| **T-9** | Order spam — make the kitchen cook food for nobody | Primary: `FIRE_ON_STAFF_ACCEPT` is the default (§4.4), so nothing reaches the kitchen without a human tap. Secondary: `max_orders_per_session` (default 6), `max_order_value_paisa`, `max_items_per_order`. Tertiary: a per-table order budget (default 12/hour) and a per-branch guest-order rate that, when tripped, flips the branch to accept-only and raises an operator alert rather than failing silently. |
| **T-10** | Session farming — mint thousands of sessions from one QR | Per-IP mint limit at the gateway (20/min). Per-**table** mint limit in pos-service (default 10 concurrent `ACTIVE` sessions, 30 mints/hour). A table with 40 concurrent sessions is not a busy table. Exceeding it revokes the oldest sessions and alerts. |
| **T-10b** | Kiosk session inheritance — the next customer gets the last one's cart/session | 5-minute kiosk token TTL, 45-second attract loop that closes the session and clears the cart, and an explicit "Start new order" gesture. The session ends when the order is placed, not when the screen changes. |
| **T-13** | Replay of an expired or revoked guest token | `exp` is enforced at the gateway (`JwtGlobalFilter` L266-269). Revocation is enforced in pos-service via `GuestSessionFilter` (§8.3), **falling back to the DB, never to allow**, on a Redis outage. **Test:** revoke a session, then use its still-unexpired token → 401. |
| **T-24** | Rate-limit evasion / false positives on shared IPs | Pakistani mobile carriers CGNAT heavily — a whole neighbourhood can share one IP, so a purely per-IP limit is both evadable (botnet) and harmful (one busy restaurant's guests locking each other out). Hence the layering in §13: IP limits are coarse *availability* protection at the edge; the authoritative limits are per-session / per-table / per-branch inside pos-service, where the identity is real. |
| **T-25** | Idempotency-key collision or cross-session replay | Guest idempotency keys are namespaced with the session id: `guest:order:{guestSessionId}:{clientKey}`. A key from session A cannot replay into session B. Matches the existing `"sendToKds:" + orderId + ":" + clientFireId` namespacing (`OrderServiceImpl` L411-413). |
| **T-29** | Poisoning the outbox / downstream consumers with guest-controlled fields | The only guest-controlled strings that reach an event are `notes` (order and line). Sanitized (T-27) and length-capped before they are written. Everything else in `OrderSentToKdsPayload` is server-derived. |

### 12.5 Content and physical

| # | Threat | Control |
|---|---|---|
| **T-27** | Injection into KDS tickets and thermal printers via `notes` | Kitchen tickets go to a React UI (auto-escaped) **and** to ESC/POS printers, where raw control bytes are commands, not text. So: strip all C0/C1 control characters, normalise to NFC, allow-list to letters/digits/space/`.,!?()-/&'` and Urdu/Arabic script ranges, cap at 140 (line) / 240 (order) matching `UpdateInstructionsRequest.ITEM_NOTES_MAX_LENGTH` / `ORDER_NOTES_MAX_LENGTH`. Sanitize on **write**, so what is stored is what prints. → **[swarm: POS thermal printing]** must own the escaping contract; this design must not invent a second one. |
| **T-12** | Quishing — a malicious sticker over the real QR | Not preventable server-side. Contained by: (1) the platform never accepts card data, so the real flow never asks for a card on our page — staff can be trained on "we never ask for your card details on the menu page"; (2) tamper-evident printed plates rather than paper stickers, and a peel-test line in the opening checklist; (3) **detection** — a per-table scan-rate baseline, alerting when a table that normally sees N scans/day sees ~0 while its neighbours are normal, which is the signature of a covered code; (4) short-lived rotation capability so a compromised table can be reprinted in minutes; (5) the QR URL is on the tenant's own branded subdomain, so a wrong domain is visible in the URL bar. |
| **T-19** | Kiosk device token theft | Token stored hashed (SHA-256); shown once at enrolment; the enrolment code is single-use and expires in 15 minutes. `last_seen_at` per device; a token used from a second concurrent IP is flagged. Instant revoke from the back office. Blast radius is one branch's guest surface — the device token grants **no** staff authority. |
| **T-20** | Kiosk escape — a customer breaks out to the OS | Device-level lockdown (§5.2); the app contributes no external links, no `target=_blank`, no file inputs, and no `window.open`. A CSP with `frame-ancestors 'none'`, `form-action 'self'`, and no `unsafe-inline`. |
| **T-28** | CSRF against the guest surface | The guest token is a `Bearer` header held in memory, not a cookie, so classic CSRF does not apply — matching the existing pattern (`frontend/lib/api-client/client.ts` L20-27 and `proxy.ts` L18-19: *"The access JWT is never stored in a cookie (memory-only)"*). The token **must not** be moved to a cookie for the guest surface. Kiosk `localStorage` holds the *device* token only, which is never auto-sent. |

### 12.6 The four tests that would have caught the four defects

| Defect | The test that catches its class |
|---|---|
| D1 (dead feature gate) | `GuestFeatureGateIT` — flip `FEATURE_GUEST_ORDERING` off and assert a **real HTTP call** through the gateway is refused, on both the public and the token-bearing path. Not a unit test of the map. |
| D2 (unreachable transport) | `GuestStatusPollIT` — poll the status endpoint through the gateway and assert a 200 with a changing body. Any transport used by the guest surface must have an end-to-end test through the gateway, not against the service port. |
| D3 (dead modifiers) | `GuestModifierPricingIT` — add a `+Rs 50` modifier, assert `line_total_paisa` moves by exactly 5000 × qty and the KDS payload carries the modifier's **name**. |
| D4 (inert RLS) | `PosTenantIsolationIT` running as a **non-owner** role against FORCE-RLS tables, asserting a cross-tenant query returns zero rows at the database level. Currently impossible; see §17 P0. |

---

## 13. Rate limiting, in full

Four layers, because no single one is both evasion-resistant and false-positive-safe.

**L0 — nginx.** `deploy/nginx/nginx.conf` currently has **no** `limit_req` at all (I grepped:
zero occurrences). For a surface with no login this is the wrong starting point. Add:

```nginx
limit_req_zone $binary_remote_addr zone=guest_mint:10m rate=20r/m;
limit_req_zone $binary_remote_addr zone=guest_api:10m  rate=180r/m;
limit_conn_zone $binary_remote_addr zone=guest_conn:10m;

location = /api/v1/guest/sessions { limit_req zone=guest_mint burst=5  nodelay; ... }
location   /api/v1/guest/         { limit_req zone=guest_api  burst=40 nodelay;
                                    limit_conn guest_conn 20; ... }
```

This is the only layer that can shed load before it costs a Java thread.

**L1 — gateway.** The three routes in §11, all keyed on `ipKeyResolver`. Coarse; survives a
pos-service outage; cheap.

> **A note on a tempting refinement.** A `guestKeyResolver` reading the gateway-injected
> `X-User-Id` (which for a guest token is the session id) would give per-session limits at the
> edge. Whether the route-scoped `RequestRateLimiter` observes the request **mutated** by
> `JwtGlobalFilter` depends on Spring Cloud Gateway's merged filter ordering, and I have not
> verified it. **UNVERIFIED.** If someone wants it, it needs a test that mints two guest tokens
> from the same IP and asserts they get independent buckets. Until then, the authoritative
> per-session limits live at L2, where the fact is certain.

**L2 — pos-service, the authoritative layer.** After `GuestSessionFilter` has resolved a real
session, a Redis token bucket per dimension:

| Key | Limit (default, tenant-configurable) |
|---|---|
| `guest:sess:{sessionId}:req` | 120 req / min |
| `guest:sess:{sessionId}:order` | `max_orders_per_session` = 6 / session |
| `guest:table:{tableId}:mint` | 30 mints / hour, 10 concurrent ACTIVE |
| `guest:table:{tableId}:order` | 12 orders / hour |
| `guest:branch:{branchId}:order` | 300 orders / hour → trip to accept-only + alert |
| `guest:tenant:{tenantId}:mint` | 5,000 mints / hour → alert |

Fail-closed on a Redis outage for the **order** buckets (refuse, retryable 503), fail-open for the
**read** buckets (browsing a menu during a Redis blip should not break service). That asymmetry is
deliberate and should be written down where the code lives, because it will look like an
inconsistency to the next reader.

**L3 — behavioural.** Anomaly detection on the guest facts (mint rate per table, cart-to-order
conversion, average order value, decline rate) feeding the existing alerting. Not v1, but the data
model (`guest_sessions.ip_hash`, `orders_placed`) is shaped for it now so it does not need a
migration later.

---

## 14. Frontend design

The 4-layer rule (`frontend/eslint.config.mjs` L15-36) is enforced only on `components/**`:
a component may not import `@/lib/api-client/**` or `@/lib/repositories/**`, and must go through a
Layer-3 hook. The guest surfaces slot in without any exception:

```
frontend/
  app/(guest)/                        ← new route group, no auth shell, no sidebar
    layout.tsx                        ← tenant theming from the mint response
    t/[qrToken]/page.tsx              ← QR entry: mints, then redirects to the menu
    kiosk/page.tsx                    ← kiosk (attract loop, large targets)
    order/[branchCode]/page.tsx       ← online
    status/[statusToken]/page.tsx     ← online return path
  lib/
    api-client/guest-client.ts        ← L1: a SEPARATE axios instance (see below)
    repositories/guest.repository.ts  ← L2
    adapters/guest.adapter.ts
    api-client/schemas/guest.schema.ts← L3 zod schemas mirroring the guest DTOs
    hooks/guest/                      ← L3: use-guest-session, use-guest-menu,
                                         use-guest-cart, use-guest-order-status
  components/guest/                   ← L4: menu-browser, item-modifier-sheet, cart-sheet,
                                         upsell-prompt, order-status-card, attract-loop
```

**A separate `guest-client.ts`, not a mode on `apiClient`.** `frontend/lib/api-client/client.ts`
L36-57 has a response interceptor that, on 401, calls `refreshSession()` and then
`window.location.href = "/login?reason=session_expired"`. A guest hitting an expired session must
**never** be bounced to a staff login page — it is confusing, it leaks the existence of the back
office, and there is no credential to offer. The guest client's 401 handler re-mints from the
stored `qrToken` / `deviceToken` (once), and otherwise shows "This session has ended — please scan
again."

`proxy.ts` `PROTECTED` is `["/platform", "/app"]` and its `matcher` covers `/login`, `/platform/*`,
`/app/*`, `/dashboard*`. `/t/*`, `/kiosk`, `/order/*`, `/status/*` are outside both, so **no
middleware change is needed** — the guest routes are already unprotected. Worth stating explicitly
in a comment, because a future reader adding `"/order"` to `PROTECTED` would silently break every
QR scan.

The guest token lives in a React context in memory only, mirroring `getSession()`. Never a cookie
(T-28). Kiosk `localStorage` holds the *device* token only.

→ **[swarm: frontend component stack]** and **[swarm: UI/UX visual direction]** own the actual
component library and visual system; this section only fixes the layering and the routing.

---

## 15. Tenant configurability

Two levels, matching the existing split described in
`.planning/research/erp-completion/tenant-configurability.md`: platform-level entitlement
(SuperAdmin, `tenant_features`, `is_override`) and tenant-level settings (Tenant Admin).

**Platform (SuperAdmin):** `FEATURE_GUEST_ORDERING` in `TierFeatureDefaults.ALL_TIERS_ON`,
individually overridable per tenant via the existing
`PATCH /api/v1/platform/tenants/{id}/features/{code}` which sets `is_override = true`.

**Tenant Admin (`branch_guest_config`, per branch):**

| Setting | Default | Why it is a setting |
|---|---|---|
| `qr_enabled` / `kiosk_enabled` / `online_enabled` | all `false` | Off by default. A customer-facing surface that turns itself on is a surprise nobody wants. |
| `payment_mode` | `FIRE_ON_STAFF_ACCEPT` | The safe mode (§4.4). |
| `cart_mode` | `SHARED` | Full-service default; bars want `PER_GUEST`. |
| `service_charge_pct` | 0 | Table service charge on QR orders is a live commercial question per venue. |
| `max_order_value_paisa` | 5,000,000 (Rs 50,000) | Abuse ceiling that a fine-dining venue legitimately needs raised. |
| `max_items_per_order` | 40 | Same. |
| `max_orders_per_session` | 6 | Same. |
| `session_ttl_minutes` | 30 (QR/online), 5 (kiosk, not configurable) | Kiosk is fixed because a long TTL on an unattended public device is a security decision, not a preference. |
| `order_ready_label` | `ORDER_NUMBER` | Square-style choice of number / name / table (§2.2). |
| `upsell_enabled` | `true` | |
| `price_drift_tolerance_paisa` | 0 | T-5b. |
| PSP + webhook secret | none | Per tenant; the secret is stored via `EncryptedStringConverter`. |

**Explicitly not configurable:** whether prices come from the server, whether the PSP webhook
signature is verified, whether tenant scoping applies, and the kiosk token TTL. A setting that can
disable a security control is a security control that does not exist.

---

## 16. What I could not verify

Stated plainly, because the failure mode this project keeps hitting is confident-sounding design
built on an unchecked assumption.

1. **Whether the gateway's `RequestRateLimiter` sees the request mutated by `JwtGlobalFilter`.**
   Determines whether a per-guest-session limiter is possible at the edge (§13 L1). Experiment:
   two guest tokens, one IP, assert independent buckets. *Mitigated by putting the authoritative
   limits at L2.*

2. **Whether a long-lived response survives `posCircuitBreaker`'s 5 s time limiter**
   (`gateway/src/main/resources/application.yml` L540-543). Determines whether SSE is viable
   (§7.3). The KDS WebSocket runs under an identically configured `kitchenCircuitBreaker` and is
   believed to work, which makes the answer genuinely unclear. Experiment: `curl -N` an SSE
   endpoint through the gateway and time the disconnect. *Mitigated by shipping polling.*

3. **Whether the KDS WebSocket actually works through the gateway today.** D2 shows the POS one
   cannot. `/api/v1/kitchen/` *is* in `WS_UPGRADE_PATHS`, so it should — but "should" is what D2 was
   too. Worth an actual browser check before §7.2 depends on it.

4. **Whether `pos_user` truly owns the pos tables in a real deployment.** I inferred it from
   `deploy/init/02-create-roles.sql` L43 + Flyway running as `pos_user`
   (`application.yml` L11-12) + `OrderServiceImpl.listOrders` L573-575 asserting RLS is inert.
   Confirm with `\dt` ownership against a real `pos_db`. It changes how urgent §17 P0 is.

5. **PSP contracts.** I did not read a JazzCash/Easypaisa/Raast API specification. Webhook payload
   shape, signature algorithm, retry semantics and refund API are all assumed to follow the common
   pattern (HMAC over raw body, at-least-once retry, idempotent by event id). **Every one of those
   must be verified against the chosen provider's docs before implementation**, and the design
   deliberately isolates them behind a `GuestPaymentProvider` interface so a wrong assumption costs
   one adapter, not the feature.

6. **Whether `FeatureFlagAspect`'s `@RequiresFeature` behaves correctly on a guest token.** It
   calls `tenantContext.requireTenantId()` (L20), which is populated by
   `JwtAuthenticationFilter` from the `tenant_id` claim — so it should work identically. Untested
   with a permission-less token, and D1 is a reminder that "should work identically" has been
   wrong here before.

7. **Load characteristics.** No numbers. A 40-table venue at 5 s polling is ~8 req/s of mostly-304
   traffic, which is nothing — but I have not measured pos-service's actual per-request cost, and
   `GuestSessionFilter` adds a Redis round-trip to every guest request. → **[swarm: testing
   strategy]** for where a load test belongs.

---

## 17. Phasing and effort

**P0 — prerequisites (must land before any guest surface).**

| Item | Why it is a prerequisite | Days |
|---|---|---|
| Fix D3: modifier repositories, server-side pricing, group validation | A kiosk without priced modifiers is a revenue leak, and the KDS prints UUIDs | 3 |
| Fix D4: `FORCE ROW LEVEL SECURITY` on pos_db + a non-owner runtime role | Service-layer-only isolation on a public surface is one missing `WHERE` from a breach | 4 |
| Fix D1's class: make `FeatureFlagGlobalFilter` log loudly when it skips, and add the `/iclock` gate where it actually runs | Otherwise the same hole is re-dug for guests | 1 |
| Optional: segment-boundary `isPublicPath` (§3.6) | Makes the childless-public-path rule structural | 0.5 |

**P1 — the guest platform (shared by all three surfaces).** Guest token minting
(`signGuestToken` + `/internal/auth/guest-token`), `guest_sessions`, `GuestSessionFilter`,
revocation, `guest_carts`, `GuestOrderService`, `createGuestOrder` seam, the gateway routes,
`FEATURE_GUEST_ORDERING`, the `guest.*` catalog, `branch_guest_config`, the sweeper, and the tests
GS-01…GS-04. — **8 days**

**P2 — QR-at-table.** `dining_table_qr`, issue/rotate/revoke, table sessions, shared carts, the
staff accept flow, the `(guest)/t/[qrToken]` frontend, adaptive status polling. — **6 days**

**P3 — Kiosk.** `kiosk_devices`, enrolment, the `(guest)/kiosk` surface, modifier and upsell UI,
attract loop, `public_code`, terminal/wallet tender. — **6 days**

**P4 — Online ordering.** `guest_payment_intents`, the PSP adapter + signed webhook,
`order_customer_details`, status tokens, the branch picker, pay-first fire. — **7 days**

**P5 — Hardening and observability.** Timing-equalised mint failures, anomaly detection, the QR
scan-rate alert, `GUEST_CART_ABANDONED` reporting, load test. — **3 days**

**Total: ~38.5 days** (P0 8.5 + P1 8 + P2 6 + P3 6 + P4 7 + P5 3).

P2, P3 and P4 are independent once P1 lands and can run in parallel. P0 cannot be deferred: D3 and
D4 are each sufficient on their own to make the feature either lose money or leak data.

---

## Appendix: cross-references to the parallel swarm

| Topic | Why this design depends on it |
|---|---|
| **FBR e-invoicing** | Guest orders are real sales. `WALLET_JAZZCASH` / `WALLET_EASYPAISA` / `RAAST` tenders and the `channel` field must appear correctly on the invoice, and an online order with a delivery address may have different invoicing requirements than a dine-in one. |
| **POS thermal printing** | Owns the ESC/POS escaping contract that T-27's sanitizer must match. Also owns kiosk receipt printing and the customer-copy layout with `public_code`. |
| **ERP module gaps** | `FEATURE_ECOMMERCE` already exists as a defined-but-unbuilt code; whether `FEATURE_GUEST_ORDERING` should subsume or sit beside it is a module-taxonomy decision. |
| **Cross-module integration gaps** | `GUEST_CART_ABANDONED` and channel-attributed revenue need reporting-service fact tables. CRM linkage (an online customer's phone → a `crm` customer record) is a genuine integration, not a pos-service concern. |
| **UI/UX visual direction** | Owns the guest visual system: a customer-facing surface must look like the *restaurant*, not like the back office. |
| **Frontend component stack** | Owns what `components/guest/**` is built from. |
| **Tenant configurability** | `branch_guest_config` must fit the settings taxonomy that research defines, not invent a parallel one. |
| **Testing strategy** | Owns where GS-01…GS-04 and the four defect-class tests live, and where the load test runs. |

---

## Sources

- [USPTO 12561730 — Collaborative and independently re-entrant transient order session management](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12561730)
- [Restolabs — Restaurant QR code table ordering guide](https://www.restolabs.com/blog/restaurant-qr-code-table-ordering-guide)
- [Jamezz — QR ordering implementation guide](https://jamezz.com/blog/qr-ordering-implementation-guide)
- [Square — QR code ordering for restaurants](https://squareup.com/us/en/online-ordering/qr-code-ordering)
- [Square — Customize self-serve ordering with Square Kiosk](https://squareup.com/help/us/en/article/8313-customize-self-serve-ordering-with-square-kiosk)
- [Toast — Restaurant self-ordering kiosks](https://pos.toasttab.com/hardware/restaurant-kiosk)
- [Toast — Kiosk: placing orders, making payments and tipping](https://support.toasttab.com/en/article/Kiosk-Placing-Orders-Making-Payments-and-Tipping)
- [Cybernexora — QR code phishing attacks: quishing scams in 2026](https://blog.cybernexora.com/qr-code-phishing-attacks-quishing-scams-2026/)
- [2b1 — Scan with caution: how fake QR codes turn convenience into a cyber risk](https://2b1inc.com/scan-with-caution-how-fake-qr-codes-turn-convenience-into-a-cyber-risk/)
- [arXiv 2204.04086 — Gone quishing: a field study of phishing with malicious QR codes](https://arxiv.org/pdf/2204.04086)
- [XSTAK — Best online payment gateways in Pakistan 2026](https://www.xstak.com/blog/payment-gateways-in-pakistan)
- [Rapid Gateway — Best payment gateway in Pakistan (2026)](https://rapidgateway.pk/resources/best-payment-gateway-pakistan)
