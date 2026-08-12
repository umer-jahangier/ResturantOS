# One restaurant day, driven end to end

**Date driven:** 2026-08-12, 07:45–08:35 Asia/Karachi (02:45–03:35 UTC)
**Method:** one continuous session in real Chromium (Playwright), switching personas the way a
restaurant does. Every claim below was produced by clicking, and cross-read over HTTP on the
signed-in persona's own bearer — never on an injected token, never on a mock.
**Stack:** `scripts/check-stale-jars.sh` → `checked=16 stale=0` before the run. All 14 services
answering. Frontend on :3000, gateway on :8080.
**Evidence:** 94 screenshots in `.planning/audits/shift/`. Every figure quoted below is also
reproduced verbatim in this document, so nothing here depends on an uncommitted artefact; the raw
probe dump (`shift/_state.json`) and the driving harness (`frontend/e2e/shift/*.mjs`) are left in
the working tree deliberately uncommitted, because the brief scopes this commit to the report and
its screenshots.

Everything in this document was driven by me in a browser. Where I could not complete a task, I
say so and give the exact refusal.

---

## 0. The setup, and one finding before service even started

The brief says *"Manager opens a till with a float."* **A manager cannot open a till for anyone but
themselves.** `TillServiceImpl.openTill` binds the session to `findByCashierIdAndStatus(cashierId,
OPEN)` — the drawer belongs to whoever pressed the button. The manager opened a Rs 5,000.00 float
and the cashier's terminal still read `No active till`. In a real restaurant the duty manager counts
the float into the drawer and hands it over; here every cashier must count their own.
`01b-manager-pos-before-till.png`, `01f-cashier-pos-till-strip.png`

The seeded cashier's inherited drawer could not be cashed up at all: **133 orders**, and the close
was refused with *"This till still has open orders. Settle, serve, or void them before closing."* —
with **no list of which orders**, and no route to them. A cashier at 23:00 is told to go and find
133 checks by hand. `01i-after-close-attempt.png`

So I hired a cashier, which the product does well: owner → `/app/users` → **Add a user** → branch,
role Cashier → one-time password shown once → new hire signs in → forced password change → own
drawer, Rs 5,000.00 float, **0 orders**. Clean, checkable money from this point on.
`01k`–`01r`

Two small things a real new hire meets on that path:

- After setting their password they are **bounced to `/login`** and must type the password they set
  ten seconds earlier. `01p-after-change-password.png`
- The change-password link carries **the reset token and the email address in the URL query
  string** (`/login/change-password?token=…&email=…`). That lands in browser history and in every
  proxy log between here and the browser.

---

## 1. Service — what worked

This is the strongest part of the product and it deserves to be said plainly.

**Ring and fire.** Dine-in, table **H1** chosen from a real picker showing live states
(`H1 Available`, `T1 Occupied`), three dishes with one at qty 2, subtotal Rs 1,577.00 / tax
Rs 12.80 / total Rs 1,589.80 estimated on the panel *before* committing. One tap on **Send to
Kitchen** → `ORD-20260812-0164`. `02b`, `02c`, `02d`

**Station routing genuinely works.** That one check split across two boards, correctly:

| Board | Card |
|---|---|
| `PANTRY1` (Cold prep) | `ORD-20260812-0164 · DINE-IN · Table H1 · 2× Audit Item 52235 · 1× Audit Item 60568` |
| `DEFAULT` | `ORD-20260812-0164 · DINE-IN · Table H1 · 1× Butter Naan` |
| `BAR`, `GRILL`, and three others | not present |

`02f`, `02g`

**The cook worked it, per item, and it stuck.** On `PANTRY1` the buttons read
`Audit Item 52235 → Started`, then `→ Preparing`, then `→ Ready`. After four presses the fragment
key was `READY:1c28885e-…` and the column counts read `NEW 12 · STARTED 0 · PREPARING 0 · READY 1`.
No bump error. `02h-bump-0/1/2`, `02i`

**The second check.** Takeaway, two dishes, Rs 1,700.00 + Rs 272.00 tax = Rs 1,972.00 →
`ORD-20260812-0165`. Selecting Takeaway correctly **removes** the table picker. `02j`, `02k`

**The late add.** Table H1 asked for another naan after the mains had gone. Order Management →
search → open → **Quick Add** "Naan" → Add → the drawer showed the new line as `Pending` beside the
already-`Sent` lines, offered **`Send New Items (1)`**, and firing it produced
`Butter Naan REV 2 · Sent` with the header moving from `1 revision` to `2 revisions`. Only the new
line went to the kitchen. `02t`–`02w`

**Money in, correct to the paisa.** Cash: the field is labelled **Amount (Rs)**, "Full amount"
filled `1682.60`, a **Tendered (Rs)** box took `2000`, and **Change due Rs 317.40** rendered before
the payment was taken. Quick-tender chips `+50 +100 +500 +1,000 +5,000 Exact`. After recording:

```
order_payments: method CASH  amountPaisa 168260  tenderedPaisa 200000  changePaisa 31740
```

`03b`, `03c`. Card: reference field present, **no** tendered/change row (a card has no drawer) —
`amountPaisa 197200, tenderedPaisa 197200, changePaisa 0, referenceNo "VISA-4411"`. `03d`, `03e`

**Void on a paid check is properly refused.** No Void trigger on the drawer, and the direct call
returns a specific, correct 409 for **both** cashier and manager:

```
ORDER_HAS_PAYMENTS — "Order ORD-20260812-0164 has 168260 paisa recorded against it and cannot be
voided. Use Refund — a void leaves the payment in place with no reversing entry."
```

I read the payment rows afterwards: **unchanged**, one CASH row, nothing added, nothing deleted.
`03l`

**The drawer reconciled exactly.** Till Review as the manager:
`FLOAT Rs 5,000.00 · EXPECTED Rs 6,682.60 · DECLARED Rs 6,682.60 · VARIANCE Rs 0.00`, with my
close note attached. Float + the single cash tender = the expected figure to the paisa. `05g`

**Debits equal credits, on real persisted rows.** Transactions → my CASH payment row → **Open**:

```
Order ORD-20260812-0164 · status CLOSED
subtotal Rs 1,657.00 · discount Rs 0.00 · tax Rs 25.60 · service Rs 0.00 · total Rs 1,682.60
JE-2027-000254 · ORDER_REVENUE
  1010  CASH payment       DR Rs 1,682.60
  4100  Sales revenue                      CR Rs 1,657.00
  2200  Output tax                         CR Rs    25.60
Balanced · Rs 1,682.60
```

`05l`. DR 1,682.60 = CR 1,682.60. That is genuinely right.

**The bill is real paper, not Ctrl-P.** The receipt page says *"Sent to the receipt printer … No
browser print dialog is opened"* and renders a complete bill whose every figure matches the screen
and the ledger: `Subtotal Rs 1,657.00 / Tax Rs 25.60 / TOTAL Rs 1,682.60 / CASH Rs 1,682.60 /
Tendered Rs 2,000.00 / Change Rs 317.40`. `07d`

**The voids are audited.** `/api/v1/audit/events` holds all four of my `ORDER_VOIDED` events with
actor ids, plus `TILL_OPENED` and `TILL_CLOSED`, and the Voided list prints the reason and the
actor's **name**: *"End of shift — parked check never taken · by Shift Cashier 984155 · Aug 12,
08:16 AM"*. `06f`

---

## 2. The three things that stop tomorrow's lunch

### S0-A — A cashier cannot void a check that has been sent to the kitchen. The button is there and it 403s.

This is the register's own headline defect, unrepaired, reproduced under my hands.

The cashier rang `ORD-20260812-0166`, fired it, the guest walked out. They opened the check, pressed
**Void order**, typed *"Guest left before the food went out"*, pressed **Confirm Void**, and the
panel answered:

> **You don't have permission to void this order.**

`03o-after-void.png`

The same call with the same live bearer:

```
POST /api/v1/pos/orders/41227cec-…/void
403  {"title":"FORBIDDEN","detail":"Not permitted: pos.void"}
```

The cashier's JWT carries `pos.order.void.own` (14 permissions, verified by decoding the live
token), the order's `cashierId` **is** the cashier's `sub`, and the client renders the trigger
because `PermissionGuard require={["pos.order.void.own","pos.order.void.any"]}`.

I pinned the boundary on one run, with the same token, minutes apart:

| Check | Status | Result |
|---|---|---|
| `ORD-20260812-0167` — saved as a draft, never fired | `OPEN` | **200 → VOIDED** |
| `ORD-20260812-0166` — the same cashier, fired | `SENT_TO_KDS` | **403 `Not permitted: pos.void`** |
| `ORD-20260812-0166` — manager (`pos.order.void.any`) | `SENT_TO_KDS` | **200 → VOIDED** |

The cause is one line. `policies/restaurantos/pos.rego:13-20`:

```rego
# void.own: cashier can void their own OPEN order
allow if {
    input.action == "void"
    common.has_permission(input, "pos.order.void.own")
    input.resource.created_by == input.user.id
    input.resource.status == "OPEN"          # ← here
    common.same_tenant_and_branch(input)
}
```

while `void-refund-dialog.tsx` renders the trigger for `OPEN || SENT_TO_KDS`.

`VoidOwnOrderIT.java` exists and tests *"a CASHIER … voids THEIR OWN **OPEN** order → succeeds"*.
It is green. It encodes exactly the state that works and never touches the state a restaurant
actually voids in — a check that has already gone to the pass. **This is the signature failure the
brief describes, still live: the assertion is true and the button does not work.**

The operational consequence is worse than a failed click. A check the cashier cannot void stays
open. An open check blocks `closeTill` ("This till still has open orders"). So a cashier whose guest
walks out cannot cash up without finding a manager, and if no manager is on, the drawer stays open
overnight. That is exactly how the seeded drawer got to 133 uncloseable orders.

**Note the copy, too.** `pos.void` is not a permission that exists anywhere in this repo — it is
`module + "." + action` string concatenation. Whoever debugs this will spend an hour looking for a
permission code that was never real. It cost this project that hour twice already; it is recorded
in `07-UAT.md` from July.

---

### S0-B — No discount can be given, by anybody, anywhere, on a check that has been fired. Which is all of them.

I hunted for a discount control on the POS terminal, the charge page, and the order drawer. Every
one returned an empty list:

```
charge-page:   []
pos-terminal:  []
drawer:        ["1 revision","Mark Served","Cancel","+ Add note","Full Menu","CHARGE NOW",
                "Reprint kitchen ticket"]   hasDiscountWord: false
```

`03f`, `04a`

Then I went to the endpoint the register says only needs wiring up. It is not just unwired — it is
unfit for the job:

| Who | Order state | Scope | Result |
|---|---|---|---|
| cashier | `SENT_TO_KDS` | ORDER | `409 STATE_INVALID — Cannot apply discount to order in status: SENT_TO_KDS` |
| cashier | `SENT_TO_KDS` | LINE | same 409 |
| manager | `SENT_TO_KDS` | ORDER | same 409 |
| manager | `SENT_TO_KDS` | LINE | same 409 |
| cashier | `OPEN` (never fired) | ORDER | **`403 Not permitted: pos.pos.order.discount.override`** |

`OrderServiceImpl.applyDiscount` refuses anything that is not `OPEN`. A discount in a restaurant is
decided when the bill is presented — after the food is fired, by definition. So even with a perfect
screen bolted on, the only discountable check is one nobody has cooked yet.

And the cashier — who is the person standing in front of the guest — cannot give a whole-order
discount at all; that needs `pos.order.discount.override`, which only the manager holds. There is no
manager-approval flow anywhere to bridge that.

Two more things fall out of this:

- **`ApplyDiscountRequest` has no reason field** (`scope, orderItemId, type, value`). Even when it
  works there is no reason code, so the "Discount Summary" report in `/app/reports` can only ever be
  a list of amounts with no explanation.
- The 403 message reads **`pos.pos.order.discount.override`** — the module prefix is applied twice.

The Takings screen is honest about the downstream damage, which I respect and which also proves
nobody can fix it from the UI:

> **COMPS — Not known.** *Comps are not recorded separately from discounts. `orders.discount_paisa`
> is one column, and a full comp appears in it as a discount equal to the subtotal.*

---

### S0-C — The day's takings are filed to the wrong day, and the two finance screens disagree about it.

My shift's money, unambiguously:

```
CASH Rs 1,682.60   recorded_at 2026-08-12T02:59:24Z
CARD Rs 1,972.00   recorded_at 2026-08-12T03:01:20Z
```

`/app/finance/transactions` stamps them **`8/12/2026, 7:59:24 AM`** and **`8/12/2026, 8:01:20 AM`**.

`/app/finance/takings` puts them on business date **`2026-08-11`**. Asking that screen for today:

```
/app/finance/takings?date=2026-08-12
  → "0 orders closed on this trading day", no tender split, no till list, no tiles
```

`05j-takings-2026-08-11.png`, `05j-takings-2026-08-12.png`

The 08-11 page then contradicts itself inside a single row. Under **"What each till counted"**:

> **Shift Cashier 984155** — *Opened 8/12/26, 7:50 AM · closed 8/12/26, 8:16 AM* — Matched —
> Rs 5,000.00 / Rs 6,682.60 / Rs 6,682.60 / Rs 0.00

A till whose own timestamps say 12 August, listed on the page for 11 August.

The journal entry inherited it: `JE-2027-000254 · ORDER_REVENUE · **2026-08-11**` for a payment the
rest of the product dates 12 August.

**The cause.** `/app/settings` carries a **Time zone** field reading `Asia/Karachi`, described on
that very screen as *"An IANA name. **Business dates and reports are cut on it.**"* They are not.

- `reporting-service` `BusinessDay.java` does it correctly:
  `occurredAt.atZone(branchZone).minusHours(offsetHours).toLocalDate()`
- `pos-service` `DailyTakingsService` does it in UTC — and its own comment claims the two are
  "byte-identical":

```sql
AND date((COALESCE(p.recorded_at, p.created_at) AT TIME ZONE 'UTC')
         - make_interval(hours => :offset)) = :date
```

For `Asia/Karachi` (UTC+5) that moves the trading-day boundary from 04:00 local to **09:00 local**.
Every sale between 04:00 and 09:00 local — five hours of every single day, including the whole of
breakfast — is filed to yesterday on Takings and to today everywhere else. My run happened to sit
inside that window, which is the only reason the entire shift vanished.

Correct answer by the product's own formula: `2026-08-12T02:59:24Z` → `07:59 Asia/Karachi` → minus
4h → **2026-08-12**. The screen says 2026-08-11.

An owner who opens Finance → Takings after a morning service sees an empty day while the drawer is
full of money. That is the exact class of failure this register was written about.

---

## 3. Everything else that broke, confused or lied

Ordered roughly by how much it would cost a real restaurant.

### Money and reconciliation

**1. The close-till panel shows no expected cash and no variance.** The cashier is asked for a
"Declared Cash Count (PKR)" against a panel reading only *"Opening float: Rs 5,000.00"*. Measured:
`hasExpected: false`, and the variance preview stayed `null` after I typed the count.
`05d-close-till-panel.png`

The information exists **one line above**: the green strip reads
`Till OPEN · Float: Rs 5,000.00 · Cash: Rs 6,682.60 · Orders: 6`. And the manager's Till Review
shows all three columns. The component gates on `activeTill.expectedClosingPaisa`, which the server
only populates *after* the close — so the field is structurally always null at the moment it is
needed. The brief's step 5 — *"counts the drawer and reads the variance"* — **cannot be done by the
cashier**, only by a manager afterwards.

**2. "Net sales" is larger than "gross sales."** `GROSS SALES Rs 43,350.00`, `DISCOUNTS Rs 950.00`,
`TAX Rs 3,566.40`, `NET SALES Rs 45,966.40` — because "net" here means gross − discounts + tax. In
every restaurant P&L net sales is gross **less** discounts and **excluding** tax. The tile's own
caption, *"What the bills actually came to"*, describes a total, not net sales. Any accountant
reading this screen will mis-state revenue.

**3. The bill prints at close, not at tender.** My receipt is stamped
`*** REPRINT #2 *** Originally issued 2026-08-12T03:15:24.754Z` — that is when I pressed **Mark
served & close order**. The payment was at `02:59:24`. A cashier who takes the cash and hands the
guest their change has produced no paper.

**4. Every print agent reads "Not responding", and the receipt page still promises paper.** The
Printers screen lists nine agents, all *"It has polled before but not recently. The machine may be
off or off the network."*, while the panel beside them says *"No print agent answered on this
machine."* The receipt page nonetheless states *"the branch print agent will put it on paper"*.
`07c`, `07d`

The screen is honest about coverage, which is good: a real `[role=alert]` reads *"BAR, GRILL,
DGB28334, DGS43431, DGS20334, EXPO7 have no printer. Tickets for those stations will be recorded as
unprintable and no paper will appear in the kitchen."* Six of seven stations have no printer.

**5. The guest's bill says `[OTHER]`.** The tax line on the printed receipt renders
`Tax (16.00%) [OTHER] Rs 25.60` — a raw enum on a customer-facing document.

**6. The manual journal entry form defaults to a date a year in the past.** `/app/finance/journal-entries/new`
shows a calendar headed **August 2026** with `Selected: **2025-08-01**` underneath, under a label
reading "Entry Date (open periods only)". The line fields are also labelled **"Debit (paisa)" /
"Credit (paisa)"** — raw paisa entry, in the one place an accountant types money by hand, in a
product that just fixed exactly this on the cash screen. `06b`

**7. Journal entries are described by UUID.** Every row on `/app/finance/journal-entries` reads
`Order revenue b64e3cdd-6e00-4d45-88d6-7e8afdaff0fb`. The order number is not carried — even though
the transaction row that links to the same entry knows it is `ORD-20260812-0164`.

### The order list — the screen a manager scans all day

**8. The "Server/Cashier" column is a raw UUID, for every row, for every persona.**
`order-management.tsx:356-358`:

```tsx
row.original.cashierId ? <span>{row.original.cashierId.slice(0, 8)}</span> : <span>—</span>
```

Screen reads `bc0d9897`. This is not "the name is unavailable": **the same table's Voided column, in
the same row, prints "by Shift Cashier 984155"**, and the Takings till list prints the same name in
full. The name is resolved a few pixels away and thrown away here. `06f-voided-rows.png`

**9. Four of my six checks show the wrong order type.** `order-management.tsx:326`:

```tsx
<span>{o.tableName ?? "Takeaway"}</span>
```

The order's `type` is never consulted. `ORD-20260812-0166/0167/0168/0169` are all `DINE_IN` on the
server and all read **Takeaway** on the list. The screenshot of the Voided filter shows **thirteen
consecutive rows all labelled Takeaway** — a restaurant that apparently never voids a dine-in check.
And the void panel calls the same order *"Order #ORD-20260812-0166 · **Dine-in**"*, so two surfaces
one click apart disagree. `06f`, `03o`

The brief asked me to check the order list shows every order **with the correct type and status**.
Status: correct on every chip I tried (Active / Draft / In Progress / Closed / Paid / Voided /
Refunded all resolved, and my checks appeared under the right ones). Type: **wrong, by construction**.

**10. Voided checks still offer "Cancel" and "Continue" actions.** Rows `0167`, `0168`, `0169` —
already `VOIDED` — carry the cancel-draft control pair in their action cell.

**11. The void reason is clipped.** *"shift walkthrough — manager voiding a fired, unpaid…"* is cut
off at the column edge with no tooltip and no wrap. `06f`

**12. One cell states the item count twice, differently.** `4 Items` on line one, `3 Items / 4 Qty`
on line two, in the same "Items" cell.

### Kitchen

**13. The station picker and the boards disagree, on three of seven stations, repeatedly.**
Measured twice, twenty minutes apart, same session:

| Station | Picker tile | Board header | Picker column split | Board column split |
|---|---|---|---|---|
| `DEFAULT` | **120 tickets** | **111 tickets** | 97 NEW / 20 STARTED | **76 NEW / 18 STARTED** |
| `PANTRY1` | **18 tickets** | **12 tickets** | 12 NEW | 12 NEW |
| `GRILL` | **6 tickets** | **5 tickets** | 5 NEW | 5 NEW |
| `BAR` | 4 | 4 | — | — |

The screen a cook uses to decide where to stand is 21 tickets out on the busiest board. Neither
number is labelled to say what it counts.

**14. Nothing ages a ticket off a board.** `DEFAULT` reads *"Oldest 121h 34m"* — a five-day-old
ticket, with **100 NEW** on a board paginated 1 / 12. This is test debris, but the product has no
answer for it: there is no bulk clear, no auto-expire, and no way for a cook to get to a clean
board tomorrow morning.

**15. There is no expo / pass view.** My one check split to two boards; `PANTRY1` finished its two
items while `DEFAULT` never started the naan. Nothing in the product tells anyone the table is
half-ready, and by then the check was paid and closed.

### Permissions and copy

**16. The cashier is told to use a control they cannot see.** On a paid check the drawer says
*"Paid — void unavailable. Use Refund."* The Refund button is wrapped in
`<PermissionGuard require="pos.order.refund">`; the cashier does not hold it. The notice is
deliberately **not** guarded — the code comment explains that hiding it "would only make the missing
button more mysterious", which is right, and then leaves the cashier reading an instruction with no
button and no mention that a manager is needed. The manager's own drawer, same order, does show
**Refund order**. `03l` vs `03q`

**17. The Void trigger's accessible name is not what it says.** The button reads `Void`; its
`aria-label` is `Void order`. A screen-reader user hears one thing and a sighted user reads another,
and any test looking for the visible word finds nothing — which is how my first attempt missed it.

### Missing surfaces a day needs

**18. There is no audit log screen.** `/app/audit`, `/app/settings/audit`, `/app/admin/audit`,
`/app/settings/security` → **404** for the OWNER. Zero navigation entries match
audit/log/activity/history/security. The data is right there —
`GET /api/v1/audit/events` returns 200 with `ORDER_VOIDED ×4`, `TILL_OPENED`, `TILL_CLOSED`,
`JOURNAL_POSTED ×12`, `USER_CREATED`, `ROLE_GRANTED`, `PASSWORD_CHANGED` — and no screen shows any
of it. The brief's step 6 (*"check the audit log recorded the void and the discount with an
actor"*) is answerable only over HTTP, which is not a thing an owner does.

**19. The audit read path ignores its own filter.** `?resourceType=ORDER&size=40` returned
`USER_LOGIN_SUCCEEDED ×24`, `USER_LOGIN_FAILED ×8`, `JOURNAL_POSTED ×3`, `TILL_CLOSED ×1` — 36 of 40
rows are not orders. `?action=ORDER_VOIDED` **does** work.

**20. `/app/reports/<anything>` renders a blank report instead of a 404.** `/app/reports/audit`
renders *"← All reports / audit / From To"* — a working-looking report shell for a report code that
does not exist. This is precisely the trap the brief warns about: an error state wearing an empty
state's clothes.

**21. No sales-tax configuration exists.** `/app/settings/tax`, `/app/settings/taxes`,
`/app/finance/tax`, `/app/menu/tax` → 404 for the OWNER. `/app/settings` is branch identity only
(name, address, phone, email, time zone, opened-on).

The consequence showed up in my own bill: the dine-in check subtotalled Rs 1,657.00 and was taxed
**Rs 25.60 — 1.5%**, because only the two Butter Naans carry a rate and the other lines carry none.
The cart cheerfully labelled it "Tax (est.)". No screen in the product lets a tenant fix that
across a menu.

**22. No modifiers, no notes at the point of tap.** Tapping a dish produced
`{dialogs: 0, noteControls: []}` — no "no chilli", no "half/full", no size, no course. The order
drawer has a `+ Add note` for the whole check only.

**23. No tip and no service charge control** — while `Service charge Rs 0.00` is printed on the
charge page **and** on the guest's receipt, every time.

**24. Menu tiles still have no images.** 40 tiles on the till, all text-and-price, including
`Photo Dish 50585`. `02m-searched-order1.png`

---

## 4. Things I had to know that a real employee would not

- That the drawer belongs to whoever opened it, so "the manager opens the till" is not a thing.
- That `Void` on a fired check will fail, and that the fix is to find a manager — nothing on screen
  says either.
- That "Use Refund" means "ask a manager", because the Refund button is invisible to you.
- That `bc0d9897` is a person.
- That "Takeaway" under an order number means "this check has no table", not "this is a takeaway".
- That Takings' Business date box needs **yesterday's** date to show this morning's money.
- That the KDS station picker's count and the board's count mean different things.
- That the receipt is queued to a print agent which has not polled recently, so no paper will
  actually appear — the screen says the opposite.

---

## 5. Could a real restaurant run tomorrow's lunch service on this?

**No.**

Not "not comfortably" — genuinely no. A lunch service will hit all three of these before 14:00:

1. **A guest will walk out, or a check will be rung wrong, and the cashier cannot void it.** The
   button is on the screen, they will press it, and it will refuse them by name. They then cannot
   close their drawer at the end of the shift. This is the single most ordinary correction in a
   restaurant and it is unavailable to the person who makes it.
2. **Someone will ask for a discount** — a staff meal, a comped starter, a regular's 10% — and there
   is no way to give one. Not on any screen, and not through the API either, because the endpoint
   refuses every check that has been sent to the kitchen and refuses the cashier outright on
   whole-order discounts.
3. **The owner will open Finance to see the day's take and find an empty page**, because Takings
   cuts its trading day in UTC while the branch is `Asia/Karachi` and the settings screen promises
   otherwise. Every sale in the five hours after 04:00 local lands on yesterday, and the journal
   entry follows it.

Add to that: the cashier cannot read a variance when they count the drawer, the manager cannot tell
from the order list who took which check, and nobody in the building can read the audit log.

## 6. The number

**4 / 10** — up from 2.5, and the increase is earned.

What justifies moving it, all of which I drove myself: money is now correct where it is recorded —
cash with tendered and change agrees to the paisa across the screen, the printed bill and
`order_payments`; a paid check genuinely cannot be voided and the payment row survives the attempt
intact; debits equal credits on a real posted journal entry read back through the UI; station
routing splits a mixed check onto the right boards and the cook can bump it item by item; a late
add fires as revision 2 without re-firing the original; voided checks are findable with a reason and
a named actor; the till reconciles to Rs 0.00 variance; the receipt reaches a print agent rather
than a browser dialog; and a brand-new employee can be hired, given a password and put on a drawer
in about ninety seconds. Those are not small things and several of them were the register's worst
findings.

What holds it at 4 rather than 6 is that the failures are still on the **critical path of an
ordinary hour**, and they are still the same shape the register named: *structurally present,
behaviourally absent*. The Void button is rendered, wired, reasoned about in a dialog with a reason
box and a confirm step — and 403s. `useApplyDiscount`, the `/discounts` endpoint, the
`pos.order.discount.line` permission and a "Discount Summary" report all exist, and no discount can
be given. `BusinessDay.java` computes the trading day correctly, in the wrong service. The Takings
screen explains at length that it "will not show you a zero it does not mean" — and shows a zero it
does not mean.

The gap between what has been built and what can be done is still where the value is.
`VoidOwnOrderIT` is green while a cashier cannot void, which is the same sentence the register wrote
in July. Until the tests are written against the state a restaurant is actually in — a fired check,
a presented bill, a morning shift in Karachi — every future audit will keep finding this.

---

*Driven 2026-08-12 by one continuous Chromium session. Personas: `owner@terrace.local` (TOTP),
`manager@terrace.local`, `kitchen@terrace.local`, and a cashier hired during the run,
`shift.cashier.984155@terrace.local`. Checks: `ORD-20260812-0164` (dine-in, table H1, cash + change,
closed), `0165` (takeaway, card, closed), `0166` (fired, voided by the manager after the cashier was
refused), `0167`/`0168`/`0169` (drafts, voided). Screenshots in `.planning/audits/shift/`.*
