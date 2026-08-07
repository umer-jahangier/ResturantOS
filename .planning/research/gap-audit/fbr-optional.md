# FBR Digital Invoicing as an OPTIONAL, per-tenant capability

**Date:** 2026-08-07 · **Author:** gap-audit agent · **Scope:** optionality + tax-authority abstraction
**Prerequisite reading:** `.planning/research/erp-completion/fbr-api.md` (the PRAL API research) and
`.planning/research/erp-completion/fbr-integration-design.md` (the integration design). This document
does **not** repeat the endpoint, payload or retry research done there. It answers three questions
those documents deliberately left open:

1. How does FBR become an *optional* capability that a non-registered tenant never notices?
2. How is the tax **authority** abstracted so SRB (Sindh) and PRA (Punjab) can be added without rework?
3. Where do the QR code and the FBR invoice number actually land, given what this repo has today?

It also **corrects three recommendations** in `fbr-integration-design.md`: putting `hsCode`/`uoM`/
`saleType` directly on `MenuItem` (§3.8 — the single biggest rework trap in the plan; see §4.3 R2),
naming the tables and the feature flag after FBR (§3.2/§3.3/§3.4; see §4.3 R1), and defaulting a
saved credential to `active = TRUE` (§3.2; see §4.4).

---

## 0. Epistemic status

| Marker | Meaning |
|---|---|
| **[LIVE]** | Observed against the running app on 2026-08-07: HTTP status, response body, or console/network log. Reproducible. |
| **[REPO]** | Read directly in this repository, with file and line. |
| **[DESIGN]** | My proposal. Not built. Argued, not asserted. |
| **[UNVERIFIED]** | Inherited from the prior research as unresolved. Not re-litigated here. |

Environment note: `POST /api/v1/auth/login` began returning **HTTP 503** through the gateway partway
through this session while every other gateway route (`/api/v1/branches`, `/api/v1/pos/menu/items/admin`,
`/api/v1/feature-flags`) continued to return **200** with a token minted before the wedge. `.dev-logs/auth-service.log`
shows a `NoClassDefFoundError: ch.qos.logback.classic.spi.ThrowableProxy` startup failure and
`.dev-logs/gateway.log` shows `NoClassDefFoundError: io/netty/util/concurrent/DefaultPromise$1` —
i.e. jars replaced under running JVMs by a concurrent build. This is the known stale-lease / restart
class of issue, noted and moved past as instructed. All **[LIVE]** evidence below was captured while
the path was healthy, and every one of it is re-checkable with a fresh token.

---

## 1. Jurisdiction: why FBR is the correct authority *for this client*, and why that must be data

**Floating Terrace's first branch is in F-7, Islamabad.** F-7 is in the **Islamabad Capital Territory
(ICT)**, not in a province. That single fact is what makes FBR the right integration here, and the
reasoning must be recorded because it does not generalise.

Pakistan splits sales tax by subject matter and by territory:

| Subject | Territory | Authority |
|---|---|---|
| Sales tax on **goods** | Federal, everywhere | **FBR** |
| Sales tax on **services** | **Islamabad Capital Territory** | **FBR** (under the ICT (Tax on Services) Ordinance 2001) |
| Sales tax on **services** | Sindh | **SRB** — Sindh Revenue Board |
| Sales tax on **services** | Punjab | **PRA** — Punjab Revenue Authority |
| Sales tax on **services** | Khyber Pakhtunkhwa | **KPRA** |
| Sales tax on **services** | Balochistan | **BRA** |

A restaurant meal is a **service**. In Karachi that is SRB's. In Lahore that is PRA's. In F-7
Islamabad there is no provincial revenue authority, so services fall to FBR — which is why FBR
Digital Invoicing is the correct and sufficient sales-side integration **for Floating Terrace and
for no other jurisdiction by default**.

Two consequences that must be built in, not remembered:

- **A Karachi or Lahore tenant needs a different integration.** SRB and PRA run their own restaurant
  invoice-monitoring systems with their own specs, endpoints and credentials
  (`fbr-api.md` §10, marked **[HEARSAY]** there — the provincial APIs were not researched). Filing a
  Lahore restaurant's service sales to FBR would be filing them with the wrong authority.
- **FBR still matters for every tenant on the *purchase* side.** Vendor invoices for goods are
  federal wherever the restaurant is. The existing `FbrTaxSummary` report
  (`services/reporting-service/.../service/FbrTaxSummaryService.java`) is a bookkeeping aggregation
  of exactly that and is **out of scope** of everything below — it is not an integration and does
  not change.

**The system today cannot express any of this.** [REPO] `grep -rn "province\|jurisdiction\|taxAuthority"`
across every `*.java` under `services/` (excluding `target/` and tests) returns **0 hits**. There is
no province field, no jurisdiction field, no authority concept anywhere. `BranchEntity` carries
`address` as untyped `jsonb` (`services/user-service/src/main/java/io/restaurantos/user/entity/BranchEntity.java:36`)
and [LIVE] `GET /api/v1/branches` → 200 shows `"address": null` on **both** Floating Terrace branches.
So there is not even an address to infer a province from.

That is not a cosmetic gap. `sellerProvince` is a **mandatory** field in the DI `postinvoicedata`
payload (`fbr-api.md` §6, error 0074), and the choice of authority is upstream of every other
decision in this document.

### 1.1 The rate data already proves the point

[LIVE] `GET /api/v1/pos/menu/items/admin` → **200**, 78 items. Distinct values:

```
taxRatePct   : {16.00: 68 items, 13.00: 10 items}
taxRateCode  : {null: 78 items}
```

Two different tax rates on one Islamabad branch's menu, and **not one of the 78 items records which
authority levies either rate**. `tax_rate_code` — the column that exists precisely for this
(`services/pos-service/src/main/java/io/restaurantos/pos/domain/model/MenuItem.java:37-38`) — is null
everywhere. A bare percentage with no authority is not filable: FBR wants the rate as a string
(`"18%"`) tied to an HS code and a sale type; PRA and SRB want their own service classification.

**A rate without an authority is the bug.** Fixing that is the first move of the abstraction, and it
has value even for a tenant who never fiscalises anything, because it is what makes the existing
tax numbers mean something.

And neither field is reachable through the UI. [REPO] `MenuItemAdminDtos.java:16-23` and `:29-36`
(`CreateMenuItemRequest`, `UpdateMenuItemRequest`) both accept `taxRatePct` **and** `taxRateCode`, and
`MenuServiceImpl.java:177-178,203-204` persists them — but `frontend/components/menu/MenuItemFormDialog.tsx`
(229 lines) contains **0 occurrences of "tax"**. The tax rate that decides what every customer pays,
and the code that would carry the fiscal taxonomy, are settable only by `curl` or the seeder. That is
the same "backend built, no UI" shape as `TableController`, on the field an invoice is built from.

---

## 2. The requirement, precisely

**Floating Terrace is not currently FBR-registered.** They hold no PRAL bearer token, no STRN for
digital invoicing. So:

| Tenant state | Required behaviour |
|---|---|
| Has PRAL credentials, ICT branch | Every closed sale is fiscalised. Receipt carries the FBR invoice number + QR. |
| **No credentials** (Floating Terrace today) | Uses the system **fully**. No degraded path, no disabled buttons, no empty FBR panel, no "not configured" banner on the till, no nav item that leads nowhere. |
| Credentials later | Turning it on is a per-branch action by the owner. No migration, no redeploy, no support ticket. |

The second row is the hard one. "Optional" in most systems means *present but greyed out*, which is
exactly the dead UI the user already complained about. The standard here is stronger: **an
unregistered tenant must not be able to tell the feature exists.**

---

## 3. What the running system actually does today

Everything in this section is evidence, not impression.

### 3.1 The seller's own NTN/STRN cannot be written. At all. [LIVE + REPO] — BLOCKER

`BranchEntity` persists `fbr_strn` and `ntn`
(`services/user-service/src/main/java/io/restaurantos/user/entity/BranchEntity.java:39-43`) and
`BranchResponse` returns both (`services/user-service/src/main/java/io/restaurantos/user/dto/BranchDtos.java:38`).
It looks like a round-trip. It is not:

- `CreateBranchRequest` — `BranchDtos.java:14` — fields: `name, isHq, address, phone, email, timezone,
  currencyConfig, receiptConfig, openedOn`. **No `ntn`. No `fbrStrn`.**
- `UpdateBranchRequest` — `BranchDtos.java:26` — same list. **No `ntn`. No `fbrStrn`.**
- `BranchService.update` — `services/user-service/src/main/java/io/restaurantos/user/service/BranchService.java:116-133`
  — copies nine fields. Neither `ntn` nor `fbrStrn` is among them, because neither is on the request.

[LIVE] proof:

```
PUT /api/v1/branches/34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03   {"ntn":"1234567-8"}
→ HTTP 200
→ body: {... "fbrStrn": null, "ntn": null ...}
GET /api/v1/branches/34cd6f62-...   → HTTP 200, "ntn": null
```

**The write is accepted with a 200 and silently discarded.** This is worse than a 400. A UI built
against this endpoint would show a success toast and lose the data.

This is a *third* failure mode beyond the two already confirmed for this audit — not "backend built,
no UI" (`TableController`) and not "no backend either" (menu item images), but **backend half-built
and lying about it**: the read path exists, the write path does not, and the API reports success.

Nor is there a UI: [REPO] `frontend/lib/repositories/branch.repository.ts:8` calls exactly one branch
endpoint, `GET /api/v1/branches/mine`. There is no branch create or update anywhere in the frontend.
Of the 26 frontend references to `ntn`/`fbrStrn`, every one is either the **vendor's** NTN
(`frontend/components/purchasing/VendorFormDialog.tsx`, editable) or a read-only display on the FBR
tax-summary report (`frontend/components/reporting/FbrTaxSummaryCard.tsx`). **You can record your
supplier's NTN. You cannot record your own.**

Since `sellerNTNCNIC` is the identity the PRAL token is bound to (`fbr-api.md` §4.1), this blocks FBR
onboarding outright.

### 3.2 There is no printed receipt anywhere in this system [REPO] — BLOCKER

- `grep -rn "window\.print\|@media print" frontend/app frontend/components frontend/lib` → **0 hits**
- `grep -rn "[Rr]eceipt" services/pos-service/src/main/java` → **0 hits**
- `frontend/components/pos/charge-summary.tsx` — 484 lines, the entire settlement surface — contains
  neither "receipt" nor "print"

A sale closes and the customer gets nothing. The QR code and the FBR invoice number have **no
destination**. This is the largest single dependency of the whole feature, and it is why §5 puts the
receipt document ahead of the FBR client in the build order.

`fbr-integration-design.md` §2.11 also confirms no QR library exists; re-verified: `grep -rn "zxing\|qrcode\|QRCode"`
across every `pom.xml` and `package.json` (excluding `node_modules`) → **0 hits**.

### 3.3 Feature flags work, and nobody can operate them through the UI [LIVE + REPO]

[LIVE] `GET /api/v1/feature-flags` → **200**, 20 codes for Floating Terrace (ENTERPRISE):
`FEATURE_ANALYTICS, AUDIT_EXPORT, CONSOLIDATED_REPORTING, CRM, CUSTOM_ROLES, ECOMMERCE, FINANCE, HR,
INVENTORY, KDS, LOT_TRACKING, LOYALTY, MULTI_BRANCH, NLQ, PAYROLL, POS, REPORTING_ADVANCED, VENDOR,
WHATSAPP_NOTIFICATIONS, WHITE_LABEL_DOMAIN`. No fiscalisation code, as expected.

The write path is SuperAdmin-only:
`services/platform-admin-service/src/main/java/io/restaurantos/platform/controller/PlatformAdminController.java:35`
`@PreAuthorize("hasAuthority('SUPER_ADMIN')")` on the whole class, with
`PATCH /tenants/{tenantId}/features/{featureCode}` at line 192.

But the SuperAdmin has no UI for it. [REPO] `frontend/components/shared/sidebar-nav-items.ts:354-361`
declares a **Tenants** nav item at `/platform/tenants` with **no `comingSoon` flag** — and
`frontend/app/(platform)/` contains only `layout.tsx` and `platform/dashboard/page.tsx`. There is no
`platform/tenants` route. Clicking it 404s. And `platform/dashboard/page.tsx` is **9 lines** —
literally `<h1>Platform Dashboard</h1>` plus "SuperAdmin shell placeholder."

**Consequence for this design:** the entitlement switch is real in the backend and unreachable in
practice. Any plan that says "SuperAdmin enables the flag" is describing a `curl`.

### 3.4 The tenant-facing settings surface does not exist [REPO]

`find frontend/app -name page.tsx` returns exactly **one** settings page: `(tenant)/settings/appearance/page.tsx`.
The sidebar declares `/app/settings` ("General", `comingSoon: true`,
`sidebar-nav-items.ts:328-335`) and `/app/settings/users` ("Users", `comingSoon: true`, lines 343-349)
— both hidden, both unbuilt. There is nowhere for an FBR settings page to live.

### 3.5 Field encryption exists and is the right tool [REPO]

**The class is `io.restaurantos.shared.security.EncryptionService`, applied through the JPA converter
`io.restaurantos.shared.security.EncryptedStringConverter`.**

| File | What it is |
|---|---|
| `shared-lib/src/main/java/io/restaurantos/shared/security/EncryptionService.java` | AES-GCM. `AES/GCM/NoPadding`, 12-byte IV from `SecureRandom` (line 11), 128-bit tag (line 12). Ciphertext layout `IV ‖ ct+tag` in one `byte[]` (line 30). Key from base64 (line 17). `encrypt(null)`/`decrypt(null)` → `null`. Failures throw `IllegalStateException`. |
| `shared-lib/src/main/java/io/restaurantos/shared/security/EncryptedStringConverter.java` | `AttributeConverter<String, byte[]>`, wired by a **static** `init(EncryptionService)` (line 10). |
| `shared-lib/src/main/java/io/restaurantos/shared/config/EncryptionAutoConfiguration.java` | `@ConditionalOnProperty(name = "restaurantos.encryption.key")` (line 11) — opt-in. |

**The footgun is real and unmitigated in the converter itself.** `EncryptedStringConverter.convertToDatabaseColumn`
(line 16-17) calls `encryptionService.encrypt(attribute)` with **no null check**. If
`restaurantos.encryption.key` is unset, the autoconfiguration is skipped, the static stays `null`, and
the first write throws `NullPointerException` — at runtime, during a sale.

The fix already exists as a copyable precedent:
`services/purchasing-service/src/main/java/io/restaurantos/purchasing/config/EncryptionRequiredConfig.java`
— a `BeanFactoryPostProcessor` that checks the property **and** the bean and refuses to start, and
whose javadoc documents both failure modes (unset vs. blank-string, which `@ConditionalOnProperty`
treats as *satisfied*). pos-service must gain the equivalent before it stores a fiscal token.

Structural precedent for the field itself:
`services/hr-service/src/main/java/io/restaurantos/hr/entity/AttendanceDeviceEntity.java:53` —
`@Convert(converter = EncryptedStringConverter.class)` on a `bytea` column holding a device shared
secret. A PRAL bearer token is the same shape of thing: long-lived, externally issued, per-tenant.

### 3.6 TOTP step-up is a signed claim, and its list has a trap [REPO]

`AuthServiceImpl.requiresTotpStepUp` (`services/auth-service/.../service/AuthServiceImpl.java:549-554`)
challenges a login when the user holds `rbac.manage` **or** `finance.period.close` **or**
`hr.payroll.approve` (or already has TOTP enabled). The javadoc above it (lines 529-548) states the
invariant plainly: a permission gated downstream but **missing** from this list produces a holder who
"can therefore never perform the action"; a permission listed here but gated nowhere "is pure
friction". It also names the specific hazard — adding a code that MANAGER or CASHIER holds throws
`TotpEnrollmentRequiredException` **at every manager and cashier login**, because those personas are
seeded without a TOTP secret.

Downstream, the enforcement pattern is
`services/finance-service/src/main/java/io/restaurantos/finance/web/PeriodController.java:83`:

```java
@RequestHeader(value = "X-TOTP-Verified", defaultValue = "false") boolean totpVerified
```

written by the gateway from the signed `totp_verified` JWT claim, with any inbound copy stripped
first (`gateway/.../filter/StripInternalHeaderFilter.java:41-49`). That is the template for gating a
fiscal-credential write.

### 3.7 Build-enforced closure tests that a new feature must satisfy [REPO]

Three separate mechanisms will fail the build if this feature is added carelessly. All three exist
because the corresponding bug already shipped:

1. **Feature-code closure.** `services/platform-admin-service/.../config/TierFeatureDefaults.java:20-22`
   — the tier sets must stay closed over `gateway/.../support/RouteFeatureMap.java`, and codes must be
   written in that file's *comments* only in split form (`"FEATURE_" + "X"`) because
   `frontend/__tests__/lib/nav-feature-flags.test.ts` regex-scrapes it for `/FEATURE_[A-Z_]+/`.
2. **Frontend flag mirror.** `frontend/lib/features/feature-flags.ts` holds a `const` array of the
   same 20 codes and derives `type FeatureFlag` from it, so a nav item gated on a code the backend
   never grants is a **compile** error. Its header names the actual incident: the phantom
   `"FEATURE_" + "PURCHASING"` flag, UAT 2026-07-13.
3. **Audit allow-list closure.** `shared-lib/src/main/java/io/restaurantos/shared/event/AuditEventCatalog.java`
   — `MUST_AUDIT` and `NOT_AUDIT_RELEVANT`, compared mechanically against publishers by
   `AuditAllowListClosureTest`. Its javadoc records that four of eight allow-listed types were
   published by no service at all, including voids and refunds.

Note for §4.3: `/api/v1/pos/` is **not** in `RouteFeatureMap` (lines 35-50 list finance, purchasing,
hr, iclock, crm, nlq, payroll, analytics, loyalty, kds, kitchen, ecommerce, inventory — not pos).
So a pos-hosted fiscal controller must gate with the `@RequiresFeature` aspect, which is a live,
used pattern — nine usages in purchasing-service, e.g. `VendorController.java:23`.

---

## 4. Design

### 4.1 The core idea: three switches, not one

The single biggest structural error available here is conflating the commercial question ("has this
tenant bought fiscalisation?") with the factual question ("which authority governs this branch?")
with the operational question ("do we have a working token today?"). They have different owners,
different lifecycles and different failure modes.

| # | Switch | Stored where | Operated by | Semantics |
|---|---|---|---|---|
| 1 | **Entitlement** | `tenant_features(tenant_id, 'FEATURE_FISCAL_INVOICING')` in `platform_db` | **SUPER_ADMIN only** (`PlatformAdminController:35`) | Commercial. Is fiscalisation part of this subscription? |
| 2 | **Jurisdiction** | `branches.tax_jurisdiction` *(new)* | OWNER / TENANT_ADMIN via `branch.manage` | Factual. Which authority governs sales at this branch? |
| 3 | **Activation** | `fiscal_credentials.active` per `(tenant, branch, authority, environment)` *(new)* | OWNER / TENANT_ADMIN via new `tax.fiscalisation.manage` **+ TOTP step-up** | Operational. Do we hold a working token, and is it live? |

**A sale is fiscalised if and only if all four of these hold**, evaluated in this order, every one
fail-closed:

```
1. FEATURE_FISCAL_INVOICING enabled for the tenant                    (Redis-cached, fail-closed)
2. resolveAuthority(branch) != NONE                                   (needs branch.tax_jurisdiction)
3. an active fiscal_credentials row for (tenant, branch, authority, environment)
4. branch.ntn is non-null                                             (seller identity)
```

If any is false, `OrderServiceImpl.performClose` writes **no** submission row and does nothing
different from today. That single `if` is the entire blast radius against existing behaviour — which
is what makes this safe to ship while ~every tenant, including Floating Terrace, has it off.

Condition 2 is the addition to `fbr-integration-design.md` §3.3, which listed three conditions. Without
it, a Lahore tenant who is entitled and who pastes in a PRAL token would start filing service sales
to the federal authority. Jurisdiction is not optional metadata; it is a guard.

**Why the flag is named `FEATURE_FISCAL_INVOICING`, not `FEATURE_FBR_DIGITAL_INVOICING`.** The flag is
the *entitlement*, and a Karachi tenant buying the same product should not have their subscription
row say "FBR". Naming it after one authority guarantees a second flag later, at which point tier
reconciliation, the `RouteFeatureMap` closure, the frontend `FeatureFlag` union and every nav gate all
fork. The authority is selected by data (switch 2); the entitlement is one thing.

**Tier placement.** `fbr-integration-design.md` §3.3 flags this as a commercial call and it remains
one. My input: STGO #01 of 2026 obligates *all* sales-tax-registered persons to integrate
(`fbr-api.md` §10). Gating a legal obligation behind GROWTH tier means a STARTER tenant who becomes
liable must upgrade to stay lawful. I would put it in the **STARTER** set and price the *support*, not
the switch. Either choice works mechanically; the closure test only cares that the code appears in at
least one tier set.

### 4.2 The tax-authority abstraction

Two layers. The first is data that should exist regardless; the second is the plug point.

#### Layer 1 — jurisdiction as a typed branch attribute

```sql
-- user-service migration
ALTER TABLE branches ADD COLUMN tax_jurisdiction TEXT;   -- nullable: unknown is a real state
-- ICT | PUNJAB | SINDH | KP | BALOCHISTAN | AJK | GILGIT_BALTISTAN
```

Set once at branch setup from the branch's actual address. **Never inferred at sale time** and never
guessed from a phone number or a timezone (every branch currently defaults to `Asia/Karachi` —
`BranchEntity.java:51-52` — which carries no jurisdictional information whatsoever).

`NULL` is a legitimate state meaning "nobody has told us", and it resolves to `NONE`. It must be
surfaced once, on the branch settings screen, as a setup task — **not** as a warning on the till.

This field earns its place even for a tenant who never fiscalises: it is what lets the existing
`FbrTaxSummary` report state which authority its numbers pertain to, and it is what makes the
16%/13% split observed in §1.1 answerable.

Floating Terrace HQ (F-7) → `ICT`. Record it in the seed script so the reasoning is executable, not
just written down.

#### Layer 2 — the `FiscalAuthorityAdapter` SPI

```java
package io.restaurantos.pos.fiscal;

/** One implementation per revenue authority. Registered as a Spring bean; selected by jurisdiction. */
public interface FiscalAuthorityAdapter {

    /** Stable code stored in fiscal_submissions.authority_code / fiscal_credentials.authority_code. */
    String code();                                   // "FBR_DI" | "SRB" | "PRA" | ...

    /** Which branches this adapter may serve. FBR_DI ships as EnumSet.of(ICT) — see below. */
    Set<TaxJurisdiction> jurisdictions();

    /** Drives the onboarding form: which credential fields to collect, which are secret. */
    CredentialSpec credentialSpec();

    /** Build the authority's payload from our own entities, inside performClose's transaction. */
    FiscalDocument build(Order order, SellerIdentity seller, TaxClassificationResolver taxonomy);

    /** The only method that touches the network. Called by the worker, never by performClose. */
    FiscalResult submit(FiscalDocument doc, FiscalCredential cred);

    /** TRANSIENT (retry) | PERMANENT (REJECTED, needs a human) | AUTH (disable credential, alert). */
    FailureClass classify(FiscalResult result, Throwable error);

    /** What the printed receipt must carry once fiscalised: number, date, QR payload, logo asset. */
    ReceiptFiscalBlock receiptBlock(FiscalRecord record);

    /** What the printed receipt must carry while a submission is still queued. */
    ReceiptFiscalBlock provisionalBlock(FiscalRecord record);
}
```

Everything else is authority-agnostic and written once: the submission table, the retry worker and
its backoff, the credential store, the enable/disable switch, the feature flag, the unfiscalised
counter, the receipt slot, the audit events, the RLS policies. Only `build`, `submit`, `classify`,
`receiptBlock`, `provisionalBlock` and `credentialSpec` are FBR-specific — six methods.

#### Selection: exactly one, or none

```java
FiscalAuthorityAdapter resolveAuthority(Branch branch) {
    if (branch.taxJurisdiction() == null) return NONE;       // logged once at branch save, not per sale
    var candidates = adapters.stream()
        .filter(a -> a.jurisdictions().contains(branch.taxJurisdiction()))
        .toList();
    if (candidates.size() > 1) throw new IllegalStateException(...);  // see below
    return candidates.isEmpty() ? NONE : candidates.get(0);
}
```

Two adapters claiming one jurisdiction is a configuration bug, and the right time to find it is
**startup**, not the Friday dinner rush. Add an `ApplicationRunner` (or a unit test in the spirit of
`FeatureCodeClosureTest`) that asserts the jurisdiction sets are pairwise disjoint and refuses to
start otherwise. This repo has three precedents for exactly this class of guard (§3.7); adding a
fourth is cheap and idiomatic here.

**Day one ships one adapter — `FbrDigitalInvoicingAdapter`, registered for `ICT` only.** Not for
`PUNJAB`, not for `SINDH`. A Punjab branch resolves to `NONE` and behaves exactly like an
unregistered tenant until a `PraAdapter` exists. This is the requirement "the system must not assume
otherwise" turned into a mechanism rather than a comment: the *only* way to make a Lahore branch file
to FBR is to deliberately add `PUNJAB` to that `EnumSet`, in a diff, with a reviewer.

> Honest caveat, inherited: `fbr-api.md` §10 records SRO 288(I)/2026 (draft, Income Tax Ordinance)
> as explicitly naming restaurants for federal online integration, with provincial authorities
> reported as opposing it — a live jurisdictional dispute **[UNVERIFIED]**. If it lands, `PUNJAB`
> may legitimately need FBR too. The `EnumSet` is exactly the one-line change that would express
> that, which is the point of putting it there.

### 4.3 The anti-rework rules

These are the specific decisions that decide whether adding SRB in 2027 is a new class or a schema
migration on live tax records.

**R1. No authority name in any table, column or permission.**

| Do not | Do |
|---|---|
| `fbr_submissions` | `fiscal_submissions` + `authority_code TEXT NOT NULL` |
| `fbr_credentials` | `fiscal_credentials` + `authority_code TEXT NOT NULL` |
| `fbr_invoice_number` | `fiscal_document_number` |
| permission `fbr.credentials.manage` | permission `tax.fiscalisation.manage` |
| `FEATURE_FBR_DIGITAL_INVOICING` | `FEATURE_FISCAL_INVOICING` |

`fbr-integration-design.md` §3.2/§3.4 names both tables after FBR. Renaming an RLS-protected table
that holds statutory records, with a unique constraint acting as the idempotency key, is a migration
nobody wants to write. It costs nothing to get right now.

The unique constraint becomes `UNIQUE (tenant_id, order_id, authority_code, document_type)` — which
also, usefully, admits the real case of a branch that must file to two authorities for one sale.

**R2. Never bind menu items to one authority's taxonomy. — this corrects §3.8 of the prior design.**

`fbr-integration-design.md` §3.8 recommends adding `hsCode`, `uoM` and `saleType` as new columns on
`MenuItem`. Do not. Those are FBR's federal-goods taxonomy. PRA and SRB classify *services* under
their own schedules. Following that recommendation gives you `hs_code`, then `pra_service_code`, then
`srb_service_code` on the same row, each null for most tenants — the exact shape of schema that
becomes unmaintainable.

Instead, a child table keyed by authority:

```sql
CREATE TABLE menu_item_tax_codes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    menu_item_id        UUID NOT NULL REFERENCES menu_items(id),
    authority_code      TEXT NOT NULL,           -- 'FBR_DI' | 'SRB' | 'PRA'
    classification_code TEXT NOT NULL,           -- HS code for FBR; service code for SRB/PRA
    uom                 TEXT,                    -- FBR requires; may be null elsewhere
    sale_type           TEXT,                    -- FBR requires; may be null elsewhere
    rate_code           TEXT,                    -- the authority's rate string, e.g. "18%"
    extra               JSONB,                   -- sroScheduleNo etc. without a column per authority
    CONSTRAINT uq_item_authority UNIQUE (tenant_id, menu_item_id, authority_code)
);
ALTER TABLE menu_item_tax_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_item_tax_codes
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
```

RLS policy shape copied verbatim from `services/pos-service/src/main/resources/db/migration/V1__pos_schema.sql:26-28`.

A tenant with fiscalisation off has **zero rows** here and `MenuItem` is untouched — which is also
why this is the version that satisfies the optionality requirement: no new mandatory column appears
on the menu form for a restaurant that will never file anything.

`TaxClassificationResolver` (injected into `build`) reads this table for the resolved authority and
raises a *configuration* error at onboarding time if an item sold under an active authority has no
row — surfaced on the fiscal settings screen, never at the till.

**R3. Keep `tax_rate_pct` as the money truth; make `tax_rate_code` the taxonomy join.**
Pricing arithmetic stays exactly where it is
(`services/pos-service/.../service/OrderPricingCalculator.java`, `perLineTax`, HALF_UP to the paisa).
Do not let a fiscal integration move the number that decides what the customer pays. `tax_rate_code`
— currently null on all 78 live items — becomes the key into `menu_item_tax_codes.rate_code`.

**R4. `request_json` is frozen at close and is per-authority.** Already argued in the prior design;
it matters more with two authorities, because a retry must resubmit what was sold under the rules
that applied, to the authority that applied, on the day it was sold.

**R5. `authority_code` is written on the row, never re-derived.** If a branch's jurisdiction is
corrected later (or a branch relocates), historical submissions must keep pointing at the authority
they were actually filed with.

### 4.4 Credential storage

**New table in pos-service, `fiscal_credentials`, field-encrypted with `EncryptedStringConverter`.**

```sql
CREATE TABLE fiscal_credentials (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL,
    branch_id         UUID        NOT NULL,          -- seller identity is per-branch
    authority_code    TEXT        NOT NULL,          -- 'FBR_DI'
    environment       TEXT        NOT NULL,          -- SANDBOX | PRODUCTION
    api_token         BYTEA       NOT NULL,          -- @Convert(EncryptedStringConverter)
    token_hint        TEXT        NOT NULL,          -- last 4 chars, for the UI. NOT the token.
    seller_ntn_cnic   TEXT        NOT NULL,
    seller_business_name TEXT     NOT NULL,
    seller_province   TEXT        NOT NULL,
    seller_address    TEXT        NOT NULL,
    active            BOOLEAN     NOT NULL DEFAULT FALSE,   -- note the default
    token_added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    token_expires_at  TIMESTAMPTZ,
    last_success_at   TIMESTAMPTZ,
    last_error_at     TIMESTAMPTZ,
    last_error_code   TEXT,
    CONSTRAINT uq_fiscal_cred UNIQUE (tenant_id, branch_id, authority_code, environment)
);
ALTER TABLE fiscal_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fiscal_credentials
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
```

```java
@Convert(converter = EncryptedStringConverter.class)
@Column(name = "api_token", columnDefinition = "bytea", nullable = false)
private String apiToken;
```

— structurally identical to `AttendanceDeviceEntity.java:53`.

Rules, each with a reason:

- **`active` defaults to FALSE.** Saving a token is not the same act as going live. Making the default
  `TRUE` (as `fbr-integration-design.md` §3.2 has it) means the first paste of a production token
  starts filing real invoices before anyone has run a validation submission.
- **No read path ever decrypts.** The admin DTO returns `token_hint`, `token_added_at`,
  `last_success_at`, `last_error_code`. There is no `GET` that returns `api_token`. Writes are
  `PUT`-only.
- **`token_hint` is stored, not derived on read**, so no code path needs to decrypt in order to render
  the settings screen.
- **`environment` is enforced by us**, because PRAL routes by token, not by URL (`fbr-api.md` §4.1) —
  a production token in a `SANDBOX` row files test data as real. The worker asserts
  `credential.environment == submission.environment` and refuses loudly.
- **Not in `TenantFeatureEntity.config_json`.** `platform_db` is non-RLS, the rows are mirrored into
  Redis by `FeatureFlagAdminService.invalidateBothKeyShapes`, and `FeatureFlagPublicController` serves
  flag state to every authenticated tenant user. Non-secret fiscal config (submission mode, strict
  mode, default sale type) is a fine fit for `config_json`; the token is not.
- **Copy `EncryptionRequiredConfig` into pos-service** (§3.5). A `NullPointerException` on the
  settlement path because a key was unset is not an acceptable discovery mechanism.
- **Audit every write.** New event types `FISCAL_CREDENTIAL_UPDATED`, `FISCAL_CREDENTIAL_ACTIVATED`,
  `FISCAL_CREDENTIAL_DEACTIVATED`, `FISCAL_ENVIRONMENT_PROMOTED` — each added to
  `AuditEventCatalog.MUST_AUDIT` **and** published, or `AuditAllowListClosureTest` fails the build
  (§3.7). Promotion from `SANDBOX` to `PRODUCTION` is its own audited act.

### 4.5 Who may operate what

| Action | Permission | Step-up | Notes |
|---|---|---|---|
| Grant/revoke `FEATURE_FISCAL_INVOICING` | `SUPER_ADMIN` role | n/a | `PlatformAdminController:192`. **Needs `/platform/tenants` built — currently 404 (§3.3).** |
| Set `branches.tax_jurisdiction` | `branch.manage` | no | OWNER + TENANT_ADMIN, per `BranchController` javadoc. **Needs the branch write path fixed (§3.1) and a branch settings UI.** |
| Set `branches.ntn` / `fbr_strn` | `branch.manage` | no | Public business identifiers, not secrets. **Blocked today (§3.1).** |
| Save / replace a fiscal token | `tax.fiscalisation.manage` *(new)* | **yes** | `@RequestHeader("X-TOTP-Verified")`, refuse when false — `PeriodController.java:83` pattern. |
| Activate / deactivate a credential | `tax.fiscalisation.manage` | **yes** | This is the tenant's real on/off switch. |
| Promote `SANDBOX` → `PRODUCTION` | `tax.fiscalisation.manage` | **yes** | Separate endpoint, separate audit event. |
| View submission queue / retry a `DEAD` row | `tax.fiscalisation.view` *(new)* | no | Manager-level. Read plus a manual retry is not credential access. |

**`tax.fiscalisation.manage` is granted to OWNER and TENANT_ADMIN only, and must be added to
`AuthServiceImpl.requiresTotpStepUp`.** The reasoning is precise and comes from that method's own
javadoc (§3.6):

- Because the credential write is gated downstream on `X-TOTP-Verified`, the invariant requires the
  code to be in the login list too — otherwise a holder who triggers no other step-up code could
  never write a credential at all.
- Adding it forces **no new TOTP enrolment**: OWNER already triggers on `rbac.manage`, TENANT_ADMIN
  already triggers on `finance.period.close` and `hr.payroll.approve`. It changes the *reason* those
  two are challenged, not *who* is challenged — the same argument by which `hr.payroll.approve` was
  added.
- **It must never be granted to MANAGER or CASHIER.** Those personas are seeded with no TOTP secret;
  granting it would throw `TotpEnrollmentRequiredException` at every one of their logins. This is the
  documented hazard, and a fiscal permission is exactly the kind of "seems administrative, give it to
  managers" grant that would trip it.

`tax.fiscalisation.view` is deliberately kept **out** of the step-up list: it gates no credential and
adding it would drag MANAGER into TOTP enrolment for a read screen.

### 4.6 What the invoice flow does when fiscalisation is OFF

**Nothing changes.** Concretely, and testably:

- `OrderServiceImpl.performClose` writes no `fiscal_submissions` row, makes no new call, publishes no
  new event. The event set emitted by a close is byte-identical to today's.
- No fiscal document number is allocated (so `order_sequences` behaviour is unchanged and no gapless
  sequence accrues holes for a tenant who never files).
- The receipt renders **without** a fiscal block — the block is *absent*, not empty. No "FBR: —", no
  greyed panel, no "not configured" placeholder.
- No nav item. The fiscal settings entry carries both `feature: "FEATURE_FISCAL_INVOICING"` and
  `permission: "tax.fiscalisation.manage"` in `sidebar-nav-items.ts`; the Sidebar renders an item only
  when the permission is held **and** the feature is enabled. The `feature` field is typed
  `FeatureFlag`, so the code must exist in `frontend/lib/features/feature-flags.ts` and therefore in
  a `TierFeatureDefaults` set — the compile-time guard from §3.7 (2).
- No unfiscalised counter and no badge: they count rows in a table that has none.
- `/app/reports/fbr` is untouched. It is a bookkeeping report on `reporting.report.fbr`, not an
  integration, and its own subtitle already says so.

**The regression net** is one integration test, and it is worth writing before the feature: close an
order for a tenant with the flag off; assert `fiscal_submissions` is empty, assert the published
event list equals the pre-change list exactly, assert the response DTO has no new non-null fields.
Cheap, and it is the thing that proves the word "optional".

**Dead-UI rule.** No screen in this feature renders a disabled control explaining what the tenant
cannot do. Either the surface is absent (feature off) or it is a working setup screen (feature on,
not yet configured). The setup screen is a checklist with actionable steps — jurisdiction, NTN,
credential, sandbox validation, go live — not a wall of disabled inputs.

### 4.7 What it does when fiscalisation is ON and the authority is unreachable

**Queue it. Do not block the sale.** This confirms `fbr-integration-design.md` §3.5 and adds one
argument that is specific to this codebase and, I think, decisive on its own.

The published reasons stand:
1. Rules 150T–150XD explicitly contemplate invoices issued during disruption, marked offline and
   uploaded within 24 hours. Offline issuance is the regulated path, not a workaround.
2. Comparative practice agrees (Poland KSeF offline24: valid from the moment of issue).
3. PRAL publishes no availability SLA that the prior research could find.

The repo-specific reason, which I consider the strongest:

**`performClose` runs inside a database transaction that is entered from `recordPayment` — i.e.
after the money has been taken.** The chain is
`PaymentServiceImpl.recordPayment` → `OrderServiceImpl.maybeCloseOrder` (line 706) →
`performClose` (line 740 — whose own javadoc at line 738 calls `maybeCloseOrder`'s Paid-AND-Served
path "the ONLY remaining caller"), and `performClose` already holds locks on `orders` and calls the
fail-closed `FinancePeriodClient.assertPeriodOpen`. Putting a third-party HTTP call in there has two
consequences, and the second is the one that ends the argument:

- Refusing to close does **not** refund the customer. It strands a paid order and a till that cannot
  reconcile. The failure lands on staff, after the transaction the customer considers finished.
- pos-service is **multi-tenant**. A hung PRAL connection inside a transaction holds a database
  connection from a shared pool. A PRAL slowdown therefore degrades every till of every tenant
  sharing that service — including the ones with fiscalisation switched off entirely. That converts
  an optional feature into a systemic dependency, which is precisely what "optional" must not mean.

So: the sale closes, the payment stands, the revenue journal posts, the receipt prints marked as an
offline invoice, and the submission queues. On success the till is notified, the fiscal number and QR
become available, and a fiscal reprint action appears.

**Strict mode**, for a tenant who genuinely wants it, is offered per branch in `config_json` and is
enforced **at order entry, before payment is taken** — never at close. Refusing to start an order
because the tax authority is down is a business decision a restaurant can make. Refusing to close an
order after taking the customer's money is not a decision, it is a defect. Never the default.

Queue mechanics (table shape, `PENDING|IN_FLIGHT|FISCALISED|REJECTED|DEAD`, `SELECT … FOR UPDATE SKIP
LOCKED`, one row per transaction, time-bounded rather than attempt-bounded retry, the
`LeaveAccrualScheduler` tenant-enumeration pattern and the `deploy/init/05-hr-fn-owner.sql`
`SECURITY DEFINER` ownership trap) are fully specified in `fbr-integration-design.md` §3.4 and are
authority-agnostic as written. The only changes are the R1 renames and `authority_code` in the unique
key.

### 4.8 How the QR code and the fiscal invoice number reach the printed receipt

**The blunt answer first: today, they cannot, because this system prints no receipt at all** (§3.2).
The QR has no destination. So the design here is the *seam* the printing work must leave, so that the
receipt lands fiscal-ready rather than needing a rewrite.

`pos-printing.md` §9 already specifies the printing architecture (server renders a `PrintDocument`, a
per-branch local agent renders ESC/POS, `window.print()` CSS as the fallback ladder). Three
constraints connect it to this design:

**(a) The fiscal block is an optional member of the receipt document, produced by the adapter.**

```java
record ReceiptDocument(
    ...,
    Optional<ReceiptFiscalBlock> fiscal      // absent when not fiscalised — see §4.6
) {}

record ReceiptFiscalBlock(
    String authorityCode,        // "FBR_DI" — printed labels are authority-specific
    String documentNumber,       // FBR: "7000007DI1747119701593"
    String documentDated,
    byte[] qrPng,                // rendered server-side, sized in physical units
    String qrSpecVersion,        // FBR: "2.0", 25x25, 1.0 x 1.0 inch
    String authorityLogoAssetId, // the FBR DI logo, supplied by FBR — not recreated
    String provisionalNotice     // non-null only while the submission is queued
) {}
```

Because the block comes from `FiscalAuthorityAdapter.receiptBlock(...)`, an SRB or PRA receipt
requires **no change to the receipt document schema and no change to the print agent** — only a new
adapter method body. That is the payoff of the abstraction at the last mile.

**(b) The QR must be rendered server-side, as a raster, in pos-service.** Three independent reasons:
the client never has the FBR invoice number (it arrives asynchronously, after close); the spec's
1.0 × 1.0 inch physical size cannot be met reliably by a printer's native QR command, so it must go
as a raster image (`pos-printing.md` §9.6); and server-side rendering keeps the symbol identical
across the web till, the thermal printer and any PDF. A QR library must be added — none exists
(`grep zxing|qrcode|QRCode` across every `pom.xml` and `package.json` → 0 hits). `com.google.zxing:core`
+ `:javase` is the conventional choice; version to be checked at implementation time, not guessed.

**(c) The receipt is issued twice, and the second issue must be a first-class action.** Because
fiscalisation is asynchronous, the receipt handed over at the table is provisional. On
`ORDER_FISCALISED`, the till gains a "Print fiscal receipt" action and the fiscal block becomes
available. So the print-job table (`pos-printing.md` §9.8 step 3) needs a `document_version` column
from day one: the fiscal reprint is a **new job**, not a mutation of the old one, so the audit trail
shows both the provisional and the fiscal document.

**(d) Config generalises.** `pos-printing.md` §9.5 already reserves `receipt_config.fbr`
(`{"printLogo": true, "qrSizeMm": 25.4}`). Make it `receipt_config.fiscal` keyed by authority code —
R1 applied at the config layer. `BranchEntity.receiptConfig` exists (`BranchEntity.java:59-60`), is
writable via `UpdateBranchRequest` (unlike `ntn` — §3.1), and is [LIVE] `null` on both branches, with
no UI referencing it.

**(e) What the provisional receipt must legally say is [UNVERIFIED] and blocks customer-facing
print.** `fbr-integration-design.md` §5.2 flags this; nothing found here changes it. Rule 150R ties
the QR to the Board-assigned invoice number, which by definition does not exist offline, and no
Pakistani analogue of Poland's taxpayer signing certificate was located. `provisionalNotice` is a
field with no verified content. **Resolve with a tax advisor before printing anything a customer
takes away.** This is the highest-risk open item in the whole feature.

---

## 5. Build order, given what is actually missing

Ordered by dependency, not by interest. Steps 1–4 have value with FBR switched off forever, which is
the correct property for work that unblocks an optional feature.

| # | Work | Why it is first | Est. |
|---|---|---|---|
| 1 | Add `ntn`/`fbrStrn` to `CreateBranchRequest`/`UpdateBranchRequest` + `BranchService.update`; add `tax_jurisdiction` | Seller identity cannot be recorded at all today, and a `PUT` currently 200s and discards (§3.1) | 1 |
| 2 | Branch settings UI (`/app/settings` → Branch): name, address, NTN, STRN, jurisdiction, receipt config | No branch write UI exists; the frontend calls only `GET /branches/mine` | 3 |
| 3 | `/platform/tenants` page with the feature-flag toggle | The entitlement switch is `curl`-only; nav item 404s today (§3.3) | 3 |
| 4 | `ReceiptDocument` + renderer + print path (`pos-printing.md` §9.8 steps 1–5), with `Optional<ReceiptFiscalBlock>` reserved | No receipt exists; the QR has no destination (§3.2) | 8–12 |
| 5 | `FiscalAuthorityAdapter` SPI, `fiscal_credentials`, `fiscal_submissions`, worker, `menu_item_tax_codes`, `FEATURE_FISCAL_INVOICING`, permissions, `EncryptionRequiredConfig` in pos-service | The feature proper. Inert until a credential exists | 10–15 |
| 6 | `FbrDigitalInvoicingAdapter` (ICT only) + sandbox onboarding via `validateinvoicedata` | Needs a sandbox token; blocked on the §6 questions | 8–12 |

Floating Terrace can be fully served by steps 1–4 while remaining un-registered, and step 5 can ship
dark. Step 6 is the only part that needs FBR to exist.

---

## 6. Open questions

Carried forward unchanged from `fbr-integration-design.md` §5 — all six still block, none needs code
to investigate: (1) what the QR encodes; (2) what an offline receipt must display and when the
24-hour clock starts; (3) whether a seller-supplied invoice number is required; (4) how an
unregistered walk-in diner satisfies the mandatory `buyerBusinessName`/`buyerProvince`/`buyerAddress`
fields — still the most likely blocker for restaurant use specifically; (5) whether ResturantOS could
itself be a licensed integrator, which would invert the per-tenant credential model entirely;
(6) tier placement.

Added here:

7. **Do SRB and PRA publish e-invoicing APIs at all, and in what shape?** The abstraction above is
   designed against an assumption — that a provincial authority looks broadly like FBR (credential,
   payload, submit, document number, QR). If SRB turns out to be, say, a certified fiscal device
   rather than a web API, `FiscalAuthorityAdapter.submit` is the wrong seam and it is better to learn
   that before the first adapter hardens the interface. **This is the next research item**, and it is
   cheap relative to what it de-risks.
8. **Does an ICT restaurant file service sales to FBR under the Sales Tax Act or under the ICT
   (Tax on Services) Ordinance 2001, and does the DI API cover both?** The DI spec is written in
   goods vocabulary (HS codes, UoM). Whether an ICT *service* invoice uses the same
   `postinvoicedata` schema is not established by anything in `fbr-api.md`. This determines whether
   `menu_item_tax_codes.classification_code` holds an HS code or something else for the very first
   tenant.
9. **What does the 72-hour amend window mean for our void/refund flow?** STGO #01 of 2026 allows
   cancel/edit within 72 hours through the Board's system, and beyond that requires a Commissioner's
   approval — but spec v1.12 documents **no** cancel or amend endpoint (`fbr-api.md` §10,
   **[UNVERIFIED]**). A restaurant comping a meal on day four is then a tax-office petition, not a
   button. `RefundServiceImpl` needs a designed boundary here, and `fiscal_submissions.document_type`
   must exist from day one so the credit-note path is a row value, not a migration.

---

## 7. Evidence log

**[LIVE] — captured 2026-08-07 against localhost:8080, owner@terrace.local / floating-terrace**

| Probe | Result |
|---|---|
| `POST /api/v1/auth/login` (owner + TOTP) | 200, token with `tenant_id d108c2e6-…`, `branch_id 34cd6f62-…`, `roles:["OWNER"]` |
| `GET /api/v1/feature-flags` | 200, 20 codes, no fiscalisation code |
| `GET /api/v1/branches` | 200, 2 branches, both `ntn:null fbrStrn:null address:null receiptConfig:null` |
| `PUT /api/v1/branches/34cd6f62-…` body `{"ntn":"1234567-8"}` | **200 — and `ntn` still `null` in the response and in a fresh GET** |
| `GET /api/v1/pos/menu/items/admin` | 200, 78 items; `taxRatePct` ∈ {16.00 ×68, 13.00 ×10}; `taxRateCode` null ×78; no image field on the DTO |
| `POST /api/v1/auth/login` (later in session) | 503 ×5 in the browser network log; other gateway routes still 200 — see §0 |

**[REPO] — files and lines cited above**

`shared-lib/src/main/java/io/restaurantos/shared/security/EncryptionService.java` ·
`shared-lib/src/main/java/io/restaurantos/shared/security/EncryptedStringConverter.java` ·
`shared-lib/src/main/java/io/restaurantos/shared/config/EncryptionAutoConfiguration.java:11` ·
`shared-lib/src/main/java/io/restaurantos/shared/event/AuditEventCatalog.java` ·
`shared-lib/src/main/java/io/restaurantos/shared/feature/{RequiresFeature,FeatureFlagAspect}.java` ·
`services/purchasing-service/src/main/java/io/restaurantos/purchasing/config/EncryptionRequiredConfig.java` ·
`services/hr-service/src/main/java/io/restaurantos/hr/entity/AttendanceDeviceEntity.java:53` ·
`services/user-service/src/main/java/io/restaurantos/user/entity/BranchEntity.java:36,39-43,51-52,59-60` ·
`services/user-service/src/main/java/io/restaurantos/user/dto/BranchDtos.java:14,26,38` ·
`services/user-service/src/main/java/io/restaurantos/user/service/BranchService.java:116-133` ·
`services/user-service/src/main/java/io/restaurantos/user/controller/BranchController.java` (javadoc on `branch.manage`) ·
`services/auth-service/src/main/java/io/restaurantos/auth/service/AuthServiceImpl.java:529-554` ·
`services/finance-service/src/main/java/io/restaurantos/finance/web/PeriodController.java:74-85` ·
`services/platform-admin-service/src/main/java/io/restaurantos/platform/controller/PlatformAdminController.java:35,192` ·
`services/platform-admin-service/src/main/java/io/restaurantos/platform/config/TierFeatureDefaults.java:20-22,32-81` ·
`services/pos-service/src/main/java/io/restaurantos/pos/domain/model/MenuItem.java:34-38` ·
`services/pos-service/src/main/java/io/restaurantos/pos/dto/MenuItemAdminDtos.java:16-23,29-36` ·
`services/pos-service/src/main/java/io/restaurantos/pos/service/MenuServiceImpl.java:177-178,203-204` ·
`frontend/components/menu/MenuItemFormDialog.tsx` (229 lines, 0 occurrences of "tax") ·
`services/pos-service/src/main/java/io/restaurantos/pos/web/TableController.java:18,37` ·
`services/pos-service/src/main/resources/db/migration/V1__pos_schema.sql:26-28` ·
`gateway/src/main/java/io/restaurantos/gateway/support/RouteFeatureMap.java:35-50` ·
`gateway/src/main/java/io/restaurantos/gateway/filter/StripInternalHeaderFilter.java:41-49` ·
`frontend/lib/features/feature-flags.ts` · `frontend/lib/repositories/branch.repository.ts:8` ·
`frontend/components/shared/sidebar-nav-items.ts:328-349,354-361` ·
`services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java:706,738-740` ·
`frontend/components/pos/charge-summary.tsx` (484 lines, no receipt/print) ·
`frontend/app/(platform)/platform/dashboard/page.tsx` (9 lines)

**Zero-hit greps (each re-runnable):**
`window.print|@media print` over `frontend/{app,components,lib}` → 0 ·
`[Rr]eceipt` over `services/pos-service/src/main/java` → 0 ·
`province|jurisdiction|taxAuthority` over `services/**/*.java` (excl. target, tests) → 0 ·
`zxing|qrcode|QRCode` over all `pom.xml` + `package.json` (excl. node_modules) → 0
