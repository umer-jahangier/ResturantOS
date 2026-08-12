/*
 * B3 RE-OPEN ATTEMPT — independent drive. Written by the auditor, not the implementer.
 * Asserts the DONE MEANS path AND the adjacent paths the implementer did not claim.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const GW = "http://localhost:8080";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/B3-audit");
mkdirSync(OUT, { recursive: true });

const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };
const MANAGER = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };
const WAITER = { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" };

const log = (...a) => console.log(...a);
const J = { fails: [], notes: [] };
const FAIL = (k, v) => { J.fails.push({ k, v }); log("  ✗ FAIL", k, JSON.stringify(v)); };
const OK = (k, v) => log("  ✓", k, v === undefined ? "" : JSON.stringify(v));

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.__console = [];
  page.on("console", (m) => m.type() === "error" && page.__console.push(m.text().slice(0, 200)));
  return page;
}

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  if (page.url().includes("/login")) throw new Error(`login failed for ${who.email}: ${await page.locator('[role="alert"]').first().textContent().catch(()=>"")}`);
  log("  signed in as", who.email);
}

async function go(page, route, waitMs = 6000) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(waitMs);
  let t = await trouble(page);
  if (t.bad.length) {
    log(`    ! ${route} showed ${t.bad.join(",")} — retry`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(waitMs + 2500);
    t = await trouble(page);
    if (t.bad.length) log(`    !! ${route} STILL ${t.bad.join(",")} ${JSON.stringify(t.alerts)}`);
  }
  return t;
}
async function trouble(page) {
  return page.evaluate(() => {
    const txt = document.body.innerText || "";
    const alerts = [...document.querySelectorAll('[role="alert"]')].map(n => (n.textContent||"").trim()).filter(Boolean);
    const bad = [];
    if (/Couldn.t load|Something went wrong|Failed to fetch|SERVICE_UNAVAILABLE|Unexpected Application Error/i.test(txt)) bad.push("load-failure");
    if (/Access denied|You do not have permission/i.test(txt)) bad.push("access-denied");
    return { bad, alerts };
  });
}
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); log("    shot:", n); };

async function tokenOf(page) {
  return page.evaluate(async (gw) => {
    const r = await fetch(`${gw}/api/v1/auth/refresh`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  }, GW);
}
async function api(page, method, path, payload) {
  const tok = await tokenOf(page);
  return page.evaluate(async ({ m, p, b, t, gw }) => {
    const r = await fetch(`${gw}${p}`, {
      method: m, credentials: "include",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    let body = null; try { body = await r.json(); } catch {}
    return { status: r.status, body };
  }, { m: method, p: path, b: payload, t: tok, gw: GW });
}
const msgOf = (r) => r.body?.error?.message ?? r.body?.message ?? JSON.stringify(r.body)?.slice(0, 200);

/** Read the bill block + every discount-ish signal off the rendered page. */
async function screenState(page) {
  return page.evaluate(() => {
    const t = (document.body.innerText || "").replace(/ /g, " ");
    const grab = (label) => new RegExp(`${label}\\s*\\n?\\s*(-?Rs [\\d,]+\\.\\d\\d)`).exec(t)?.[1] ?? null;
    const permRe = /pos\.(pos\.)?[a-z.]*discount[a-z.]*/i;
    return {
      subtotal: grab("Subtotal"), discounts: grab("Discounts"), taxes: grab("Taxes"),
      total: grab("Total"), remaining: grab("Remaining balance"),
      hasAddDiscountButton: !!document.querySelector('[data-testid="add-discount-button"]'),
      appliedDiscounts: document.querySelector('[data-testid="applied-discounts"]')?.innerText.replace(/\s+/g," ").trim() ?? null,
      rawPermissionOnScreen: permRe.exec(t)?.[0] ?? null,
      allControls: [...document.querySelectorAll("button,a,[role=button]")]
        .map(n => (n.innerText||n.getAttribute("aria-label")||"").replace(/\s+/g," ").trim())
        .filter(s => s && /discount|comp|promo|\boff\b/i.test(s)),
    };
  });
}

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });

// ── 0. manager ensures a free table ──────────────────────────────────────────
log("\n=== 0. free table ===");
const mgr = await newPage(browser);
await login(mgr, MANAGER);
const mgrTok = await tokenOf(mgr);
const mgrClaims = JSON.parse(Buffer.from(mgrTok.split(".")[1], "base64").toString("utf8"));
const branchId = mgrClaims.branch_id ?? mgrClaims.branchId;
J.managerDiscountPerms = (mgrClaims.permissions ?? []).filter(p => /discount/.test(p));
OK("manager discount perms", J.managerDiscountPerms);
{
  const ex = await api(mgr, "GET", `/api/v1/pos/tables?branchId=${branchId}`);
  const free = (ex.body?.data ?? []).filter(t => t.status === "AVAILABLE");
  if (free.length < 2) {
    for (let i = 0; i < 3; i++) {
      const name = "AUD-" + Math.floor(Math.random()*900+100);
      await api(mgr, "POST", `/api/v1/pos/tables?branchId=${branchId}`, { tableNumber: name, capacity: 4, section: "AUD" });
    }
    log("  added 3 tables");
  } else log("  ", free.length, "free tables already");
}

// ── 1. cashier rings + fires ─────────────────────────────────────────────────
log("\n=== 1. cashier rings a DINE-IN check and fires it ===");
const cash = await newPage(browser);
await login(cash, CASHIER);
const cashTok = await tokenOf(cash);
const cashClaims = JSON.parse(Buffer.from(cashTok.split(".")[1], "base64").toString("utf8"));
J.cashierDiscountPerms = (cashClaims.permissions ?? []).filter(p => /discount/.test(p));
OK("cashier discount perms", J.cashierDiscountPerms);

async function ringAndFire(page, label, fire = true) {
  await go(page, "/app/pos", 9000);
  await page.locator("[data-testid=order-type-dine_in]").click();
  await page.waitForTimeout(500);
  await page.locator("[data-testid=table-select-trigger]").click();
  await page.waitForTimeout(1500);
  const opts = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="table-option-"]')]
    .map(n => ({ id: n.getAttribute("data-testid"), t: n.innerText.replace(/\s+/g," ").trim(), disabled: n.getAttribute("aria-disabled") === "true" })));
  const free = opts.find(o => !o.disabled);
  if (!free) throw new Error("no free table " + JSON.stringify(opts.slice(0,5)));
  await page.locator(`[data-testid="${free.id}"]`).click();
  await page.waitForTimeout(1200);
  const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 25000 });
  await tiles.nth(3).click(); await page.waitForTimeout(500);
  await tiles.nth(9).click(); await page.waitForTimeout(1200);
  // dismiss any modifier dialog that S6 may open
  const dlg = page.locator('[role="dialog"] button:has-text("Add"), [role="dialog"] button:has-text("Done"), [role="dialog"] button:has-text("Confirm")');
  if (await dlg.count()) { await dlg.first().click().catch(()=>{}); await page.waitForTimeout(800); }
  if (fire) {
    await page.locator("[data-testid=send-to-kitchen-button]").click();
    await page.waitForTimeout(8000);
  }
  const list = await api(page, "GET", `/api/v1/pos/orders?branchId=${branchId}&size=30`);
  const mine = (list.body?.data ?? []).filter(o => o.cashierId === (fire ? cashClaims.sub : cashClaims.sub));
  return mine[0];
}

const target = await ringAndFire(cash, "primary");
const orderId = target.orderId;
log("  check:", target.orderNo, orderId);
const before = (await api(cash, "GET", `/api/v1/pos/orders/${orderId}?branchId=${branchId}`)).body.data;
J.order = { orderNo: target.orderNo, orderId, status: before.status,
  subtotalPaisa: before.subtotalPaisa, discountPaisa: before.discountPaisa, taxPaisa: before.taxPaisa, totalPaisa: before.totalPaisa };
OK("fired totals", J.order);
if (before.status !== "SENT_TO_KDS") FAIL("order-not-fired", before.status);
const item0 = before.items[0];
const item0Gross = item0.unitPriceSnapshot * item0.quantity;

// ── 2. charge page control ───────────────────────────────────────────────────
log("\n=== 2. the charge page control ===");
await go(cash, `/app/pos/orders/${orderId}/charge`, 7000);
await shot(cash, "a01-charge-page");
J.chargeBefore = await screenState(cash);
OK("charge page", J.chargeBefore);
if (!J.chargeBefore.hasAddDiscountButton) FAIL("no-discount-control-on-charge-page", J.chargeBefore.allControls);

await cash.locator("[data-testid=add-discount-button]").click();
await cash.waitForTimeout(1000);
await shot(cash, "a02-panel-open");

// ── 3. reason gate ───────────────────────────────────────────────────────────
log("\n=== 3. the reason gate ===");
await cash.locator("[data-testid=discount-line-select]").selectOption(item0.id);
await cash.waitForTimeout(400);
await cash.locator("[data-testid=discount-value-input]").fill("10");
await cash.waitForTimeout(700);
J.reasonGate = await cash.evaluate(() => ({
  submitDisabled: document.querySelector('[data-testid="apply-discount-submit"]')?.disabled ?? null,
  validation: document.querySelector('[data-testid="discount-validation-error"]')?.textContent?.trim() ?? null,
}));
OK("no reason →", J.reasonGate);
if (J.reasonGate.submitDisabled !== true) FAIL("submit-not-disabled-without-reason", J.reasonGate);
if (!J.reasonGate.validation) FAIL("no-onscreen-reason-message", J.reasonGate);
await shot(cash, "a03-reason-required");

await cash.locator("[data-testid=apply-discount-submit]").click({ force: true }).catch(()=>{});
await cash.waitForTimeout(2000);
{
  const o = (await api(cash, "GET", `/api/v1/pos/orders/${orderId}?branchId=${branchId}`)).body.data;
  J.forcedClickChangedTotal = o.totalPaisa !== before.totalPaisa;
  if (J.forcedClickChangedTotal) FAIL("forced-click-applied-a-reasonless-discount", { was: before.totalPaisa, now: o.totalPaisa });
  else OK("forced click changed nothing");
}
// server-side: a reasonless request straight at the API
{
  const r = await api(cash, "POST", `/api/v1/pos/orders/${orderId}/discounts`, { scope: "LINE", orderItemId: item0.id, type: "PERCENT", value: 10 });
  J.apiNoReason = { status: r.status, message: msgOf(r) };
  OK("API without reason", J.apiNoReason);
  if (r.status < 400) FAIL("api-accepted-reasonless-discount", J.apiNoReason);
}

// ── 4. 10% off one line ──────────────────────────────────────────────────────
log("\n=== 4. 10% off one line, with a reason ===");
await cash.locator("[data-testid=discount-reason-input]").fill("Kebab arrived cold");
await cash.waitForTimeout(800);
J.preview = await cash.evaluate(() => document.querySelector('[data-testid="discount-preview"]')?.innerText.replace(/\s+/g," ").trim() ?? null);
OK("preview", J.preview);
await shot(cash, "a04-ready");
await cash.locator("[data-testid=apply-discount-submit]").click();
await cash.waitForTimeout(4000);
await shot(cash, "a05-line-applied");

const afterLine = (await api(cash, "GET", `/api/v1/pos/orders/${orderId}?branchId=${branchId}`)).body.data;
const expectedLine = Math.round(item0Gross * 0.1);
J.lineDiscount = {
  itemName: item0.itemNameSnapshot, itemGrossPaisa: item0Gross, expectedPaisa: expectedLine,
  serverDiscountPaisa: afterLine.discountPaisa,
  totalBefore: before.totalPaisa, totalAfter: afterLine.totalPaisa, dropped: before.totalPaisa - afterLine.totalPaisa,
  rows: afterLine.discounts?.map(d => ({ scope: d.scope, type: d.type, amt: d.amountPaisa, reason: d.reason, who: d.appliedByName })),
};
OK("line discount", J.lineDiscount);
if (afterLine.discountPaisa !== expectedLine) FAIL("discount-paisa-mismatch", J.lineDiscount);
if (before.totalPaisa - afterLine.totalPaisa !== expectedLine) FAIL("total-did-not-drop-by-exact-paisa", J.lineDiscount);
J.chargeAfterLine = await screenState(cash);
OK("bill on screen", J.chargeAfterLine);

// ── 4b. PERSISTENCE across a reload ──────────────────────────────────────────
log("\n=== 4b. reload — does it persist? ===");
await go(cash, `/app/pos/orders/${orderId}/charge`, 7000);
J.afterReload = await screenState(cash);
OK("after reload", J.afterReload);
await shot(cash, "a06-after-reload");
if (J.afterReload.discounts === "Rs 0.00" || !J.afterReload.discounts) FAIL("discount-did-not-persist-on-screen", J.afterReload);
if (J.afterReload.appliedDiscounts && !/Kebab arrived cold/i.test(J.afterReload.appliedDiscounts)) FAIL("reason-missing-after-reload", J.afterReload.appliedDiscounts);

// ── 5. cashier asks for the whole check ──────────────────────────────────────
log("\n=== 5. cashier asks for a whole-check discount ===");
await cash.locator("[data-testid=add-discount-button]").click();
await cash.waitForTimeout(900);
await cash.locator("[data-testid=discount-scope-order]").click();
await cash.waitForTimeout(900);
J.cashierWholeCheck = await cash.evaluate(() => ({
  message: document.querySelector('[data-testid="discount-validation-error"]')?.textContent?.trim() ?? null,
  submitDisabled: document.querySelector('[data-testid="apply-discount-submit"]')?.disabled ?? null,
  rawPermissionAnywhere: /pos\.(pos\.)?order\.discount/i.test(document.body.innerText),
  bodyMentionsManager: /manager/i.test(document.body.innerText),
}));
OK("cashier whole-check UI", J.cashierWholeCheck);
if (J.cashierWholeCheck.submitDisabled !== true) FAIL("cashier-whole-check-not-blocked-in-ui", J.cashierWholeCheck);
if (J.cashierWholeCheck.rawPermissionAnywhere) FAIL("raw-permission-string-on-screen", J.cashierWholeCheck);
await shot(cash, "a07-cashier-refused-whole-check");
{
  const r = await api(cash, "POST", `/api/v1/pos/orders/${orderId}/discounts`, { scope: "ORDER", type: "PERCENT", value: 10, reason: "Trying it anyway" });
  J.cashierWholeCheckApi = { status: r.status, message: msgOf(r) };
  OK("server, same request", J.cashierWholeCheckApi);
  if (r.status !== 403) FAIL("server-did-not-403-cashier-whole-check", J.cashierWholeCheckApi);
}

// ── 5b. WRONG PERSONA: the waiter ────────────────────────────────────────────
log("\n=== 5b. wrong persona — the waiter ===");
const wait = await newPage(browser);
try {
  await login(wait, WAITER);
  const wTok = await tokenOf(wait);
  const wClaims = JSON.parse(Buffer.from(wTok.split(".")[1], "base64").toString("utf8"));
  J.waiterDiscountPerms = (wClaims.permissions ?? []).filter(p => /discount/.test(p));
  const rl = await api(wait, "POST", `/api/v1/pos/orders/${orderId}/discounts`, { scope: "LINE", orderItemId: item0.id, type: "PERCENT", value: 50, reason: "waiter probing line scope" });
  const ro = await api(wait, "POST", `/api/v1/pos/orders/${orderId}/discounts`, { scope: "ORDER", type: "PERCENT", value: 50, reason: "waiter probing order scope" });
  J.waiter = { perms: J.waiterDiscountPerms, line: { status: rl.status, msg: msgOf(rl) }, order: { status: ro.status, msg: msgOf(ro) } };
  OK("waiter", J.waiter);
  await go(wait, `/app/pos/orders/${orderId}/charge`, 7000);
  J.waiterScreen = await screenState(wait);
  await shot(wait, "a08-waiter-charge-page");
  OK("waiter charge page", { hasBtn: J.waiterScreen.hasAddDiscountButton, controls: J.waiterScreen.allControls });
} catch (e) { J.waiter = { error: String(e).slice(0,200) }; log("  waiter probe error:", e.message); }

// ── 6. manager whole check ───────────────────────────────────────────────────
log("\n=== 6. manager applies the whole-check discount ===");
await go(mgr, `/app/pos/orders/${orderId}/charge`, 7000);
await shot(mgr, "a09-manager-charge");
await mgr.locator("[data-testid=add-discount-button]").click();
await mgr.waitForTimeout(900);
await mgr.locator("[data-testid=discount-scope-order]").click();
await mgr.waitForTimeout(500);
await mgr.locator("[data-testid=discount-value-input]").fill("10");
await mgr.locator("[data-testid=discount-reason-input]").fill("Regular of twenty years");
await mgr.waitForTimeout(900);
J.managerPreview = await mgr.evaluate(() => document.querySelector('[data-testid="discount-preview"]')?.innerText.replace(/\s+/g," ").trim() ?? null);
OK("manager preview", J.managerPreview);
await shot(mgr, "a10-manager-ready");
await mgr.locator("[data-testid=apply-discount-submit]").click();
await mgr.waitForTimeout(4000);
await shot(mgr, "a11-manager-applied");

const afterOrder = (await api(mgr, "GET", `/api/v1/pos/orders/${orderId}?branchId=${branchId}`)).body.data;
const netAfterLine = afterLine.subtotalPaisa - afterLine.discountPaisa;
const expectedOrderDisc = Math.round(netAfterLine * 0.1);
J.wholeCheck = {
  netBeforePaisa: netAfterLine, expectedOrderDiscountPaisa: expectedOrderDisc,
  subtotalPaisa: afterOrder.subtotalPaisa, discountPaisa: afterOrder.discountPaisa,
  taxPaisa: afterOrder.taxPaisa, serviceChargePaisa: afterOrder.serviceChargePaisa ?? 0, totalPaisa: afterOrder.totalPaisa,
  rows: afterOrder.discounts?.map(d => ({ scope: d.scope, amt: d.amountPaisa, reason: d.reason, who: d.appliedByName })),
};
OK("whole check", J.wholeCheck);
J.moneyIdentityHolds = afterOrder.subtotalPaisa - afterOrder.discountPaisa + afterOrder.taxPaisa + (afterOrder.serviceChargePaisa ?? 0) === afterOrder.totalPaisa;
if (!J.moneyIdentityHolds) FAIL("money-identity-broken", J.wholeCheck);
if (afterOrder.discountPaisa !== expectedLine + expectedOrderDisc) FAIL("combined-discount-arithmetic", { expected: expectedLine + expectedOrderDisc, got: afterOrder.discountPaisa });
J.managerScreen = await screenState(mgr);
OK("manager bill on screen", J.managerScreen);

// actor attribution — the report must name WHO
const whoLine = afterOrder.discounts?.find(d => d.scope === "LINE")?.appliedByName;
const whoOrder = afterOrder.discounts?.find(d => d.scope === "ORDER")?.appliedByName;
J.actors = { line: whoLine, order: whoOrder };
OK("actors", J.actors);
if (!whoLine || !whoOrder) FAIL("actor-name-missing", J.actors);
if (whoLine === whoOrder) FAIL("both-discounts-attributed-to-the-same-person", J.actors);

// ── 7. printed bill ──────────────────────────────────────────────────────────
log("\n=== 7. the printed bill ===");
{
  const r = await api(mgr, "GET", `/api/v1/pos/orders/${orderId}/receipt-document?branchId=${branchId}`);
  J.receiptDoc = { status: r.status, totals: r.body?.data?.totals ?? r.body?.totals };
  OK("receipt-document", J.receiptDoc);
}
await go(cash, `/app/pos/orders/${orderId}/receipt`, 8000);
await shot(cash, "a12-printed-bill");
J.printedBill = await cash.evaluate(() => {
  const t = (document.body.innerText||"").replace(/ /g," ");
  const grab = (l) => new RegExp(`${l}[^\\n]*?(-?[\\d,]+\\.\\d\\d)`, "i").exec(t)?.[1] ?? null;
  return { subtotal: grab("Subtotal"), discount: grab("Discount"), tax: grab("Tax"), total: grab("Total"),
           mentionsReason: /Kebab arrived cold|Regular of twenty/i.test(t), raw: t.replace(/\s+/g," ").slice(0,900) };
});
OK("printed bill", J.printedBill);

// ── 8. settle ────────────────────────────────────────────────────────────────
log("\n=== 8. settle the check ===");
await go(cash, `/app/pos/orders/${orderId}/charge`, 7000);
{
  const full = cash.locator('button:has-text("Full amount")');
  if (await full.count()) { await full.first().click(); await cash.waitForTimeout(800); }
  const tendered = cash.locator('input[aria-label="Tendered (Rs)"]');
  if (await tendered.count()) {
    const amt = await cash.locator('input[aria-label="Amount (Rs)"]').first().inputValue();
    await tendered.first().fill(amt); await cash.waitForTimeout(500);
  }
  await shot(cash, "a13-tender");
  await cash.locator('button:has-text("Record Payment")').first().click();
  await cash.waitForTimeout(6000);
  await shot(cash, "a14-paid");
  const closeBtn = cash.locator('button:has-text("Close order"), button:has-text("Mark served and close"), [data-testid="close-order-button"]');
  if (await closeBtn.count()) { await closeBtn.first().click(); await cash.waitForTimeout(7000); }
  await shot(cash, "a15-closed");
}
const settled = (await api(cash, "GET", `/api/v1/pos/orders/${orderId}?branchId=${branchId}`)).body.data;
J.settled = { status: settled.status, discountPaisa: settled.discountPaisa, totalPaisa: settled.totalPaisa,
  payments: (await api(cash,"GET",`/api/v1/pos/orders/${orderId}/payments?branchId=${branchId}`)).body?.data };
OK("settled", { status: J.settled.status, discount: J.settled.discountPaisa, total: J.settled.totalPaisa });

// ── 8b. a CLOSED check refuses in plain English ──────────────────────────────
{
  const r = await api(mgr, "POST", `/api/v1/pos/orders/${orderId}/discounts`, { scope: "ORDER", type: "PERCENT", value: 5, reason: "after close" });
  J.closedRefusal = { status: r.status, message: msgOf(r) };
  OK("discount on CLOSED check", J.closedRefusal);
  if (r.status < 400) FAIL("closed-check-still-discountable", J.closedRefusal);
  if (/status:|SENT_TO_KDS|CLOSED\b/.test(String(J.closedRefusal.message)) && !/Refund the guest/i.test(String(J.closedRefusal.message)))
    FAIL("closed-refusal-names-a-status-enum", J.closedRefusal);
  await go(mgr, `/app/pos/orders/${orderId}/charge`, 7000);
  J.closedScreen = await screenState(mgr);
  await shot(mgr, "a16-closed-charge-page");
  if (J.closedScreen.hasAddDiscountButton) FAIL("discount-control-still-offered-on-closed-check", J.closedScreen);
}

writeFileSync(`${OUT}/audit-core.json`, JSON.stringify(J, null, 2));
log("\n=== FAILS:", J.fails.length, "===");
J.fails.forEach(f => log("  ✗", f.k, JSON.stringify(f.v)));
log("journal →", `${OUT}/audit-core.json`);
log("ORDER_ID=" + orderId);
log("BRANCH_ID=" + branchId);
await browser.close();
