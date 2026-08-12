/*
 * B3 REPRO — "no discount can be given by anyone, anywhere".
 *
 * Drives the real cashier persona in real Chromium:
 *   1. rings a DINE-IN check, fires it to the kitchen
 *   2. probes the charge page / terminal / drawer for ANY discount control
 *   3. hits the endpoint with the persona's own bearer at every scope
 *   4. rings a SECOND, unfired check and applies a LINE discount to it — the one
 *      combination the register claims works — and reads the totals back.
 *
 * Everything is measured, nothing is assumed.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const API = "http://localhost:8080";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/B3");
mkdirSync(OUT, { recursive: true });

const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };
const MANAGER = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };

const log = (...a) => console.log(...a);
const journal = {};

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

async function go(page, route, waitMs = 5000) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(waitMs);
  const t = await page.evaluate(() => {
    const txt = document.body.innerText || "";
    const alerts = Array.from(document.querySelectorAll('[role="alert"]')).map((n) => (n.textContent || "").trim()).filter(Boolean);
    const bad = [];
    if (/Couldn.t load|Something went wrong|Failed to fetch/i.test(txt)) bad.push("load-failure");
    if (/Access denied|You do not have permission/i.test(txt)) bad.push("access-denied");
    return { bad, alerts };
  });
  if (t.bad.length) {
    log(`    ! ${route} showed ${t.bad.join(",")}, retrying once`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(waitMs + 1500);
  }
  return t;
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

async function api(page, method, path, payload, token) {
  const t = token ?? (await tokenOf(page));
  return page.evaluate(async ({ m, p, b, tok }) => {
    const r = await fetch(`http://localhost:8080${p}`, {
      method: m,
      credentials: "include",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    let body = null;
    try { body = await r.json(); } catch { body = null; }
    return { status: r.status, body };
  }, { m: method, p: path, b: payload, tok: t });
}

/** Every control on the page that could conceivably be a discount. */
async function discountControls(page) {
  return page.evaluate(() => {
    const names = Array.from(document.querySelectorAll('button,[role="button"],a,input,select'))
      .map((n) => (n.getAttribute("aria-label") || n.textContent || n.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return {
      all: Array.from(new Set(names)).slice(0, 40),
      discountish: names.filter((t) => /discount|comp|off\b|promo|voucher|markdown/i.test(t)),
      hasDiscountWord: /discount/i.test(document.body.innerText),
      billBlock: /Bill([\s\S]*?)(Payment History|Take Payment|$)/.exec(document.body.innerText)?.[1]?.replace(/\s+/g, " ").trim().slice(0, 320) ?? null,
    };
  });
}

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const cash = await newPage(browser);
await login(cash, CASHIER);

const tok = await tokenOf(cash);
const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));
const branchId = claims.branch_id ?? claims.branchId;
log("  cashier permissions with 'discount':", JSON.stringify((claims.permissions ?? []).filter((p) => /discount/.test(p))));
journal.cashierDiscountPerms = (claims.permissions ?? []).filter((p) => /discount/.test(p));

// ── 1. ring a dine-in check and FIRE it ───────────────────────────────────────
log("\n=== 1. ring a dine-in check, send to kitchen ===");
await go(cash, "/app/pos", 8000);
await cash.locator("[data-testid=order-type-dine_in]").click();
await cash.waitForTimeout(400);
const trigger = cash.locator("[data-testid=table-select-trigger]");
if (await trigger.count()) {
  await trigger.click();
  await cash.waitForTimeout(1200);
  const opts = await cash.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="table-option-"]')).map((n) => ({
      id: n.getAttribute("data-testid"),
      t: n.innerText.replace(/\s+/g, " ").trim(),
      disabled: n.getAttribute("aria-disabled") === "true",
    })));
  const free = opts.find((o) => !o.disabled);
  log("  tables:", JSON.stringify(opts.slice(0, 10)));
  log("  table chosen:", JSON.stringify(free));
  if (free) {
    await cash.locator(`[data-testid="${free.id}"]`).click();
    await cash.waitForTimeout(800);
  } else {
    log("  ! every table is occupied — pressing Escape and ringing without one");
    await cash.keyboard.press("Escape");
    await cash.waitForTimeout(500);
  }
}
const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().waitFor({ timeout: 20000 });
await tiles.nth(0).click();
await cash.waitForTimeout(300);
await tiles.nth(1).click();
await cash.waitForTimeout(700);
await shot(cash, "01-cart");
await cash.locator("[data-testid=send-to-kitchen-button]").click();
await cash.waitForTimeout(7000);
await shot(cash, "02-fired");

const list = await api(cash, "GET", `/api/v1/pos/orders?branchId=${branchId}&size=40`, undefined, tok);
const mine = (list.body?.data ?? []).filter((o) => o.cashierId === claims.sub);
const fired = mine.find((o) => o.settlementStatus === "SENT_TO_KDS" || o.derivedStatus === "NEW" || o.derivedStatus === "IN_PROGRESS");
log("  my recent orders:", JSON.stringify(mine.slice(0, 4).map((o) => ({ no: o.orderNo, s: o.settlementStatus, d: o.derivedStatus }))));
const firedId = fired?.orderId ?? mine[0]?.orderId;
const firedNo = fired?.orderNo ?? mine[0]?.orderNo;
log("  fired check:", firedNo, firedId);
journal.firedOrder = { orderNo: firedNo, orderId: firedId };

const full = await api(cash, "GET", `/api/v1/pos/orders/${firedId}?branchId=${branchId}`, undefined, tok);
const order = full.body?.data ?? full.body;
log("  status:", order.status, "subtotal:", order.subtotalPaisa, "discount:", order.discountPaisa, "total:", order.totalPaisa);
journal.firedTotalsBefore = { status: order.status, subtotalPaisa: order.subtotalPaisa, discountPaisa: order.discountPaisa, taxPaisa: order.taxPaisa, totalPaisa: order.totalPaisa };

// ── 2. hunt for a discount control on every surface ──────────────────────────
log("\n=== 2. is there a discount control anywhere? ===");
await go(cash, `/app/pos/orders/${firedId}/charge`, 6500);
await shot(cash, "03-charge-page");
journal.chargePageControls = await discountControls(cash);
log("  charge page:", JSON.stringify(journal.chargePageControls.discountish), "hasDiscountWord:", journal.chargePageControls.hasDiscountWord);
log("  bill block:", journal.chargePageControls.billBlock);

await go(cash, "/app/pos", 7000);
journal.terminalControls = await discountControls(cash);
log("  pos terminal:", JSON.stringify(journal.terminalControls.discountish));

// ── 3. the endpoint, every scope, on a FIRED check ───────────────────────────
log("\n=== 3. the endpoint on a fired check ===");
const item = order.items?.[0];
journal.endpointMatrix = [];
for (const req of [
  { scope: "LINE", orderItemId: item?.id, type: "PERCENT", value: 10 },
  { scope: "ORDER", type: "PERCENT", value: 10 },
]) {
  const r = await api(cash, "POST", `/api/v1/pos/orders/${firedId}/discounts`, req, tok);
  const msg = r.body?.error?.message ?? r.body?.message ?? r.body?.detail ?? JSON.stringify(r.body)?.slice(0, 200);
  log(`  cashier ${req.scope} on ${order.status} → ${r.status} — ${msg}`);
  journal.endpointMatrix.push({ who: "cashier", scope: req.scope, status: order.status, http: r.status, msg });
}

// ── 4. the ONE combination the register says works: LINE on an unfired check ──
log("\n=== 4. LINE discount on an UNFIRED check (the only allowed state) ===");
const create = await api(cash, "POST", "/api/v1/pos/orders", { branchId, type: "TAKEAWAY", coverCount: 1, clientOrderId: crypto.randomUUID() }, tok);
const draftId = (create.body?.data ?? create.body)?.id;
log("  draft:", create.status, draftId);
const menu = await api(cash, "GET", `/api/v1/pos/menu/items?branchId=${branchId}&size=5`, undefined, tok);
const menuItem = (menu.body?.data?.content ?? menu.body?.data ?? [])[0];
const added = await api(cash, "POST", `/api/v1/pos/orders/${draftId}/items`, { menuItemId: menuItem.id, branchId, quantity: 2 }, tok);
const draft = added.body?.data ?? added.body;
log("  draft status:", draft.status, "subtotal:", draft.subtotalPaisa, "tax:", draft.taxPaisa, "total:", draft.totalPaisa);
const lineId = draft.items[0].id;
const lineTotal = draft.items[0].lineTotalPaisa;
log("  line:", draft.items[0].itemNameSnapshot, "x", draft.items[0].quantity, "lineTotal:", lineTotal);

const lineDisc = await api(cash, "POST", `/api/v1/pos/orders/${draftId}/discounts`, { scope: "LINE", orderItemId: lineId, type: "PERCENT", value: 10 }, tok);
const after = lineDisc.body?.data ?? lineDisc.body;
log("  cashier LINE 10% on OPEN →", lineDisc.status);
log("  totals AFTER:", JSON.stringify({ subtotalPaisa: after?.subtotalPaisa, discountPaisa: after?.discountPaisa, taxPaisa: after?.taxPaisa, totalPaisa: after?.totalPaisa }));
journal.lineOnOpen = {
  http: lineDisc.status,
  before: { subtotalPaisa: draft.subtotalPaisa, discountPaisa: draft.discountPaisa, taxPaisa: draft.taxPaisa, totalPaisa: draft.totalPaisa },
  after: { subtotalPaisa: after?.subtotalPaisa, discountPaisa: after?.discountPaisa, taxPaisa: after?.taxPaisa, totalPaisa: after?.totalPaisa },
  expectedDiscountPaisa: Math.round(lineTotal * 0.1),
};
log("  EXPECTED discount:", journal.lineOnOpen.expectedDiscountPaisa, "paisa  ACTUAL:", after?.discountPaisa);

// what does the reason field do?
const withReason = await api(cash, "POST", `/api/v1/pos/orders/${draftId}/discounts`, { scope: "LINE", orderItemId: lineId, type: "PERCENT", value: 5, reason: "Manager comp" }, tok);
log("  with a reason field →", withReason.status, "(server ignores unknown fields?)");
journal.reasonAccepted = withReason.status;

// ── 5. manager on the fired check ────────────────────────────────────────────
log("\n=== 5. manager on the same fired check ===");
const mgr = await newPage(browser);
await login(mgr, MANAGER);
const mtok = await tokenOf(mgr);
for (const req of [
  { scope: "LINE", orderItemId: item?.id, type: "PERCENT", value: 10 },
  { scope: "ORDER", type: "PERCENT", value: 10 },
]) {
  const r = await api(mgr, "POST", `/api/v1/pos/orders/${firedId}/discounts`, req, mtok);
  const msg = r.body?.error?.message ?? r.body?.message ?? r.body?.detail ?? JSON.stringify(r.body)?.slice(0, 200);
  log(`  manager ${req.scope} on ${order.status} → ${r.status} — ${msg}`);
  journal.endpointMatrix.push({ who: "manager", scope: req.scope, status: order.status, http: r.status, msg });
}

writeFileSync(`${OUT}/00-repro.json`, JSON.stringify(journal, null, 2));
log("\nrepro journal →", `${OUT}/00-repro.json`);
await browser.close();
