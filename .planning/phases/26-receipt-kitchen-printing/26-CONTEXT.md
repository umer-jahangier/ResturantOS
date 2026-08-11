# Phase 26 — Receipt & Kitchen Printing · CONTEXT

**Status:** planning
**Depends on:** 17 (tenant config), 21 (screen rebuilds) — both partially landed
**Blocked-on-user:** U3, a physical 80mm ESC/POS printer, for FINAL SIGN-OFF ONLY

---

## Why this phase exists

`.planning/research/gap-audit/DEFECT-REGISTER.md` records it plainly: **no printed receipt
exists anywhere in the product.** A restaurant cannot take payment and hand the customer
nothing. The register puts an HTML print bill in **Tier 1** of the shortest path to demo-able,
which makes this one of the few remaining items between the current build and a system
Floating Terrace could actually run a service on.

The research is already done and committed at
`.planning/research/erp-completion/pos-printing.md` — WebUSB vs Web Serial vs QZ Tray vs a
local print agent, the browser support matrix, ESC/POS cut and cash-drawer command sequences,
and the licensing position on QZ Tray. **The planner must read it and must not re-research it.**

---

## Locked decisions

> **AMENDED 2026-08-07, after the planner challenged it.** D-26-01 originally said "direct
> ESC/POS", which read literally means *browser-direct* — and the research rejects that on four
> independent grounds: Windows binds printer-class devices to `usbprint.sys` so WebUSB cannot
> claim them, Web Serial does not enumerate printer-class devices at all, no browser has raw
> TCP, and Safari supports none of it. **"Direct" means "not rasterised through a print driver",
> not "issued from the browser process".** The transport is a local print agent, per research §9.
> The planner was right to raise this before wave 3 rather than discover it there.
>
> **26-11 is KEPT, not cut.** The planner flagged it as the ~3-day overrun candidate and left the
> decision here. Keeping it: its whole purpose is that a kitchen ticket prints when no browser tab
> is open. A kitchen printer that fires only while someone's tablet happens to be awake is
> precisely the "structurally present, behaviourally absent" outcome this project's defect
> register catalogues 26 times — it would demo perfectly and fail on a Friday night.

> **AMENDED 2026-08-11, after the user stated the deployment topology.** The user said:
> *"the app will be running on cloud somewhere else while the users will be accessing it from
> their browser… for the printers how the printers will automatically get detected and print slip
> in pos and kds both."*
>
> This is decisive and it was not known when plans 26-07 to 26-12 were written. Two new locked
> decisions follow, and the plan order changes.

**D-26-06 — The cloud can NEVER open a connection to a printer. Only outbound polling works.**
RestaurantOS runs in a datacentre; the printers sit on the restaurant's LAN behind NAT. There is
no route from the cloud to port 9100 and there never will be — not a firewall rule, a topology
fact. Everything that reaches a printer must be initiated from INSIDE the restaurant.

What this changes, plan by plan:

- **26-11 is no longer an optimisation. It is what makes the product deployable at all.** Its
  `cloud/poll.ts` + `enrol.ts` shape — the agent authenticates with a per-branch credential and
  polls outbound — is the only architecture that works. Without it a cloud-hosted RestaurantOS
  cannot print anything. It now ranks ABOVE 26-08 and 26-10.
- **Tier 1 (the browser bill) is unaffected.** `window.print()` runs in the cashier's browser,
  which is inside the restaurant. Already proven end to end in 26-05.
- **26-09's client bridge is unaffected**: browser → `127.0.0.1:7654` is LAN-local on both ends.
- **The kitchen ticket must not depend on a browser being open.** That is 26-11's whole purpose and
  it is now load-bearing: the cloud enqueues, the agent polls, the ticket prints with no KDS tab
  anywhere. 26-12's proof must demonstrate exactly this — **fire an order with every browser
  closed and assert the bytes reach the socket.**
- **26-07 does not change**, and after-commit dispatch matters MORE here, not less: a phantom
  ticket from a rolled-back fire is worse when the cook is in a different building from the
  database.
- **D-2 gets its answer from this.** The agent needs the printer registry, and it is not a user —
  it should authenticate as a DEVICE with a per-branch credential (26-11's enrolment), not borrow
  a cashier's token. So the fix for "the receipt-config read requires `branch.manage`" is a
  device-scoped internal read, not widening a user permission. That is the resolution direction
  for 26-09/26-11; do not grant cashiers something broad.

**D-26-07 — Printers are DISCOVERED inside the restaurant and CONFIRMED by a human. Never
auto-bound.**
The registry today is manual IP entry, which does not survive contact with a restaurant manager.
Discovery can only run inside the LAN, so it belongs in the print agent (26-06's daemon) and
surfaces in the registry screen (26-10).

- **mDNS / DNS-SD is the primary mechanism.** Browse `_pdl-datastream._tcp` (port 9100),
  `_ipp._tcp` (631) and `_printer._tcp` (515). Address, port and usually make and model come off
  the TXT record.
- **A bounded port-9100 sweep of the agent's own /24 is the FALLBACK**, because cheap ESC/POS units
  commonly ship with mDNS disabled. Rate-limited, never beyond the subnet the agent is attached to,
  and **opt-in only — triggered by a manager pressing "Scan for printers", never on a timer.** An
  unattended subnet scan from a device on a customer-facing network is indistinguishable from
  reconnaissance and will trip a client's IDS.
- **Enumerate USB / system print queues too.** Many tills have the printer on USB and the
  system-printer transport already exists (26-06 task 2).
- **Discovery produces CANDIDATES, not configuration.** A discovered device becomes a suggestion
  with make, model and address prefilled; a manager names it, assigns it to a station and saves it.
  Auto-binding would silently route a customer's bill to whatever answered first on port 9100.
- **Test Print is the confirmation step.** The column ruler built in 26-06 task 3 is the only
  honest way to establish that the thing which answered is a receipt printer and not a label
  printer or a network appliance — and it measures the column count at the same time, which
  research §7.5 says must be measured rather than assumed.
- **Discovery results cross a trust boundary.** A candidate list is the restaurant's internal
  network topology — addresses, makes, models. It is branch-scoped data: report it to the cloud
  only for the branch that produced it, do not log it broadly, and do not retain rejected
  candidates.

**Revised plan order:** 26-07, **26-11**, 26-09, 26-10 (with discovery), 26-08, 26-12.

**D-26-01 — Two tiers, and the plain tier ships first.**
A tenant with no thermal hardware must still be able to hand a customer a bill. So: an HTML
receipt rendered for `window.print()` with an 80mm `@page` stylesheet, working in any browser
with no drivers and no install — and, on top of it, direct ESC/POS for tenants who have a
thermal printer. If the ESC/POS path is unavailable, unsupported by the browser, or the device
is not paired, the product falls back to the HTML bill **without an error** — printing on
paper is the requirement, thermal is the optimisation.

**D-26-02 — Built and proven against an emulator; hardware is sign-off, not a dependency.**
Floating Terrace has no printer yet. Everything except real-paper behaviour is verifiable
against an ESC/POS emulator and byte-level assertions on the generated command stream. The
things no emulator can settle — cut degradation, drawer pulse voltage, exact columns-per-line
on a specific model — are the ONLY items that may be deferred to U3, and each must be listed
explicitly in the summary rather than left implied.

**D-26-03 — The receipt carries FBR placeholders from day one.**
Floating Terrace is in Islamabad (F-7), which is ICT, where services ARE federally taxed — so
FBR is the correct authority and Phase 27 will need the QR code and the FBR invoice number on
the printed receipt. The layout must reserve and render those regions now, populated when
present and gracefully absent when not. **This phase does NOT implement FBR integration** —
that is Phase 27, deferred pending the user's NTN and PRAL sandbox credentials. The cost of
getting this wrong is a receipt redesign later; the cost of getting it right is a nullable
field and some whitespace.

**D-26-04 — Money converts at the print layer and nowhere else.**
Money is BIGINT paisa throughout the domain and the transport. The register found journal
detail rendering raw paisa, making **every total 100× too large**. A receipt showing the wrong
amount is worse than no receipt, so the conversion happens once, at render, and is asserted.

**D-26-05 — Printer configuration is per-tenant AND per-terminal.**
A tenant has branches; a branch has terminals; a kitchen printer is not the counter printer.
The config must reach terminal granularity even if the first UI only exposes tenant-level
defaults. Phase 17's tenant-configuration spine is the owner of that storage — follow it rather
than inventing a parallel settings mechanism.

---

## Scope fences

**In scope:** customer receipt (itemised bill, tax, service charge, tender, change), kitchen
ticket, reprint of a past order, cash-drawer kick on cash settlement, printer configuration,
and the fallback path.

**Out of scope, deliberately:** FBR fiscalisation (Phase 27), label/barcode printing, PDF
export and email delivery (needs the notification service, which is an empty module), and
multi-POS terminal routing (Phase 28).

---

## Constraints the planner must honour

- **The POS live-order WebSocket was only just fixed** and had never worked in a browser. Do
  not disturb `WS_UPGRADE_PATHS` in the gateway.
- **All `pos_db` tables are FORCE RLS** (Phase 17b closed a live cross-tenant leak). Any new
  query is tenant-scoped, with the predicate in the query as well as the policy. Under forced
  RLS an unscoped query returns **zero rows rather than erroring**, so a wiring break presents
  as "no data".
- **Testcontainers runs Postgres as a superuser and bypasses RLS**, so a green integration test
  proves nothing about tenant scoping. Follow `RlsForcedInvariantIT` and the non-superuser
  canary established in 17b.
- **Design tokens are phase 20's** (`.planning/phases/20-design-system/UI-SPEC.md`). A receipt
  is monochrome thermal output, so it is largely exempt from the colour system — but the
  configuration UI is not.
- `QueryBoundary` (phase 14b) on every data-fetching screen: a failed request renders an ERROR
  state, never an empty one.

---

## Definition of done

Verifiable by command or browser journey, never by opinion:

1. A cashier settles an order and gets a correctly totalled printed bill in a real browser,
   with no thermal printer attached.
2. The generated ESC/POS byte stream is asserted against an emulator, including cut and drawer
   commands.
3. A reprint of a past order produces an identical document and is distinguishable as a
   reprint.
4. Totals match the order and the ledger to the paisa — asserted, not eyeballed.
5. The FBR QR and invoice-number regions render when populated and collapse cleanly when not.
6. A tenant with no printer configured still gets a bill.
7. Every item genuinely requiring physical hardware is listed explicitly as awaiting U3.
8. **A kitchen ticket reaches a station printer, and a printer fault cannot stop an order being
   fired.** Added 2026-08-07 — the plan-checker found the scope fence put the kitchen ticket in
   scope while these seven items never mentioned it, so the phase's second-largest subsystem
   (26-07, most of 26-06, all of 26-11) had **no section in the live proof script**. Tickets were
   exercised only by "rows exist via the API", which is precisely the structurally-present /
   behaviourally-absent shape this phase exists to escape. My omission, faithfully reproduced by
   the planner. Proof must drive a document through the agent's HTTP endpoint → durable queue →
   transport → socket and assert the bytes the socket **received**, not what the renderer returned.
