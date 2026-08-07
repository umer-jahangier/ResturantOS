# FBR Digital Invoicing — Multi-Tenant Integration Design

**Repo:** ResturantOS (`/Users/muhammadumer/Documents/Projects/ResturantOS`)
**Date:** 2026-08-07
**Status:** Design research. No code written. Every repo claim below cites a file I opened; every external claim cites a URL I fetched.

---

## 0. Epistemic status — read this first

| Claim class | Confidence | Basis |
|---|---|---|
| PRAL DI API endpoints, auth, request/response JSON, error codes, QR print spec | **High** | I read the primary PDF (PRAL *Technical Specification for DI API* v1.10, 24-May-2025) page by page |
| Legal rule numbers (150R/150S/150T/150XE) and the 24-hour offline upload window | **Medium** | EY tax alert (secondary summary). I did **not** successfully extract text from SRO 69(I)/2025 or STGO 01 of 2026 — both fetched as unparseable PDF streams |
| What the offline receipt must display *in place of* the FBR invoice number and QR | **Unverified — genuine gap** | The PRAL spec is silent; the rules summary says "mark as offline" but not what replaces the fiscal number |
| Competitor architectures (per-tenant credential storage, queue design) | **Low** | Vendors publish marketing pages, not architecture. What I found is documented in §2.3 with its limits stated |
| Everything about the ResturantOS repo | **High** | Direct file reads, cited inline |

Where I could not verify something I have written **UNVERIFIED** rather than guessing. Two schema-level unknowns (§1.5, §1.7) must be resolved against a live sandbox token before any code is written.

---

## 1. External research: the FBR / PRAL Digital Invoicing API

### 1.1 Primary source

PRAL, *Technical Specification for DI API*, version 1.10, updated 24-May-2025, author Muhammad Umair Siddique — https://download1.fbr.gov.pk/Docs/20256201364855300TechnicalDocumentationforDIAPI.pdf

I read pages 1–16 and 34–40 directly. The facts in §1.2–§1.6 are quoted from that document.

### 1.2 Endpoints

| Purpose | URL |
|---|---|
| Post invoice (real-time submission) | `https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata` |
| Validate invoice (pre-flight, sandbox) | `https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata_sb` |
| Validate invoice (production) | `https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata` |

**Critical architectural fact, verbatim from §4 of the spec:**

> "DI data acquisition API URL's are mentioned in this document will remain the same for **Sandbox** and **Production** routing will be based on the security token being used."

**The token selects the environment, not the URL.** This is the single most important design constraint for a multi-tenant system: there is no `?env=sandbox` switch and no separate host. A tenant onboarding in sandbox and a tenant live in production hit the *same* URL, and the only thing distinguishing them is which bearer token we attached. A credential-selection bug does not fail loudly — it silently files test invoices as real ones, or real ones as tests. The credential record must therefore carry an explicit `environment` column that we enforce ourselves (§4.2), because the wire protocol will not enforce it for us.

*(Note: the doc lists the `_sb` suffix only on the validate endpoint. Whether `postinvoicedata_sb` also exists as a distinct path is contradicted between sources — the third-party ezinvoice.pk guide documents `POST /api/postinvoicedata_sb` on **their own** wrapper API, not PRAL's. Treat the PRAL doc as authoritative and confirm against a live token.)*

### 1.3 Authentication

Spec §3.1:

> "This Web API is secured and will require a security token to be passed in the header of each request. This security token will be issued by PRAL and given to Supply Chain Operators along with all URLs to access the web API. This security token will have a validity of **5 Years**."

Header form: `Authorization: Bearer <token>` (spec Figure 2).

Consequences for us:
- The token is a **long-lived static secret**, not an OAuth flow. There is no refresh endpoint to implement, and no token-expiry retry path. It is a password-equivalent that lives for five years — which raises rather than lowers the bar on at-rest encryption and access logging.
- The token is issued **per taxpayer**, not per software vendor. Each tenant brings their own. This is exactly the per-tenant-credential problem the task asks about, and it is unavoidable — we cannot pool.

### 1.4 Request schema (`postinvoicedata`)

Header fields (spec §4.1.1/§4.1.2 sample JSON + field table pp. 9–10):

| Field | Type | Required | Notes |
|---|---|---|---|
| `invoiceType` | String | Yes | `"Sale Invoice"` or `"Debit Note"` |
| `invoiceDate` | date | Yes | `YYYY-MM-DD` (error 0005/0113 enforce this) |
| `sellerNTNCNIC` | string | Yes | 7 or 9 digit NTN, or 13-digit CNIC (error 0002) |
| `sellerBusinessName` | string | Yes | |
| `sellerProvince` | string | Yes | |
| `sellerAddress` | string | Yes | |
| `buyerNTNCNIC` | string | Yes, optional if buyer Unregistered | |
| `buyerBusinessName` | string | Yes | |
| `buyerProvince` | string | Yes | |
| `buyerAddress` | string | Yes | |
| `buyerRegistrationType` | string | Yes | `"Registered"` / `"Unregistered"` |
| `invoiceRefNo` | String | Only for debit/credit note | e.g. `7327556DI1744111990654` |
| `scenarioId` | String | **Sandbox only** | e.g. `"SN001"` |
| `items[]` | array | Yes | |

Item fields: `hsCode`, `productDescription`, `rate` (string, e.g. `"18%"`), `uoM`, `quantity` (Int), `totalValues` (Double), `valueSalesExcludingST` (Double), `fixedNotifiedValueOrRetailPrice` (Double), `salesTaxApplicable` (Int), `salesTaxWithheldAtSource` (Double), `extraTax` (opt), `furtherTax` (opt), `sroScheduleNo` (opt), `fedPayable` (opt), `discount` (opt), `saleType` (String, required, e.g. `"Goods at standard rate (default)"`), `sroItemSerialNo` (opt).

### 1.5 Response schema

Valid (spec §4.1.3):

```json
{
  "invoiceNumber": "7000007DI1747119701593",
  "dated": "2025-05-13 12:01:41",
  "validationResponse": {
    "statusCode": "00", "status": "Valid", "error": "",
    "invoiceStatuses": [
      { "itemSNo": "1", "statusCode": "00", "status": "Valid",
        "invoiceNo": "7000007DI1747119701593-1", "errorCode": "", "error": "" }
    ]
  }
}
```

Invalid (§4.1.4/§4.1.5): `invoiceNumber` is **absent**, `validationResponse.statusCode` is `"01"`, `status` is `"Invalid"`, with `errorCode` (e.g. `"0052"`) and a human message. Per-item failures come back inside `invoiceStatuses[]` with `"invoiceNo": null`.

**HTTP status codes documented (§4.1.6): only `200`, `401`, `500`.** There is no documented 429, 503, or 400.

Two consequences that shape the whole retry design:

1. **A business rejection arrives as HTTP 200.** Success/failure is `validationResponse.statusCode`, not the HTTP status. Any client that branches on `response.isSuccessful()` will record permanently-rejected invoices as fiscalised. This must be an explicit assertion in our client, not an incidental behaviour.
2. **Transient and permanent failures are not distinguishable by HTTP code.** `500` is documented as "Internal Server Error (Contact Administrator)" — which reads as permanent but in practice will also cover transient gateway faults. Our retry classifier therefore has to key off `validationResponse.errorCode` for permanent-reject decisions and off transport-level outcomes (connect timeout, read timeout, 5xx, 401) for retry decisions. See §5.3.

**UNVERIFIED — seller invoice number.** The v1.10 sample request JSON contains **no** seller-side `invoiceNumber` field at header level, yet sales error codes `0041` ("Provide invoice No.") and `0088` ("Alphanumeric and (-) contained invoice No. is allowed. (-) should be in between Alphanumeric string. For example: Inv-001") clearly reference one. Either the field is required in a document type not sampled (debit/credit notes), or the sample is stale relative to the error table. **Resolve against a live sandbox token before designing the numbering scheme** (§4.5 assumes we must supply one, which is the safe assumption).

### 1.6 QR code — what the spec actually says

Spec §6, *Digital Invoicing Logo & QR Code Printing* (p. 34), in full substance:

- The DI system logo **and** a QR code "must be printed on each invoice issued by the taxpayers."
- **QR Code Version: 2.0 (25×25)**
- **QR Code Dimensions: 1.0 × 1.0 Inch**

**The spec does not state what the QR encodes.** It specifies the symbol version and physical size and nothing else. This is a real gap, not an oversight in my reading — page 34 is the entirety of section 6.

The rules summary (EY, §1.7) says invoices must "Include digital signatures and QR codes **based on the unique invoice number assigned by the Board**" — which implies the payload is (or contains) the returned `invoiceNumber`. Under the older Tier-1 POS regime the QR was specified at 7×7 mm and encoded the FBR fiscal invoice number; the DI regime's 1.0-inch/25×25 spec is different, so do **not** carry the old assumption over.

**Design consequence:** the QR cannot be generated until FBR has responded. This is the hinge on which the entire "block vs queue" question turns (§5.1).

### 1.7 The legal offline rule

Source: EY Global tax alert, *Pakistan amends sales tax rules for implementation of electronic invoicing* — https://www.ey.com/en_gl/technical/tax-alerts/pakistan-amends-sales-tax-rules-for-implementation-of-electronic-invoicing (secondary source; I could not extract the SRO PDFs directly).

- **Rule 150R** — the integrated system must "securely generate, store and transmit sales tax invoice data in the prescribed format", and invoices must "include digital signatures and QR codes based on the unique invoice number assigned by the Board."
- **Rule 150S** — "Real-time, verifiable electronic invoices are required to be issued for every taxable supply and service."
- **Rules 150T–150XD** — **"Invoices issued during periods of disruption (such as power or internet outages) must be clearly marked as offline and uploaded within 24 hours."**
- **Rules 150XE–150XQ** — licensed integrators. PRAL is designated a licensed integrator providing free services; other licensees may charge fees.

That third bullet is the direct answer to "must a failed fiscalisation block the sale": **no — the regulation explicitly contemplates issuing the invoice offline and uploading it later.**

**UNVERIFIED:** what "clearly marked as offline" requires on the printed receipt, and whether the 24-hour clock runs from the invoice or from service restoration (the search summary said "within 24 hours of restoration"; EY's phrasing says "within 24 hours" of issuance). These differ materially for a shop that is offline for three days. Confirm against SRO text before implementing the SLA alarm in §5.5.

### 1.8 Comparative practice — Poland KSeF

Source: https://www.sparados.com/en/post/ksef-system-failure-how-offline-mode-works (fetched)

Poland's KSeF 2.0 formalises what Pakistan's rules gesture at, and is worth copying structurally:

| Mode | Trigger | Submit deadline | QR | Invoice valid before submission? |
|---|---|---|---|---|
| **offline24** | Taxpayer-side: no internet, own system failure, KSeF slowness | 1 business day | Required | **Yes** — "valid from the moment it is issued" |
| **System failure** | Ministry of Finance *officially declares* KSeF down | 7 business days | Required | Yes |

Two design ideas worth stealing:
1. **Distinguish "our side is down" from "their side is declared down"** — different deadlines, different operator messaging, different alerting. Pakistan's rules do not (yet, per my sources) make this split, but the *state model* costs nothing to build in and the classification is useful operationally regardless.
2. **The offline QR is generated from a taxpayer certificate, not from the authority's response** — i.e. Poland solved the "you can't print the authority's number before you have it" problem by giving sellers a signing certificate. Pakistan's DI spec has no equivalent that I found, which is precisely why §1.6's gap matters.

### 1.9 What competitor multi-tenant vendors actually do

Honest answer: **very little architecture is published.** I fetched three vendor pages; two disclosed nothing structural. Recording what I did find, with its limits:

- **ezinvoice.pk developer guide** (https://www.ezinvoice.pk/api-guide) — a Pakistani SaaS wrapper in front of PRAL. Their model: *"The seller is identified by `sellerNTNCNIC` in the request body. EZ Invoice matches this to a registered company and uses its **pre-configured FBR token** automatically."* They return HTTP 400 specifically for "No FBR token configured for seller company" and 404 for "Seller company not found", and they persist each invoice locally in one of four states: `Draft`, `Valid`, `Invalid`, `Error`.

  That is a genuine multi-tenant credential design, and two things in it are directly transferable: **(a)** the tenant is resolved from the *invoice's own seller NTN*, so a mis-scoped request fails closed rather than borrowing another tenant's token; **(b)** a **four-state local persistence model that separates `Invalid` (FBR rejected — permanent) from `Error` (submission failed — retryable)**. That distinction is exactly what the outbox in this repo cannot express (§3.3), and it is the crux of §5.3.

- **Nimbus RMS** (https://support.nimbusrms.com/cloud-retail/what-is-fbr-digital-invoicing-software/) — confirms the customer-visible output shape (UIN + QR + FBR digital stamp/logo, "real time" submission) but discloses nothing about credential storage, queueing, or failure behaviour. I asked directly and the page does not answer.

- **The licensed-integrator route** (Rules 150XE–150XQ) is the genuinely interesting strategic option for a SaaS vendor: rather than each restaurant tenant obtaining their own PRAL token, the platform itself becomes a licensed integrator. I have **not** verified the licensing requirements, cost, or whether it changes the credential model (it may allow one integrator token covering many taxpayers, which would invert this entire design). **This is worth a separate investigation before committing to the per-tenant-token design below**, though per-tenant tokens are the safe default that works either way.

---

## 2. What exists in ResturantOS today

### 2.1 There is no fiscalisation anywhere. There is also no sales invoice.

`grep -ril "fbr\|fiscal"` across Java sources returns only:
- `services/reporting-service/.../service/FbrTaxSummaryService.java` — a **reporting** aggregation (output tax − input tax over a period). The UI itself disclaims it: `frontend/app/(tenant)/app/reports/fbr/page.tsx` renders *"internal bookkeeping figures, not an FBR/IRIS e-filing submission."*
- `services/hr-service/.../entity/TaxConfigEntity.java` — FBR **income-tax slabs** for payroll. Unrelated domain.
- Comments in `services/finance-service/.../autopost/AutoPostingRecipeEngine.java` and `services/pos-service/.../service/RefundServiceImpl.java` referring to keeping the FBR Tax Summary honest.

More consequentially: **`services/finance-service` has no invoice entity at all.** Listing `services/finance-service/src/main/java/io/restaurantos/finance/domain/model/` gives `AccountingPeriod`, `ArTransaction`, `ChartOfAccount`, `CustomerAccount`, `Expense`, `JeSequence`, `JournalEntry`, `JournalLine` — journals and receivables, no sales-invoice document. The only `Invoice` types in finance are Feign clients to purchasing (`feign/PurchasingInternalClient.java`), i.e. **vendor** invoices on the AP side.

**Therefore: the POS order *is* the sales invoice in this system.** There is no separate document to fiscalise, no invoice table to hang an FBR number off, and nowhere today that a QR could be attached. Everything below follows from that.

### 2.2 The settlement flow and its single close seam

`services/pos-service/src/main/java/io/restaurantos/pos/service/PaymentServiceImpl.java` — `recordPayment(...)`:
1. loads and tenant-scopes the order; refuses terminal statuses
2. enforces the open-till rule for `CASH`
3. caps `applied` at outstanding balance
4. for `CHARGE_TO_ACCOUNT`, calls finance **first** and lets refusal propagate
5. persists the `OrderPayment`
6. calls `orderService.maybeCloseOrder(orderId)` — and the class comment is explicit that recording a payment "never closes the order directly"

`services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java`:
- `maybeCloseOrder` (line 697) — closes **only** when `paymentStatus == PAID && derivedStatus == SERVED`, otherwise returns the DTO unchanged. Also reachable from `markItemServed` (line 820).
- `performClose` (line 731) — the private method the class comment calls "the POS-23 single seam". In order it: resolves `businessDate` from `closedAt` via `BusinessDay`, asserts the accounting period is open (**fail-closed**), asserts the state transition, sets `CLOSED`/`closedAt`, releases the table, saves, builds item entries, and publishes exactly one `ORDER_CLOSED` event (line 780):

```java
eventPublisher.publish(POS_EXCHANGE, ORDER_CLOSED_KEY, ORDER_CLOSED_TYPE,
        finalOrder.getBranchId(), payload);
```

The comment states the legacy exact-tender close bypass is deleted and its endpoint returns 410, so `maybeCloseOrder`'s Paid-AND-Served path is **the only remaining caller**. That is a genuinely single seam — which is what makes this integration tractable.

`FinancePeriodClient.assertPeriodOpen` is the precedent that matters: **there is already a synchronous, fail-closed, cross-service gate inside `performClose`.** So "block the close on an external system" is an existing, accepted pattern here. That it exists does not mean we should reuse it for FBR (§5.1 argues we must not), but it means the mechanical hook point is proven.

### 2.3 Event payload

`shared-lib/src/main/java/io/restaurantos/shared/event/payload/PosEventContract.java`, `OrderClosedPayload` (line 48): `orderId`, `orderNo`, `type`, `customerId`, `subtotalPaisa`, `discountPaisa`, `serviceChargePaisa`, `taxPaisa`, `totalPaisa`, `payments[]`, `items[]` (`menuItemId`, `itemNameSnapshot`, `quantity`, `unitPriceSnapshot`, `lineTotalPaisa`), `tillSessionId`, `cashierId`, `closedAt`, `businessDate`.

**This payload is insufficient for an FBR submission.** Missing: per-line tax amount (`OrderItem.taxPaisa` exists on the entity — `services/pos-service/.../domain/model/OrderItem.java:59` — but is not carried in `ItemEntry`), HS code, UoM, `saleType`, and any buyer identity beyond `customerId`. Extending the contract is unavoidable (§4.4).

### 2.4 Tax data available today

- `services/pos-service/.../domain/model/MenuItem.java:34-38` — `tax_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 0` and a **currently-unused `tax_rate_code TEXT`**.
- `services/pos-service/.../service/OrderPricingCalculator.java:56` — `perLineTax(lineNetPaisa, taxRatePct)`, HALF_UP to the paisa; `LineResult(subtotalPaisa, discountPaisa, taxPaisa, lineTotalPaisa)`.
- `services/pos-service/.../domain/model/Order.java:63` and `OrderItem.java:59` — `taxPaisa` persisted at both levels.

So the arithmetic FBR wants (`valueSalesExcludingST`, `salesTaxApplicable`, `rate`, `discount`) is **derivable per line today**. What is absent is the FBR *taxonomy*: `hsCode`, `uoM`, `saleType`, `sroScheduleNo`. `tax_rate_code` is a ready-made column for the `rate` string (`"18%"`) but the rest needs new fields on `MenuItem`.

### 2.5 Seller identity is already modelled — at branch level

`services/user-service/src/main/java/io/restaurantos/user/entity/BranchEntity.java`:

```java
@Column(name = "fbr_strn", length = 50) private String fbrStrn;
@Column(name = "ntn", length = 50)      private String ntn;
@Column(name = "timezone", nullable = false, length = 64) private String timezone = "Asia/Karachi";
@JdbcTypeCode(SqlTypes.JSON) @Column(name = "receipt_config", columnDefinition = "jsonb") private String receiptConfig;
```

NTN and STRN are **plaintext `varchar(50)`** — appropriate, they are public business identifiers, not secrets. They are exposed on the internal branch DTO (`services/user-service/.../dto/BranchDtos.java:45-46`) and already consumed by reporting (`services/reporting-service/.../feign/UserInternalClient.java:38`).

Two things follow. First, **seller identity is per-branch, not per-tenant** — which is correct for Pakistan, where a multi-branch restaurant group may hold separate STRNs. The credential model must therefore be branch-aware (§4.2). Second, `receipt_config` jsonb is the natural home for the FBR logo/QR print toggles.

### 2.6 Field encryption — **`EncryptionService` + `EncryptedStringConverter`**

This is the answer to "the repo has field encryption — find it, name the class". Two classes in `shared-lib`:

**`shared-lib/src/main/java/io/restaurantos/shared/security/EncryptionService.java`** — AES-GCM:
- `AES/GCM/NoPadding`, 12-byte IV from `SecureRandom`, 128-bit auth tag
- key from a base64 string: `new SecretKeySpec(Base64.getDecoder().decode(base64Key), "AES")`
- ciphertext layout is `IV || ciphertext+tag` in one `byte[]`
- `encrypt(null)` / `decrypt(null)` return `null`; any failure throws `IllegalStateException`

**`shared-lib/src/main/java/io/restaurantos/shared/security/EncryptedStringConverter.java`** — a JPA `AttributeConverter<String, byte[]>` wired via a **static** `init(EncryptionService)`.

**`shared-lib/src/main/java/io/restaurantos/shared/config/EncryptionAutoConfiguration.java`** — `@ConditionalOnProperty(name = "restaurantos.encryption.key")`; constructs the service and calls `EncryptedStringConverter.init(service)`.

⚠️ **The `@ConditionalOnProperty` is a live footgun for this feature.** If `restaurantos.encryption.key` is unset, the autoconfiguration silently does not run, `EncryptedStringConverter.encryptionService` stays `null`, and the first write throws `NullPointerException` — at runtime, on a sale. Existing consumers tolerate this because they encrypt PII that is written rarely. A fiscalisation credential read on the settlement path must not inherit that. **Add a startup assertion in the fiscalisation module that fails fast if the key is absent.**

**Precedent to copy — `services/hr-service/src/main/java/io/restaurantos/hr/entity/AttendanceDeviceEntity.java:53`:**

```java
@Convert(converter = EncryptedStringConverter.class)
@Column(name = "device_token", columnDefinition = "bytea", nullable = false)
private String deviceToken;
```

Its class comment describes it as "the device's shared secret, field-encrypted (AES-256-GCM) into a `bytea` column exactly like employee PII." That is *structurally identical* to an FBR bearer token: a long-lived, per-tenant, externally-issued shared secret. Also see `services/auth-service/.../entity/UserEntity.java:37`.

### 2.7 The transactional outbox — and what it is not

`shared-lib/src/main/java/io/restaurantos/shared/event/`:

- **`DomainEventPublisher.java`** — `@Transactional publish(...)`: builds an `EventEnvelope`, serialises with Jackson, INSERTs an `OutboxEntry` **inside the caller's business transaction**. Comment: "resolves MAJOR-12 … The OutboxRelay polls and delivers to RabbitMQ at-least-once after commit."
- **`OutboxEntry.java`** — `event_outbox`: `eventId`, `exchange`, `routingKey`, `eventType`, `tenantId`, `branchId`, `correlationId`, `source`, `envelopeJson`, `status` (**`PENDING | SENT` only**), `createdAt`, `sentAt`.
- **`OutboxRelay.java`** — `@Scheduled(fixedDelay = 1000) @Transactional relay()`: `findTop200ByStatusOrderByCreatedAtAsc("PENDING")`, publishes raw UTF-8 bytes with `contentType=application/json` (the SC5 double-encode fix), sets `SENT`.
- **`OutboxRepository.java`** — one query: `findTop200ByStatusOrderByCreatedAtAsc`.

DDL: `services/pos-service/src/main/resources/db/migration/V2__pos_infra_tables.sql` — explicitly **NON-RLS**: *"relay and idempotency run outside tenant request context."*

**This outbox cannot serve as the FBR retry queue.** Concretely, it has:
- no `attempts` column, no `next_attempt_at`, no backoff — it re-polls every 1000 ms, forever
- no `FAILED`/`DEAD` terminal state — a permanently-rejected submission would be retried every second until the heat death of the database
- no response storage — nowhere to persist `invoiceNumber`, `dated`, `errorCode`
- an all-or-nothing transaction — one throwing entry rolls back the whole batch of 200

Compare the **frontend** outbox, which already has the shape we need: `frontend/lib/offline/outbox.ts` carries `attempts`, `MAX_ATTEMPTS = 5`, and a terminal `DEAD` status so a failing op "stops counting toward the queued badge and stops being auto-retried on every reconnect" — with `frontend/lib/offline/db.ts` backing it in IndexedDB.

**Design conclusion: use the existing outbox for what it is good at — reliably emitting `ORDER_CLOSED` after commit — and build a separate `fbr_submissions` table with real retry semantics as the fiscalisation queue.** The two are different problems: the outbox guarantees *in-process delivery to our own broker*; fiscalisation needs *durable, backed-off, classifiable retry against a third party that can reject us permanently*.

### 2.8 Per-tenant feature flags

`services/platform-admin-service` (a **non-RLS** `platform_db`):

- **`entity/TenantFeatureEntity.java`** — `tenant_features(tenant_id, feature_code, is_enabled, is_override, config_json jsonb)`, composite key `(tenantId, featureCode)`. `is_override` marks a deliberate SuperAdmin decision so tier reconciliation skips it — the comment: "a SuperAdmin override is authoritative over tier defaults".
- **`config/TierFeatureDefaults.java`** — the tier matrix. STARTER-and-above: `FEATURE_POS`, `FEATURE_INVENTORY`, `FEATURE_FINANCE`, `FEATURE_VENDOR`, `FEATURE_HR`, `FEATURE_PAYROLL`, `FEATURE_CRM`, `FEATURE_LOYALTY`, `FEATURE_KDS`. GROWTH+: `FEATURE_MULTI_BRANCH`, `FEATURE_REPORTING_ADVANCED`, `FEATURE_WHATSAPP_NOTIFICATIONS`, `FEATURE_CUSTOM_ROLES`, `FEATURE_AUDIT_EXPORT`, `FEATURE_LOT_TRACKING`, `FEATURE_NLQ`, `FEATURE_ANALYTICS`, `FEATURE_ECOMMERCE`. ENTERPRISE+: `FEATURE_WHITE_LABEL_DOMAIN`, `FEATURE_CONSOLIDATED_REPORTING`.
- **`service/FeatureFlagAdminService.java`** — `setFeature` (always sets `is_override = true`), `reconcileToTierDefaults` (skips overridden rows **in both directions**), and `invalidateBothKeyShapes` which **SETs** (not deletes) both Redis keys: `tenant_features:{tenantId}:{code}` (gateway) and `feature:{tenantId}:{code}` (service aspect). The comment explains DELETE would fail-close to "false" until TTL.
- **`controller/FeatureFlagPublicController.java`** — `GET /api/v1/feature-flags` returns enabled codes for the caller's tenant.
- **`gateway/src/main/java/io/restaurantos/gateway/support/RouteFeatureMap.java`** — path-prefix → feature code, first match wins.
- **`shared-lib/.../feature/RedisFeatureFlagService.java`** — read-through with 300 s TTL, **fail-closed** on lookup failure but never caches the failure.

**Three hard-won constraints this repo has already paid for, which a new flag must respect:**

1. `TierFeatureDefaults`'s class comment: *"This set must stay closed over the gateway's route→feature map."* A code that `RouteFeatureMap` gates on but that appears in **no** tier set can be granted to nobody — every request 403s indistinguishably from an unpurchased module. This has shipped twice (purchasing, NLQ). `FeatureCodeClosureTest` now fails the build on it.
2. The same comment: feature codes must be written in that file's *comments* only in **split form** (`"FEATURE_" + "X"`), because `frontend/__tests__/lib/nav-feature-flags.test.ts` regex-scrapes the file for `/FEATURE_[A-Z_]+/` to detect drift. Naming a code whole in prose silently admits it to the set.
3. `TenantFeatureEntity.config_json` (jsonb) already exists and is unused by the services I read. It is tempting as the credential store — **do not use it for the token** (§4.2).

### 2.9 Order numbering

`services/pos-service/.../domain/model/OrderSequence.java` — `order_sequences(tenant_id, branch_id, business_date, last_seq)`, allocated in `OrderServiceImpl.java:1052` via `sequenceRepository.findForUpdate(tenantId, branchId, LocalDate.now())` (pessimistic row lock). So `orderNo` is a **per-tenant, per-branch, per-day** sequence.

### 2.10 Cross-tenant scheduled work — the precedent and its trap

`services/hr-service/.../service/LeaveAccrualScheduler.java` is the model for a background worker that must touch every tenant: enumerate tenants via a `SECURITY DEFINER` SQL function (`SELECT tenant_id FROM hr_tenant_ids()` — `LeaveService.java:228`), then per tenant `tenantContext.set(...)` so `TenantAwareDataSource` scopes the connection, `try/catch/finally` per tenant so one failure never aborts the run, and **idempotency in the domain table, not in the cron** ("`@Scheduled` fires on every replica").

And read `deploy/init/05-hr-fn-owner.sql` before writing any such function. It documents two defects that both bit this repo:
1. `SECURITY DEFINER` runs as the function **owner**; Liquibase connects as the app user, so the app user owned the function, and `FORCE RLS` binds the owner too — the function returned **zero rows** silently. Invisible in tests, because Testcontainers makes `POSTGRES_USER` a **superuser**.
2. Postgres grants `EXECUTE` to `PUBLIC` by default — any role on the DB could enumerate every tenant and read device tokens.

**A fiscalisation retry worker enumerating tenants will hit both.** Budget for the `ALTER FUNCTION ... OWNER TO postgres` + `REVOKE ALL ... FROM PUBLIC` step and an init-script entry alongside `05-hr-fn-owner.sql`.

### 2.11 No QR library is present

`grep` for `zxing|qrcode|QRCode` across every `pom.xml` and `package.json` returns **nothing**. A QR dependency must be added (server-side `com.google.zxing:core` + `javase` is the obvious choice; I have **not** verified a current version and will not guess one).

---

## 3. Design

### 3.1 Where fiscalisation hooks into the settlement flow

**Hook point: `OrderServiceImpl.performClose`, as a second event published beside `ORDER_CLOSED` — not as a synchronous call.**

```
recordPayment ──▶ maybeCloseOrder ──▶ performClose
                                        │  (inside the business transaction)
                                        ├─▶ assertPeriodOpen        [existing, synchronous, fail-closed]
                                        ├─▶ order.status = CLOSED
                                        ├─▶ INSERT event_outbox: ORDER_CLOSED       [existing]
                                        └─▶ INSERT fbr_submissions (status=PENDING) [NEW, same txn]
                                                    │
                                                    │ after commit
                                            FbrSubmissionWorker (@Scheduled)
                                                    │
                                     ┌──────────────┴───────────────┐
                                     ▼                              ▼
                          POST postinvoicedata            classify failure
                          statusCode "00"                 transient → backoff
                                     │                    permanent → REJECTED
                                     ▼
                        store invoiceNumber + dated,
                        render QR, status=FISCALISED
                                     │
                                     ▼
                         publish ORDER_FISCALISED  ──▶ WebSocket to the till
                                                   ──▶ receipt reprint available
```

Rationale for this exact placement:

- **Inside the transaction, so the row cannot be lost.** Same guarantee `DomainEventPublisher` gives: the submission row commits atomically with the `CLOSED` status. There is no window where an order is closed but unqueued.
- **Not a Feign/HTTP call inside `performClose`.** `assertPeriodOpen` sets a precedent for synchronous gating, but it calls *our own* service. Calling `gw.fbr.gov.pk` there would put a third-party network round-trip inside a database transaction that holds locks on `orders` and (via `recordPayment`) potentially `order_sequences`. A PRAL slowdown would convert into pool exhaustion and a dead POS. This is the single most important "don't" in the design.
- **A dedicated table, not the outbox**, for the reasons in §2.7.
- **Not in finance-service**, because there is no invoice there to attach a fiscal number to (§2.1), and because the fiscal identifier belongs on the document the customer receives, which pos-service owns.

**Refunds:** `RefundServiceImpl` must eventually emit FBR credit notes (`invoiceType` supports `"Debit Note"`; error codes 0026/0027/0029/0034 describe credit/debit note rules including a 180-day window). Out of scope for the first slice, but the `fbr_submissions` table should carry a `document_type` column from day one so the refund path is a row-value change, not a migration.

### 3.2 Per-tenant credential storage

**New table in `pos-service`, `fbr_credentials`, using `EncryptedStringConverter`.**

```sql
CREATE TABLE fbr_credentials (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    branch_id       UUID        NOT NULL,          -- seller identity is per-branch (§2.5)
    environment     TEXT        NOT NULL,          -- SANDBOX | PRODUCTION  (see §1.2)
    seller_ntn_cnic TEXT        NOT NULL,
    seller_business_name TEXT   NOT NULL,
    seller_province TEXT        NOT NULL,
    seller_address  TEXT        NOT NULL,
    api_token       BYTEA       NOT NULL,          -- @Convert(EncryptedStringConverter)
    token_added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    token_expires_at TIMESTAMPTZ,                  -- PRAL tokens are 5-year (§1.3)
    last_success_at TIMESTAMPTZ,
    active          BOOLEAN     NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_fbr_cred UNIQUE (tenant_id, branch_id, environment)
);
ALTER TABLE fbr_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fbr_credentials
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
```

The RLS policy shape is copied verbatim from `services/pos-service/src/main/resources/db/migration/V1__pos_schema.sql:26-28`.

Entity field, mirroring `AttendanceDeviceEntity:53`:

```java
@Convert(converter = EncryptedStringConverter.class)
@Column(name = "api_token", columnDefinition = "bytea", nullable = false)
private String apiToken;
```

**Rules this must follow:**

- **Never return the token on any read path.** The admin DTO exposes a masked hint (last 4 chars) and `token_added_at` only. Write-only via `PUT`; there is no `GET` that decrypts.
- **`environment` is enforced by us.** Because PRAL routes by token and not by URL (§1.2), a wrong token files test data as real. The submission worker must assert `credential.environment == submission.environment` and refuse otherwise, loudly.
- **Do not store the token in `TenantFeatureEntity.config_json`.** It is tempting — the column exists and is jsonb — but `platform_db` is explicitly **non-RLS** (`TenantFeatureEntity` class comment), the flag rows are read by SuperAdmin tooling and mirrored into Redis by `FeatureFlagAdminService.invalidateBothKeyShapes`, and `FeatureFlagPublicController` serves flag state to **every authenticated tenant user**. A secret in that blast radius is a secret in Redis and one refactor away from a public endpoint. Config that is *not* secret (submission mode, default `saleType`, whether to block on failure) is a perfectly good fit for `config_json`.
- **Assert `restaurantos.encryption.key` at startup** (§2.6) rather than discovering it via NPE during a sale.
- **Audit every credential write** through the existing audit-service, with actor and branch. Consider gating the write behind the existing TOTP step-up (the repo has step-up gating — `frontend/__tests__/lib/step-up-gated-actions.test.ts`, and commit `6da5fb2` mints step-up as a JWT claim).

### 3.3 The per-tenant toggle

**Add `FEATURE_FBR_DIGITAL_INVOICING`** to `TierFeatureDefaults`.

Placement recommendation: **GROWTH-and-above**, alongside the other compliance/premium surfaces, defaulting **off for STARTER**. Rationale: it is a chargeable integration with real support cost, and — crucially — enabling it for a tenant with no credentials configured must be harmless. But note the counter-argument honestly: FBR DI is a **legal obligation** above a turnover threshold, not a luxury, so gating it by price tier may be commercially wrong even if it is architecturally convenient. **This is a business decision, not a technical one — flag it to the product owner.** The mechanism works either way.

Mandatory mechanics, from §2.8:
1. **Do not add a `RouteFeatureMap` prefix for it unless the code is in a tier set.** `FeatureCodeClosureTest` enforces closure; violating it produces the phantom-flag 403 that has already shipped twice here.
2. **Write the code in `TierFeatureDefaults` comments only as `"FEATURE_" + "FBR_DIGITAL_INVOICING"`**, or `frontend/__tests__/lib/nav-feature-flags.test.ts`'s regex scrape silently absorbs it and stops detecting drift.
3. Admin routes (`/api/v1/pos/fbr/**`) sit under the existing `/api/v1/pos/` prefix, which `RouteFeatureMap` does **not** currently gate — so use the `@RequiresFeature` aspect (`shared-lib/.../feature/RequiresFeature.java`) on the controller rather than adding a gateway prefix.

**The flag is not the switch that decides whether a sale fiscalises.** Three independent conditions must hold, checked in this order, all fail-closed:
1. `FEATURE_FBR_DIGITAL_INVOICING` enabled for the tenant, **and**
2. an `active` `fbr_credentials` row exists for `(tenant, branch, environment)`, **and**
3. the branch has a non-null `ntn` (`BranchEntity.ntn`).

If any is false, `performClose` writes **no** submission row and behaves exactly as today. This is what makes the feature safely inert for the ~all tenants who do not use it, and it means the rollout risk to existing behaviour is a single `if`.

### 3.4 Retry / queue model

**New table, `fbr_submissions`, in pos-service — RLS-enabled, following `V1__pos_schema.sql`:**

```sql
CREATE TABLE fbr_submissions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL,
    branch_id           UUID        NOT NULL,
    order_id            UUID        NOT NULL,
    document_type       TEXT        NOT NULL,   -- SALE_INVOICE | DEBIT_NOTE (refunds later)
    environment         TEXT        NOT NULL,   -- SANDBOX | PRODUCTION
    status              TEXT        NOT NULL,   -- PENDING|IN_FLIGHT|FISCALISED|REJECTED|DEAD
    request_json        TEXT        NOT NULL,   -- the exact payload, frozen at close
    fbr_invoice_number  TEXT,                   -- "7000007DI1747119701593"
    fbr_dated           TEXT,
    response_json       TEXT,
    error_code          TEXT,                   -- validationResponse.errorCode, e.g. "0052"
    error_message       TEXT,
    attempts            INT         NOT NULL DEFAULT 0,
    next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    offline_marked      BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    fiscalised_at       TIMESTAMPTZ,
    CONSTRAINT uq_fbr_submission UNIQUE (tenant_id, order_id, document_type)
);
ALTER TABLE fbr_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fbr_submissions
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
```

`UNIQUE (tenant_id, order_id, document_type)` **is the idempotency key** — the `LeaveAccrualScheduler` lesson (§2.10): idempotency lives in the domain table, never in the cron, because `@Scheduled` fires on every replica.

**`request_json` is frozen at close time and never recomputed.** If a menu item's `tax_rate_pct` or HS code changes overnight, a retry the next morning must resubmit what was actually sold, not what the menu now says.

**State machine:**

| From | Event | To |
|---|---|---|
| — | order closed, all 3 conditions met | `PENDING` |
| `PENDING` | worker claims | `IN_FLIGHT` |
| `IN_FLIGHT` | HTTP 200 + `validationResponse.statusCode == "00"` | `FISCALISED` |
| `IN_FLIGHT` | HTTP 200 + `statusCode == "01"` (data is wrong) | `REJECTED` (terminal, needs a human) |
| `IN_FLIGHT` | 401 | `REJECTED` + **disable credential, alert tenant** |
| `IN_FLIGHT` | timeout / connect failure / 5xx | `PENDING`, `attempts++`, backoff |
| `PENDING` | `attempts >= MAX_ATTEMPTS` | `DEAD` (terminal, operator action) |

The `REJECTED` vs `DEAD` split mirrors ezinvoice.pk's `Invalid` vs `Error` (§1.9) and the frontend outbox's `FAILED` vs `DEAD` (`frontend/lib/offline/outbox.ts`). It matters operationally: `REJECTED` means *our data is wrong* (bad HS code, unregistered buyer) and no amount of retrying fixes it; `DEAD` means *we could not reach them enough times* and a human should retry once the network is back.

**Backoff:** exponential with jitter, e.g. 5 s, 30 s, 2 m, 10 m, 30 m, then hourly, capped. `MAX_ATTEMPTS` should be generous — this is a *legal* obligation with a 24-hour window (§1.7), so giving up after 5 attempts (the frontend's number) is wrong here. Prefer a **time bound over an attempt bound**: keep retrying until the 24-hour compliance window is breached, then escalate to `DEAD` **plus an alert**, rather than silently stopping.

**Worker:** `@Scheduled(fixedDelay = ...)` following `OutboxRelay`'s shape but with three differences it must not inherit: claim rows with `SELECT ... FOR UPDATE SKIP LOCKED` (replica-safe), process **one row per transaction** (so one failure does not roll back the batch), and set `IN_FLIGHT` before the HTTP call with a stale-reclaim timeout. Tenant enumeration follows `LeaveAccrualScheduler` — and see §2.10 for the `SECURITY DEFINER` ownership trap that **will** otherwise make it silently return zero rows.

**Timeouts must be aggressive** (connect 3 s / read 10 s). Requeueing is cheap; a worker thread parked on a hung PRAL connection is not.

### 3.5 Must a failed fiscalisation block the sale?

**No. Queue it. Blocking is both non-compliant with the spirit of the rules and operationally indefensible.**

Evidence:

1. **The regulation explicitly permits it.** Rules 150T–150XD: *"Invoices issued during periods of disruption (such as power or internet outages) must be clearly marked as offline and uploaded within 24 hours."* If offline issuance were forbidden, this rule would not exist.
2. **Comparative practice agrees.** Poland's KSeF offline24 lets the seller issue with full legal validity — *"valid from the moment it is issued"* — and submit within 1 business day; a declared system failure extends that to 7 (https://www.sparados.com/en/post/ksef-system-failure-how-offline-mode-works).
3. **The failure mode of blocking is catastrophic and asymmetric.** A restaurant at Friday dinner rush cannot tell a queue of customers that the tax authority is unreachable. Blocking converts a third-party outage into total revenue loss, and — worse in this codebase — it would sit inside `performClose`, which holds a DB transaction and is called from `recordPayment` **after money has been taken**. The customer has paid; refusing to close the order does not un-take the payment, it just strands the till.
4. **PRAL publishes no availability SLA that I could find**, and the spec documents only `200/401/500` with no 429/503 — i.e. no rate-limit contract to design against. Coupling revenue to an unmeasured dependency is not a defensible trade.

**What we do instead:**
- The sale closes. The order is `CLOSED`, the payment stands, the revenue journal posts (`OrderClosedConsumer` → `AutoPostingRecipeEngine`) — all unchanged.
- The receipt prints immediately, **marked as an offline invoice** with the tenant's own `orderNo`, and *without* an FBR number or QR (we do not have them — §1.6).
- The submission queues. On success, `ORDER_FISCALISED` is published; the till shows the fiscal number and a **reprint / re-issue** action becomes available, and the QR can be rendered.
- A visible per-branch counter of unfiscalised invoices with age, mirroring the frontend's existing sync badge (`frontend/lib/offline/outbox.ts` → `emitProgress`).
- **Alert before the 24-hour window closes**, not after.

**Two carve-outs where blocking is defensible**, both opt-in per tenant via `config_json`:
- **`REJECTED` on a B2B invoice for a registered buyer** who needs the fiscal number for input-tax credit — arguably worth refusing at order entry (before payment) rather than at close.
- **A tenant who explicitly chooses strict mode** for their own compliance-risk reasons. Offer it; never default to it.

**UNVERIFIED and important:** what the offline receipt must legally display in place of the FBR number and QR. Rule 150R says the QR is "based on the unique invoice number assigned by the Board" — which we do not have offline. Poland solved this with a taxpayer signing certificate; I found no Pakistani equivalent in the PRAL spec. **Resolve with a tax advisor or FBR before printing anything customer-facing.** This is the highest-risk open question in the document.

### 3.6 Invoice numbering

Three distinct numbers, which must not be conflated:

| Number | Owner | Where | Format |
|---|---|---|---|
| `orderNo` | us | `order_sequences(tenant, branch, business_date, last_seq)`, `OrderServiceImpl.java:1052` | existing |
| Seller invoice no. | us | **UNVERIFIED whether required** (§1.5) | must satisfy error 0088: alphanumeric with `-` between alphanumerics, e.g. `Inv-001` |
| FBR invoice no. | FBR | `fbr_submissions.fbr_invoice_number` | `7000007DI1747119701593`; per-item `…-1` |

Recommendation: **do not overload `orderNo`.** Derive a separate, gapless, per-branch, per-fiscal-year sales-invoice number for FBR purposes (`{STRN}-{FY}-{seq}`), allocated with the same `findForUpdate` pessimistic-lock pattern `OrderSequence` already uses. Reasons: `orderNo` resets daily and is a *kitchen* identifier that staff read aloud; a tax invoice number must be gapless and auditable across a fiscal year; and voided orders consume `orderNo` values in ways a tax authority will question. The repo already has fiscal-year logic to reuse — `frontend/lib/utils/pakistan-fiscal-year.ts`.

Allocate the invoice number **at close, inside `performClose`'s transaction**, not at submission time — otherwise a retry after a restart could allocate a second number for the same sale.

### 3.7 QR code

Verified requirements (§1.6): **Version 2.0 (25×25), 1.0 × 1.0 inch**, plus the FBR DI logo, on every invoice.

**Payload content is UNVERIFIED.** Do not guess. The strong inference from Rule 150R is that it encodes the FBR-assigned `invoiceNumber` (possibly as a verification URL), but the PRAL spec does not say, and an incorrect payload means every printed receipt is non-compliant.

Implementation notes:
- Render **server-side** in pos-service after `FISCALISED`, store as a PNG/SVG blob or regenerate on demand from `fbr_invoice_number`. Server-side keeps it identical across the web till, printer, and any PDF.
- **Add a QR dependency** — none exists (§2.11). `com.google.zxing:core` + `com.google.zxing:javase` is the conventional choice; **I have not verified a current version number and will not invent one** — check Maven Central at implementation time.
- A 25×25 symbol at 1 inch is ~25 modules/inch. On a 203 dpi thermal printer that is ~8 dots per module — adequate, but it must be verified on real hardware, not assumed.
- The FBR DI logo is a supplied image asset; obtain it from FBR rather than recreating it.

### 3.8 Data the payload needs that we do not have

To build a `postinvoicedata` body we must add:

| FBR field | Source | Status |
|---|---|---|
| `sellerNTNCNIC`, `sellerBusinessName`, `sellerProvince`, `sellerAddress` | `fbr_credentials` / `BranchEntity` | `ntn` exists; province/address need normalising out of `BranchEntity.address` jsonb |
| `buyerNTNCNIC`, `buyerBusinessName`, `buyerProvince`, `buyerAddress`, `buyerRegistrationType` | crm-service customer | **Missing.** Walk-in diners have no NTN → `"Unregistered"`, but `buyerBusinessName`/`buyerProvince`/`buyerAddress` are marked **Required** in the spec (errors 0010/0073/0074). **How an unregistered walk-in satisfies these is UNVERIFIED and must be tested in sandbox** — it is the single most likely blocker for restaurant use. |
| `hsCode` | `MenuItem` | **Missing** — new column; error 0019/0044 make it mandatory |
| `uoM` | `MenuItem` | **Missing** — must match the HS code (error 0099) |
| `rate` | `MenuItem.taxRateCode` | column exists, currently unused — repurpose to hold `"18%"` |
| `saleType` | `MenuItem` or branch default | **Missing** — required (error 0013) |
| `valueSalesExcludingST`, `salesTaxApplicable`, `discount`, `quantity` | `OrderItem` | derivable today (§2.4) |
| `scenarioId` | fixed per sandbox test | sandbox only |

Also: `PosEventContract.ItemEntry` does not carry `taxPaisa` (§2.3). If the payload is built from the event rather than from the entity, extend the contract. **Building it from the entity inside `performClose` avoids the contract change entirely** and is the recommended route.

**FBR amounts are `Double` rupees; ours are `long` paisa.** Convert once, in one place, with an explicit rounding policy, and unit-test it. Every floating-point tax bug in history started as an implicit conversion at a service boundary.

---

## 4. Rollout

1. **Sandbox first, always.** `environment` defaults to `SANDBOX`; promotion to `PRODUCTION` is a deliberate, audited, per-branch action. Because the URL does not change (§1.2), this guard is entirely ours to enforce.
2. **Shadow mode.** A `config_json` setting that builds and persists `request_json` but does not POST. Lets us validate payload construction against real orders with zero regulatory exposure.
3. **`validateinvoicedata` before `postinvoicedata`** during onboarding — the spec provides it precisely for pre-flight checks, and it costs one round-trip to catch a systematically-wrong HS code before it becomes 500 rejected invoices.
4. **Sandbox scenarios.** The spec has a *Scenarios for Sandbox Testing* section (§9) and *Applicable Scenarios based on Business Activity* (§10) driving `scenarioId` (e.g. `SN001`). I did not read pages 45–50; **read them before onboarding** to determine which scenario IDs apply to restaurant/food-service activity.
5. **Reference APIs.** Spec §5 lists 12 lookup endpoints (Province Code, Document Type ID, Item Code, SRO Item ID, Transaction Type ID, UOM ID, SRO Schedule, Rate ID, HS Code with UOM, STATL). These are how HS codes and UoMs get validated at menu-configuration time rather than at sale time. **Read pages 21–33 before building the menu admin UI** — I did not.

---

## 5. Open questions (blocking)

1. **What does the QR encode?** Unspecified in the PRAL doc (§1.6). Blocks every customer-facing receipt.
2. **What must an offline receipt display** in place of the FBR number/QR, and does the 24-hour clock run from issuance or from restoration? (§1.7, §3.5)
3. **Is a seller-supplied invoice number required** in `postinvoicedata`? Error codes say yes, the sample JSON says no. (§1.5)
4. **How does an unregistered walk-in diner satisfy the Required `buyerBusinessName` / `buyerProvince` / `buyerAddress` fields?** (§3.8) Most likely blocker for restaurant use specifically.
5. **Licensed-integrator route** (Rules 150XE–150XQ): could ResturantOS itself be licensed, and would that replace per-tenant tokens with one platform token? Would invert §3.2. (§1.9)
6. **Tier placement** of `FEATURE_FBR_DIGITAL_INVOICING` — commercial decision. (§3.3)

All six are answerable with a sandbox token and a tax advisor. **None require code to investigate**, and all should be closed before implementation starts.

---

## 6. Sources

**Primary (fetched and read directly)**
- PRAL, *Technical Specification for DI API* v1.10 (24-May-2025) — https://download1.fbr.gov.pk/Docs/20256201364855300TechnicalDocumentationforDIAPI.pdf — pages 1–16, 34–40
- EY Global, *Pakistan amends sales tax rules for implementation of electronic invoicing* — https://www.ey.com/en_gl/technical/tax-alerts/pakistan-amends-sales-tax-rules-for-implementation-of-electronic-invoicing
- Sparados, *KSeF System Failure: How Offline Invoicing Works in Poland* — https://www.sparados.com/en/post/ksef-system-failure-how-offline-mode-works
- EZ Invoice, *FBR Digital Invoicing API Documentation* — https://www.ezinvoice.pk/api-guide (third-party wrapper; their endpoints are **not** PRAL's)
- Nimbus RMS support — https://support.nimbusrms.com/cloud-retail/what-is-fbr-digital-invoicing-software/ (no architectural detail)

**Attempted, not extractable** (PDF streams returned unparseable)
- SRO 69(I)/2025 — https://download1.fbr.gov.pk/Docs/202541712407495sro69(I)2025.pdf
- STGO 01 of 2026 — https://download1.fbr.gov.pk/Docs/2026331133557466STGO01of2026.pdf

**Repo files read**
`services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java` ·
`services/pos-service/src/main/java/io/restaurantos/pos/service/PaymentServiceImpl.java` ·
`services/pos-service/src/main/java/io/restaurantos/pos/service/OrderPricingCalculator.java` ·
`services/pos-service/src/main/java/io/restaurantos/pos/domain/model/{Order,OrderItem,MenuItem,OrderSequence}.java` ·
`services/pos-service/src/main/resources/db/migration/{V1__pos_schema.sql,V2__pos_infra_tables.sql}` ·
`shared-lib/src/main/java/io/restaurantos/shared/security/{EncryptionService,EncryptedStringConverter}.java` ·
`shared-lib/src/main/java/io/restaurantos/shared/config/EncryptionAutoConfiguration.java` ·
`shared-lib/src/main/java/io/restaurantos/shared/event/{DomainEventPublisher,OutboxEntry,OutboxRelay,OutboxRepository}.java` ·
`shared-lib/src/main/java/io/restaurantos/shared/event/payload/PosEventContract.java` ·
`shared-lib/src/main/java/io/restaurantos/shared/feature/RedisFeatureFlagService.java` ·
`services/platform-admin-service/src/main/java/io/restaurantos/platform/entity/TenantFeatureEntity.java` ·
`services/platform-admin-service/src/main/java/io/restaurantos/platform/config/TierFeatureDefaults.java` ·
`services/platform-admin-service/src/main/java/io/restaurantos/platform/service/FeatureFlagAdminService.java` ·
`services/platform-admin-service/src/main/java/io/restaurantos/platform/controller/FeatureFlagPublicController.java` ·
`services/platform-admin-service/src/main/java/io/restaurantos/platform/repository/TenantFeatureRepository.java` ·
`gateway/src/main/java/io/restaurantos/gateway/support/RouteFeatureMap.java` ·
`services/user-service/src/main/java/io/restaurantos/user/entity/BranchEntity.java` ·
`services/hr-service/src/main/java/io/restaurantos/hr/entity/AttendanceDeviceEntity.java` ·
`services/hr-service/src/main/java/io/restaurantos/hr/service/LeaveAccrualScheduler.java` ·
`services/finance-service/src/main/java/io/restaurantos/finance/autopost/consumer/OrderClosedConsumer.java` ·
`deploy/init/05-hr-fn-owner.sql` ·
`frontend/lib/offline/{outbox.ts,db.ts}` ·
`frontend/app/(tenant)/app/reports/fbr/page.tsx`
