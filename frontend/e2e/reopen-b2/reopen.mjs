/*
 * B2 RE-OPEN ATTEMPT — independent verification, driven as the CASHIER.
 *
 * Not a re-run of the claimant's harness. Every assertion here is mine, and three of them
 * are things the claim never checked:
 *   - does the void SURVIVE A RELOAD (the claim proved the panel closed, not that it stuck)
 *   - what happens on the statuses that are NOT in the new set (READY / SERVED), from the
 *     cashier's screen — is the button absent, or present-and-403 (the original defect shape)
 *   - can this cashier void SOMEONE ELSE'S check now that the status gate is wider
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
  page.on("response", (r) => {
    const u = r.url();
    if (u.startsWith(API)) page.__requests.push({ m: r.request().method(), s: r.status(), u: u.replace(API, "") });
  });
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
  if (page.url().includes("/login")) throw new Error(`login failed for ${who.email}`);
  log(`  signed in: ${who.email}`);
}

async function go(page, route, waitMs = 6000) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(waitMs);
  const t = await page.evaluate(() => {
    const txt = document.body.innerText || "";
    const bad = [];
    if (/Couldn.t load|Something went wrong|SERVICE_UNAVAILABLE|Failed to fetch/i.test(txt)) bad.push("load-failure");
    if (/Access denied|You do not have permission/i.test(txt)) bad.push("access-denied");
    return { bad, url: location.href };
  });
  if (t.bad.length) {
    log(`  ! ${route} showed ${t.bad.join(",")} — retrying once (error state and empty state are the same picture)`);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(waitMs + 2000);
  }
  return t;
}

const shot = async (page, n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); log(`    shot ${n}.png`); };

async function tokenOf(page) {
  return page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
}
const claimsOf = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64").toString("utf8"));

async function api(page, method, path, payload, token) {
  const t = token ?? (await tokenOf(page));
  return page.evaluate(async ({ m, p, b, tok }) => {
    const r = await fetch(`http://localhost:8080${p}`, {
      method: m,
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
      credentials: "include",
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    let body = null; try { body = await r.json(); } catch { body = null; }
    return { status: r.status, body };
  }, { m: method, p: path, b: payload, tok: t });
}

/** Ring a check on the terminal and fire it. */
async function ringAndFire(page, label, { type = "dine_in", tiles = 2 } = {}) {
  await go(page, "/app/pos", 9000);
  if (page.url().includes("/login")) { await login(page, CASHIER); await go(page, "/app/pos", 9000); }
  try {
    await page.locator(`[data-testid=order-type-${type}]`).waitFor({ timeout: 25000 });
  } catch {
    await shot(page, `${label}-no-terminal`);
    throw new Error(`terminal never rendered: ${await page.evaluate(() => document.body.innerText.slice(0, 500))}`);
  }
  await page.locator(`[data-testid=order-type-${type}]`).click();
  await page.waitForTimeout(700);
  if (type === "dine_in") {
    const trig = page.locator("[data-testid=table-select-trigger]");
    if (await trig.count()) {
      await trig.click(); await page.waitForTimeout(1400);
      const opts = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="table-option-"]'))
        .map((n) => ({ id: n.getAttribute("data-testid"), t: n.innerText.replace(/\s+/g, " ").trim(), d: n.getAttribute("aria-disabled") === "true" })));
      const free = opts.find((o) => !o.d && /AVAILABLE/i.test(o.t)) ?? opts.find((o) => !o.d);
      if (!free) throw new Error("no selectable table");
      await page.locator(`[data-testid="${free.id}"]`).click();
      await page.waitForTimeout(1000);
    }
  }
  const grid = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await grid.first().waitFor({ timeout: 30000 });
  for (let i = 0; i < tiles; i++) {
    await grid.nth(i).click({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(700);
    // S6's modifier dialog opens over the grid for items that carry modifier groups; it
    // intercepts every later tile click until it is dismissed. Accept its defaults and add.
    const dlg = page.locator("[data-testid=modifier-dialog]");
    if (await dlg.count()) {
      const add = dlg.locator("button", { hasText: /Add|Confirm|Done/i }).last();
      if (await add.count()) await add.click({ timeout: 10000 }).catch(() => {});
      else await page.keyboard.press("Escape");
      await page.waitForTimeout(1200);
      if (await page.locator("[data-testid=modifier-dialog]").count()) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(800);
      }
    }
  }
  await page.waitForTimeout(900);
  await shot(page, `${label}-cart`);
  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(7000);
  await shot(page, `${label}-fired`);
  const orderNo = await page.evaluate(() => (document.body.innerText.match(/ORD-\d{8}-\d+/g) || [null])[0]);
  const tok = await tokenOf(page);
  const branch = claimsOf(tok).branch_id;
  const list = await api(page, "GET", `/api/v1/pos/orders?branchId=${branch}&size=30`, undefined, tok);
  const row = (list.body?.data ?? []).find((r) => r.orderNo === orderNo) ?? null;
  log(`  fired ${orderNo} id=${row?.orderId} status=${row?.status ?? row?.settlementStatus}`);
  return { orderNo, orderId: row?.orderId ?? null, row, token: tok, branch };
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

// ══════════════════════════════════════════════════════════════════════════════
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const cash = await newPage(browser);
await login(cash, CASHIER);
const ctok = await tokenOf(cash);
const cc = claimsOf(ctok);
record("cashier", { sub: cc.sub, roles: cc.roles, void: cc.permissions.filter((p) => /void/.test(p)) });

// ── make sure a till is open (a closed till blocks ringing) ────────────────────
await go(cash, "/app/pos", 8000);
const tillTxt = await cash.evaluate(() => document.body.innerText.slice(0, 1200));
if (/No active till|Your till is closed|Open Till/i.test(tillTxt)) {
  log("\n=== till is closed — opening one as the cashier ===");
  const btn = cash.locator("button", { hasText: /Open Till/i });
  if (await btn.count()) {
    await btn.first().click(); await cash.waitForTimeout(2000);
    const term = cash.locator("[data-testid=terminal-select-trigger]");
    if (await term.count()) {
      await term.click(); await cash.waitForTimeout(1200);
      const first = cash.locator('[data-testid^="terminal-option-"]').first();
      if (await first.count()) { await first.click(); await cash.waitForTimeout(800); }
    }
    const float = cash.locator('input[type="number"], input[name*="float" i], input[id*="float" i]');
    if (await float.count()) await float.first().fill("5000");
    await cash.waitForTimeout(500);
    await shot(cash, "00-open-till");
    const submit = cash.locator("button", { hasText: /^(Open Till|Open|Confirm)$/i }).last();
    await submit.click().catch(() => {});
    await cash.waitForTimeout(5000);
    await shot(cash, "00b-till-opened");
  }
  await go(cash, "/app/pos", 8000);
}
record("till-strip", await cash.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 300)));

// ══ 1. THE HEADLINE PATH: ring → fire → KDS → void, all by clicking ═══════════
log("\n=== 1. dine-in check, fired to the kitchen ===");
const A = await ringAndFire(cash, "01");
if (!A.orderId) { await browser.close(); throw new Error("could not ring a check"); }
record("A.fired", { orderNo: A.orderNo, status: A.row?.status ?? A.row?.settlementStatus });

log("\n=== 1b. the cook can see it (proof it really fired) ===");
const kds = await newPage(browser);
await login(kds, KITCHEN);
let onBoard = null;
for (const st of ["DEFAULT", "PANTRY1", "GRILL", "BAR"]) {
  await go(kds, `/app/kitchen/${st}`, 6000);
  const hit = await kds.evaluate((no) => {
    const b = document.body.innerText; const i = b.indexOf(no);
    return i < 0 ? null : b.slice(Math.max(0, i - 30), i + 200).replace(/\s+/g, " ").trim();
  }, A.orderNo);
  if (hit) { onBoard = { station: st, card: hit }; await shot(kds, "01c-kds"); break; }
}
record("A.onKdsBoard", onBoard ?? "NOT FOUND on any board");

log("\n=== 1c. Order Management -> Void -> reason -> Confirm ===");
const idA = await openDrawer(cash, A.orderNo);
record("A.drawerOpened", idA);
await shot(cash, "02a-drawer");
const trigA = cash.getByLabel("Void order");
record("A.voidTriggerCount", await trigA.count());
await trigA.first().click();
await cash.waitForTimeout(1800);
await shot(cash, "02b-void-panel");
await cash.locator("[data-testid=void-refund-panel] textarea").first().fill("Reopen check: guest walked out");
await cash.waitForTimeout(400);
cash.__requests.length = 0;
await cash.locator("[data-testid=void-refund-panel] button", { hasText: /Confirm Void/i }).last().click();
await cash.waitForTimeout(7000);
await shot(cash, "02c-after-confirm");
const afterA = await cash.evaluate(() => ({
  err: document.querySelector("[data-testid=void-error]")?.textContent?.trim() ?? null,
  panelOpen: !!document.querySelector("[data-testid=void-refund-panel]"),
  toasts: Array.from(document.querySelectorAll("[data-sonner-toast]")).map((n) => n.innerText.trim()),
}));
record("A.panelAfterConfirm", afterA);
record("A.voidNetwork", cash.__requests.filter((r) => /void/i.test(r.u)));

// ── THE CHECK THE CLAIM NEVER MADE: does it survive a reload? ─────────────────
log("\n=== 1d. RELOAD — does the void persist? ===");
await cash.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
await cash.waitForTimeout(6000);
const persisted = await api(cash, "GET", `/api/v1/pos/orders?branchId=${A.branch}&size=50&status=VOIDED`);
const rowA = (persisted.body?.data ?? []).find((r) => r.orderNo === A.orderNo) ?? null;
record("A.afterReload", rowA ? { orderNo: rowA.orderNo, status: rowA.status ?? rowA.settlementStatus, voidReason: rowA.voidReason, voidedBy: rowA.voidedByName ?? rowA.voidedBy } : "NOT in VOIDED list");

// the Voided chip on screen
await go(cash, "/app/pos", 8000);
await cash.getByText("Order Management", { exact: true }).click();
await cash.waitForTimeout(4000);
await cash.locator("[data-testid=status-filter-VOIDED]").click().catch(async () => {
  await cash.getByText("Voided", { exact: true }).click().catch(() => {});
});
await cash.waitForTimeout(4500);
await cash.locator("[data-testid=order-management-search]").first().fill(A.orderNo).catch(() => {});
await cash.waitForTimeout(4000);
await shot(cash, "02d-voided-chip");
record("A.voidedChipText", await cash.evaluate((no) => {
  const b = document.body.innerText; const i = b.indexOf(no);
  return i < 0 ? "order number NOT on the Voided chip" : b.slice(i, i + 320).replace(/\s+/g, " ").trim();
}, A.orderNo));

// ══ 2. ADJACENT STATUS: a check the kitchen has already made ═════════════════
log("\n=== 2. adjacent status — void after the food is READY ===");
const B = await ringAndFire(cash, "03");
record("B.fired", { orderNo: B.orderNo, id: B.orderId });
// cook it: drive the KDS board to advance the ticket
let advanced = null;
for (const st of ["DEFAULT", "PANTRY1", "GRILL", "BAR"]) {
  await go(kds, `/app/kitchen/${st}`, 6000);
  const has = await kds.evaluate((no) => document.body.innerText.includes(no), B.orderNo);
  if (!has) continue;
  for (let round = 0; round < 3; round++) {
    const btns = await kds.evaluate(() => Array.from(document.querySelectorAll("button"))
      .map((n) => n.innerText.replace(/\s+/g, " ").trim()).filter((t) => /start|ready|bump|complete|serve/i.test(t)));
    if (!btns.length) break;
    const b = kds.locator("button", { hasText: /Ready|Bump|Complete/i }).first();
    if (await b.count()) { await b.click().catch(() => {}); await kds.waitForTimeout(3000); }
    else {
      const s = kds.locator("button", { hasText: /Start/i }).first();
      if (await s.count()) { await s.click().catch(() => {}); await kds.waitForTimeout(3000); } else break;
    }
  }
  await shot(kds, "03b-kds-advanced");
  advanced = st; break;
}
const bRow = await api(cash, "GET", `/api/v1/pos/orders?branchId=${B.branch}&size=50`);
const bNow = (bRow.body?.data ?? []).find((r) => r.orderNo === B.orderNo);
record("B.statusAfterKitchen", { station: advanced, status: bNow?.status ?? bNow?.settlementStatus });

const idB = await openDrawer(cash, B.orderNo);
const trigB = await cash.getByLabel("Void order").count();
const drawerB = await cash.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 2500));
await shot(cash, "03c-drawer-advanced-status");
record("B.voidTriggerOnAdvancedStatus", { drawerOpened: idB, triggerCount: trigB });
record("B.drawerMentionsVoidUnavailable", /void unavailable|Use Refund|cannot be voided/i.test(drawerB));
// and what the API says on the cashier's own bearer
const bVoid = await api(cash, "POST", `/api/v1/pos/orders/${B.orderId}/void`, { reason: "reopen probe" });
record("B.directVoidCall", { status: bVoid.status, body: JSON.stringify(bVoid.body).slice(0, 260) });

// ══ 3. PAID CHECK — must be refused for MONEY, not permission ════════════════
log("\n=== 3. paid check ===");
const C = await ringAndFire(cash, "04");
record("C.fired", C.orderNo);
const total = await api(cash, "GET", `/api/v1/pos/orders/${C.orderId}?branchId=${C.branch}`);
const totalPaisa = total.body?.data?.totalPaisa ?? total.body?.data?.grandTotalPaisa ?? null;
record("C.totalPaisa", totalPaisa);
const pay = await api(cash, "POST", `/api/v1/pos/orders/${C.orderId}/payments`,
  { method: "CASH", amountPaisa: totalPaisa, tenderedPaisa: totalPaisa, branchId: C.branch });
record("C.payment", { status: pay.status, body: JSON.stringify(pay.body).slice(0, 260) });
const paymentsBefore = await api(cash, "GET", `/api/v1/pos/orders/${C.orderId}/payments?branchId=${C.branch}`);
record("C.paymentsBefore", JSON.stringify(paymentsBefore.body).slice(0, 400));
const cVoid = await api(cash, "POST", `/api/v1/pos/orders/${C.orderId}/void`, { reason: "reopen paid probe" });
record("C.voidOnPaidCheck", { status: cVoid.status, body: JSON.stringify(cVoid.body).slice(0, 320) });
const paymentsAfter = await api(cash, "GET", `/api/v1/pos/orders/${C.orderId}/payments?branchId=${C.branch}`);
record("C.paymentsAfter", JSON.stringify(paymentsAfter.body).slice(0, 400));
record("C.paymentRowUntouched", JSON.stringify(paymentsBefore.body) === JSON.stringify(paymentsAfter.body));
// and the drawer offers no Void
const idC = await openDrawer(cash, C.orderNo);
await shot(cash, "04c-paid-drawer");
record("C.drawer", { opened: idC, voidTrigger: await cash.getByLabel("Void order").count(),
  text: await cash.evaluate(() => { const b = document.body.innerText; const i = b.search(/void unavailable|Use Refund/i); return i < 0 ? null : b.slice(i - 40, i + 120).replace(/\s+/g, " ").trim(); }) });

// ══ 4. WRONG PERSONA — can this cashier void SOMEONE ELSE'S check? ═══════════
log("\n=== 4. someone else's check ===");
const mgr = await newPage(browser);
await login(mgr, MANAGER);
const mtok = await tokenOf(mgr);
const mc = claimsOf(mtok);
record("manager", { sub: mc.sub, void: mc.permissions.filter((p) => /void/.test(p)) });
// manager rings their own check via the API on their own bearer
const mOrder = await api(mgr, "POST", "/api/v1/pos/orders", { branchId: mc.branch_id, type: "TAKEAWAY" }, mtok);
const mId = mOrder.body?.data?.id ?? mOrder.body?.data?.orderId ?? null;
record("mgr.orderCreated", { status: mOrder.status, id: mId });
if (mId) {
  const menu = await api(mgr, "GET", `/api/v1/pos/menu/items?branchId=${mc.branch_id}&size=5`, undefined, mtok);
  const item = (menu.body?.data ?? menu.body?.data?.content ?? [])[0];
  if (item) await api(mgr, "POST", `/api/v1/pos/orders/${mId}/items`, { menuItemId: item.id, quantity: 1, branchId: mc.branch_id }, mtok);
  // now the CASHIER tries to void the MANAGER's order on the cashier's own bearer
  const steal = await api(cash, "POST", `/api/v1/pos/orders/${mId}/void`, { reason: "reopen cross-user probe" });
  record("D.cashierVoidsManagersCheck", { status: steal.status, body: JSON.stringify(steal.body).slice(0, 240) });
}

// ══ 5. CLOSE TILL as the cashier, no manager ═════════════════════════════════
log("\n=== 5. close the till ===");
await go(cash, "/app/pos", 8000);
await shot(cash, "05a-before-close");
const closeBtn = cash.locator("button", { hasText: /Close Till/i });
record("E.closeTillButton", await closeBtn.count());
if (await closeBtn.count()) {
  await closeBtn.first().click();
  await cash.waitForTimeout(3000);
  await shot(cash, "05b-close-panel");
  const panel = await cash.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 1500));
  record("E.closePanel", panel.slice(0, 700));
  const m = panel.match(/Expected[^0-9]*([\d,]+\.\d{2})/i);
  const expected = m ? m[1].replace(/,/g, "") : null;
  record("E.expected", expected);
  const decl = cash.locator('[data-testid=close-till-panel] input, input[name*="declared" i], input[type="number"]');
  if (await decl.count() && expected) { await decl.first().fill(expected); await cash.waitForTimeout(600); }
  await shot(cash, "05c-declared");
  cash.__requests.length = 0;
  const confirm = cash.locator("button", { hasText: /Close Till|Confirm/i }).last();
  await confirm.click().catch(() => {});
  await cash.waitForTimeout(7000);
  await shot(cash, "05d-after-close");
  record("E.closeNetwork", cash.__requests.filter((r) => /till/i.test(r.u)));
  record("E.afterClose", await cash.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400)));
}

writeFileSync(`${OUT}/findings.json`, JSON.stringify(findings, null, 2));
log(`\nwrote ${OUT}/findings.json`);
await browser.close();
