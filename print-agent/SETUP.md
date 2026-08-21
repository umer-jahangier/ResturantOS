# Setting up printers

Written after wiring a real 80 mm USB thermal printer on a Mac to the
`dev.restaurantos.softxlogic.com` cluster and proving all three slip types.
Every step below was executed, not designed.

## How it actually connects

```
POS closes/fires  →  pos-service writes a print_jobs row       (server, in the cluster)
                                  ↑  outbound HTTPS, every 3s
                     print agent on the shop's machine
                                  ↓  lp -d <queue> -o raw
                            the printer
```

**Nothing connects inward to the shop.** The agent dials out and polls
`POST /api/v1/pos/print-agent/claim` with an `X-Print-Agent-Key` header. No port
forwarding, no VPN, no tunnel, no inbound firewall rule. A printer behind NAT on
a café's domestic broadband works with no network configuration at all.

**The browser never prints.** It talks to the agent on `127.0.0.1:7654` for
exactly two things: "is the agent on THIS machine alive?" and "print a
calibration page". Receipts and kitchen tickets never touch the tab — which is
why kitchen tickets keep printing when every browser is closed.

## One agent per BRANCH, not per till

The counter PC or a Raspberry Pi. Not each till. That is the whole reason this
exists instead of QZ Tray: the print path must survive the last browser closing.

---

## 1. Make the OS see the printer

**USB.** Install the vendor driver or add it as a generic raw queue, then:

```bash
lpstat -p            # macOS / Linux — note the queue NAME, you need it below
```

**Network.** Give it a static IP. It speaks port 9100 with no driver at all —
usually less trouble than USB.

## 2. Install the agent

Node 20+. No compiler, no native build, no database.

```bash
cd print-agent
pnpm install
pnpm exec tsc -p tsconfig.build.json
```

## 3. Enrol it with the server

Enrolment is per branch and returns a secret shown **once**. Any user holding
`pos.printer.manage` (MANAGER and above) can do it, in the app or over the API:

```bash
curl -X POST "https://<host>/api/v1/pos/print-agents" \
  -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  -d '{"branchId":"<branch-uuid>","label":"Counter PC"}'
# → { "agentId": "...", "secret": "..." }   ← store the secret now
```

## 4. Point the agent at the server

```bash
export PRINT_AGENT_CLOUD_URL="https://<host>"
export PRINT_AGENT_CREDENTIAL="<the secret from step 3>"
node dist/main.js
```

Confirm the cloud channel came up — this line is the whole test:

```
{"event":"cloud_channel","state":"POLLING","pollIntervalMs":3000}
```

`DISABLED` means `PRINT_AGENT_CLOUD_URL` is unset and the agent is loopback-only:
it will answer a test print from the Printers screen and receive **no** real
jobs. That is the single most likely reason "nothing prints".

## 5. Register the printers in the product

**This is the step everyone misses.** The agent reporting its queues is only
DISCOVERY. A job needs a configured printer to aim at, and that configuration
lives on the branch, not in the agent's local file:

`PUT /api/v1/branches/{branchId}/receipt-config`

```json
{
  "printers": [
    { "id": "counter-1", "role": "RECEIPT", "stationCode": null,
      "transport": "SYSTEM", "systemPrinterName": "<queue name from step 1>",
      "widthMm": 80, "columns": 48, "columnsMeasured": false,
      "codepage": "CP437", "cut": "PARTIAL" },

    { "id": "kitchen-1", "role": "KITCHEN", "stationCode": "KITCHEN", "...": "same device" },
    { "id": "bar-1",     "role": "KITCHEN", "stationCode": "BAR",     "...": "same device" }
  ],
  "kitchenStations": ["KITCHEN", "BAR"]
}
```

Several logical printers may name the **same** physical device — that is how a
one-printer shop still gets correct routing, and it is exactly how this was
tested. For a network printer use `"transport": "TCP"` with `host` and
`port: 9100` instead of `systemPrinterName`.

The agent picks the registry up on its next 3-second poll:

```
{"event":"registry_applied","printers":["counter-1","kitchen-1","bar-1"],"rejected":[]}
```

## 6. Route the menu to stations

A kitchen ticket is addressed by the item's **station**, so items with no station
produce `UNROUTABLE: no kitchen printer configured for station UNASSIGNED`, which
is a FAILED job and no paper. Create the stations, then assign every item:

```bash
POST /api/v1/pos/stations?branchId=<b>          {"code":"KITCHEN","name":"Main Kitchen","stationType":"KITCHEN"}
POST /api/v1/pos/stations?branchId=<b>          {"code":"BAR","name":"Main Bar","stationType":"BAR"}
PUT  /api/v1/pos/menu/items/<id>/station?branchId=<b>   {"stationId":"<station-uuid>"}
```

`GET /api/v1/branches/{b}/receipt-config` returns a `completeness` block that
names any station with no printer. Aim for `"complete": true`.

## 7. Calibrate the column count

`columns: 48` is a guess until a human looks at paper. Print the ruler from the
Printers screen (or `POST http://127.0.0.1:7654/test-print` with
`{"targetPrinterId":"counter-1"}`), read the highest number that fits on one
line, put that in `columns`, and set `columnsMeasured: true`. 80 mm is usually
48; 58 mm is usually 32.

## 8. Make it survive a reboot

`systemd` on Linux, `launchd` on macOS, Task Scheduler on Windows.

---

## Verifying, and what the system will not tell you

```bash
curl localhost:7654/health    # queue depth by status, per-printer last attempt
curl localhost:7654/printers  # the registry it received from the server
curl localhost:7654/queue     # depth plus dead-lettered jobs
```

**`SENT` does not mean printed.** Raw printing is fire-and-forget: the agent
knows it wrote bytes, and a spooler will accept jobs for a printer unplugged
since Tuesday. The terminal success state is named `SENT` for that reason and
nothing here will ever claim a paper outcome it cannot observe. Server-side the
job shows `PRINTED`, which likewise means "the agent acknowledged it", not "ink
met paper".

A dead-lettered job has exhausted `maxAttempts` and is **never** retried
automatically — deliberately, so one wedged printer cannot drain the queue. It is
also never compacted away, because that record is the only evidence a customer's
receipt did not print. Re-POST the document to `/print` to retry one.

## Known limits

- **Windows raw printing is not implemented.** The agent fails with a named error
  rather than silently discarding the job. A Windows till needs a network printer
  over TCP, or an agent on a Linux/macOS machine in the same branch.
- **Non-loopback binds are refused without a shared secret**, and an
  `allowedOrigins` wildcard is rejected at load. An unauthenticated print endpoint
  on a restaurant LAN prints whatever anyone sends it, and on most restaurant
  networks that includes the guest wifi. Both are refusals, not warnings, because
  nobody reads a warning on a till.

## Proven end-to-end, 2026-08-21

One order containing a kitchen item and a bar item, on a single physical 80 mm
USB printer with three logical printers registered:

| Slip | Printer | Result |
|---|---|---|
| `CUSTOMER_RECEIPT` | `counter-1` | PRINTED |
| `KITCHEN_TICKET` | `kitchen-1` | PRINTED |
| `KITCHEN_TICKET` | `bar-1` | PRINTED |

Agent queue: 30 SENT, 0 FAILED, 0 dead-lettered.
