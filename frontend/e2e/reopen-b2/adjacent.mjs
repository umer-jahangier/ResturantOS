/*
 * B2 RE-OPEN, part 2 — the paths the claim did NOT cover.
 *
 *  D. A check the KITCHEN HAS ALREADY MADE (READY). The new rule stops at SENT_TO_KDS, so
 *     this must be refused — but HOW it is refused is the whole point of B2: the original
 *     defect was a button that renders and then 403s. Does the cashier's drawer offer a Void
 *     control at READY?
 *  E. SOMEONE ELSE'S check. The status gate got wider; the ownership gate must not have.
 *  F. A drawer the cashier actually controls, closed by the cashier alone.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const API = "http://localhost:8080";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/B2/reopen");
mkdirSync(OUT, { recursive: true });

const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };
const KITCHEN = { slug: "floating-terrace", email: "kitchen@terrace.local", password: "Terrace#Kitchen1" };
const MANAGER = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };

const findings = [];
const log = (...a) => console.log(...a);
const record = (k, v) => { findings.push({ k, v }); log(`  [${k}] ${typeof v === "string" ? v : JSON.stringify(v)}`); };

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.__requests = [];
  page.on("response", (r) => { const u = r.url(); if (u.startsWith(API)) page.__requests.push({ m: r.request().method(), s: r.status(), u: u.replace(API, "") }); });
  return page;
}
async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);
  // A rate-limited login (429) looks exactly like a rejected password on this screen. Say
  // which one it was, and wait it out rather than scoring it as a product finding.
  for (let attempt = 0; attempt < 6 && page.url().includes("/login"); attempt++) {
    const diag = await page.evaluate(() => ({
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
      body: document.body.innerText.replace(/\s+/g, " ").slice(0, 300),
    }));
    const net = page.__requests.filter((r) => /auth\/login/.test(r.u)).slice(-3);
    log(`  ! login attempt ${attempt + 1} still on /login — net=${JSON.stringify(net)} alerts=${JSON.stringify(diag.alerts)}`);
    if (net.some((r) => r.s === 429) || /too many|rate/i.test(diag.body + diag.alerts.join(" "))) {
      log("    rate-limited (429) — backing off 45s; this is a harness/traffic event, not a product finding");
      await page.waitForTimeout(45000);
    } else {
      await page.waitForTimeout(8000);
    }
    await page.locator('input[name="email"], input#email').first().fill(who.email).catch(() => {});
    await page.locator('input[name="password"], input#password').first().fill(who.password).catch(() => {});
    const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await s.count()) await s.first().fill(who.slug).catch(() => {});
    await page.locator('button[type="submit"]').first().click().catch(() => {});
    await page.waitForTimeout(5000);
  }
  if (page.url().includes("/login")) throw new Error(`login failed ${who.email}`);
  log(`  signed in: ${who.email}`);
}
async function go(page, route, waitMs = 6000) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(waitMs);
  const t = await page.evaluate(() => {
    const x = document.body.innerText || ""; const bad = [];
    if (/Couldn.t load|Something went wrong|SERVICE_UNAVAILABLE|Failed to fetch/i.test(x)) bad.push("load-failure");
    if (/Access denied|You do not have permission/i.test(x)) bad.push("access-denied");
    return { bad, url: location.href };
  });
  if (t.bad.length) { log(`  ! ${route} ${t.bad.join(",")} — retry`); await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 }); await page.waitForTimeout(waitMs + 2000); }
  return t;
}
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); log(`    shot ${n}.png`); };
async function tokenOf(page) {
  return page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok) return null; const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
}
const claimsOf = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64").toString("utf8"));
async function api(page, method, path, payload, token) {
  const t = token ?? (await tokenOf(page));
  return page.evaluate(async ({ m, p, b, tok }) => {
    const r = await fetch(`http://localhost:8080${p}`, {
      method: m, headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
      credentials: "include", body: b === undefined ? undefined : JSON.stringify(b),
    });
    let body = null; try { body = await r.json(); } catch { body = null; }
    return { status: r.status, body };
  }, { m: method, p: path, b: payload, tok: t });
}
async function ringAndFire(page, label, { type = "dine_in", tiles = 1 } = {}) {
  await go(page, "/app/pos", 9000);
  if (page.url().includes("/login")) { await login(page, CASHIER); await go(page, "/app/pos", 9000); }
  await page.locator(`[data-testid=order-type-${type}]`).waitFor({ timeout: 25000 });
  await page.locator(`[data-testid=order-type-${type}]`).click();
  await page.waitForTimeout(700);
  if (type === "dine_in") {
    const trig = page.locator("[data-testid=table-select-trigger]");
    if (await trig.count()) {
      await trig.click(); await page.waitForTimeout(1400);
      const opts = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="table-option-"]')).map((n) => ({ id: n.getAttribute("data-testid"), t: n.innerText.replace(/\s+/g, " ").trim(), d: n.getAttribute("aria-disabled") === "true" })));
      const free = opts.find((o) => !o.d && /AVAILABLE/i.test(o.t)) ?? opts.find((o) => !o.d);
      if (free) { await page.locator(`[data-testid="${free.id}"]`).click(); await page.waitForTimeout(1000); }
    }
  }
  const grid = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await grid.first().waitFor({ timeout: 30000 });
  const total = await grid.count();
  // Keep adding tiles until Send to Kitchen actually enables. Some tiles open S6's modifier
  // dialog and add nothing if it is dismissed, so "clicked N tiles" is not "cart has N lines" —
  // assert the state the next step needs instead of assuming the click worked.
  for (let i = 0; i < Math.min(total, 8); i++) {
    await grid.nth(i).click({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(700);
    const dlg = page.locator("[data-testid=modifier-dialog]");
    if (await dlg.count()) {
      const add = dlg.locator("button", { hasText: /Add|Confirm|Done/i }).last();
      if (await add.count()) await add.click({ timeout: 10000 }).catch(() => {}); else await page.keyboard.press("Escape");
      await page.waitForTimeout(1300);
      if (await page.locator("[data-testid=modifier-dialog]").count()) { await page.keyboard.press("Escape"); await page.waitForTimeout(800); }
    }
    const enabled = await page.locator("[data-testid=send-to-kitchen-button]").isEnabled().catch(() => false);
    if (enabled && i + 1 >= tiles) break;
  }
  await page.waitForTimeout(900);
  if (!(await page.locator("[data-testid=send-to-kitchen-button]").isEnabled().catch(() => false))) {
    await shot(page, `${label}-cart-never-filled`);
    throw new Error("Send to Kitchen never enabled — cart stayed empty after 8 tiles");
  }
  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(7000);
  const orderNo = await page.evaluate(() => (document.body.innerText.match(/ORD-\d{8}-\d+/g) || [null])[0]);
  const tok = await tokenOf(page);
  const branch = claimsOf(tok).branch_id;
  const list = await api(page, "GET", `/api/v1/pos/orders?branchId=${branch}&size=30`, undefined, tok);
  const row = (list.body?.data ?? []).find((r) => r.orderNo === orderNo) ?? null;
  log(`  fired ${orderNo} id=${row?.orderId}`);
  return { orderNo, orderId: row?.orderId ?? null, branch, token: tok };
}
async function openDrawer(page, orderNo) {
  await go(page, "/app/pos", 8000);
  if (page.url().includes("/login")) { await login(page, CASHIER); await go(page, "/app/pos", 8000); }
  await page.getByText("Order Management", { exact: true }).waitFor({ timeout: 60000 });
  await page.getByText("Order Management", { exact: true }).click();
  await page.waitForTimeout(4500);
  await page.locator("[data-testid=order-management-search]").first().fill(orderNo);
  let id = null;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1500);
    id = await page.evaluate(() => document.querySelector('[data-testid^="open-order-"]')?.getAttribute("data-testid")?.replace("open-order-", "") ?? null);
    if (id) break;
  }
  if (!id) return null;
  await page.locator(`[data-testid="open-order-${id}"]`).click();
  await page.waitForTimeout(3500);
  return id;
}
const statusOf = async (page, orderId, branch, tok) =>
  (await api(page, "GET", `/api/v1/pos/orders/${orderId}?branchId=${branch}`, undefined, tok)).body?.data?.status;

// ══════════════════════════════════════════════════════════════════════════════
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const cash = await newPage(browser);
await login(cash, CASHIER);
const ctok = await tokenOf(cash);
const cc = claimsOf(ctok);

// ══ D. a check the kitchen has already MADE ══════════════════════════════════
log("\n=== D. cook the check all the way to READY, then look at the cashier's drawer ===");
const D = await ringAndFire(cash, "d");
record("D.fired", { orderNo: D.orderNo, status: await statusOf(cash, D.orderId, D.branch, ctok) });

const kit = await newPage(browser);
await login(kit, KITCHEN);
const ktok = await tokenOf(kit);
// bump every item on this order's ticket, on the cook's own bearer
const tickets = await api(kit, "GET", `/api/v1/kitchen/kds/tickets?branchId=${D.branch}&size=100`, undefined, ktok);
const rows = tickets.body?.data ?? tickets.body?.data?.content ?? [];
const tk = rows.find((t) => t.orderNo === D.orderNo || t.orderNumber === D.orderNo);
record("D.ticketFound", tk ? { id: tk.id ?? tk.ticketId, items: (tk.items ?? []).length } : `NOT FOUND among ${rows.length} tickets`);
if (tk) {
  const tid = tk.id ?? tk.ticketId;
  for (const it of (tk.items ?? [])) {
    const r = await api(kit, "POST", `/api/v1/kitchen/kds/tickets/${tid}/items/${it.id ?? it.itemId}/bump`, { branchId: D.branch }, ktok);
    log(`    bump item ${it.id ?? it.itemId} -> ${r.status}`);
  }
}
await kit.waitForTimeout(6000);
let dStatus = await statusOf(cash, D.orderId, D.branch, ctok);
record("D.statusAfterBump", dStatus);
// if only PARTIAL_READY, serve-all is the cashier's own control; use it to reach SERVED
if (dStatus === "READY") {
  record("D.reached", "READY — this is the status the new rule deliberately excludes");
}

log("\n--- the cashier's drawer on a READY check ---");
const idD = await openDrawer(cash, D.orderNo);
await shot(cash, "d1-ready-drawer");
const drawerD = await cash.evaluate(() => {
  const b = document.body.innerText.replace(/\s+/g, " ");
  const i = b.search(/CHARGE NOW|Reprint kitchen/i);
  return i < 0 ? b.slice(0, 600) : b.slice(Math.max(0, i - 260), i + 260);
});
record("D.drawerOpened", idD);
record("D.voidTriggerCount", await cash.getByLabel("Void order").count());
record("D.drawerText", drawerD);
// if a trigger IS offered, click it through — a button that renders and 403s is the B2 defect
if (await cash.getByLabel("Void order").count()) {
  await cash.getByLabel("Void order").first().click();
  await cash.waitForTimeout(1800);
  await shot(cash, "d2-ready-void-panel");
  const ta = cash.locator("[data-testid=void-refund-panel] textarea");
  if (await ta.count()) {
    await ta.first().fill("Reopen: READY-status probe");
    cash.__requests.length = 0;
    await cash.locator("[data-testid=void-refund-panel] button", { hasText: /Confirm Void/i }).last().click();
    await cash.waitForTimeout(6000);
    await shot(cash, "d3-ready-after-confirm");
    record("D.uiVoidResult", {
      err: await cash.evaluate(() => document.querySelector("[data-testid=void-error]")?.textContent?.trim() ?? null),
      net: cash.__requests.filter((r) => /void/i.test(r.u)),
    });
  }
}
// and the raw call, whatever the UI did
const dDirect = await api(cash, "POST", `/api/v1/pos/orders/${D.orderId}/void`, { reason: "reopen READY probe" });
record("D.directVoidAsCashier", { status: dDirect.status, body: JSON.stringify(dDirect.body).slice(0, 300) });
record("D.statusAfterAttempt", await statusOf(cash, D.orderId, D.branch, ctok));

// the manager CAN (void.any) — proving the escalation path the design intends
const mgr = await newPage(browser);
await login(mgr, MANAGER);
const mtok = await tokenOf(mgr);
const mDirect = await api(mgr, "POST", `/api/v1/pos/orders/${D.orderId}/void`, { reason: "reopen: manager writes off cooked food" }, mtok);
record("D.managerVoidOnReady", { status: mDirect.status, body: JSON.stringify(mDirect.body).slice(0, 160) });
record("D.statusAfterManager", await statusOf(cash, D.orderId, D.branch, ctok));

// ══ E. SOMEONE ELSE'S check ══════════════════════════════════════════════════
log("\n=== E. can this cashier void a check they did not ring? ===");
const mc = claimsOf(mtok);
const mOrder = await api(mgr, "POST", "/api/v1/pos/orders",
  { branchId: mc.branch_id, orderType: "TAKEAWAY", type: "TAKEAWAY" }, mtok);
const mId = mOrder.body?.data?.id ?? mOrder.body?.data?.orderId ?? null;
record("E.managerOrderCreated", { status: mOrder.status, id: mId, body: mId ? undefined : JSON.stringify(mOrder.body).slice(0, 220) });
if (mId) {
  const menu = await api(mgr, "GET", `/api/v1/pos/menu/items?branchId=${mc.branch_id}&size=5`, undefined, mtok);
  const arr = menu.body?.data?.content ?? menu.body?.data ?? [];
  const item = Array.isArray(arr) ? arr[0] : null;
  if (item) {
    const add = await api(mgr, "POST", `/api/v1/pos/orders/${mId}/items`, { menuItemId: item.id, quantity: 1, branchId: mc.branch_id }, mtok);
    record("E.itemAdded", add.status);
  }
  record("E.managerOrderStatus", await statusOf(mgr, mId, mc.branch_id, mtok));
  const steal = await api(cash, "POST", `/api/v1/pos/orders/${mId}/void`, { reason: "reopen cross-user probe" });
  record("E.cashierVoidsManagersOwnCheck", { status: steal.status, body: JSON.stringify(steal.body).slice(0, 260) });
  record("E.managerOrderStatusAfter", await statusOf(mgr, mId, mc.branch_id, mtok));
}

// ══ F. a drawer the cashier controls, closed by the cashier alone ════════════
log("\n=== F. open a fresh till on a free terminal, ring, void, close — cashier only ===");
const terms = await api(cash, "GET", `/api/v1/pos/terminals?branchId=${cc.branch_id}`);
const termList = terms.body?.data ?? [];
record("F.terminals", termList.map((t) => t.code ?? t.name));
let opened = null;
for (const t of termList) {
  const r = await api(cash, "POST", "/api/v1/pos/tills/open",
    { branchId: cc.branch_id, terminalId: t.id, openingFloatPaisa: 500000 });
  log(`    open till on ${t.code ?? t.name} -> ${r.status}`);
  if (r.status === 200 || r.status === 201) { opened = { till: r.body?.data, terminal: t }; break; }
}
record("F.freshTill", opened ? { id: opened.till?.id, terminal: opened.terminal.code, status: opened.till?.status } : "could not open a second till");
if (opened?.till?.id) {
  const closeR = await api(cash, "POST", `/api/v1/pos/tills/${opened.till.id}/close`, { declaredClosingPaisa: 500000 });
  record("F.closeFreshTill", { status: closeR.status, body: JSON.stringify(closeR.body).slice(0, 300) });
  const readBack = await api(cash, "GET", `/api/v1/pos/tills/${opened.till.id}`);
  record("F.tillReadBack", JSON.stringify(readBack.body?.data ?? readBack.body).slice(0, 400));
}

writeFileSync(`${OUT}/adjacent.json`, JSON.stringify(findings, null, 2));
log(`\nwrote ${OUT}/adjacent.json`);
await browser.close();
