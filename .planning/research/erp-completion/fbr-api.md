# FBR (Pakistan) Digital Invoicing API — Research Findings

**Researched:** 2026-08-07
**Scope:** Is FBR e-invoicing buildable into ResturantOS, and what exactly is the contract?

## How to read this document

Every claim is tagged:

- **[VERIFIED-PRIMARY]** — extracted from a document I downloaded from an official FBR/PRAL
  domain (`download1.fbr.gov.pk`, `fbr.gov.pk`) or observed by directly calling the live API.
- **[VERIFIED-THIRD-PARTY]** — from a non-government source I actually fetched (GitHub,
  Packagist). Real, but not authoritative for the contract.
- **[HEARSAY]** — blog/news claim I could not confirm against a primary document. Treat as a
  lead, not a fact.
- **[UNVERIFIED]** — I looked and could not establish it. Explicitly not filled in with a guess.

---

## 1. Bottom line

**Yes, there is a publicly documented API, and the full invoice payload schema is public.**
PRAL (Pakistan Revenue Automation Pvt Ltd, FBR's IT arm) publishes the complete technical
specification as a free PDF on FBR's own download server — no registration needed to *read* it.

**But you cannot call any endpoint, not even the read-only lookup endpoints, without a bearer
token that is issued per-taxpayer through the IRIS portal.** I confirmed this by calling the
API. There is **no developer self-service sandbox**. A sandbox token is minted only after a
real taxpayer (with a real NTN) logs into IRIS, nominates a licensed integrator, and submits
their server IP addresses for whitelisting.

So: schema work can start today with high confidence. Wire-level testing is blocked on a real
Pakistani taxpayer account.

---

## 2. Primary source documents

All of these I downloaded and text-extracted myself.

| Document | Version / Date | URL |
|---|---|---|
| Technical Specification for DI API | **v1.12**, issued 7-Apr-2025, last updated **24-July-2025** | https://download1.fbr.gov.pk/Docs/20257301172130815TechnicalDocumentationforDIAPIV1.12.pdf |
| Technical Specification for DI API (earlier print) | v1.0-era | https://download1.fbr.gov.pk/Docs/20254171241855429TechnicalSpecificationforDIAPI.pdf |
| Digital Invoicing User Manual | Doc 1.0, PRAL © 2025 | https://download1.fbr.gov.pk/Docs/20254171643756444DI-User-Manual.pdf |
| S.R.O. 69(I)/2025 | 29 January 2025 | https://download1.fbr.gov.pk/Docs/202541712407495sro69(I)2025.pdf |
| Sales Tax General Order #01 of 2026 | 30 March 2026 | https://download1.fbr.gov.pk/Docs/2026331133557466STGO01of2026.pdf |
| Point of Sale (POS) Booklet — Legal Provisions | 2025 | https://download1.fbr.gov.pk/Docs/202551615541769POSBooklet.pdf |
| Chapter XIV consolidated (SRO 69(I)/2025) | 29 Jan 2025 | https://download1.fbr.gov.pk/Docs/2025571554338577ChapterXIV.pdf |
| FBR POS legal provisions index page | live | https://www.fbr.gov.pk/pos-legal-provisions/163085/163086 |

**Version currency caveat [UNVERIFIED]:** v1.12 (updated 24-July-2025) is the newest spec I
could find published. FBR's own "Technical Documentation for Digital Invoicing API Integration"
page (https://fbr.gov.pk/technical-documentation-di/163085/173959) links a single document via
a `Downloads/?id=88877&Type=Docs` redirect that did **not** resolve to a PDF for me (it 200s to
an "Invalid Type" HTML page). I could not confirm whether a v1.13+ exists behind the IRIS
portal. **Re-check the version before building against this schema.** The changelog shows the
spec churned ~12 times in 4 months during 2025, so assume drift.

---

## 3. Endpoints — [VERIFIED-PRIMARY], transcribed from spec v1.12

The spec states plainly: *"DI data acquisition API URL's are mentioned in this document will
remain the same for Sandbox and Production routing will be based on the security token being
used."* — i.e. **the token, not the URL, selects the environment** for the reference APIs. The
two invoice-posting methods do have distinct `_sb` sandbox paths.

### Invoice submission

| Purpose | Method | URL |
|---|---|---|
| Post invoice — **sandbox** | POST | `https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb` |
| Post invoice — **production** | POST | `https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata` |
| Validate invoice — **sandbox** | POST | `https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata_sb` |
| Validate invoice — **production** | POST | `https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata` |

`validateinvoicedata` takes the identical payload and returns the identical validation block
but does **not** issue an FBR invoice number — it is a dry-run. Useful as a pre-flight check.

### Reference / lookup APIs (all GET unless noted)

| Purpose | URL |
|---|---|
| Provinces | `https://gw.fbr.gov.pk/pdi/v1/provinces` |
| Document type IDs | `https://gw.fbr.gov.pk/pdi/v1/doctypecode` |
| HS codes + descriptions | `https://gw.fbr.gov.pk/pdi/v1/itemdesccode` |
| SRO item codes | `https://gw.fbr.gov.pk/pdi/v1/sroitemcode` |
| Transaction type IDs | `https://gw.fbr.gov.pk/pdi/v1/transtypecode` |
| Units of measure | `https://gw.fbr.gov.pk/pdi/v1/uom` |
| SRO schedule | `https://gw.fbr.gov.pk/pdi/v1/SroSchedule?rate_id={id}&date={dd-MMM-yyyy}&origination_supplier_csv={provinceId}` |
| Sale type → rate | `https://gw.fbr.gov.pk/pdi/v2/SaleTypeToRate?date={dd-MMM-yyyy}&transTypeId={id}&originationSupplier={provinceId}` |
| Valid UOMs for an HS code | `https://gw.fbr.gov.pk/pdi/v2/HS_UOM?hs_code={code}&annexure_id={id}` |
| SRO items by SRO | `https://gw.fbr.gov.pk/pdi/v2/SROItem?date={yyyy-MM-dd}&sro_id={id}` |
| STATL (active-taxpayer status) | `https://gw.fbr.gov.pk/dist/v1/statl` — body `{"regno":"0788762","date":"2025-05-18"}` |
| Registration type lookup | `https://gw.fbr.gov.pk/dist/v1/Get_Reg_Type` — body `{"Registration_No":"0788762"}` |

Note the mixed `v1`/`v2` prefixes and the inconsistent date formats (`dd-MMM-yyyy` for
`SaleTypeToRate` and `SroSchedule`, `yyyy-MM-dd` for `SROItem` and the invoice body). That is
what the spec says; it is not a transcription error.

The spec labels STATL and `Get_Reg_Type` as "HTTP meth Get" while showing a JSON request body.
**[UNVERIFIED]** — whether these are actually GET-with-body or POST. Cannot resolve without a
token. Try POST first.

### Live behaviour — [VERIFIED-PRIMARY], observed by direct call on 2026-08-07

```
$ curl -s https://gw.fbr.gov.pk/pdi/v1/provinces
{"fault":{"code":900902,"message":"Missing Credentials","description":"Required OAuth
credentials not provided. Make sure your API invocation call has a header:
\"Authorization: Bearer ACCESS_TOKEN\""}}                                  → HTTP 401

$ curl -s -X POST -H "Authorization: Bearer 00000000-0000-0000-0000-000000000000" \
       -H "Content-Type: application/json" -d '{}' \
       https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb
{"fault":{"code":900901,"message":"Invalid Credentials","description":"Access failure for
API: /di_data/v1, version: v1 status: (900901) - Invalid Credentials. ..."}}  → HTTP 401
```

Three real conclusions from this:

1. The hosts are live and the paths in the spec are correct as of today.
2. **Even the read-only reference endpoints require a token.** You cannot pre-cache the HS code
   or UOM tables during development without a taxpayer account. This is the single biggest
   practical blocker.
3. The gateway is **WSO2 API Manager** (fault codes 900901/900902 and that exact `fault` JSON
   envelope are WSO2's signature). Useful for predicting behaviour: expect WSO2 throttling
   responses (`900802` "Message throttled out") under load, and note the `fault` envelope is
   **structurally different** from the application-level `validationResponse` envelope — your
   client must branch on HTTP status before parsing.

---

## 4. Authentication — [VERIFIED-PRIMARY]

From spec v1.12 §3.1, quoted:

> "This Web API is secured and will require a security token to be passed in the header of each
> request. This security token will be issued by PRAL and given to Supply Chain Operators along
> with all URLs to access the web API. This security token will have a validity of 5 Years..."

- **Scheme:** `Authorization: Bearer <token>`. Static long-lived token. **No OAuth flow, no
  client credentials exchange, no token refresh endpoint, no client certificates.** There is no
  `/token` endpoint in the spec.
- **Validity:** 5 years, auto-reissued on expiry.
- **Format:** the third-party legacy-POS sample shows a UUID (`1298b5eb-b252-3d97-8622-a4a69d5bf818`).
  **[UNVERIFIED]** for the DI API specifically — the spec never states the token format. Treat
  it as an opaque string.

### The token is bound to a specific seller NTN — [VERIFIED-PRIMARY], and this matters a lot

Error code **0401** in the spec's sales error table reads:

> "The provided seller NTN/CNIC does not have a valid or authorized access token" —
> "Unauthorized access: Provided seller registration number is not 13 digits (CNIC) or 7 digits
> (NTN) or **the authorized token does not exist against seller registration number**"

**Architectural consequence for ResturantOS:** a token belongs to one taxpayer. A multi-tenant
SaaS cannot hold one platform-wide FBR token and post on behalf of every restaurant. Each
tenant must obtain their own token through their own IRIS login, and the platform must store
per-tenant tokens as tenant-scoped secrets. Design for `tenant → {sandboxToken, productionToken,
sellerNTN}` from day one. (Code 0402 is the same rule applied to the buyer NTN.)

### IP whitelisting — [VERIFIED-PRIMARY], DI User Manual p.8

Registration requires submitting hosting server company name, country, and **IP address(es)**
(single, or bulk via an `.xls` upload up to 1 MB). PRAL whitelists them; the manual says allow
"up to 2 working hours for IP Whitelisting that will enable Sandbox testing automatically."

**Consequence:** egress IPs must be static and known ahead of time. Autoscaling containers on
ephemeral NAT IPs will break. Plan a fixed-IP egress (NAT gateway / static egress proxy) per
deployment, and note that every tenant registers *your* server IPs, so the whitelist is per-
taxpayer but the IPs are yours.

---

## 5. Registration — what a business actually needs — [VERIFIED-PRIMARY], DI User Manual

Confirmed flow, taxpayer side:

1. **Log into IRIS** (`iris.fbr.gov.pk`) with sales-tax registration number + password. This
   presupposes the business is already **sales-tax registered** (has an NTN, and an STRN).
2. Navigate to **Digital Invoicing**.
3. **Integration Mode** screen — choose *API Integration* or *Manual Invoice Generation*.
4. Choose a **Licensed Integrator**. Two paths:
   - *"Proceed with PRAL as Licensed Integrator"* — **free of cost**, per SRO 69(I)/2025 rule
     150XF(2): *"PRAL shall provide free of cost integration services to the registered persons
     on demand."*
   - *"Proceed with Other Licensed Integrator"* — pick from a dropdown; these may charge.
5. **Technical Details** form: Technical Contact Person / Mobile / Email, ERP-System Provider,
   Software Type (Cloud / On-Premises), Software Version, CRM User ID, CRM Password.
6. **Business Types (for Sandbox Testing Only)**: Business Nature (multi-select) and Sector
   (single-select). *This pair determines which test scenarios you must pass.*
7. **IP Whitelisting** (above). Wait ~2 working hours.
8. **Sandbox Environment** tab exposes: Web API Details, Sample JSON Format, Sample Code, and
   the sandbox security token.
9. Submit passing invoices for **every scenario applicable to your Business Nature × Sector**.
10. **"With 'Success' status of test invoices of applicable scenarios, Production token will be
    generated automatically."** Then the Production Environment tab shows the production API
    details and security token.

### Answers to the specific registration questions

- **NTN** — required. 7 digits (or 9 per error code 0002; the spec is internally inconsistent,
  saying "7 or 9 digits" in code 0002 and "7 digits" in code 0401). CNIC is 13 digits.
- **STRN** — the business must be sales-tax registered to reach the Digital Invoicing module.
- **Sandbox token** — issued through IRIS only, after IP whitelisting.
- **Licensed integrator** — **mandatory**, but PRAL is one and it is free. You do *not* have to
  buy a commercial integrator.
- **Can a developer self-register for sandbox?** **No.** [VERIFIED-PRIMARY] — there is no
  developer portal, no signup form, no public sandbox key. Entry is exclusively through a
  taxpayer's authenticated IRIS session. Confirmed empirically: all endpoints 401 without a
  token, including read-only lookups.
- **Licensed integrator (PCT) licensing** — a *separate, much heavier* track. SRO 69(I)/2025
  rule 150XH requires an application in duplicate with company profile, managerial/technical
  personnel details, employee count, evidence of ERP and payment-processing integration
  capability, a **PASHA or ICAP registration certificate**, and **audited accounts for the last
  three financial years**. Only relevant if ResturantOS wants to *become* an integrator rather
  than integrate as a taxpayer's software. Recommendation: do not.

---

## 6. The invoice payload — [VERIFIED-PRIMARY], spec v1.12 §4.1

### Request body (sandbox sample, verbatim from the spec)

```json
{
  "invoiceType": "Sale Invoice",
  "invoiceDate": "2025-04-21",
  "sellerNTNCNIC": "….7 or 13 digit of seller NTN/CNIC….",
  "sellerBusinessName": "Company 8",
  "sellerProvince": "Sindh",
  "sellerAddress": "Karachi",
  "buyerNTNCNIC": "….7 or 13 digit of buyer NTN/CNIC….",
  "buyerBusinessName": "FERTILIZER MANUFAC IRS NEW",
  "buyerProvince": "Sindh",
  "buyerAddress": "Karachi",
  "buyerRegistrationType": "Registered",
  "invoiceRefNo": "",
  "scenarioId": "SN001",
  "items": [
    {
      "hsCode": "0101.2100",
      "productDescription": "product Description",
      "rate": "18%",
      "uoM": "Numbers, pieces, units",
      "quantity": 1.0000,
      "totalValues": 0.00,
      "valueSalesExcludingST": 1000.00,
      "fixedNotifiedValueOrRetailPrice": 0.00,
      "salesTaxApplicable": 180.00,
      "salesTaxWithheldAtSource": 0.00,
      "extraTax": 0.00,
      "furtherTax": 120.00,
      "sroScheduleNo": "",
      "fedPayable": 0.00,
      "discount": 0.00,
      "saleType": "Goods at standard rate (default)",
      "sroItemSerialNo": ""
    }
  ]
}
```

The production sample is byte-identical **except** `scenarioId` is absent and
`buyerRegistrationType` is `"Unregistered"`. The spec is explicit: `scenarioId` is
**"Required for Sandbox only."**

### Header field table (verbatim)

| JSON field | Type | Required | Notes |
|---|---|---|---|
| `invoiceType` | string | Required | `"Sale Invoice"` or `"Debit Note"` |
| `invoiceDate` | date | Required | `YYYY-MM-DD` (error 0005 confirms the format) |
| `sellerNTNCNIC` | string | Required | 7-digit NTN or 13-digit CNIC |
| `sellerBusinessName` | string | Required | |
| `sellerProvince` | string | Required | value from provinces reference API |
| `sellerAddress` | string | Required | |
| `buyerNTNCNIC` | string | Required (Optional if Unregistered) | |
| `buyerBusinessName` | string | Required | |
| `buyerProvince` | string | Required | value from provinces reference API |
| `buyerAddress` | string | Required | |
| `buyerRegistrationType` | string | Required | `"Registered"` or `"Unregistered"` |
| `invoiceRefNo` | string | Required only for debit note | 22 chars for NTN, 28 for CNIC |
| `scenarioId` | string | **Sandbox only** | `SN001`–`SN028` |

⚠️ **Spec typo, carried faithfully:** the field-description table spells the header row
`InvoiceType` (capital I) and `buyeRegistrationType` (missing `r`), while every JSON sample uses
`invoiceType` and `buyerRegistrationType`. **Trust the JSON samples** — the tables are prose,
the samples are the wire format. This is a real trap in the document.

### Item field table (verbatim)

| JSON field | Type | Required | Notes |
|---|---|---|---|
| `hsCode` | String | Required | HS code, e.g. `"0101.2100"` |
| `productDescription` | String | Required | |
| `rate` | String | Required | **String, with the `%`** — `ratE_DESC` from `SaleTypeToRate` |
| `uoM` | String | Required | `description` from the UOM reference API |
| `quantity` | Number (Decimal) | Required | |
| `totalValues` | Number (Decimal) | Required | total sales value **including** tax |
| `valueSalesExcludingST` | Number (Decimal) | Required | |
| `fixedNotifiedValueOrRetailPrice` | Number (Decimal) | Required | |
| `salesTaxApplicable` | Number (Decimal) | Required | sales tax / FED in ST mode, **excluding** further & extra tax |
| `salesTaxWithheldAtSource` | Number (Decimal) | Required | |
| `extraTax` | Number (Decimal) | Optional | |
| `furtherTax` | Number (Decimal) | Optional | |
| `sroScheduleNo` | String | Optional | |
| `fedPayable` | Number (Decimal) | Optional | |
| `discount` | Number (Decimal) | Optional | |
| `saleType` | String | Required | e.g. `"Goods at standard rate (default)"` |
| `sroItemSerialNo` | String | Optional | |

**Money is decimal, not minor units.** ResturantOS stores money as `Long` paisa
(`services/reporting-service/src/main/java/io/restaurantos/reporting/dto/FbrTaxSummaryDto.java`
documents this project rule). The FBR boundary needs an explicit paisa → decimal-rupee
conversion with a fixed 2dp scale. Do that conversion **only** at the serialization edge; never
let a `double` back into the domain.

**`rate` is a string like `"18%"`, not a number.** It must match `ratE_DESC` from the
`SaleTypeToRate` lookup exactly — including exotic values the spec shows such as
`"18% along with rupees 60 per kilogram"`. Do not construct it by formatting a number.

### Success response (verbatim)

```json
{
  "invoiceNumber": "7000007DI1747119701593",
  "dated": "2025-05-13 12:01:41",
  "validationResponse": {
    "statusCode": "00",
    "status": "Valid",
    "error": "",
    "invoiceStatuses": [
      {
        "itemSNo": "1",
        "statusCode": "00",
        "status": "Valid",
        "invoiceNo": "7000007DI1747119701593-1",
        "errorCode": "",
        "error": ""
      }
    ]
  }
}
```

The FBR invoice number is `{sellerNTN}DI{13-digit-epoch-millis}` = 22 chars for a 7-digit NTN,
28 for a 13-digit CNIC — matching the spec's stated lengths. **Per-item** invoice numbers are
the header number suffixed `-1`, `-2`, …

### Failure responses — two distinct shapes, both HTTP 200

**Header-level rejection** (`invoiceNumber` absent entirely):

```json
{
  "dated": "2025-05-13 13:09:05",
  "validationResponse": {
    "statusCode": "01",
    "status": "Invalid",
    "errorCode": "0052",
    "error": "Provide proper HS Code with invoice no. null",
    "invoiceStatuses": null
  }
}
```

**Item-level rejection** — and note the trap: outer `statusCode` is **`"00"`** while outer
`status` is `"invalid"` (lowercase), and the real failure is inside `invoiceStatuses[]`:

```json
{
  "dated": "2025-05-13 13:10:00",
  "validationResponse": {
    "statusCode": "00",
    "status": "invalid",
    "error": "",
    "invoiceStatuses": [
      { "itemSNo": "1", "statusCode": "01", "status": "Invalid",
        "invoiceNo": null, "errorCode": "0046", "error": "Provide rate." }
    ]
  }
}
```

**Client rule, do not get this wrong:** treat a submission as successful **only if
`invoiceNumber` is a non-empty string AND every `invoiceStatuses[].statusCode == "00"`.** Do
not branch on the outer `statusCode` alone — the spec's own sample shows `"00"` on a failed
invoice. Also note `status` casing is inconsistent (`"Valid"`, `"Invalid"`, `"invalid"`), so
compare case-insensitively or ignore `status` and use `statusCode`.

### HTTP status codes (spec §4.1.6)

`200` Ok · `401` Unauthorized · `500` Internal Server Error. That is the entire documented set —
no 400, no 429 documented, though WSO2 will emit throttling faults in practice.

---

## 7. Sandbox scenarios — [VERIFIED-PRIMARY], spec v1.12 §9

28 scenarios, `SN001`–`SN028`. You must pass every scenario applicable to your declared
Business Nature × Sector before a production token is minted. The restaurant-relevant ones:

| ID | Description | Sale type |
|---|---|---|
| SN001 | Goods at standard rate to registered buyers | Goods at Standard Rate (default) |
| SN002 | Goods at standard rate to unregistered buyers | Goods at Standard Rate (default) |
| SN005 | Reduced rate sale | Goods at Reduced Rate |
| SN006 | Exempt goods sale | Exempt Goods |
| SN007 | Zero rated sale | Goods at zero-rate |
| SN008 | Sale of 3rd schedule goods | 3rd Schedule Goods |
| SN018 | Services rendered/provided where FED is charged in ST mode | Services (FED in ST Mode) |
| SN019 | Services rendered or provided | Services |
| SN026 | **Sale to End Consumer by retailers** | Goods at Standard Rate (default) |
| SN027 | **Sale to End Consumer by retailers** | 3rd Schedule Goods |
| SN028 | **Sale to End Consumer by retailers** | Goods at Reduced Rate |

Spec note, verbatim: *"Scenarios ID 26, 27 & 28 are applicable only if registered as retailer in
sales tax profile."*

**A restaurant is most likely `Service Provider` × `Services` → SN018, SN019** (spec §10 row 99),
or `Retailer` × `Services` → **SN018, SN019, SN026, SN027, SN028, SN008** (row 84). The exact
row depends on how the taxpayer's sales-tax profile is registered, which the restaurant chooses,
not you. **Build the scenario ID as tenant configuration, not a constant.**

---

## 8. QR code and invoice printing

### What the DI spec actually says — [VERIFIED-PRIMARY], §6

Only this:

> "The below Digital Invoicing System logo and QR code must be printed on each invoice issued by
> the taxpayers."
> - QR Code Version: 2.0 (25×25)
> - QR Code Dimensions: 1.0 x 1.0 Inch

**The DI spec does NOT specify what data goes inside the QR code.** I grepped the entire
document; there are exactly five mentions of "QR" and none defines a payload, encoding, or URL
template. **[UNVERIFIED]** — do not invent one.

The strong inference (**not** a verified DI-spec statement) comes from the older POS rules in
the POS Booklet, rule 150XA(4)(e): *"generate the QR Code on the base of unique FBR invoice
number and print the QR Code on receipt"* — i.e. the QR encodes the FBR invoice number. That is
**[VERIFIED-PRIMARY] for the legacy Tier-1 POS regime**, and only a reasonable guess for DI.
Confirm with PRAL support before shipping printed receipts.

### Legacy Tier-1 POS invoice content — [VERIFIED-PRIMARY], POS Booklet

Different regime, different format. FBR fiscal invoice number is `XXXXXX-DDMMYYHHMMSS-0001`
(**not** the DI `{NTN}DI{millis}` form), QR dimensions **7×7 mm** (not 1 inch). The booklet's
rule 150XA(13) lists 26 mandatory printed particulars (a–z): FBR invoice number, verifiable QR
code, POS software registration number, FBR logo, seller name/address/registration number,
recipient name/address/registration number, date of issue, tax period, description, quantity,
value excl. tax, sales tax rate, sales tax amount, ST withheld at source, extra tax, further
tax, FED payable in ST mode, total discount, invoice reference no, HS code, UOM, and applicable
SRO + serial number.

Same booklet, rule 150XA(8): FBR **may** require CCTV recording of each point of sale, retained
at least one month. Relevant to a restaurant POS product roadmap.

---

## 9. Two different FBR systems — do not confuse them

| | **Digital Invoicing (DI)** | **Legacy POS / IMS (Tier-1 retailers)** |
|---|---|---|
| Host | `gw.fbr.gov.pk` | `gw.fbr.gov.pk/imsp/...` (prod), `esp.fbr.gov.pk:8244` (sandbox) |
| Post path | `/di_data/v1/di/postinvoicedata` | `/imsp/v1/api/Live/PostData` |
| Invoice no. format | `{NTN}DI{epochMillis}` | `XXXXXX-DDMMYYHHMMSS-0001` |
| QR size | 1.0 × 1.0 inch, v2.0 (25×25) | 7 × 7 mm |
| Registration portal | `iris.fbr.gov.pk` → Digital Invoicing | `e.fbr.gov.pk` → POS Client Registration |
| Governing SRO | 69(I)/2025, 1413(I)/2025 | 1006(I)/2021, 1279(I)/2021 |
| Spec published? | **Yes**, full JSON schema | **No** official public payload spec found |

The DI endpoints and formats above are **[VERIFIED-PRIMARY]**. The legacy POS endpoints
(`https://esp.fbr.gov.pk:8244/FBR/v1/api/Live/PostData` sandbox,
`https://gw.fbr.gov.pk/imsp/v1/api/Live/PostData` production) are **[VERIFIED-THIRD-PARTY]** —
from the Tier3-Pk GitHub repo, not from an FBR document. I found **no** official FBR PDF
publishing the legacy POS request payload schema. Do not build against it from blog posts.

**Migration relief — [VERIFIED-PRIMARY], SRO 69(I)/2025 rule 150Q(2) proviso:** *"registered
persons who have already registered and integrated their point of sale with the Board's
computerised system shall be treated to have been integrated with Board's computerised system
under these rules."* Existing Tier-1 POS integrations are grandfathered. New builds should
target **DI**, not legacy POS.

Also there is a **Re. 1 per invoice** POS service fee under SRO 1279(I)/2021, collected from the
customer and deposited with the monthly return (per the POS Booklet index and Business Recorder
reporting). **[HEARSAY]** whether this applies to DI-regime invoices — I did not find it
restated in the DI documents.

---

## 10. Regulatory timeline

**[VERIFIED-PRIMARY]:**

- **SRO 69(I)/2025** (29 Jan 2025) — replaced Chapter XIV of the Sales Tax Rules 2006 with
  "Procedure for licensing, issuance of electronic sales tax invoices and integration of
  registered persons". Rule 150XF makes PRAL a licensed integrator providing **free** services.
  Rule 150R(3): *"Every electronic invoicing software or point of sales software including
  payment counter whether fixed or portable ... shall be integrated with the Board through the
  licensed integrator."*
- **STGO #01 of 2026** (30 March 2026) — confirms **SRO 1413(I)/2025 dated 01.08.2025 obligates
  *all* sales-tax registered persons** to integrate via a licensed integrator and issue digital
  invoices. Allows engaging **more than one** licensed integrator. And the key operational rule:

  > "an integrated person shall only be allowed to cancel, delete, or edit a valid electronic
  > sales tax invoice generated due to bonafide mistake, through the Board's computerized system
  > **within a period of seventy-two (72) hours** from the time of its generation."
  > Beyond 72 hours requires **prior approval of the concerned Commissioner Inland Revenue**.

  **Product consequence:** a restaurant void/refund/comp after 72 hours is not a system
  operation — it is a tax-office petition. ResturantOS must surface that boundary in the UI and
  block or escalate rather than silently failing.

  ⚠️ Note STGO 01/2026 describes the 72-hour amend window as happening "through the Board's
  computerized system", but **spec v1.12 documents no cancel/amend/delete endpoint at all** —
  only post and validate. **[UNVERIFIED]** how amendment is performed via API. It may be
  IRIS-portal-only, or in a spec version I could not obtain. This is a genuine gap; ask PRAL.

**[HEARSAY] — needs primary verification before you rely on any of it:**

- Phased SRO 1413(I)/2025 deadlines: 1 Sep 2025 (public cos, turnover > PKR 1bn, importers);
  1 Oct 2025 (turnover PKR 100m–1bn, individuals/AOPs > PKR 100m); all others register by
  10 Nov 2025, test by 30 Nov 2025, live 1 Dec 2025. I did **not** fetch SRO 1413 itself.
- **SRO 288(I)/2026** (18 Feb 2026) — reported as a **draft** notification under the **Income
  Tax Ordinance 2001** (not the Sales Tax Act) adding an "Online Integration of Businesses"
  chapter, explicitly naming **restaurants**, hotels/guest houses, marriage halls, clubs,
  courier services, beauty parlours, medical practitioners and labs; covering e-invoicing, POS
  integration, QR codes, CCTV and integrator licensing. Reported by ProPakistani, Business
  Recorder and Profit. **I could not locate the SRO PDF on `download1.fbr.gov.pk`.** If accurate
  this is the single most relevant instrument for ResturantOS — **chase the primary text.**
- STGO #05 of 2026 reportedly makes POS integration mandatory for service providers in
  Islamabad. Not verified.

### Restaurants: federal vs provincial — important and only partly resolved

**[HEARSAY, but consistent across sources and constitutionally expected]:** sales tax on
*services* is **provincial** in Pakistan — Sindh Revenue Board (SRB), Punjab Revenue Authority
(PRA), KPRA, BRA — while FBR administers sales tax on *goods* plus services in **Islamabad
Capital Territory**. Restaurant sales are services, taxed at ~15% by SRB/PRA. Business Recorder
reports the provincial authorities **opposed** FBR's SRO 288 on services integration — a live
jurisdictional dispute.

**I did not verify the provincial e-invoicing APIs at all.** SRB and PRA each run their own
restaurant invoice monitoring systems with their own specs and endpoints. **For a Pakistani
restaurant POS, the provincial authority may matter more than FBR.** This is a significant
open research item and arguably the next thing to investigate.

What *is* solid: FBR DI matters for a restaurant's **purchase/input side** (vendor invoices are
goods, federal) and for restaurants operating in **ICT**, and it is what the existing
`FbrTaxSummary` report in this repo is shaped around.

---

## 11. Open-source clients and Postman collections

**No official FBR/PRAL Postman collection is published.** The spec shows a Postman *screenshot*
illustrating the Authorization header (§3.1, "Figure 2"), but no collection file. FBR's own
technical-documentation page lists exactly one document and no collection, no sample code. The
DI User Manual says "View Sample Code" is available **inside** the IRIS Sandbox tab — i.e.
behind login. **[VERIFIED-PRIMARY]**

**[VERIFIED-THIRD-PARTY] — what actually exists:**

| Project | Details |
|---|---|
| `inaat/fbr-digital-invoicing` (Packagist `fbr/digital-invoicing`) | Laravel package, **explicitly targets DI API v1.12**. MIT. v1.0.0 released 5 Aug 2025. PHP 8.0+, Laravel 9–12, Guzzle 7. Endpoints match this document exactly (`di_data/v1/di/`, `pdi/v1/`, `dist/v1/`). Facade `FbrDigitalInvoicing` with `postInvoiceData`, `validateInvoiceData`, `getProvinces`, `getUomCodes`, `getItemDescCodes`, `checkStatl`, `getRegistrationType`; `InvoiceBuilder`/`InvoiceItemBuilder`. Handles all 28 scenarios and QR generation. **Adoption is tiny: ~164 installs, 1 star, 5 forks, 6 open issues.** |
| `Tier3-Pk/FBR-POS-INTEGRATION-SERVICES` | GPL-3.0. Targets the **legacy POS/SDC** regime, not DI. PHP + .NET samples, receipt formatting per SRO 1006(I)/2021. Its .NET sample **disables TLS certificate validation** — do not copy that code. |

**No Java/Kotlin client exists** that I could find. ResturantOS is a Spring Boot monorepo
(`services/`, `shared-lib/`), so a client would be written from scratch. Given the schema is
public and small (13 header fields + 17 item fields, 2 POST endpoints, 12 lookups), that is a
modest job — the Laravel package is worth reading as a cross-check on field naming, not as a
dependency.

---

## 12. What already exists in ResturantOS

Grounded in files I read:

| Path | What it is |
|---|---|
| `services/reporting-service/src/main/java/io/restaurantos/reporting/dto/FbrTaxSummaryDto.java` | Record with `ntn`, `fbrStrn`, output/input tax, `netPayablePaisa`. Its own Javadoc states: *"There is no FBR/IRIS e-filing API integration anywhere in the specs and NONE is built here or planned by this plan."* |
| `services/reporting-service/src/main/java/io/restaurantos/reporting/service/FbrTaxSummaryService.java` | 157 lines, computes the summary. |
| `services/reporting-service/src/test/java/io/restaurantos/reporting/report/FbrTaxSummaryIT.java` | Integration test. |
| `services/user-service/src/main/java/io/restaurantos/user/entity/BranchEntity.java` | Already persists `fbr_strn` (len 50) and `ntn` (len 50) **per branch** — lines 39–43. |
| `frontend/app/(tenant)/app/reports/fbr/page.tsx` | Report page, gated on permission `reporting.report.fbr`. Subtitle says *"internal bookkeeping figures, not an FBR/IRIS e-filing submission."* |
| `frontend/components/reporting/FbrTaxSummaryCard.tsx` | Renders it; handles negative net as "Refundable input-tax credit". |
| `frontend/lib/models/reporting.model.ts` (lines 39–62) | `FbrTaxSummary` / `FbrTaxSummaryParams` types. |

**Assessment:** what exists is a *reporting* feature named after FBR, not an integration. It is
nevertheless a genuinely useful foundation — **`BranchEntity` already carries NTN and STRN at
branch granularity**, which maps well onto the per-seller token binding described in §4. There
is **no** FBR HTTP client, no token storage, no invoice submission, no QR generation, and no
outbox/retry machinery anywhere in `services/`.

---

## 13. Recommended build sequence

1. **Verify the spec version first.** Ask PRAL/FBR support (`helpline@fbr.gov.pk`) for the
   current DI API technical document. Do not assume v1.12 is current in Aug 2026.
2. **Resolve the jurisdiction question before writing code.** For a restaurant, confirm whether
   the target tenants file with FBR (ICT / goods) or with SRB/PRA (services). Research the
   provincial APIs — that gap is currently unfilled and may dominate the requirement.
3. **Chase SRO 288(I)/2026's primary text.** If it is real and finalized, it names restaurants
   directly and changes the priority of this whole workstream.
4. **Build the model + serializer now** — the schema is public and stable enough. Add an
   `fbr-invoicing` module in `shared-lib` or a new service: request/response records mirroring
   §6 exactly, paisa→decimal conversion at the edge, and the strict success predicate from §6
   (`invoiceNumber` non-empty AND all item `statusCode == "00"`).
5. **Design for per-tenant tokens and static egress IPs from the start** (§4). Retrofitting
   multi-tenant secret storage and fixed-IP egress later is expensive.
6. **Model the 72-hour amendment window** in the POS void/refund flow (§10) — and ask PRAL how
   amendment is done via API, since the spec documents no such endpoint.
7. **Build an outbox with retry.** Real-time submission against a government gateway that
   returns HTTP 200 for business failures and WSO2 throttling faults under load needs durable
   queuing, idempotency keyed on your own invoice ID, and a dead-letter path. Never block a
   customer's checkout on FBR availability.
8. **Cache the reference data** (HS codes, UOM, rates) once a token exists — those tables are
   large and change slowly, and you cannot fetch them without a token.

---

## 14. Honest gaps

Things I could **not** verify and deliberately did not guess:

- Whether a DI API spec newer than v1.12 (24-July-2025) exists.
- The QR code payload content for the DI regime.
- Any cancel / amend / delete API endpoint, despite STGO 01/2026 mandating a 72-hour window.
- Whether STATL and `Get_Reg_Type` are GET-with-body or POST.
- The primary text of SRO 288(I)/2026 and SRO 1413(I)/2025.
- The legacy POS/IMS request payload schema from an official source.
- The token's format and whether sandbox and production tokens differ structurally.
- **Provincial (SRB / PRA / KPRA / BRA) restaurant e-invoicing APIs — entirely unresearched.**
- Any live request/response, since every endpoint requires a taxpayer-issued token.

---

## Sources

Primary (FBR / PRAL):
- https://download1.fbr.gov.pk/Docs/20257301172130815TechnicalDocumentationforDIAPIV1.12.pdf
- https://download1.fbr.gov.pk/Docs/20254171643756444DI-User-Manual.pdf
- https://download1.fbr.gov.pk/Docs/202541712407495sro69(I)2025.pdf
- https://download1.fbr.gov.pk/Docs/2026331133557466STGO01of2026.pdf
- https://download1.fbr.gov.pk/Docs/202551615541769POSBooklet.pdf
- https://download1.fbr.gov.pk/Docs/2025571554338577ChapterXIV.pdf
- https://www.fbr.gov.pk/pos-legal-provisions/163085/163086
- https://fbr.gov.pk/technical-documentation-di/163085/173959
- Live API probes against `https://gw.fbr.gov.pk/...` (2026-08-07)

Third-party:
- https://github.com/inaat/fbr-digital-invoicing · https://packagist.org/packages/fbr/digital-invoicing
- https://github.com/Tier3-Pk/FBR-POS-INTEGRATION-SERVICES

News/blog (hearsay only):
- https://www.brecorder.com/news/40414134/ · https://www.brecorder.com/news/40411087
- https://propakistani.pk/2026/02/19/fbr-mandates-e-invoicing-integration-for-clubs-hospitals-retailers-online-sellers-and-schools/
- https://kpmg.com/us/en/taxnewsflash/news/2025/08/pakistan-compliance-deadlines-e-invoicing.html
