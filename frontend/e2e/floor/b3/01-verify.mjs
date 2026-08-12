/*
 * B3 VERIFICATION — the DONE MEANS path, driven as the people who do the job.
 *
 *  1. cashier rings a DINE-IN check on a real table and fires it
 *  2. on the charge page: the discount control exists; it REFUSES to submit without a reason
 *  3. 10% off one line — the total drops by exactly that many paisa
 *  4. the same cashier asks for a whole-check discount and is refused in plain English,
 *     with no permission string anywhere on the screen
 *  5. manager@terrace.local signs in and applies the whole-check discount to the SAME check
 *  6. printed bill re-read and compared to the charge page, to the paisa
 *  7. check settled, then /app/finance/takings and /app/reports/discount-summary
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/B3");
mkdirSync(OUT, { recursive: true });

const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };
const MANAGER = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };

const log = (...a) => console.log(...a);
const J = {};
const money = (p) => `Rs ${(p / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.__console = [];
  page.on("console", (m) => m.type() === "error" && page.__console.push(m.text().slice(0, 240)));
  return page;
}

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);
  if (page.url().includes("/login")) throw new Error(`login failed for ${who.email}`);
  log("  ✓ signed in as", who.email);
}

/** Never score a screen while it is failing. */
async function go(page, route, waitMs = 5500) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(waitMs);
  let t = await trouble(page);
  if (t.bad.length) {
    log(`    ! ${route} showed ${t.bad.join(",")} — retrying once`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(waitMs + 2000);
    t = await trouble(page);
    if (t.bad.length) log(`    !! ${route} STILL ${t.bad.join(",")} — ${JSON.stringify(t.alerts)}`);
  }
  return t;
}

async function trouble(page) {
  return page.evaluate(() => {
    const txt = document.body.innerText || "";
    const alerts = Array.from(document.querySelectorAll('[role="alert"]')).map((n) => (n.textContent || "").trim()).filter(Boolean);
    const bad = [];
    if (/Couldn.t load|Something went wrong|Failed to fetch|SERVICE_UNAVAILABLE/i.test(txt)) bad.push("load-failure");
    if (/Access denied|You do not have permission/i.test(txt)) bad.push("access-denied");
    return { bad, alerts };
  });
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  log("    shot:", name + ".png");
}

async function tokenOf(page) {
  return page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: "{}",
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
}

async function api(page, method, path, payload) {
  const tok = await tokenOf(page);
  return page.evaluate(async ({ m, p, b, t }) => {
    const r = await fetch(`http://localhost:8080${p}`, {
      method: m, credentials: "include",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    let body = null; try { body = await r.json(); } catch { /* not json */ }
    return { status: r.status, body };
  }, { m: method, p: path, b: payload, t: tok });
}

/** What the Bill block on the charge page says, read off the screen. */
async function billOnScreen(page) {
  return page.evaluate(() => {
    const t = document.body.innerText.replace(/ /g, " ");
    const grab = (label) => new RegExp(`${label}\\s*\\n?\\s*(-?Rs [\\d,]+\\.\\d\\d)`).exec(t)?.[1] ?? null;
    return {
      subtotal: grab("Subtotal"),
      discounts: grab("Discounts"),
      taxes: grab("Taxes"),
      total: grab("Total"),
      remaining: grab("Remaining balance"),
      hasAddDiscountButton: !!document.querySelector('[data-testid="add-discount-button"]'),
      appliedDiscountText: document.querySelector('[data-testid="applied-discounts"]')?.innerText.replace(/\s+/g, " ").trim() ?? null,
      /** The trap this whole item is about: a raw permission code shown to an operator. */
      rawPermissionStringOnScreen: /pos\.(pos\.)?order\.discount/.test(t) ? /pos\.[a-z.]+/.exec(t)[0] : null,
    };
  });
}

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });

/*
 * A dine-in check needs a table nobody is sitting at, and this shared branch is usually full of
 * other people's open checks. The manager — who holds pos.tables.admin, and who is the person who
 * lays out the floor — adds one. This is a real operation through the real API on the real
 * persona, not a fixture: the check below is genuinely dine-in, on a genuinely free table.
 */
log("\n=== 0. the manager makes sure there is a free table ===");
const mgr = await newPage(browser);
await login(mgr, MANAGER);
const mgrTok = await tokenOf(mgr);
const mgrClaims = JSON.parse(Buffer.from(mgrTok.split(".")[1], "base64").toString("utf8"));
const mgrBranchId = mgrClaims.branch_id ?? mgrClaims.branchId;
const existing = await api(mgr, "GET", `/api/v1/pos/tables?branchId=${mgrBranchId}`);
const anyFree = (existing.body?.data ?? []).some((t) => t.status === "AVAILABLE");
if (!anyFree) {
  const name = "B3-" + Math.floor(Math.random() * 900 + 100);
  const made = await api(mgr, "POST", `/api/v1/pos/tables?branchId=${mgrBranchId}`,
    { tableNumber: name, capacity: 4, section: "B3" });
  log("  every table was occupied — manager added", name, "→", made.status);
  J.tableCreated = { name, status: made.status };
} else {
  log("  a free table already exists");
}

// ─────────────────────────────────────────────────────────────────────────────
log("\n=== 1. cashier rings a DINE-IN check and fires it ===");
const cash = await newPage(browser);
await login(cash, CASHIER);
const tok = await tokenOf(cash);
const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));
const branchId = claims.branch_id ?? claims.branchId;
J.cashierPerms = (claims.permissions ?? []).filter((p) => /discount/.test(p));
log("  cashier discount permissions:", JSON.stringify(J.cashierPerms));

await go(cash, "/app/pos", 8000);
await cash.locator("[data-testid=order-type-dine_in]").click();
await cash.waitForTimeout(400);
await cash.locator("[data-testid=table-select-trigger]").click();
await cash.waitForTimeout(1200);
const opts = await cash.evaluate(() =>
  Array.from(document.querySelectorAll('[data-testid^="table-option-"]')).map((n) => ({
    id: n.getAttribute("data-testid"),
    t: n.innerText.replace(/\s+/g, " ").trim(),
    disabled: n.getAttribute("aria-disabled") === "true",
  })));
const free = opts.find((o) => !o.disabled);
if (!free) throw new Error("no free table: " + JSON.stringify(opts));
log("  table:", free.t);
J.table = free.t;
await cash.locator(`[data-testid="${free.id}"]`).click();
await cash.waitForTimeout(900);

const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().waitFor({ timeout: 20000 });
await tiles.nth(3).click(); // Chicken Karahi
await cash.waitForTimeout(300);
await tiles.nth(9).click(); // Seekh Kebab
await cash.waitForTimeout(800);
await shot(cash, "10-cart");
await cash.locator("[data-testid=send-to-kitchen-button]").click();
await cash.waitForTimeout(7000);
await shot(cash, "11-fired");

const list = await api(cash, "GET", `/api/v1/pos/orders?branchId=${branchId}&size=30`);
const mine = (list.body?.data ?? []).filter((o) => o.cashierId === claims.sub);
const target = mine[0];
const orderId = target.orderId;
log("  check:", target.orderNo, target.settlementStatus, orderId);
J.order = { orderNo: target.orderNo, orderId, statusAtDiscount: target.settlementStatus };

const before = (await api(cash, "GET", `/api/v1/pos/orders/${orderId}?branchId=${branchId}`)).body.data;
log("  fired totals:", JSON.stringify({ status: before.status, subtotal: before.subtotalPaisa, discount: before.discountPaisa, tax: before.taxPaisa, total: before.totalPaisa }));
J.before = { status: before.status, subtotalPaisa: before.subtotalPaisa, discountPaisa: before.discountPaisa, taxPaisa: before.taxPaisa, totalPaisa: before.totalPaisa };
const firstItem = before.items[0];
const firstLineGross = firstItem.unitPriceSnapshot * firstItem.quantity;
log("  line to discount:", firstItem.itemNameSnapshot, "gross", money(firstLineGross));

// ─────────────────────────────────────────────────────────────────────────────
log("\n=== 2. the charge page, and the control that did not exist ===");
await go(cash, `/app/pos/orders/${orderId}/charge`, 6500);
await shot(cash, "12-charge-page-with-control");
J.chargeBefore = await billOnScreen(cash);
log("  bill:", JSON.stringify(J.chargeBefore));
if (!J.chargeBefore.hasAddDiscountButton) throw new Error("no discount control on the charge page");

await cash.locator("[data-testid=add-discount-button]").click();
await cash.waitForTimeout(900);
await shot(cash, "13-discount-panel-open");

// ─── the reason gate, BEFORE anything is sent ────────────────────────────────
await cash.locator("[data-testid=discount-line-select]").selectOption(firstItem.id);
await cash.waitForTimeout(300);
await cash.locator("[data-testid=discount-value-input]").fill("10");
await cash.waitForTimeout(500);
const noReason = await cash.evaluate(() => ({
  submitDisabled: document.querySelector('[data-testid="apply-discount-submit"]')?.disabled ?? null,
  validation: document.querySelector('[data-testid="discount-validation-error"]')?.textContent?.trim() ?? null,
}));
log("  with NO reason →", JSON.stringify(noReason));
J.reasonGate = noReason;
await shot(cash, "14-reason-required");

// Press it anyway — a disabled control that still fires is the failure mode worth checking.
await cash.locator("[data-testid=apply-discount-submit]").click({ force: true }).catch(() => {});
await cash.waitForTimeout(1500);
const afterForcedClick = (await api(cash, "GET", `/api/v1/pos/orders/${orderId}?branchId=${branchId}`)).body.data;
J.forcedClickChangedTotal = afterForcedClick.totalPaisa !== before.totalPaisa;
log("  forcing the disabled button changed the total?", J.forcedClickChangedTotal);

// ─── 10% off one line, with a reason ─────────────────────────────────────────
log("\n=== 3. 10% off one line ===");
await cash.locator("[data-testid=discount-reason-input]").fill("Kebab arrived cold");
await cash.waitForTimeout(600);
J.preview = await cash.evaluate(() =>
  document.querySelector('[data-testid="discount-preview"]')?.innerText.replace(/\s+/g, " ").trim() ?? null);
log("  preview on screen:", J.preview);
await shot(cash, "15-ready-to-apply");
await cash.locator("[data-testid=apply-discount-submit]").click();
await cash.waitForTimeout(3500);
await shot(cash, "16-line-discount-applied");

const afterLine = (await api(cash, "GET", `/api/v1/pos/orders/${orderId}?branchId=${branchId}`)).body.data;
const expectedLine = Math.round(firstLineGross * 0.1);
J.lineDiscount = {
  expectedPaisa: expectedLine,
  serverDiscountPaisa: afterLine.discountPaisa,
  totalBefore: before.totalPaisa,
  totalAfter: afterLine.totalPaisa,
  totalDropped: before.totalPaisa - afterLine.totalPaisa,
  discountRows: afterLine.discounts,
};
log("  expected", expectedLine, "paisa; server discountPaisa", afterLine.discountPaisa,
    "; total", before.totalPaisa, "→", afterLine.totalPaisa, `(dropped ${before.totalPaisa - afterLine.totalPaisa})`);
log("  discount rows:", JSON.stringify(afterLine.discounts));
J.chargeAfterLine = await billOnScreen(cash);
log("  bill on screen:", JSON.stringify(J.chargeAfterLine));

// ─────────────────────────────────────────────────────────────────────────────
log("\n=== 4. the SAME cashier asks for a whole-check discount ===");
await cash.locator("[data-testid=add-discount-button]").click();
await cash.waitForTimeout(700);
await cash.locator("[data-testid=discount-scope-order]").click();
await cash.waitForTimeout(700);
J.cashierWholeCheck = await cash.evaluate(() => ({
  message: document.querySelector('[data-testid="discount-validation-error"]')?.textContent?.trim() ?? null,
  submitDisabled: document.querySelector('[data-testid="apply-discount-submit"]')?.disabled ?? null,
  rawPermissionAnywhere: /pos\.(pos\.)?order\.discount\.override/.test(document.body.innerText),
}));
log("  refusal:", JSON.stringify(J.cashierWholeCheck));
await shot(cash, "17-cashier-refused-whole-check");

// And the server, independently, on the same request.
const cashierOrderScope = await api(cash, "POST", `/api/v1/pos/orders/${orderId}/discounts`,
  { scope: "ORDER", type: "PERCENT", value: 10, reason: "Regular customer" });
J.cashierWholeCheckApi = { status: cashierOrderScope.status, message: cashierOrderScope.body?.error?.message ?? cashierOrderScope.body?.message };
log("  server, same request:", JSON.stringify(J.cashierWholeCheckApi));

// ─────────────────────────────────────────────────────────────────────────────
log("\n=== 5. the manager applies the whole-check discount to the SAME fired check ===");
await go(mgr, `/app/pos/orders/${orderId}/charge`, 6500);
await shot(mgr, "18-manager-charge-page");
await mgr.locator("[data-testid=add-discount-button]").click();
await mgr.waitForTimeout(800);
await mgr.locator("[data-testid=discount-scope-order]").click();
await mgr.waitForTimeout(400);
await mgr.locator("[data-testid=discount-value-input]").fill("10");
await mgr.locator("[data-testid=discount-reason-input]").fill("Regular of twenty years");
await mgr.waitForTimeout(700);
J.managerPreview = await mgr.evaluate(() =>
  document.querySelector('[data-testid="discount-preview"]')?.innerText.replace(/\s+/g, " ").trim() ?? null);
log("  manager preview:", J.managerPreview);
await shot(mgr, "19-manager-whole-check-ready");
await mgr.locator("[data-testid=apply-discount-submit]").click();
await mgr.waitForTimeout(3500);
await shot(mgr, "20-manager-whole-check-applied");

const afterOrder = (await api(mgr, "GET", `/api/v1/pos/orders/${orderId}?branchId=${branchId}`)).body.data;
J.afterOrderScope = {
  subtotalPaisa: afterOrder.subtotalPaisa, discountPaisa: afterOrder.discountPaisa,
  taxPaisa: afterOrder.taxPaisa, totalPaisa: afterOrder.totalPaisa,
  discounts: afterOrder.discounts,
};
log("  totals:", JSON.stringify({ subtotal: afterOrder.subtotalPaisa, discount: afterOrder.discountPaisa, total: afterOrder.totalPaisa }));
log("  rows:", JSON.stringify(afterOrder.discounts.map((d) => ({ scope: d.scope, amt: d.amountPaisa, why: d.reason, who: d.appliedByName }))));
J.managerBill = await billOnScreen(mgr);
log("  manager's bill on screen:", JSON.stringify(J.managerBill));

// identity: subtotal − discount + tax + service == total
J.moneyIdentityHolds =
  afterOrder.subtotalPaisa - afterOrder.discountPaisa + afterOrder.taxPaisa + afterOrder.serviceChargePaisa
  === afterOrder.totalPaisa;
log("  subtotal − discount + tax + service == total ?", J.moneyIdentityHolds);

// ─────────────────────────────────────────────────────────────────────────────
log("\n=== 6. the printed bill ===");
const receipt = await api(mgr, "GET", `/api/v1/pos/orders/${orderId}/receipt-document?branchId=${branchId}`);
if (receipt.status === 200) {
  const t = receipt.body?.data?.totals ?? receipt.body?.totals;
  J.receiptTotals = t;
  log("  receipt document totals:", JSON.stringify(t));
} else {
  log("  receipt-document endpoint:", receipt.status, "— falling back to the printed page");
}
await go(cash, `/app/pos/orders/${orderId}/receipt`, 7000);
await shot(cash, "21-printed-bill");
J.printedBill = await cash.evaluate(() => {
  const t = document.body.innerText.replace(/ /g, " ");
  const grab = (l) => new RegExp(`${l}[^\\n]*?(-?[\\d,]+\\.\\d\\d)`, "i").exec(t)?.[1] ?? null;
  return {
    subtotal: grab("Subtotal"), discount: grab("Discount"), tax: grab("Tax"),
    total: grab("(Grand )?Total"),
    raw: t.replace(/\s+/g, " ").slice(0, 700),
  };
});
log("  printed bill:", JSON.stringify(J.printedBill));

// ─────────────────────────────────────────────────────────────────────────────
log("\n=== 7. settle the check ===");
await go(cash, `/app/pos/orders/${orderId}/charge`, 6000);
await cash.locator('input[aria-label="Amount (Rs)"], [data-testid="tender-amount-input"]').first().waitFor({ timeout: 10000 }).catch(() => {});
const full = cash.locator('button:has-text("Full amount")');
if (await full.count()) { await full.first().click(); await cash.waitForTimeout(600); }
const tendered = cash.locator('input[aria-label="Tendered (Rs)"]');
if (await tendered.count()) {
  const amt = await cash.locator('input[aria-label="Amount (Rs)"]').first().inputValue();
  await tendered.first().fill(amt);
  await cash.waitForTimeout(400);
}
await shot(cash, "22-tender-filled");
await cash.locator('button:has-text("Record Payment")').first().click();
await cash.waitForTimeout(5000);
await shot(cash, "23-paid");
const closeBtn = cash.locator('button:has-text("Close order"), button:has-text("Mark served and close"), [data-testid="close-order-button"]');
if (await closeBtn.count()) { await closeBtn.first().click(); await cash.waitForTimeout(6000); }
await shot(cash, "24-closed");
const settled = (await api(cash, "GET", `/api/v1/pos/orders/${orderId}?branchId=${branchId}`)).body.data;
J.settled = { status: settled.status, discountPaisa: settled.discountPaisa, totalPaisa: settled.totalPaisa };
log("  settled:", JSON.stringify(J.settled));

// ─────────────────────────────────────────────────────────────────────────────
log("\n=== 8. takings and the Discount Summary report ===");
await new Promise((r) => setTimeout(r, 6000)); // let the ETL consume ORDER_CLOSED
await go(mgr, "/app/finance/takings", 8000);
await shot(mgr, "25-takings");
J.takings = await mgr.evaluate(() => {
  const t = document.body.innerText.replace(/ /g, " ");
  const grab = (l) => new RegExp(`${l}\\s*\\n?\\s*(-?Rs [\\d,]+\\.\\d\\d)`, "i").exec(t)?.[1] ?? null;
  return { gross: grab("GROSS SALES"), discounts: grab("DISCOUNTS"), net: grab("NET SALES") };
});
log("  takings:", JSON.stringify(J.takings));

await go(mgr, "/app/reports/discount-summary", 9000);
await mgr.waitForTimeout(2000);
const runBtn = mgr.locator('button:has-text("Run"), button:has-text("Generate")');
if (await runBtn.count()) { await runBtn.first().click(); await mgr.waitForTimeout(5000); }
await shot(mgr, "26-discount-summary-report");
J.report = await mgr.evaluate(() => ({
  headers: Array.from(document.querySelectorAll("th")).map((n) => n.textContent.trim()),
  firstRows: Array.from(document.querySelectorAll("tbody tr")).slice(0, 4).map((r) =>
    Array.from(r.querySelectorAll("td")).map((c) => c.textContent.trim())),
  text: document.body.innerText.replace(/\s+/g, " ").slice(0, 900),
}));
log("  report headers:", JSON.stringify(J.report.headers));
log("  report rows:", JSON.stringify(J.report.firstRows, null, 1));

// Same query over HTTP so a rendering gap is distinguishable from an empty dataset.
const reportApi = await api(mgr, "POST", "/api/v1/reporting/reports/discount-summary/run",
  { branchId, from: new Date(Date.now() - 86400000).toISOString().slice(0, 10), to: new Date(Date.now() + 86400000).toISOString().slice(0, 10) });
J.reportApi = { status: reportApi.status, columns: reportApi.body?.data?.columns, rowCount: reportApi.body?.data?.rowCount, rows: (reportApi.body?.data?.rows ?? []).slice(0, 4) };
log("  report over HTTP:", JSON.stringify(J.reportApi, null, 1));

J.consoleErrors = { cashier: cash.__console.slice(0, 5), manager: mgr.__console.slice(0, 5) };
writeFileSync(`${OUT}/01-verify.json`, JSON.stringify(J, null, 2));
log("\njournal →", `${OUT}/01-verify.json`);
await browser.close();
