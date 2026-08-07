# POS Receipt Printing from a Browser (58 mm / 80 mm ESC/POS) — Research Findings

**Researched:** 2026-08-07
**Scope:** How does a browser-based POS print receipts, kitchen tickets, kick a cash drawer
and cut paper on thermal printers — and which architecture survives a Friday dinner service?

## How to read this document

Every factual claim is tagged:

- **[VERIFIED-PRIMARY]** — from a vendor/standards document I downloaded and text-extracted
  myself (Epson ePOS-Print manual, Star ESC/POS command spec Rev 2.52), from MDN/caniuse/Chrome
  developer docs I fetched, from Chromium source, or from the npm/GitHub APIs I queried.
- **[VERIFIED-REPO]** — I read the file in this repository. Path is cited.
- **[VERIFIED-THIRD-PARTY]** — from a library README or project page I actually fetched. Real,
  but not authoritative for the underlying platform behaviour.
- **[HEARSAY]** — a search-result summary or blog claim I could **not** confirm against a
  primary document. A lead, not a fact.
- **[UNVERIFIED]** — I looked and could not establish it. Deliberately left as a gap rather
  than filled with a plausible-sounding guess.

---

## 1. Bottom line

**Do not print ESC/POS from the browser.** Every browser-direct transport (WebUSB, Web Serial,
`window.print()`, direct TCP) fails at least one hard requirement for a restaurant till:
Windows blocks WebUSB for printers, Safari/iOS support nothing, `window.print()` cannot kick a
drawer, and browsers have no raw TCP.

**Recommended architecture: a small on-premise print agent per branch, fed a *semantic* JSON
receipt document (never raw bytes) by both the cloud backend and the POS tab.** The agent owns
the ESC/POS renderer, owns a durable local queue, and talks to printers over `IP:9100` (network)
or the OS device (USB). Full design in §9.

**Second-best, if you must ship without writing a daemon:** QZ Tray. It is LGPL-2.1 and free to
run, but silent printing (no per-job popup) requires a certificate from QZ Industries —
**$599/yr** for the entry tier **[HEARSAY — see §6.3, I could not load the price page]**.

**Do not build on:** WebUSB (dead on Windows), Web Serial (does not see USB printer-class
devices; Firefox requires installing an add-on), or `window.print()` alone (no drawer, no cut).

---

## 2. What already exists in ResturantOS

I grepped `frontend/` for `print`, `receipt`, `escpos`, `thermal`, `qz`, `@page`, `window.print`,
`react-to-print`, and searched for any file named `*print*` / `*receipt*` / `*escpos*`.

**There is no printing code in this repository at all.** [VERIFIED-REPO]

- No `window.print()`, no `useReactToPrint`, no `@media print`, no `@page` rule anywhere under
  `frontend/` (excluding `node_modules`).
- `frontend/package.json` has **no** print/ESC/POS/USB/serial dependency. The full dependency
  list is React 19.2.4 / Next 16.2.9 / TanStack Query / Radix / Zod / Zustand / `idb` / `jose` /
  `axios` / `next-intl` / `framer-motion` / `sonner` / Tailwind helpers. Nothing printer-related.
- The only greps that hit "receipt" are **purchasing/inventory goods-receipt** domain code
  (`components/inventory/StockReceiptDialog.tsx`,
  `services/purchasing-service/.../MockGrnReceipt.java`) — unrelated to POS receipts.
- The only "drawer" hits are the Radix UI `Drawer` component and
  `frontend/components/pos/order-table-detail-drawer.tsx` — a UI drawer, not a cash drawer.
- No QR library anywhere: `grep -rn "zxing\|qrcode\|QRCode" --include=pom.xml --include=package.json`
  returns nothing. This matters because FBR requires a printed QR (see §10.6).

### 2.1 What the POS surface looks like today [VERIFIED-REPO]

```
frontend/app/(tenant)/app/pos/page.tsx
frontend/app/(tenant)/app/pos/tills/page.tsx
frontend/app/(tenant)/app/pos/orders/[orderId]/charge/page.tsx   ← settlement lands here
frontend/components/pos/  (19 files: pos-terminal, order-panel, charge-summary,
                           settlement-actions, till-session-bar, offline-indicator, …)
frontend/app/(tenant)/app/kitchen/[stationCode]/page.tsx          ← KDS is screen-only today
```

`frontend/components/pos/settlement-actions.tsx` is the shared settlement surface; its
`CHARGE NOW` button routes to `/app/pos/orders/{id}/charge`. **That route's success path is the
natural place to raise a print job** — it does not exist yet.

### 2.2 The offline machinery you should reuse, not duplicate [VERIFIED-REPO]

`frontend/lib/offline/` already implements a durable outbox on IndexedDB (`idb` ^8.0.3):

- `frontend/lib/offline/types.ts` — `OutboxOpType = "CREATE_ORDER" | "APPEND_ITEMS" | "UPDATE_INSTRUCTIONS"`,
  `OutboxStatus = "PENDING" | "IN_FLIGHT" | "SYNCED" | "FAILED" | "DEAD"`.
- `frontend/lib/offline/outbox.ts` — FIFO `enqueue`/`peekPending`/`markSynced`/`markFailed`,
  `MAX_ATTEMPTS = 5` then dead-letter to `DEAD`, `requeueRetriable()`, `repointQueuedOps()`.
- `frontend/lib/offline/sync-engine.ts`, `sw-register.ts`, `menu-cache.ts`, `use-online-status.ts`.
- E2E coverage exists: `frontend/e2e/pos-offline.spec.ts`, `frontend/e2e/pos-kitchen-live-sync.spec.ts`.

A print job is **not** a good fit for this outbox as written (`OutboxOp` is keyed on
`clientOrderId` and replays HTTP calls to the backend), but the *pattern* — enqueue, single-flight
drain, bounded retries, dead-letter, badge — is exactly right for a print queue and should be
mirrored, not reinvented.

### 2.3 Backend surface [VERIFIED-REPO]

`services/pos-service/src/main/java/io/restaurantos/pos/web/` — `OrderController`,
`PaymentController`, `TillController`, `TableController`, `StationController`, `MenuController`,
`InternalPosController`. Relevant endpoints under `/api/v1/pos/orders`:
`POST /{id}/payments`, `POST /{id}/close`, `POST /{id}/void`, `POST /{id}/refund`,
`POST /{id}/send-to-kds`, `POST /{id}/split`, `GET /{id}/payments`.

`POST /{id}/close` and `POST /{id}/send-to-kds` are the two natural server-side print triggers
(customer receipt, kitchen ticket).

Per-branch print configuration already has a home:
`services/user-service/src/main/java/io/restaurantos/user/entity/BranchEntity.java:59`
declares `@Column(name = "receipt_config", columnDefinition = "jsonb")`, surfaced through
`BranchDtos` / `BranchService` / `BranchController`. **Printer registry and receipt layout config
belong there.**

---

## 3. Browser support matrix

| API | Chrome | Edge | Firefox | Safari (desktop) | Safari iOS | Global usage |
|---|---|---|---|---|---|---|
| **WebUSB** | 61+ | 79+ | **never** | **never** | **never** | 76.2 % |
| **Web Serial** | 89+ | 89+ | **151+** (May 2026, desktop only, add-on required) | **never** | **never** | 74.56 % |
| **Direct Sockets (raw TCP)** | Isolated Web Apps only; end users only on ChromeOS | — | no | no | no | ~0 |
| `window.print()` | yes | yes | yes | yes | yes | ~100 % |

[VERIFIED-PRIMARY] caniuse `web-serial` and `webusb`; Chrome for Developers Direct Sockets doc.

- WebKit's standards position on Web Serial is **"opposed"**; Mozilla's position on WebUSB is
  **"Harmful"**. Neither is arriving in Safari. [VERIFIED-PRIMARY — caniuse notes]
- Firefox 151 (released ~19 May 2026, **desktop only**) added Web Serial, but: *"Use of the API
  will require that website users install a synthetically generated site permission add-on — this
  is the same approach used to safely manage access to WebMIDI."* [VERIFIED-PRIMARY — MDN Firefox
  151 release notes]. Mozilla Hacks confirms *"add-on gating"* with prompts appearing **before**
  the port-selection prompt. Requiring every cashier to install a browser add-on is a
  non-starter for a till.
- Both APIs require a **secure context (HTTPS)** and **transient user activation** — the call must
  originate from a real click, not page load or a background timer.
  [VERIFIED-PRIMARY — MDN `USB.requestDevice()`: *"Transient user activation is required"*; MDN
  Web Serial: *"If the site doesn't have access to any connected ports it has to wait until it has
  user activation to proceed."*]

---

## 4. The five candidate transports

### 4.1 `window.print()` + CSS `@page` — VERDICT: use as the *fallback*, never as the mechanism

**What it can do.** `@page { size: 80mm auto; margin: 0 }` is legitimate CSS: the `size`
descriptor accepts an explicit `<length>` pair and reached **Baseline "newly available" in
December 2024** [VERIFIED-PRIMARY — MDN `@page/size`]. So an 80 mm-wide continuous receipt laid
out in HTML/CSS and rasterised through the printer's OS driver genuinely works, prints logos and
QR codes at driver resolution, and works in **every** browser including Safari/iPad.

**What it cannot do — the disqualifiers:**

| Requirement | Possible via `window.print()`? |
|---|---|
| Cash drawer kick | **No.** There is no CSS or DOM surface for `ESC p`. |
| Paper auto-cut | **No** as a page instruction. Some vendor drivers cut at end-of-job if the *driver* is configured to; that is a driver setting, not something the page controls. |
| Raw ESC/POS passthrough | **No.** The browser hands a rasterised/rendered page to the OS spooler. |
| Silent print (no dialog) | Only with a browser launch flag, see below. |
| Choosing *which* printer (receipt vs kitchen) | **No.** Goes to the default printer. |
| Knowing whether it printed | **No.** No success/failure callback, no paper-out status. |

**Silent printing exists but is a launch-flag hack.** Chromium defines two command-line
switches: `kiosk` (*"Enable kiosk mode. Note: this is not Chrome OS kiosk mode"*) and
`kiosk-printing` (*"Automatically press the print button in print preview when user tries to
print. Prerequisite: kiosk mode."*) [VERIFIED-PRIMARY — `chrome/common/chrome_switches.cc` in
Chromium `main`]. So `chrome --kiosk --kiosk-printing` prints to the OS default printer with no
dialog. This is real, but it means: managing a browser shortcut on every till, one printer per
till, and no control over drawer or cut.

**[HEARSAY]** The widely-repeated claim that `@page { margin: 0 }` suppresses Chrome's
headers/footers, and that kiosk printing inherits the *OS* default printer (not Chrome's) — I did
not find this in a primary Chromium or spec document. Verify on the actual hardware.

**[UNVERIFIED]** The "Generic / Text Only" Windows driver trick — installing the thermal printer
with the text-only driver so ESC/POS escape sequences embedded in page text pass through. I could
not verify that Chrome's print pipeline preserves the bytes rather than rendering glyphs. **Do not
plan around it.**

**Where it belongs:** as the always-available degraded path — "print an A4/80 mm HTML receipt to
whatever printer this machine has" when the agent is down. Cashier tears the paper by hand.

### 4.2 WebUSB — VERDICT: rejected

`navigator.usb.requestDevice({filters})` → `device.open()` → `claimInterface()` →
`transferOut(endpoint, escposBytes)`. Technically it *is* a clean path to an ESC/POS printer:
USB printer-class devices expose a bulk-OUT endpoint and will happily accept the byte stream.

**It dies on Windows.** From the `WebUSBReceiptPrinter` README [VERIFIED-THIRD-PARTY]:

> "On most platforms you can directly talk to USB connected receipt printers using WebUSB. The
> main exception to this is on Windows where the printer driver exclusively claims the printer."

Windows binds USB printers to the in-box `usbprint.sys` class driver, which claims the interface
exclusively; Chrome cannot then claim it. The known workaround is replacing the driver with
WinUSB via Zadig — which breaks every other application that expects to print to that printer,
and is not something you can ask a restaurant to do. [HEARSAY for the Zadig mechanism specifically
— multiple community reports (WICG/webusb issue #199, chromium webusb group), not a Microsoft or
Chromium doc.]

Add: zero Safari/iOS support (kills iPad tills), HTTPS + user gesture on every fresh grant, and a
per-device permission the browser can lose on profile reset.

**Libraries (real, current):**

| Package | Version | License | Last publish | Notes |
|---|---|---|---|---|
| `@point-of-sale/webusb-receipt-printer` | **2.0.0** | MIT | 2024-09-21 | 54 GitHub stars, last push 2024-10-04 |
| `@point-of-sale/receipt-printer-encoder` | **3.0.3** | MIT | 2025-04-05 | the encoder; 328 stars |

[VERIFIED-PRIMARY — `npm view` against the live registry, GitHub API]

### 4.3 Web Serial — VERDICT: rejected

`navigator.serial.requestPort({filters:[{usbVendorId}]})` → `port.open({baudRate})` →
`port.writable.getWriter().write(escposBytes)`.

**The fatal mismatch:** Web Serial enumerates *serial ports the operating system exposes*. A
typical 80 mm USB thermal printer enumerates as **USB printer class**, not USB-CDC — the OS
creates a print queue, not a COM port. Mozilla's own framing: *"serial devices connected to a USB
port or paired via Bluetooth can advertise themselves as serial-capable devices so they appear as
serial ports in the operating system"* [VERIFIED-PRIMARY — Mozilla Hacks]. A printer-class device
does not.

It works only when: (a) the printer is genuinely RS-232, or (b) the vendor driver installs a
**virtual COM port**. The `WebUSBReceiptPrinter` README notes exactly this as the Windows
fallback, and immediately warns of *"an incompatibility between the WebSerial implementation and
the virtual serial port that the Star printer driver creates."* [VERIFIED-THIRD-PARTY]

Plus: no Safari ever; Firefox 151+ only with a per-site add-on install; HTTPS + user gesture.

**Library:** `@point-of-sale/webserial-receipt-printer` **2.0.0**, MIT, published 2024-09-21
[VERIFIED-PRIMARY — npm].

### 4.4 Local print agent / bridge — VERDICT: **this is the answer**

See §6 (options) and §9 (the design).

### 4.5 Network printers — VERDICT: yes for the transport, no for the browser doing it

See §5.

---

## 5. Network printers, port 9100, and why the browser cannot

### 5.1 What `IP:9100` is [VERIFIED-PRIMARY — CUPS `doc/network.html`]

Port 9100 is **AppSocket / JetDirect** — CUPS calls it *"the simplest and fastest network protocol
used for printers."* The device URI form is `socket://ip-address` or
`socket://ip-address:port-number/?...`. There is no protocol: you open a TCP connection and write
bytes; the printer prints them. That is why it is the universal ESC/POS transport.

CUPS also flags the obvious: *"While the AppSocket protocol is simple and fast, it also offers no
security and is often an attack vector with printers."* Anyone on the VLAN can print anything.
Segment the printer VLAN.

### 5.2 Why a browser cannot open a socket to it

Browsers expose **no raw TCP API** on the open web. `fetch`/XHR speak HTTP; WebSocket speaks the
RFC 6455 handshake (an HTTP `Upgrade` a 9100 printer will never answer); WebRTC data channels
need a peer that speaks DTLS/SCTP. There is no way to emit an arbitrary byte stream to an
arbitrary TCP port.

The **Direct Sockets API** (`TCPSocket`, `UDPSocket`, `TCPServerSocket`) exists and explicitly
lists *"connecting to local printers"* as a use case — but it is gated to **Isolated Web Apps**,
and *"will only be available to end users on platforms that support Isolated Web Apps, which is
currently only ChromeOS."* [VERIFIED-PRIMARY — Chrome for Developers, Direct Sockets in IWA].
Unless every till is a ChromeOS device running an IWA, this is not available. Not a 2026 option.

### 5.3 The two real ways to reach a network printer from a web POS

**(a) Vendor HTTP print servers embedded in the printer.**

Epson **ePOS-Print** puts an HTTP endpoint *inside* the printer, so plain `XMLHttpRequest`/`fetch`
from a browser prints. Verified against Epson's own manual (*ePOS-Print API User's Manual*,
M00042110 **Rev.K**, © Seiko Epson 2011-2014) which I downloaded and text-extracted
[VERIFIED-PRIMARY]:

- Endpoint format (p.46, verbatim):
  `http://{domain}/cgi-bin/epos/service.cgi?devid={device ID}&timeout={timeout time}`
  Timeout is optional; omitted ⇒ 300000 ms. Device ID is registered in EPSON TMNet WebConfig
  (`local_printer` in Epson's own sample).
- Client library: `epos-print-4.x.x.js`, exposing `epson.ePOSBuilder` and `epson.ePOSPrint`:
  ```js
  var builder = new epson.ePOSBuilder();
  builder.addText('Hello,\tWorld!\n');
  builder.addCut(builder.CUT_FEED);
  builder.addPulse(builder.DRAWER_1, builder.PULSE_100);   // cash drawer, pin 2, 100 ms
  var epos = new epson.ePOSPrint('http://192.168.192.168/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000');
  epos.send(builder.toString());
  ```
- It really does cover the POS peripherals: the feature list (p.16) includes **"Drawer kick
  function"**, **"Buzzer function"**, **"ESC/POS command transmission"**; the object model exposes
  `ondraweropen` / `ondrawerclosed` / `onpaperend` / `oncoveropen` status events.
- **The killer caveat, stated by Epson itself.** Operating environment (p.17): *"From Internet
  Explorer, Web pages (HTTPS) that are securely protected cannot be printed on the TM printer."*
  Restrictions (p.28): *"Internet Explorer 9 does not allow printing to the printer to be
  performed from security-protected Web pages (HTTPS)."* IE is irrelevant in 2026, but the
  underlying problem is not: the printer endpoint is **`http://`**, your POS is **`https://`**, and
  every modern browser blocks that as **active mixed content**. Epson documented this in 2014 as an
  IE quirk; today it is universal.
- Model coverage in Rev.K is **TM-i series (TM-T88V-i, TM-T70-i, TM-L90-i)** plus TM-P60II /
  TM-P80 via the JS SDK. **[UNVERIFIED]** the current (2026) model list, whether newer TM-m30
  III / TM-T88VII expose an HTTPS ePOS endpoint with a usable certificate, and the current SDK
  version. Rev.K is a decade old; get the current manual from Epson before designing around it.
- **[UNVERIFIED]** whether Chrome 142's Local Network Access permission (§7) also gates these
  printer-IP fetches. It almost certainly does — the destination is a private IP literal — but I
  did not test it.

**Verdict on ePOS-Print:** an elegant escape hatch that is dead on arrival for an HTTPS SaaS POS
because of mixed content, unless you terminate the POS UI over HTTP on the LAN (don't) or the
printer can serve a trusted HTTPS certificate (unverified).

**(b) Pull-mode: the printer polls your server (Star CloudPRNT).**

Star Micronics **CloudPRNT** inverts the direction — *"requiring customers to implement a server
following this protocol"*; the idle printer POSTs JSON status to your server at a polling
interval, and *"When receiving a print job notification from the server, the printer retrieves the
print job using a GET request."* It *"uses common http/https to pass a REST/JSON API … without
requiring specific firewall, port forwarding or tunneling for connectivity"*, and an event
(status change, barcode scan, key press) triggers an immediate poll for low latency.
[VERIFIED-THIRD-PARTY — star-m.jp CloudPRNT Protocol Guide 2.5.x, fetched]

This is architecturally excellent for a cloud POS: **no inbound connection to the restaurant, no
agent to install, printer works even if every till tab is closed.** The cost is vendor lock-in to
CloudPRNT-capable Star hardware (mC-Print2/3, TSP100IV per the manual index) and a server
component you must build anyway.

---

## 6. The local print-agent pattern

### 6.1 The pattern

```
  ┌──────────────┐   HTTPS   ┌──────────────┐
  │  POS tab     │──────────▶│  cloud API   │
  │ (Next.js)    │           └──────┬───────┘
  └──────┬───────┘                  │  (job JSON, when online)
         │ http://127.0.0.1:PORT    │
         │ (or ws://127.0.0.1)      ▼
         └──────────────────▶┌──────────────┐  socket://printer-ip:9100
                             │ print agent  │──────────────────────────▶ 🖨 receipt
                             │  (daemon)    │──────────────────────────▶ 🖨 kitchen
                             └──────────────┘  or OS device / USB
```

The daemon runs on the till (or a Raspberry Pi on the branch LAN), listens on loopback/LAN,
holds a durable queue, and owns the only code in the system that emits ESC/POS bytes. The browser
never sees a byte sequence — it POSTs a *document*.

### 6.2 Why loopback works from an HTTPS page — and the 2026 gotcha

`http://localhost` / `http://127.0.0.1` is a **potentially trustworthy origin**, so an HTTPS page
calling it is **exempt from mixed-content blocking**. Chrome's own doc says so plainly: *"the
request is exempt from mixed content restrictions because localhost qualifies as a loopback
destination."* [VERIFIED-PRIMARY — Chrome for Developers, "New permission prompt for Local Network
Access"]

**But Chrome now gates it behind a permission.** Local Network Access (LNA) *"restricts the
ability of websites to send requests to servers on a user's local network (including servers
running locally on the user's machine), requiring the user grant the site permission before such
requests can be made."* Timeline from the same page: opt-in flag in **Chrome 138**
(`chrome://flags/#local-network-access-check`), **launch in Chrome 142** (dated 29 Sep 2025).
Coverage today: *"JavaScript `fetch()` API, subresource loading, and subframe navigation"*; the
page explicitly states *"WebSockets, WebTransport, and WebRTC connections to the local network are
not yet gated on the LNA permission."*

Practical consequences for the agent design:

1. `fetch('http://127.0.0.1:PORT/print', { targetAddressSpace: 'local', … })` will raise a
   one-time permission prompt per origin per till. **You must handle denial explicitly** — a
   denied fetch rejects with a network error, which must surface as "printing unavailable", not a
   silent no-op. [Denial behaviour: HEARSAY — described in a third-party summary, the Chrome page
   I fetched did not spell it out.]
2. WebSocket to loopback currently bypasses LNA — **do not architect around that**, the wording is
   "not yet".
3. **[UNVERIFIED]** the formal permission string / Permissions-Policy token, whether an enterprise
   policy can pre-grant it, and whether Edge 142+ mirrors the behaviour. Check Chrome Enterprise
   policy docs before a fleet rollout — a per-machine click is tolerable, a per-session click is not.

### 6.3 Option A — QZ Tray

**What it is.** A Java desktop daemon (`qzind/tray`, 1,046 stars, actively pushed 2026-08-06
[VERIFIED-PRIMARY — GitHub API]). The page includes `qz-tray.js` (npm `qz-tray` **2.2.6**,
declared license **LGPL-2.1**, published 2026-04-05 [VERIFIED-PRIMARY — npm]) and calls
`qz.websocket.connect()` to reach the locally running app over WebSocket.

**Raw printing API** [VERIFIED-PRIMARY — qz.io/docs/raw]:

```js
var config = qz.configs.create("Printer Name", { encoding: 'ISO-8859-1' });
qz.print(config, [{ type: 'raw', format: 'command', flavor: 'plain', data: "\x1B\x40…" }]);
```
- `type`: `raw` | `pixel`; `format`: `command` | `image` | `pdf` | `html`;
  `flavor`: `plain` | `base64` | `hex` | `file` | `xml`.
- `format: command` accepts all five flavors — **so arbitrary ESC/POS, including drawer kick and
  cut, goes straight through.**
- Network printers are first-class: `qz.configs.create({ host: "192.168.254.254", port: 9100 })`.
- ESC/POS is explicitly a supported language (`options: { language: "ESCPOS" }` for image/raster).

**Licensing — the part that decides it.**
- Core license is **LGPL 2.1**; the API, demo code and wiki examples are public domain.
  [VERIFIED-PRIMARY — qz.io/docs/licensing and the qzind/tray wiki]
- *"QZ Tray is free. Organizations wishing to print silently are required to purchase a
  certificate from QZ Industries, LLC."* [VERIFIED-PRIMARY — qz.io/docs/faq]. **Without a
  certificate, every print raises a confirmation dialog.** On a till, that is fatal.
- **Message signing** is how the dialog goes away [VERIFIED-PRIMARY — qz.io/docs/signing-messages]:
  you hold `digital-certificate.txt` (public x509 QZ trusts) and `private-key.pem` (PKCS#8,
  2048-bit RSA) **on your server**. The page asks your backend to sign each request payload with
  SHA-512; the base64 signature goes to QZ Tray, which verifies it against the trusted cert. The
  private key never reaches the browser. Signed requests show *your company's* details with an
  "Allow / Remember this decision" option.
- The FAQ notes an escape hatch: organizations may *"implement their own root certificate"*
  instead of buying one. That is the LGPL route (rebuild/reconfigure the tray with your own trust
  root) — but note the wiki's warning that *"QZ Tray binaries provided by https://qz.io ship with a
  code restriction that encourages a premium support purchase."* So the free path means shipping
  your own build to every till.
- **Price: [HEARSAY].** Search summaries consistently report **$599 USD/yr** for "Premium Supported
  + LGPL" (includes the trusted-dialog certificate, message signing, 48-hour email support) and
  **$2,999 USD/yr** for "Company Branded + Premium Support", with ~$100 off renewals. **I could not
  verify this**: `buy.qz.io` returned HTTP 403 to both the root and the product page, and
  `qz.io/docs/licensing` discloses no numbers. **Get a written quote before budgeting.**
- One certificate *"will suffice for 99% of organizations"* — it is not per-workstation.
  [VERIFIED-PRIMARY — qz.io/docs/faq]
- Platforms: macOS 10.7+, Windows XP+, Ubuntu 12.04+; 2.2+ bundles its own JRE.
  [VERIFIED-PRIMARY — qz.io/docs/faq]

**Verdict.** Legitimate, mature, and the fastest route to working silent ESC/POS + drawer + cut
from a browser. Cost: an annual per-customer certificate fee (or maintaining your own signed
build), a JVM on every till, and a hard dependency on a single small vendor. For a multi-tenant
SaaS ERP that will be deployed to many restaurants, the recurring cost and the "install Java app
on every till" support burden are real.

### 6.4 Option B — write your own agent (recommended)

There is **no mature open-source drop-in QZ Tray replacement.** I searched GitHub via the API
(`escpos print server websocket|agent`, sorted by stars) and the field is barren: the top result
is `darkterminal/escpos-printer-server` (PHP, MIT, **23 stars**); everything else has **0 stars**.
`jordankzf/print-agent` (Go, GPL-3.0, outbound WebSocket + Windows tray + installer) is the
closest in shape to what you want but has **2 stars** [VERIFIED-PRIMARY — GitHub API]. Treat all
of these as reference reading, not dependencies.

The libraries that *are* mature are the **encoders**, and they are the hard part:

| Library | Version | License | Stars / last push | Runtime |
|---|---|---|---|---|
| `python-escpos/python-escpos` | — | MIT | **1,312** / 2026-08-04 | Python |
| `Klemen1337/node-thermal-printer` (npm `node-thermal-printer`) | **4.6.0** (2026-01-27) | GitHub says MIT, npm manifest says **ISC** — discrepancy, check before shipping | **915** / 2026-07-16 | Node |
| `NielsLeenheer/ReceiptPrinterEncoder` (npm `@point-of-sale/receipt-printer-encoder`) | **3.0.3** (2025-04-05) | MIT | **328** / 2026-03-01 | Browser + Node |

[VERIFIED-PRIMARY — npm registry + GitHub API, queried 2026-08-07]

`ReceiptPrinterEncoder` supports ESC/POS, StarLine and StarPRNT from one API, and its documented
commands include exactly what a till needs [VERIFIED-PRIMARY — its `documentation/commands.md`]:

- `cut(type)` — *"Cut the paper. Optionally a parameter can be specified which can be either be
  'partial' or 'full'. If not specified, a full cut will be used."* Plus the honest warning:
  *"Not all printer models support cutting paper. And even if they do, they might not support both
  types of cuts."*
- `pulse(device, duration, delay)` — *"Send a pulse to an external device, such as a beeper or
  cash drawer."* `device` is *"0 or 1 depending how the device is connected"* (default 0);
  `duration` defaults to **100 ms**; `delay` defaults to **500 ms**.

Sister packages for transport, all MIT [VERIFIED-PRIMARY — npm + point-of-sale.dev]:
`@point-of-sale/network-receipt-printer` **2.0.1**, `@point-of-sale/system-receipt-printer`
**2.0.1**, `@point-of-sale/webusb-receipt-printer` **2.0.0**,
`@point-of-sale/webserial-receipt-printer` **2.0.0**,
`@point-of-sale/webbluetooth-receipt-printer`, `@point-of-sale/receipt-printer-status`.

**Estimated agent size: 300–600 LOC.** It is a queue, an HTTP listener, a renderer call, and a TCP
socket. The genuinely hard parts are codepage handling for Urdu/Arabic text and per-model quirks —
which is precisely why you want that logic in **one** place, not scattered across browser tabs.

---

## 7. ESC/POS command reference (byte-level, verified)

All of the following is extracted from **Star Micronics, *Line Thermal Printer ESC/POS Mode
Command Specifications*, Revision 2.52** (PDF downloaded and text-extracted with `pdftotext`).
[VERIFIED-PRIMARY]

### 7.1 Initialize — `ESC @`

```
ASCII    ESC  @
Hex      1B   40
Decimal  27   64
```
*"Clears data from the print buffer and sets the printer to its default settings."* Send it at the
top of every job — receipts are stateful (bold, size, alignment, codepage all persist).

### 7.2 Cash drawer kick — `ESC p m t1 t2`

```
ASCII    ESC   p     m    t1   t2
Hex      1B    70    m    t1   t2
Decimal  27    112   m    t1   t2

Defined region: 0 ≤ m ≤ 1, 48 ≤ m ≤ 49 ; 0 ≤ t1 ≤ 255 ; 0 ≤ t2 ≤ 255

  m = 0, 48  → drawer kick connector pin #2
  m = 1, 49  → drawer kick connector pin #5
```
> *"Drawer kick on time is set to t1 × 2 ms; off time is set to t2 × 2 ms."*
> *"When t1 > t2, the value of t2 is processed as t2 = t1."*

So the ubiquitous `1B 70 00 19 FA` = ESC p, pin 2, ON 25×2 = **50 ms**, OFF 250×2 = **500 ms**.
A more common conservative variant is `1B 70 00 32 FA` (ON 100 ms, OFF 500 ms).

**Real-time variant — `DLE DC4 n m t`**

```
ASCII    DLE DC4   n    m    t
Hex      10   14   n    m    t
Decimal  16   20   n    m    t

Defined region: n = 1 ; m = 0,1 ; 1 ≤ t ≤ 8
  m = 0 → pin #2,  m = 1 → pin #5
  On time = t × 100 ms ; Off time = t × 100 ms
```
> *"This command is processed upon reception."* … *"This command is executed even when the printer
> is offline, the reception buffer is full, or there is an error status on serial interface
> models."*

Use `DLE DC4` for a **"no sale" / open-drawer** button — it jumps the print queue. Use `ESC p` at
the end of a receipt so the drawer opens *after* the receipt prints. Note the Star caveat:
*"Printing and drawer drive cannot be performed simultaneously"*, so real-time behaviour is not
guaranteed while a job is printing.

### 7.3 Paper cut — `GS V m` and `GS V m n`

```
ASCII    GS    V     m   [n]
Hex      1D    56    m   [n]
Decimal  29    86    m   [n]

  m = 0, 48  → Full cut
  m = 1, 49  → Partial cut (one point uncut)
  m = 65     → Feed to (cut position + n × basic calculated pitch), then FULL cut     (needs n)
  m = 66     → Feed to (cut position + n × basic calculated pitch), then PARTIAL cut  (needs n)
```
> *"This command is effective only when processed at the top of the line when standard mode is
> being used."*
> *"The auto-cut function differs according to the model. A partial cut is executed on those models
> that cannot perform a full cut. A full cut is executed on those models that cannot perform a
> partial cut."*
> *"Models that do not have the auto-cut function do not cut paper."*

**Practical sequence** (`GS V 66 n` is what most POS software sends, because it feeds the printed
area past the cutter first):

```
1B 40                     ESC @        initialize
… receipt body …
0A 0A 0A                  LF ×3        feed past the cutter before cutting
1D 56 42 00               GS V 66 0    feed to cut position + 0, partial cut
1B 70 00 32 FA            ESC p 0 50 250   kick drawer pin 2 (100 ms on / 500 ms off)
```

Order matters: **cut before drawer**, or the drawer solenoid can brown out mid-print on
under-powered supplies. **[HEARSAY]** — widely-held field practice, not a documented requirement.

### 7.4 The same three things via Epson ePOS-Print (if you go that route)

[VERIFIED-PRIMARY — ePOS-Print API User's Manual Rev.K, pp.118–120]

- `addCut(type)` — `CUT_NO_FEED` | `CUT_FEED` | `CUT_RESERVE`; undefined ⇒ feed cut.
  *"Not available in page mode."*
- `addPulse(drawer, time)` — `drawer`: `DRAWER_1` = **pin 2** (default), `DRAWER_2` = **pin 5**.
  `time`: `PULSE_100` … `PULSE_500` (100–500 ms); undefined ⇒ 100 ms.
  *"The drawer and the buzzer cannot be used together."*

### 7.5 Receipt width and column count — **do not hardcode**

**[UNVERIFIED — deliberately.]** I could not establish a trustworthy canonical column count. The
Epson TM-T88VI datasheet I downloaded states *"Column capacity: Paper width 80 mm, 58 / 80"* and
*"Character size 12 mm (W) × 24 mm (H)"* — the latter is plainly wrong (it is 12×24 **dots**),
which tells you how much to trust marketing datasheets here. Column count is a function of model ×
configured print width (a DIP/memory-switch setting) × selected font (A vs B) × codepage.

**Design rule:** make columns-per-line a per-printer config value in `receipt_config`, default it
to a conservative value, and **measure it on the actual hardware during branch onboarding** by
printing a ruler line. Do not compile `42` or `48` into the renderer.

The TM-T88VI datasheet does confirm the physically relevant facts: paper sizes
**79.50 ± 0.50 mm** and **57.50 ± 0.50 mm** wide, and the presence of a **"Drawer kick-out"**
interface alongside USB / Ethernet 100Base-TX / optional Wi-Fi / RS-232 / Bluetooth.
[VERIFIED-PRIMARY — extracted from the datasheet PDF]

---

## 8. Head-to-head verdicts

| Approach | Drawer | Cut | Silent | Safari / iPad | Windows | Works if tab closed | Verdict |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| `window.print()` + `@page` | ✗ | ✗ | flag only | ✓ | ✓ | ✗ | **Fallback only** |
| WebUSB | ✓ | ✓ | ✓ | ✗ | **✗** | ✗ | **Reject** |
| Web Serial | ✓ | ✓ | ✓ | ✗ | virtual-COM only | ✗ | **Reject** |
| Epson ePOS-Print (direct from browser) | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | **Blocked by mixed content** |
| QZ Tray | ✓ | ✓ | cert required | ✓ | ✓ | ✗ | **Viable, licensed** |
| **Own local agent** | ✓ | ✓ | ✓ | ✓ | ✓ | **✓** | **Recommended** |
| Star CloudPRNT (pull) | ✓ | ✓ | ✓ | ✓ | ✓ | **✓** | **Excellent, vendor-locked** |

"Works if tab closed" is the column that should decide this. During service, tills get locked,
tablets sleep, Chrome OOM-kills background tabs. **A kitchen ticket must print whether or not
anybody is looking at a browser.**

---

## 9. RECOMMENDED ARCHITECTURE

### 9.1 One sentence

**A per-branch print agent that owns the ESC/POS renderer and a durable queue, fed identical
semantic JSON print documents by both the cloud (`pos-service`) and the POS tab, reaching printers
over `socket://ip:9100`.**

### 9.2 Components

```
┌─ cloud ──────────────────────────────────────────────────────────┐
│  pos-service                                                     │
│    POST /orders/{id}/close        ──┐                            │
│    POST /orders/{id}/send-to-kds  ──┤  emits PrintJob(JSON)      │
│    POST /orders/{id}/refund       ──┘                            │
│                                                                  │
│  print dispatch  (new; may live in pos-service)                  │
│    • persists PrintJob + status  (queued/printed/failed)         │
│    • FBR invoice number + QR payload stamped here                │
│    • serves jobs to agents that poll / hold a WS                 │
└────────────────────────┬─────────────────────────────────────────┘
                         │ outbound-only from the branch (WSS or long-poll)
┌─ branch LAN ───────────┴─────────────────────────────────────────┐
│  print-agent  (one per branch; till PC or Raspberry Pi)          │
│    • HTTP listener on 127.0.0.1:PORT  and  0.0.0.0:PORT (LAN)    │
│    • durable queue (SQLite) — survives restart                   │
│    • renderer: PrintDocument JSON ──▶ ESC/POS bytes              │
│    • transports: socket://ip:9100 | OS printer | USB             │
│    • /health, /printers, /test-print                             │
│                                                                  │
│  POS tab (Next.js) ──── POST http://127.0.0.1:PORT/print ────────┤
│                          (offline path: same JSON, marked        │
│                           PROVISIONAL, no FBR number)            │
└──────────────────────────────────────────────────────────────────┘
```

### 9.3 The five decisions that make this work

**1. The browser never emits bytes.** It POSTs a `PrintDocument` — a semantic tree
(`{ type: "receipt", branch, order, lines[], totals, payments[], fiscal?, footer }`). Only the
agent renders. One renderer, one language, one place to fix "the Urdu codepage is wrong on the
Bixolon". Sending raw bytes from the browser would force you to ship printer-model knowledge into
every client and reimplement it again server-side for the cloud path.

**2. Two producers, one contract.** The cloud produces the *authoritative* fiscal receipt (it is
the only thing that can hold the FBR invoice number and QR). The tab produces the *provisional*
receipt when the WAN is down. Identical schema; a `provenance: "server" | "client-offline"` field
and a visible `*** OFFLINE — PROVISIONAL ***` band on the client one. This mirrors the outbox
semantics already in `frontend/lib/offline/`.

**3. The agent is the queue of record.** SQLite-backed, survives reboot, retries with backoff,
dead-letters after N attempts (mirror `MAX_ATTEMPTS = 5` from
`frontend/lib/offline/outbox.ts:68`), and exposes queue depth so the POS can show a
`PrintStatusBadge` next to the existing `SyncStatusBadge`
(`frontend/components/pos/sync-status-badge.tsx`). Cashiers must be able to see "3 tickets
queued — kitchen printer offline" and hit Reprint.

**4. Kitchen tickets are server-triggered, not browser-triggered.** `POST /orders/{id}/send-to-kds`
already exists. Routing a ticket to the hot/cold station printer belongs to the server that
already knows station assignments (`StationController`, `PUT /menu/items/{id}/station`) — not to
whichever tablet happened to fire the request. This is the single biggest reliability win: the
kitchen prints even if the front-of-house tablet died.

**5. Printers are network-attached, not USB-attached, wherever possible.** Ethernet printers on
`:9100` decouple the printer from any one machine, let a single Pi agent serve the whole branch,
and remove Windows driver-claiming from the picture entirely. Reserve USB for the single
receipt printer bolted to a till.

### 9.4 The fallback ladder (what the cashier experiences)

| # | Condition | Behaviour |
|---|---|---|
| 1 | Agent reachable, printer online | Silent ESC/POS: receipt → cut → drawer kick. Nothing on screen. |
| 2 | Agent reachable, printer offline | Job queues in the agent; badge shows "1 queued — receipt printer offline"; toast offers Retry. |
| 3 | Agent unreachable / LNA denied | Toast "Printing unavailable on this till". Offer **Print via browser** → `window.print()` on an `@page { size: 80mm auto; margin: 0 }` HTML receipt. No cut, no drawer — cashier tears and opens manually. |
| 4 | No printer at all | Offer **Email/WhatsApp receipt** and **Show QR on screen** for the customer to scan. |

Level 3 is why the CSS receipt template must be built even though it is not the mechanism.

### 9.5 Config lives in `receipt_config`

`BranchEntity.receiptConfig` (jsonb) already exists at
`services/user-service/src/main/java/io/restaurantos/user/entity/BranchEntity.java:59`
[VERIFIED-REPO]. Put the printer registry there:

```jsonc
{
  "agent":    { "baseUrl": "http://127.0.0.1:7654", "lanUrl": "http://till-01.local:7654" },
  "printers": [
    { "id": "receipt-1", "role": "RECEIPT", "transport": "tcp",
      "host": "10.0.7.21", "port": 9100,
      "widthMm": 80, "columns": 48, "codepage": "CP864",
      "cut": "partial", "drawerPin": 2, "drawerPulseMs": 100 },
    { "id": "kitchen-hot", "role": "KITCHEN", "station": "HOT",
      "transport": "tcp", "host": "10.0.7.22", "port": 9100,
      "widthMm": 80, "columns": 42, "cut": "full", "drawerPin": null }
  ],
  "header": { "logoAssetId": "…", "lines": ["…"] },
  "fbr":    { "printLogo": true, "qrSizeMm": 25.4 }
}
```
`columns` is per-printer and **measured**, not assumed (§7.5).

### 9.6 FBR interaction (Pakistan) — read this before designing the receipt

Per the sibling research at `.planning/research/erp-completion/fbr-integration-design.md`
[VERIFIED-REPO]: the DI spec requires the FBR logo **and** a QR code on every invoice
(QR version 2.0, 25×25, 1.0 × 1.0 inch), and *"the QR cannot be generated until FBR has
responded."* There is also **no QR library in this repo** (§2, confirmed by grep).

Three consequences for printing:

1. **The fiscal receipt cannot be rendered client-side**, because the client does not have the
   FBR invoice number. This alone justifies the server-produces / agent-renders split.
2. A 1-inch QR at 203 dpi is ~203 dots — comfortably inside an 80 mm (≈576-dot) print width, but
   it must be sent as a **raster image**, not the printer's native QR command, if you need exact
   physical sizing. Plan for a raster path in the agent renderer.
3. The offline/provisional receipt (level 2 of §9.4) needs a defined "clearly marked as offline"
   treatment — which the FBR design doc flags as **UNVERIFIED**. Do not invent one; resolve it
   there first.

### 9.7 Why not QZ Tray, given it does most of this?

QZ Tray is the right answer if you need this working in two weeks and you accept: an annual
certificate cost per deployment (or your own signed build), a JVM on every till, one agent
*per machine* rather than per branch, and the print path dying when the tab closes (it is
browser-driven by design). For a self-hosted-or-SaaS multi-tenant ERP, the per-branch agent with
a server-side queue is strictly more reliable and has no per-seat licence. **Ship QZ Tray as a
supported adapter if a customer already runs it — do not make it the architecture.**

### 9.8 Build order

1. **`PrintDocument` schema** (shared-lib + TS type) + the ESC/POS renderer, in the agent, with
   golden-byte unit tests. No UI yet.
2. **Agent v1**: HTTP listener, SQLite queue, `tcp://host:9100` transport, `/health`,
   `/printers`, `/test-print`. Single binary (Go) or `pkg`-bundled Node.
3. **Server-side dispatch** in `pos-service` on `POST /orders/{id}/close` and
   `POST /orders/{id}/send-to-kds`, writing to a `print_job` table.
4. **Client bridge** in `frontend/lib/print/` — `fetch(agentUrl, { targetAddressSpace: 'local' })`
   with explicit LNA-denial handling, plus `PrintStatusBadge`.
5. **CSS fallback receipt** (`@page { size: 80mm auto; margin: 0 }`) + `window.print()`.
6. **`receipt_config` admin UI** with a Test Print button and a column-ruler calibration print.

Steps 1–2 are the only novel engineering. Everything else is wiring into surfaces that exist.

---

## 10. Open questions / things I could not verify

| # | Question | Why it matters |
|---|---|---|
| 1 | QZ Tray actual list price and renewal terms | `buy.qz.io` 403'd twice; the $599 / $2,999 figures are search-summary hearsay only |
| 2 | Chrome LNA: formal permission name, whether an enterprise policy can pre-grant it, Edge parity | Decides whether fleet rollout needs a per-machine click |
| 3 | Whether LNA also gates fetches to a printer's private IP (ePOS-Print case) | Almost certainly yes; untested |
| 4 | Current Epson ePOS-Print model list + whether any TM model serves a trusted **HTTPS** endpoint | Would revive the browser-direct option if true |
| 5 | Canonical columns-per-line for target printers | Deliberately left open; must be measured per model (§7.5) |
| 6 | `node-thermal-printer` license: GitHub says MIT, npm manifest says ISC | Both permissive, but pick a source of truth before shipping |
| 7 | Whether Chrome kiosk printing inherits the OS default printer and whether `@page{margin:0}` suppresses headers/footers | Affects the level-3 fallback quality |
| 8 | The Windows "Generic / Text Only" driver passthrough trick | If it worked it would be a cheap fallback; unverified, assume it does not |
| 9 | FBR offline-receipt marking requirements | Blocked on `fbr-integration-design.md` §1.6 / §5 |

---

## 11. Sources

**Primary — downloaded and text-extracted by me**
- Star Micronics, *Line Thermal Printer ESC/POS Mode Command Specifications, Rev 2.52* — https://www.starmicronics.com/support/Mannualfolder/escpos_cm_en.pdf (`ESC p` p.74, `GS V` pp.140-141, `DLE DC4` p.39, `ESC @` in the same command reference)
- Epson, *ePOS-Print API User's Manual*, M00042110 Rev.K — https://files.support.epson.com/pdf/pos/bulk/tm-i_epos-print_um_en_revk.pdf (endpoint p.46, operating env p.17, restrictions p.28, `addCut` p.118, `addPulse` p.119)
- Epson TM-T88VI Series datasheet — https://ks-barcode.com/files/datasheets/tm-t88vi.pdf

**Primary — web docs I fetched**
- MDN, Web Serial API — https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API
- MDN, `USB.requestDevice()` — https://developer.mozilla.org/en-US/docs/Web/API/USB/requestDevice
- MDN, `@page/size` — https://developer.mozilla.org/en-US/docs/Web/CSS/@page/size
- MDN, Firefox 151 release notes — https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/151
- Mozilla Hacks, "Web Serial support in Firefox" (21 May 2026) — https://hacks.mozilla.org/2026/05/web-serial-support-in-firefox/
- caniuse, Web Serial — https://caniuse.com/web-serial ; WebUSB — https://caniuse.com/webusb
- Chrome for Developers, "New permission prompt for Local Network Access" — https://developer.chrome.com/blog/local-network-access
- Chrome for Developers, "Direct Sockets" (Isolated Web Apps) — https://developer.chrome.com/docs/iwa/direct-sockets
- Chromium source, `chrome/common/chrome_switches.cc` (`kiosk`, `kiosk-printing`) — https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/common/chrome_switches.cc
- CUPS, network printing / AppSocket-JetDirect port 9100 — https://www.cups.org/doc/network.html

**QZ Tray**
- Licensing — https://qz.io/docs/licensing ; wiki mirror — https://github.com/qzind/tray/wiki/Licensing
- FAQ (free, certificate needed for silent printing, OS support) — https://qz.io/docs/faq
- Message signing — https://qz.io/docs/signing-messages
- Raw printing API — https://qz.io/docs/raw
- Getting started — https://qz.io/docs/getting-started
- *(price page https://buy.qz.io/Premium-Support-_p_13.html returned HTTP 403 — price unverified)*

**Libraries (versions from the live npm registry / GitHub API, 2026-08-07)**
- https://github.com/NielsLeenheer/ReceiptPrinterEncoder + `documentation/commands.md`
- https://github.com/NielsLeenheer/WebUSBReceiptPrinter (README: Windows driver-claiming limitation)
- https://point-of-sale.dev/ (full `@point-of-sale` library list)
- https://github.com/Klemen1337/node-thermal-printer ; https://github.com/python-escpos/python-escpos
- https://github.com/qzind/tray ; https://github.com/jordankzf/print-agent

**Star CloudPRNT**
- Protocol Guide 2.5.x — https://star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/en/protocol-guide.html

**Repo files cited**
- `frontend/package.json`, `frontend/lib/offline/{types,outbox}.ts`,
  `frontend/components/pos/settlement-actions.tsx`,
  `frontend/app/(tenant)/app/pos/orders/[orderId]/charge/page.tsx`,
  `services/pos-service/src/main/java/io/restaurantos/pos/web/*`,
  `services/user-service/src/main/java/io/restaurantos/user/entity/BranchEntity.java`,
  `.planning/research/erp-completion/fbr-integration-design.md`
