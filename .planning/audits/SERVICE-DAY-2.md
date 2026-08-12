# A second restaurant day, driven end to end

**Date driven:** 2026-08-12, 17:15–18:15 Asia/Karachi (12:15–13:15 UTC)
**Method:** one continuous session in real Chromium (Playwright), switching personas the way a
restaurant does. Every claim below was produced by clicking, and cross-read over HTTP on the
signed-in persona's own bearer — never on an injected token, never on a mock.
**Comparison:** re-runs `FULL-SHIFT-WALKTHROUGH.md` (4/10, three blockers) on the same tenant,
plus the paths the last month's work opened up.
**Evidence:** 100 screenshots in `.planning/audits/day2/`. Every figure quoted here is reproduced
verbatim in this document, so nothing depends on an uncommitted artefact. The driving harness is
`frontend/e2e/day2/*.mjs` and the raw probe journal `day2/_state.json`, both left uncommitted
deliberately — the brief scopes the commit to the report and its screenshots.

**Stack honesty.** I did not inherit the stack I was handed. `check-stale-jars.sh` opened at
`checked=16 stale=2`: `pos-service` was serving a jar that no longer existed on disk, and
`auth-service` likewise. I rebuilt pos-service (108 MB, 569 BOOT-INF entries, shared-lib 133
classes) and restarted it before ringing anything. Mid-run a sibling agent restarted the whole
fleet; I waited for it, re-checked (`checked=16 stale=0`), and re-ran the step that had failed
during the gap. The Next dev server also died under me once and was restarted. Two failures below
are mine or the machine's, not the product's, and are named as such. At the very end of the run
`platform-admin-service` and `gateway` were flagged stale again by a sibling's rebuild; neither
serves any figure in this report, and every service I did measure (`pos`, `kitchen`, `finance`,
`audit`, `auth`, `user`, `file`) read `ok` throughout.

Personas: `owner@terrace.local` (TOTP), `manager@terrace.local`, `kitchen@terrace.local`, and a
cashier hired during the run — `day2.cashier.527737@terrace.local` — so every rupee after 17:26 is
mine and is checkable.

---

## 1. The three blockers that stopped tomorrow's lunch last time

### S0-A — "A cashier cannot void a check that has been sent to the kitchen." **FIXED.**

I rang `ORD-20260812-0444` on table **AUD3829**, two Butter Naans, Rs 193.60, and pressed **Send to
Kitchen**. Then, as the *cashier*, Order Management → Open → **Void**:

> **Void Order** — Order #ORD-20260812-0444 · Dine-in · Order total Rs 193.60
> This will cancel order #ORD-20260812-0444. This action cannot be undone.
> **Reason \*** *(placeholder: "e.g. Customer left without ordering")*
> Resulting state: order will be marked VOIDED and removed from active settlement.

Typed *"Guest left before the food went out — day 2 walkthrough"*, **Confirm Void**. No
`[data-testid=void-error]`, no "You don't have permission". After a full reload the server's own
row reads:

```
ORD-20260812-0444 | Dine-in · AUD3829 | Voided | Unpaid | Day2 Cashier 527737 | 2 items | 1 line | Rs 193.60 | Open
```

`03a`–`03e`. Audited, with the actor's name and the whole reason — see §2, *There is an audit log*.

### S0-B — "No discount can be given, by anybody, anywhere, on a check that has been fired." **FIXED.**

The charge page now carries **Apply a discount**, and the panel is the best-designed screen in the
product. On `ORD-20260812-0442`, already `SENT_TO_KDS`:

| Who | Scope | What happened |
|---|---|---|
| cashier | **The whole check** | refused *on the client*, with a reason a human can act on |
| cashier | **One item** | Rs 100.00 off Chicken Karahi — applied |
| manager | **The whole check** | 10% — applied |

The cashier's refusal reads, in full:

> A discount on the whole check has to be approved by a manager. You can take an amount off an
> individual item; ask a manager to sign in for a whole-check discount.

That is the correct answer to last month's `403 Not permitted: pos.pos.order.discount.override`.
The scope control even labels itself — *"One item"* / *"The whole check **(manager)**"*.

Both discounts carry a reason and an actor, on screen and on the server:

```
Off Chicken Karahi   Kebab was cold — day 2              · Day2 Cashier 527737   -Rs 100.00
10% off the whole check  Regular guest — 10% off, day 2  · Terrace Manager       -Rs 208.90

server: [{scope:LINE,  type:FLAT,    value:100, amt:10000, reason:"Kebab was cold — day 2",          by:"Day2 Cashier 527737"},
         {scope:ORDER, type:PERCENT, value:10,  amt:20890, reason:"Regular guest — 10% off, day 2",  by:"Terrace Manager"}]
```

`03g`–`03n`. **Two things about it are wrong; they are in §3 (D-1, D-2) and one of them is money a
cashier says out loud to a guest.**

### S0-C — "The day's takings are filed to the wrong day." **FIXED for money made today.**

Cash taken at `2026-08-12T12:49:28Z` = 17:49 Asia/Karachi. `/app/finance/takings?date=2026-08-12`
reads **"113 orders closed on this trading day"** and its tender split holds my two tenders. The
`8/12` page is no longer empty and the `8/11` page no longer holds this morning's money. Better:
the till list on the `8/12` page now shows the previous walkthrough's own drawers —
*"Shift Cashier 984155 · Opened 8/12/26, 7:50 AM · closed 8/12/26, 8:16 AM"* — on **8/12**, where
they belong. That is the retro-active half of the fix, visible.

Transactions, Takings and the ledger agree:

```
/app/finance/transactions   8/12/2026, 5:49:28 PM  Payment  ORD-20260812-0442  CASH  Rs 2,362.28
JE-2027-000368 · ORDER_REVENUE · 2026-08-12 · "Order revenue ORD-20260812-0442"
  1010  CASH payment        DR Rs 2,362.28
  4920  Discount            DR Rs   308.90
  4100  Sales revenue                        CR Rs 2,339.00
  4910  Service charge                       CR Rs   101.51
  2200  Output tax                           CR Rs   230.67
  Balanced · Rs 2,671.18
```

DR 2,362.28 + 308.90 = 2,671.18 = CR 2,339.00 + 101.51 + 230.67. Debits equal credits on a real
posted row read back through the UI, and the entry is now described by **order number**, not by a
UUID — last month's finding #7, fixed. `06b`, `06c`.

**One residue, unfixed:** the second entry on the same sale, `JE-2027-000369 · ORDER_COGS`, is still
described *"Order COGS b3e88e09-ce18-436f-8c5a-e0599c07a08e"*. The revenue leg learned the order
number; the COGS leg beside it did not.

---

## 2. What the day actually did, and what it proved

**Open.** Owner signs in with TOTP, dashboard clean, no `[role=alert]`. `01a`

**The manager opens a drawer for someone else — new, and it is right.** Till Review →
**Open a drawer**:

> Open a drawer for a cashier. Count the float into the drawer, then hand it over. The till belongs
> to the cashier you name — they settle against it and they cash it up.

The picker lists every cashier and marks the ones who already have one — *"F11 Cashier 807971 —
cashier (already has a drawer)"*. Rs 5,000.00 into **Day2 Cashier 527737**'s drawer, and the
cashier's own terminal reads `Till OPEN · Float: Rs 5,000.00 · Cash: Rs 5,000.00 · Orders: 0`.
Last month's opening finding — *"a manager cannot open a till for anyone but themselves"* — is
closed. `01e`–`01h`

**Modifiers exist and are enforced.** Tapping **Audit Item 52235** opened a real dialog. Pressing
**Add to order** without choosing raised `role="alert"`:

> **Spice level: choose exactly 1 option.**

with the button at `aria-disabled="true"`. Choosing *Hot* and *Extra cheese +Rs 150.00* moved the
dialog total from **"This item Rs 499.00"** to **"This item with options Rs 649.00"**, and the cart
line carried `Extra cheese +Rs 150.00 · Hot`. The choice reached the kitchen ticket
(`1× Audit Item 52235 · Extra cheese, Hot` on PANTRY1) and the guest's bill
(`1 x Audit Item 52235 Rs 588.45 / + Extra cheese / + Hot`). The server refuses the same omission
independently — `422 MODIFIER_SELECTION_INVALID`. `02b`–`02e`

**Station routing splits a check, and the cook works it.** `ORD-20260812-0442` landed on **two**
boards and only those two: PANTRY1 took the Audit Item, GRILL took `1× Chicken Karahi` and
`2× Butter Naan`. The per-item buttons walked `→ Started`, `→ Preparing`, `→ Ready`, the fragment
key moved `NEW: → STARTED: → PREPARING: → READY:`, and it stuck. `02h`–`02k`

**There is a pass now.** `/app/kitchen/expo` — *"The Pass · 124 checks · 4 ready to run"* — and my
half-cooked check reads:

```
ORD-20260812-0442  Dine-in · Table AUD3547  WAITING ON GRILL
1 of 2 stations ready · 1 of 3 items ready
GRILL  Hot line   NOT STARTED · 0 OF 2 READY
PANTRY1 Cold prep READY · 1 OF 1 READY
```

That is exactly the hole last month's finding #15 described. `02l`

**The KDS picker and the boards agree.** Measured on all seven, twice: picker
`Cold prep PANTRY1 · 80 tickets · 130 items`, board header `80 tickets · 130 items`; `DEFAULT 38/41`,
`GRILL 10/11`, `BAR 4/4`. Both figures now carry their unit, and the tiles are headed
**TICKETS BY STAGE**. Last month's 21-ticket disagreement is gone. `02h`

**Take-away and the late add.** Takeaway removed the table picker (`0` triggers). `ORD-20260812-0443`,
Rs 1,700.00 + Rs 272.00 tax = Rs 1,972.00. The late add on the dine-in check produced
`Butter Naan ×1 Rs 92.80 Pending` beside the already-`Sent` lines, offered **Send New Items (1)**,
and firing it moved the header from `1 revision` to `2 revisions` with the new line reading
`Butter Naan REV 2 · Sent`. Only the new line went. `02m`–`02r`

**Order Management tells the truth.** The row a manager scans all day:

```
ORD-20260812-0442 | Dine-in · AUD3547 | In Progress | Unpaid | Day2 Cashier 527737 | 4 items | 3 lines | Rs 2,629.55 | Open
```

Correct **type** (a dine-in check reads Dine-in, not "Takeaway") and the cashier's **name**, not
`bc0d9897`. Both of last month's headline order-list defects, fixed and driven. `02o`

**Money, to the paisa.** Cash tender on the discounted check:

| | |
|---|---|
| screen, before recording | `Change due Rs 637.72` (`data-paisa="63772"`) |
| `order_payments` | `CASH · amountPaisa 236228 · tenderedPaisa 300000 · changePaisa 63772` |
| printed bill | `TOTAL Rs 2,362.28 / CASH Rs 2,362.28 / Tendered Rs 3,000.00 / Change Rs 637.72` |

236228 + 63772 = 300000. Card: `CARD · amountPaisa 177480 · tendered 177480 · change 0 ·
referenceNo "VISA-8812"`, and the card tender correctly shows **no** tendered/change row. `04a`–`04f`

**The bill prints at tender, not at close.** The green strip appeared on the charge page the moment
the cash was recorded:

> **Bill issued** Aug 12, 2026, 5:49 PM — Sent to audit-receipt. Check Settings → Printers if no
> paper appears — the job is kept and retried, not lost.

and `print-jobs` holds `CUSTOMER_RECEIPT · audit-receipt · issueSeq 1 · PRINTED · issuedAt
12:49:28.569Z` — the same second as the payment. The reprint I pulled twenty minutes later is
stamped `*** REPRINT #2 *** Originally issued 2026-08-12T12:49:28.569Z`. Last month that gap was
sixteen minutes. `04b`, `08a`

**The printers are printing.** The Printers screen reports per-device delivery from real jobs —
*"Delivered · 208 jobs delivered in the last 24 hours, the most recent 7 minutes ago"* — not a
promise. `07c`

**Void on a paid check is refused, and the refusal now names the right person.** The manager's
drawer offers **Refund**; the cashier's says:

> **Paid — void unavailable. A manager must refund this check.**

The direct call, on the manager's own bearer, returns `409 ORDER_HAS_PAYMENTS`:

> Order ORD-20260812-0443 has 177480 paisa recorded against it and cannot be voided. Use Refund — a
> void leaves the payment in place with no reversing entry.

I read the payment rows before and after: byte-identical. `04g`, `05a`

**Cash up — the cashier can now count the drawer.** The close panel, before anything is typed:

```
Opening float:               Rs 5,000.00
Cash taken (net of refunds): Rs 2,362.28
Expected cash:               Rs 7,362.28
Declared Cash Count (PKR)   [        ]
```

I counted Rs 50.00 short on purpose (`7312.28`) and the panel answered **"Variance: Rs 50.00
short"** *before* I committed. The till closed — the strip went to `No active till`. Last month
this was `hasExpected: false` and a null variance. `05c`–`05e`

And it lands where the manager will look for it. Takings → *What each till counted*:

```
Day2 Cashier 527737 · Opened 8/12/26, 5:26 PM · closed 8/12/26, 5:55 PM · Short
Rs 5,000.00 · Rs 7,362.28 · Rs 7,312.28 · -Rs 50.00
```

with my note *"Day 2 — Rs 50.00 short, counted twice"* on the Till Review row. `06f`, `10a`

**Net sales is a revenue line again.** The Takings tiles now state the identity and satisfy it:

```
GROSS SALES     Rs 121,804.32
DISCOUNTS       Rs   1,301.20
NET SALES       Rs 120,503.12   "Gross sales less discounts. Tax and service charge are NOT in
                                 this figure — this is the revenue line."
TAX             Rs   9,271.02
SERVICE CHARGE  Rs   1,422.60
TOTAL BILLED    Rs 131,196.74
"Gross sales − discounts = net sales. Net sales + tax + service charge = total billed."
```

121,804.32 − 1,301.20 = 120,503.12 ✓. 120,503.12 + 9,271.02 + 1,422.60 = 131,196.74 ✓. And the
tender split carries an *of which on open orders* column with a paragraph explaining why the drawer
holds Rs 26,048.48 that is not in any sales figure. That is a screen an accountant can trust.
`06a`, `08b`

**There is an audit log, and it is readable by the person whose job it is.** `/app/settings/audit`:

```
12 Aug 2026, 05:43:58 pm | Order voided | Day2 Cashier 527737 | ORDER | Guest left before the food went out — day 2 walkthrough
```

Actor resolved to a name, reason unclipped, stamped in the branch's zone, filterable by 27 actions
and 16 resource types. Last month this screen 404'd for the OWNER. `06d`, `06e`

**The new back-office screens are real.**

- **Station Routing** — *"50 of 61 sellable items have no station — their tickets print on the
  DEFAULT board"*, per-category rules with a per-item *Follow category* override. I moved
  **Audit Item 52235** from PANTRY1 to **Main bar (BAR)**, rang it, and the ticket appeared on
  **BAR only** — not PANTRY1, not GRILL, not DEFAULT. `07a`, `07b`, `07h`
- **Printers** — add a kitchen or receipt printer, name it, save it; a live `[role=alert]` names the
  stations with no printer. `07c`–`07e`
- **Roles** — *"New role"* opens a builder with **78** permissions in 12 groups, a filter box, and
  the honest constraint *"You can only grant permissions you hold yourself."* I ticked three
  (`pos.order.view`, `pos.menu.view`, `pos.order.create`), the counter read **"3 of 78 selected"**,
  and `Day2 Runner 94325 · DAY2_RUNNER_94325 · Custom · Permissions granted 3` appeared in a list of
  10 roles. It was immediately selectable on **Add user**, and I hired someone onto it. `07i`–`07l`
- **Branches** — created `Day2 Terrace 94325 · 9 Marina Walk, Clifton, Karachi · Asia/Karachi`, then
  edited its phone via *Actions → Edit details*; read back over HTTP: `"phone": "021 333 4444"`.
  `07m`–`07p`
- **Menu item photos** — uploaded a PNG on `/app/menu/items`, saved, and the cashier's POS tile for
  *Photo Dish 50585* carries `<img>` with `naturalWidth 64, naturalHeight 64, complete true`. Last
  month: *"40 tiles on the till, all text-and-price."* `07q`–`07u`

---

## 3. What broke, confused or lied

Ordered by what it would cost a real restaurant.

### D-1. The discount preview tells the guest the wrong number — twice over

This is the one that matters, because a manager reads the preview aloud before pressing the button.

On a clean check with no modifiers (`ORD-20260812-0443`, subtotal Rs 1,700.00, tax Rs 272.00, total
Rs 1,972.00), a 10% whole-check discount previewed:

> **Takes Rs 170.00 off — new total Rs 1,802.00.**

The applied result: discount Rs 170.00 ✓, **total Rs 1,774.80** ✗. The preview is out by **Rs 27.20**
because it subtracts the discount from the gross total and never recomputes the tax the server
correctly recomputes (Rs 272.00 → Rs 244.80). `04c`, `04d`

On the dine-in check it was worse, because the *discount itself* was also wrong:

> preview: **Takes Rs 213.90 off — new total Rs 2,391.45.**
> applied:  −Rs **208.90**, new total Rs **2,362.28**

Rs 5.00 out on the discount and Rs 29.17 out on the total. `03m`, `03n`

Nothing is wrong with the money that is *stored* — every figure on the bill, in `order_payments` and
in the journal entry reconciles. What is wrong is the only number the guest ever hears.

### D-2. A discount is invisible to the audit log

The audit vocabulary has **27** actions (28 options, counting *All events*). I read every one of
them off the live `#audit-action` select and filtered on the word: **zero** mention discount, comp,
price or override. `ORDER_VOIDED`
is there; `ORDER_DISCOUNT_APPLIED` and `ORDER_DISCOUNTED` both return `200` with `n=0`.

So: a manager can take 10% off any check in the building, or comp a line, and the only record is a
row inside the order itself. The screen that promises *"Every sign-in, void, refund, till session,
role change and journal posting in this business, with who did it and when"* cannot show an owner
who has been giving money away. The brief's step 6 — *"check the audit log shows the void **and the
discount** with an actor"* — is half-answerable. `06e`

Last month a discount could not be given at all, so this gap did not exist. It exists now.

### D-3. The cart quotes a total that the check will not be

The panel a cashier reads to a guest *before* committing, on a dine-in check at table AUD3547:

```
Subtotal  Rs 2,259.00
Tax       Rs   257.60
Total     Rs 2,516.60
```

The check that was created one tap later: **Rs 2,629.55** — `serviceChargePaisa 11295,
serviceChargePct 5.0`. The 5% service charge is applied at fire time and is nowhere in the estimate.
Every dine-in guest in this restaurant is quoted 5% low. The charge page a minute later shows it
correctly (`Service charge (5.00%) Rs 116.95`), so the two screens on the same check disagree.
`02f`, `03f`

### D-4. The guest's bill prints the tax twice

```
Subtotal                    Rs 2,339.00
Discount                    Rs   308.90
Service charge (5.00%)      Rs   101.51
Sales Tax (16.00%)          Rs   230.67
Tax                         Rs   230.67
TOTAL                       Rs 2,362.28
```

Two lines, one amount, one immediately under the other, on a customer-facing document. The total is
right (2,339.00 − 308.90 + 101.51 + 230.67 = 2,362.28) so no money is wrong — but a guest counting
their own bill finds Rs 230.67 charged twice and will say so. `08a`

### D-5. The Sales Tax screen promises the name is printed on the bill. It is not.

`/app/settings/tax` labels the **Name** field, on every rate row, with exactly:

> **Printed on the guest's bill.**

I printed a bill. It says **Sales Tax (16.00%)**. The tenant has fourteen named classes — *"Standard rate"*, *"ROPEN Standard 988362"*, *"RX Standard
758504"* and four more, **seven of them at exactly 17%** — and a check carrying two different 17%
taxes would print two identical lines with no way to tell them apart. A tenant who typed a name into a box that promised it would be printed does not get it
printed. `09a`, `08a`

### D-6. The cashier is a UUID on the two screens where money is counted

Order Management learned the name. Two screens beside it did not:

- **Till Review** (`/app/pos/tills`) — the `CASHIER` column is a raw 8-character hex fragment on
  *every* row. Ten distinct fragments on one page; my own closed drawer, with its Rs 50.00 variance
  and my note attached, is filed under `de5773a8`. A manager approving variances cannot tell whose
  drawer it is. `10a`
- **The charge page header** — `Cashier: de5773a8`, one click after Order Management printed
  `Day2 Cashier 527737`. `10b`

### D-7. Quick Add cannot ring half the menu, and blames the cashier for it

The order drawer's **Quick Add** adds an item with `{menuItemId, branchId, quantity: 1}` and no
modifiers. For a dish with a required modifier group the server refuses — correctly, and with a
perfectly good message:

```
422 MODIFIER_SELECTION_INVALID — "Doneness: choose exactly 1 option."
```

The drawer throws that away and shows:

> **Failed to add item. Please try again.**

Retrying can never work. There *is* a path — the **Full Menu** link beside it re-opens the terminal
bound to the same check, offers the modifier dialog, and fires the line as `Send New Items (1)` onto
the same order (verified: `ORD-20260812-0445` went to 2 items / Rs 998.00). So this is not a
blocker. It is two add controls side by side, one of which silently cannot handle a whole class of
dishes and tells the cashier to do the thing that will fail again. `02q0`, `08c`, `08d`, `11a`–`11d`

### D-8. A whole-check percentage skips the modifiers

10% of a Rs 1,700.00 check with no modifiers is Rs 170.00 — exact. 10% of the check that carried
`Extra cheese +Rs 150.00` came out at Rs 208.90, which is 10% of `2,339.00 − 100.00 (line discount)
− 150.00 (the modifier)`. The tax relief, however, is allocated pro rata across the **full** line
values including the modifier — that is how Rs 230.67 (rather than Rs 228.96) falls out, and I
reproduced the arithmetic to the paisa. Two different bases inside one calculation. A guest promised
"10% off" does not get 10% off their extra cheese.

### D-9. The dish name in the cart is clipped to six characters

On a **1440px** screen, with the entire right-hand column empty below it, the cart line renders
**"Chicke…"** while the tile two inches to its left reads **"Chicken Karahi"** in full. Earlier in
the day the same panel read `Audit It…`, `Butter …`, `Chicke…` — three lines, no readable name
between them. This is the screen a cashier reads a check back from. `10c`, `02f`

### D-10. The order drawer prices lines tax-inclusive, the cart prices them tax-exclusive, and neither says so

Same dish, same check, two surfaces one click apart:

| | Chicken Karahi | Butter Naan ×2 |
|---|---|---|
| POS cart | Rs 1,450.00 | Rs 160.00 |
| order drawer | Rs 1,682.00 | Rs 185.60 |

Neither column is labelled. `02p`

### D-11. Smaller things, in the order I met them

- **`owner@terrace.local` appears in the Takings till list where a person's name goes.** `06f`
- **"The whole check(manager)"** — missing space before the parenthesis, on the discount scope
  control. `03g`
- **A second identical discount silently did nothing.** Re-applying 10% to an already-discounted
  check previewed *"Takes Rs 136.00 off"*, and after submit the bill and the discount list were
  unchanged with no error shown anywhere. I could not tell from the screen whether it was refused,
  deduplicated, or lost. Observed once; not diagnosed. `04c`, `04d`
- **The boards still carry yesterday's debris.** `DEFAULT` reads *"Oldest 13h 13m"* and PANTRY1
  carries 80 tickets. There is now a **Clear** control on an empty board, which is the beginning of
  an answer, but not one a cook can use on a board that is 74 NEW deep. `02h`
- **Printers and print agents disagree in tone on one screen.** The printer rows say *"Delivered ·
  209 jobs … the most recent 28 minutes ago"*; the agent list under them says *"Not responding"* for
  most entries. Both are probably true — old enrolled agents beside live ones — but a manager
  reading that screen cannot tell whether their kitchen will get paper. `07c`
- **After setting their password a new hire is bounced to `/login`** and must type the password they
  chose ten seconds earlier. Unchanged from last month. `01d`

---

## 4. Things I had to know that a real employee would not

- That **Quick Add** cannot ring a dish with a required modifier, and that **Full Menu** — which
  looks like "leave this check and go to the till" — is the way to do it.
- That the total on the POS panel is not the total of the check, because the service charge arrives
  at fire time.
- That the discount preview's "new total" is not the new total.
- That `de5773a8` is a person, on Till Review and on the charge page (but not on Order Management,
  where the same person is spelled out).
- That the name typed into the Sales Tax screen's **Name** box, captioned *"Printed on the guest's
  bill"*, is not printed on the guest's bill.
- That a discount leaves no trace outside the order it was given on.

---

## 5. Could a real restaurant run tomorrow's lunch service on this?

**Yes — a lunch, with a manager on the floor and someone checking the bills.** Not "yes, ship it".

I say yes because I did it. In one session, on one drawer, with real personas: a float counted in by
the duty manager into a named cashier's till; a dine-in check with a modifier rung, fired, split
across two boards, cooked item by item, added to after firing, discounted at the line by the cashier
and at the check by the manager, settled in cash with change to the paisa, printed at the moment the
money changed hands; a take-away check settled by card; a check voided by the cashier *after* it had
gone to the kitchen, with a reason, audited under her name; a paid check that refused to be voided
and kept its payment row intact; a drawer counted against an expected figure the cashier could see,
closed Rs 50.00 short, with the variance and the note waiting for the manager; and a journal entry
that balances to the paisa on the same trading day the money was taken. Every one of those was a
finding in the last report. All of them are now done in the ordinary sense of the word — a person
did the task in a browser.

**What still stops it being "yes, ship it":**

1. **The discount preview misstates the bill** (D-1). A manager who says *"that's Rs 1,802"* and then
   charges Rs 1,774.80 has an argument at the table every time. It is also the exact shape of defect
   this project keeps producing: the server is right, the number on the screen is not.
2. **No discount is auditable** (D-2). Giving money away is the single most abusable action in a
   restaurant, it is now available to every cashier and manager, and the audit log — which exists,
   is good, and is finally readable — cannot show it.
3. **Every dine-in guest is quoted 5% low** (D-3), because the panel that produces the quote does not
   know about the service charge the check will carry.
4. **The bill charges tax twice on its face** (D-4) and ignores the tax name the settings screen
   promised to print (D-5).

None of those four will stop a shift. All four will produce a conversation with a guest or an
argument with an owner, and three of them are guest-facing money.

---

## 6. The number

**6.5 / 10** — up from 4, and the increase is earned rather than granted.

**Why it moved 2.5 points.** Every one of the three blockers is genuinely dead, and I killed them
myself rather than reading that they were dead: the void works on a fired check, the discount works
on a fired check with a reason and a permission split that makes sense, and the trading day is cut
on the branch's zone with Takings, Transactions and the ledger all agreeing. Alongside those, seven
of the register's lesser findings closed too — expected cash and variance at the drawer, net sales
below gross, the order list's type and cashier name, the KDS count disagreement, the receipt at
tender instead of close, the audit screen, the journal entry described by order number. And five
surfaces that did not exist a month ago exist and work: the pass, station routing, printers, the role
builder, branches and dish photos. That is not a repair pass, that is a product growing.

**Why it is not 8.** The signature failure has changed shape rather than disappeared. It used to be
*structurally present, behaviourally absent* — a button that 403s. Now it is *behaviourally present,
numerically wrong*: the discount applies, and the preview beside it is out by Rs 27.20; the service
charge is charged, and the panel that quotes it omits it; the tax name is configurable, captioned
"Printed on the guest's bill", and not printed; the cashier's name is resolved on one screen and
printed as `de5773a8` on the two where money is counted. Each of these is a screen that has been
built, wired, and left disagreeing with the server it sits on. The gap has moved from *can you do
the task* to *does the screen tell the truth about what you just did* — which is progress, and is
still the same class of bug.

**Why it is not 5.** Because I could not find a path through an ordinary lunch that the product
refused. I tried: a required modifier on a late add (blocked on one control, available on the one
beside it), a void after firing, a void on a paid check, a whole-check discount as a cashier, a
short drawer, a second tender, a reprint. Each refusal I met was correct, specific, and told me what
to do instead. That was not true a month ago, and it is most of what "can it run a service" means.

---

*Driven 2026-08-12 by one continuous Chromium session. Checks: `ORD-20260812-0442` (dine-in, table
AUD3547, one modified item, late add, line + order discount, cash with change, closed),
`0443` (takeaway, manager 10%, card, closed), `0444` (fired, then voided by the cashier),
`0445` (routing proof — re-routed dish, landed on BAR, added to from the Full Menu path).
Screenshots in `.planning/audits/day2/`.*
