/*
 * F11 RE-OPEN, part 2 — is the handed-over drawer a WORKING drawer, does it PERSIST, and
 * do the adjacent paths hold?
 *
 *   A. the cashier rings and settles CASH against it (a cash tender 409s without an open till)
 *   B. PERSISTENCE — a brand new browser context, a fresh login, the drawer is still theirs
 *   C. the cashier tries to open one for the MANAGER — refused by name, nothing created
 *   D. the adjacent refusals: a non-cashier target, a target at another branch, a target in
 *      ANOTHER TENANT, a target who already holds a drawer, a negative float, a cross-branch
 *      request, and the WAITER persona
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  BASE,
  PEOPLE,
  newBrowser,
  newPage,
  login,
  go,
  shot,
  apiGet,
  apiSend,
  tokenOf,
  OUT,
  ok,
  log,
} from "./lib.mjs";

const j = JSON.parse(readFileSync(`${OUT}/journal.json`, "utf8"));
const HIRE = j.hire;
const hireId = j.hireUserId;
const managerId = j.managerId;
const branchId = j.branchId;
const out = { ...j };
const checks = [];
const note = (k, v) => {
  out[k] = v;
  log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
};
const check = (...a) => {
  const r = ok(...a);
  checks.push(r);
  return r;
};

async function signIn(page, email, password, slug = "floating-terrace") {
  for (let i = 0; i < 3; i++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await s.count()) await s.first().fill(slug);
    await page.locator('input[name="email"], input#email').first().fill(email);
    await page.locator('input[name="password"], input#password').first().fill(password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(5500);
    if (!page.url().includes("/login")) {
      log(`  ✓ signed in as ${email}`);
      return;
    }
  }
  throw new Error(`login failed for ${email}`);
}
async function loginHard(page, who, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      await login(page, who);
      return;
    } catch (e) {
      if (i === tries) throw e;
      await page.waitForTimeout(6000);
    }
  }
}
const stripOf = (page) =>
  page.evaluate(() => {
    const c = document.querySelector("[data-testid=close-till-button]");
    if (c) return c.parentElement.innerText.replace(/\s+/g, " ").trim();
    const o = document.querySelector("[data-testid=open-till-button]");
    if (o) return o.parentElement.innerText.replace(/\s+/g, " ").trim();
    return "(no till strip)";
  });
const errOf = (r) => r.body?.detail ?? r.body?.error?.message ?? JSON.stringify(r.body).slice(0, 200);
const codeOf = (r) => r.body?.title ?? r.body?.error?.code ?? r.body?.code ?? null;

const browser = await newBrowser();

// ═══ A. ring and settle CASH against the drawer the manager handed over ══════
log("\n=== A. the cashier rings and settles CASH against the handed-over drawer ===");
const cash = await newPage(browser);
await signIn(cash, HIRE.email, HIRE.newPassword);
let tok = await tokenOf(cash);

await go(cash, "/app/pos", { waitMs: 8000 });
await cash.locator("[data-testid=order-type-takeaway]").click();
await cash.waitForTimeout(700);
const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().waitFor({ timeout: 30000 });

/*
 * Some menu items now open a modifier dialog ("Nothing is saved until you press Add to
 * order"). Clicking the next tile blind just times out against the overlay, which reads as
 * "the POS is broken" when it is only a configuration step. Add the item properly.
 */
const addTile = async (i) => {
  await tiles.nth(i).click();
  await cash.waitForTimeout(1200);
  const dlg = cash.locator("[data-testid=modifier-dialog]");
  if (await dlg.count()) {
    const add = cash.locator("[data-testid=modifier-dialog-add]");
    if ((await add.count()) && (await add.first().isEnabled())) {
      await add.first().click();
    } else {
      // A required group with nothing chosen — take the first option in each group first.
      const opts = cash.locator("[data-testid^=modifier-option-]");
      const c = await opts.count();
      for (let k = 0; k < Math.min(c, 3); k++) {
        await opts.nth(k).click();
        await cash.waitForTimeout(250);
        if (await add.first().isEnabled()) break;
      }
      if (await add.first().isEnabled()) await add.first().click();
      else await cash.keyboard.press("Escape");
    }
    await cash.waitForTimeout(1500);
  }
};
await addTile(0);
await addTile(1);
await cash.waitForTimeout(1000);
await shot(cash, "39a-cart");
note("cartText", await cash.evaluate(() => {
  const n = document.querySelector("[data-testid=order-panel], aside");
  return (n ? n.innerText : document.body.innerText).replace(/\s+/g, " ").slice(0, 400);
}));
await cash.getByRole("button", { name: /Send to Kitchen/i }).first().click();
await cash.waitForTimeout(9000);
await shot(cash, "39b-fired");
let orderNo = await cash.evaluate(() => {
  const m = document.body.innerText.match(/ORD-\d{8}-\d+/);
  return m ? m[0] : null;
});
if (!orderNo) {
  // The banner may have already cleared; ask the server for this cashier's newest check.
  const recent = await apiGet(cash, `/api/v1/pos/orders?branchId=${branchId}&size=5`, tok);
  const mine = (recent.body?.data ?? [])[0];
  note("recentOrderFallback", mine ? { id: mine.orderId, no: mine.orderNo, st: mine.derivedStatus } : null);
  orderNo = mine?.orderNo ?? mine?.orderNumber ?? null;
}
note("orderNo", orderNo);
check(!!orderNo, "the cashier could ring a check on the handed-over drawer", orderNo);

// Resolve the id of the check we just rang, on the cashier's OWN bearer. (The Order
// Management search box was flaky under a hot-reloading dev server; the id is the same
// either way, and the charge page below is still driven in the browser.)
const listed = await apiGet(cash, `/api/v1/pos/orders?branchId=${branchId}&size=50`, tok);
note("orderListStatus", listed.status);
const orderId = (listed.body?.data ?? []).find((o) => (o.orderNo ?? o.orderNumber) === orderNo)?.orderId ?? null;
note("orderId", orderId);
if (!orderId) throw new Error(`could not resolve ${orderNo} (status ${listed.status})`);

await go(cash, `/app/pos/orders/${orderId}/charge`, { waitMs: 7000 });
const fill = cash.locator("[data-testid=fill-full-amount-button]");
if (await fill.count()) {
  await fill.first().click();
  await cash.waitForTimeout(800);
}
const amountVal = await cash.locator('[aria-label="Amount (Rs)"]').first().inputValue();
const tenderTarget = Math.ceil(Number(amountVal) / 100) * 100;
note("billAmountRupees", amountVal);
note("tenderedRupees", String(tenderTarget));
const tendered = cash.locator('[aria-label="Tendered (Rs)"]').first();
if (await tendered.count()) {
  await tendered.fill(String(tenderTarget));
  await cash.waitForTimeout(1000);
}
await shot(cash, "40-charge-page");
await cash.locator("[data-testid=record-payment-button]").click();
await cash.waitForTimeout(8000);
await shot(cash, "41-after-payment");
const payErr = await cash.evaluate(
  () => document.querySelector("[data-testid=record-payment-error]")?.textContent?.trim() ?? null,
);
note("recordPaymentError", payErr);
check(!payErr, "the cash tender was accepted (a cash tender 409s without an OPEN till)", payErr);

const pays = await apiGet(cash, `/api/v1/pos/orders/${orderId}/payments`, tok);
const payRows = pays.body?.data ?? [];
note("paymentRows", payRows);
const p0 = payRows[0] ?? {};
const expectedPaisa = Math.round(Number(amountVal) * 100);
const expectedTenderPaisa = tenderTarget * 100;
check(p0.method === "CASH", "the persisted payment row is CASH", p0.method);
check(
  p0.amountPaisa === expectedPaisa,
  `order_payments.amountPaisa is the bill to the paisa (${expectedPaisa})`,
  String(p0.amountPaisa),
);
check(
  p0.tenderedPaisa === expectedTenderPaisa,
  `order_payments.tenderedPaisa matches what was tendered (${expectedTenderPaisa})`,
  String(p0.tenderedPaisa),
);
check(
  p0.changePaisa === expectedTenderPaisa - expectedPaisa,
  `change = tendered - bill, to the paisa (${expectedTenderPaisa - expectedPaisa})`,
  String(p0.changePaisa),
);

await go(cash, "/app/pos", { waitMs: 8000 });
const stripAfterSettle = await stripOf(cash);
note("stripAfterSettle", stripAfterSettle);
await shot(cash, "42-strip-after-settle");
const expectedCash = (500000 + expectedPaisa) / 100;
const expectedCashText = `Rs ${expectedCash.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
check(
  stripAfterSettle.includes(`Cash: ${expectedCashText}`),
  `the strip's cash is float + bill to the paisa (${expectedCashText})`,
  stripAfterSettle,
);
check(/Orders:\s*1\b/.test(stripAfterSettle), "…and the drawer counts exactly one order", stripAfterSettle);

// ═══ B. PERSISTENCE — a brand new context, a fresh login ═════════════════════
log("\n=== B. persistence: a brand new browser context, signed in from scratch ===");
const fresh = await newPage(browser);
await signIn(fresh, HIRE.email, HIRE.newPassword);
await go(fresh, "/app/pos", { waitMs: 8000 });
const stripFresh = await stripOf(fresh);
note("stripAfterFreshLogin", stripFresh);
await shot(fresh, "43-fresh-context");
check(
  /Till\s*OPEN/i.test(stripFresh) && stripFresh.includes("Float: Rs 5,000.00"),
  "after a brand-new login the drawer is still open with the same float",
  stripFresh,
);
check(
  stripFresh.includes(`Cash: ${expectedCashText}`),
  "…and still carries the cash that was settled into it",
  stripFresh,
);

// ═══ C. the cashier tries to open a drawer for the MANAGER ══════════════════
log("\n=== C. the cashier tries to open a drawer for somebody else ===");
tok = await tokenOf(cash);
const tr = await go(cash, "/app/pos/tills", { waitMs: 6000, allowTrouble: true });
note("cashierAtTillReview", tr.bad);
await shot(cash, "44-cashier-till-review");
check(tr.bad.includes("access-denied"), "Till Review is access-denied for a cashier", JSON.stringify(tr.bad));
const btnCount = await cash.locator("[data-testid=open-drawer-for-cashier-button]").count();
check(btnCount === 0, "the 'Open a drawer' control is absent for a cashier", String(btnCount));
const listAsCashier = await apiGet(cash, `/api/v1/pos/tills/cashiers?branchId=${branchId}`, tok);
check(listAsCashier.status === 403, "GET /tills/cashiers answers 403 for a cashier", String(listAsCashier.status));

const refusal = await apiSend(
  cash,
  "POST",
  "/api/v1/pos/tills",
  { branchId, openingFloatPaisa: 500000, cashierId: managerId },
  tok,
);
note("cashierNamingManager", { status: refusal.status, code: codeOf(refusal), detail: errOf(refusal) });
check(refusal.status === 403, "a cashier naming the manager is refused 403", String(refusal.status));
check(
  /Terrace Manager/.test(errOf(refusal)),
  "…and the refusal names the person whose drawer they tried to open",
  errOf(refusal),
);
check(
  /pos\.till\.open\.other/.test(errOf(refusal)),
  "…and says which permission it needs",
  errOf(refusal),
);
const mgrAfter = await apiGet(cash, `/api/v1/pos/tills?cashierId=${managerId}&status=OPEN`, tok);
const mgrRows = mgrAfter.body?.data ?? [];
note("managerOpenTillsAfterAttempt", mgrRows.map((r) => r.id));
check(
  mgrRows.length <= 1 && !mgrRows.some((r) => r.openedAt > out.startedAt),
  "nothing was created by the refused attempt",
  JSON.stringify(mgrRows.map((r) => r.openedAt)),
);

// ═══ D. adjacent refusals, all as the MANAGER on the manager's own bearer ════
log("\n=== D. adjacent paths ===");
const mgr = await newPage(browser);
await loginHard(mgr, PEOPLE.manager);
const mtok = await tokenOf(mgr);

// D1 — a target who is rostered here but holds no pos.till.open (the kitchen hand).
const kitchen = await newPage(browser);
await signIn(kitchen, PEOPLE.kitchen.email, PEOPLE.kitchen.password);
const ktok = await tokenOf(kitchen);
const kid = JSON.parse(Buffer.from(ktok.split(".")[1], "base64").toString()).sub;
note("kitchenUserId", kid);
const d1 = await apiSend(mgr, "POST", "/api/v1/pos/tills", { branchId, openingFloatPaisa: 500000, cashierId: kid }, mtok);
note("D1_nonCashierTarget", { status: d1.status, code: codeOf(d1), detail: errOf(d1) });
check(d1.status >= 400, "a target with no pos.till.open is refused a drawer", `${d1.status} ${errOf(d1)}`);
const d1AfterK = await apiGet(kitchen, `/api/v1/pos/tills?cashierId=${kid}&status=OPEN`, ktok);
check(
  (d1AfterK.body?.data ?? []).length === 0,
  "…and no drawer exists for them afterwards",
  JSON.stringify(d1AfterK.body?.data ?? []),
);

// D2 — a target in ANOTHER TENANT.
const ctl = await newPage(browser);
let ctlId = null;
try {
  await login(ctl, {
    slug: "control-bistro-isolation-test-tenant",
    email: "admin@control.local",
    password: "Control#Admin1",
    totpSecret: "SEWG2C54BPUGZOVH5TYN2ZYF5HLWYCUG",
  });
  const ctok = await tokenOf(ctl);
  ctlId = JSON.parse(Buffer.from(ctok.split(".")[1], "base64").toString()).sub;
} catch (e) {
  log(`  ! could not sign in to the control tenant: ${String(e).slice(0, 120)}`);
}
note("controlTenantUserId", ctlId);
if (ctlId) {
  const d2 = await apiSend(mgr, "POST", "/api/v1/pos/tills", { branchId, openingFloatPaisa: 500000, cashierId: ctlId }, mtok);
  note("D2_otherTenantTarget", { status: d2.status, code: codeOf(d2), detail: errOf(d2) });
  check(d2.status >= 400, "a target in ANOTHER TENANT is refused a drawer", `${d2.status} ${errOf(d2)}`);
}

// D3 — a target who already holds a drawer (our own hire, twice).
const d3 = await apiSend(mgr, "POST", "/api/v1/pos/tills", { branchId, openingFloatPaisa: 500000, cashierId: hireId }, mtok);
note("D3_alreadyHoldsADrawer", { status: d3.status, code: codeOf(d3), detail: errOf(d3) });
check(d3.status === 409, "a second drawer for the same cashier is refused 409", String(d3.status));
check(
  new RegExp(HIRE.fullName).test(errOf(d3)),
  "…and the conflict names the TARGET, not the caller",
  errOf(d3),
);

// D4 — a negative float.
const d4 = await apiSend(mgr, "POST", "/api/v1/pos/tills", { branchId, openingFloatPaisa: -100, cashierId: hireId }, mtok);
note("D4_negativeFloat", { status: d4.status, detail: errOf(d4) });
check(d4.status >= 400, "a negative float is refused", `${d4.status}`);

// D5 — a request naming ANOTHER BRANCH.
const branches = await apiGet(mgr, "/api/v1/branches", mtok);
const other = (branches.body?.data ?? []).find((b) => b.id !== branchId);
note("otherBranch", other ? { id: other.id, name: other.name } : null);
if (other) {
  const d5 = await apiSend(
    mgr,
    "POST",
    "/api/v1/pos/tills",
    { branchId: other.id, openingFloatPaisa: 500000, cashierId: hireId },
    mtok,
  );
  note("D5_crossBranch", { status: d5.status, code: codeOf(d5), detail: errOf(d5) });
  check(d5.status >= 400, "a request naming another branch is refused", `${d5.status} ${errOf(d5)}`);
}

// D6 — the WAITER persona.
const waiter = await newPage(browser);
await signIn(waiter, PEOPLE.waiter?.email ?? "waiter@terrace.local", PEOPLE.waiter?.password ?? "Terrace#Waiter1");
const wtok = await tokenOf(waiter);
const wclaims = JSON.parse(Buffer.from(wtok.split(".")[1], "base64").toString());
note("waiterTillPerms", (wclaims.permissions ?? []).filter((p) => p.startsWith("pos.till")));
const d6 = await apiSend(
  waiter,
  "POST",
  "/api/v1/pos/tills",
  { branchId, openingFloatPaisa: 500000, cashierId: hireId },
  wtok,
);
note("D6_waiterNamingSomeone", { status: d6.status, code: codeOf(d6), detail: errOf(d6) });
check(d6.status === 403, "a waiter cannot open a drawer for anybody", `${d6.status} ${errOf(d6)}`);
const d6b = await apiGet(waiter, `/api/v1/pos/tills/cashiers?branchId=${branchId}`, wtok);
check(d6b.status === 403, "…and cannot read the eligible-cashier roster", String(d6b.status));

writeFileSync(`${OUT}/journal.json`, JSON.stringify({ ...out, checks2: checks }, null, 2));
log("\n--- part 2 checks ---");
checks.forEach((c) => log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.label}`));
log(`\n${checks.filter((c) => !c.pass).length} failures of ${checks.length}`);
await browser.close();
