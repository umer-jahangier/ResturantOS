/*
 * B2 RE-OPEN — an independent attempt to break "a cashier can void a check that went to the
 * kitchen". Written from scratch; shares nothing with frontend/e2e/floor/b2/ except the app.
 *
 * Everything is driven in real Chromium as cashier@terrace.local. Out-of-band reads use the
 * cashier's OWN bearer, minted inside the page from the HttpOnly refresh cookie the tab holds.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const API = "http://localhost:8080";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/B2-reopen");
mkdirSync(OUT, { recursive: true });

const REPORT = { started: new Date().toISOString(), steps: [], findings: [] };
const log = (...a) => console.log(...a);
const record = (k, v) => { REPORT.steps.push({ k, v, t: new Date().toISOString() }); log(`  · ${k}:`, typeof v === "string" ? v : JSON.stringify(v)); };
const finding = (s) => { REPORT.findings.push(s); log(`  !! ${s}`); };

const PEOPLE = {
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  waiter: { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" },
  kitchen: { slug: "floating-terrace", email: "kitchen@terrace.local", password: "Terrace#Kitchen1" },
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  ctrlCashier: { slug: "control-bistro-isolation-test-tenant", email: "cashier@control.local", password: "Control#Cashier1" },
};

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.__net = [];
  page.on("response", (r) => {
    const u = r.url();
    if (u.startsWith(API)) page.__net.push({ m: r.request().method(), s: r.status(), u: u.replace(API, "") });
  });
  return page;
}

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.locator('input[name="email"], input#email').first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  const emailBox = page.locator('input[name="email"], input#email').first();
  const pwBox = page.locator('input[name="password"], input#password').first();
  // Fill, then READ BACK. A fill that lands before React hydrates is silently discarded and the
  // form then reports "Enter a valid email address", which reads exactly like a refused login.
  for (let i = 0; i < 5; i++) {
    await emailBox.fill(who.email);
    await pwBox.fill(who.password);
    await page.waitForTimeout(500);
    const v = await emailBox.inputValue();
    const p = await pwBox.inputValue();
    if (v === who.email && p === who.password) break;
    log(`    ! login form did not hold its values (email="${v}") — retrying`);
    await page.waitForTimeout(1500);
  }
  await page.locator('button[type="submit"]').first().click();
  // Poll rather than sleep: "Signing in…" for longer than a fixed wait is a slow dev server, not
  // a refused credential, and scoring it as one is exactly the false reading to avoid.
  for (let i = 0; i < 30 && page.url().includes("/login"); i++) await page.waitForTimeout(1000);
  await page.waitForTimeout(2500);
  if (page.url().includes("/login")) {
    const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 300));
    throw new Error(`login failed for ${who.email} — ${txt}`);
  }
  log(`  signed in: ${who.email}`);
}

async function trouble(page) {
  return page.evaluate(() => {
    const t = document.body.innerText || "";
    const alerts = Array.from(document.querySelectorAll('[role="alert"]')).map((n) => (n.textContent || "").trim()).filter(Boolean);
    const bad = [];
    if (/Couldn.t load|Something went wrong|SERVICE_UNAVAILABLE|Failed to fetch/i.test(t)) bad.push("load-failure");
    if (/Access denied|You do not have permission/i.test(t)) bad.push("access-denied");
    return { bad, alerts };
  });
}

async function go(page, route, waitMs = 5000) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(waitMs);
  let t = await trouble(page);
  if (t.bad.length) {
    log(`    ! ${route} showed ${t.bad.join(",")} — retrying once`);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(waitMs + 2000);
    t = await trouble(page);
    t.retried = true;
  }
  return t;
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  log(`    shot ${name}.png`);
}

async function token(page) {
  return page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
}

/*
 * Ten agents share this machine and pos-service was killed and rebuilt under an earlier run of
 * this very script. A 503 from the gateway is a DEAD SERVICE, not a product answer, and scoring
 * one as a refusal would be the same class of error as scoring an error page as an empty page.
 * Retry it, say so, and never let a 503 reach an assertion.
 */
async function api(page, method, path, body, tok) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await apiOnce(page, method, path, body, tok);
    if (r.status !== 503) return r;
    log(`    ! 503 on ${method} ${path} — service down, waiting (attempt ${attempt + 1})`);
    await page.waitForTimeout(6000);
  }
  return { status: 503, body: { note: "gateway 503 after 6 attempts — service is down" } };
}

async function apiOnce(page, method, path, body, tok) {
  const t = tok ?? (await token(page));
  return page.evaluate(async ({ m, p, b, k }) => {
    const r = await fetch(`http://localhost:8080${p}`, {
      method: m,
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), ...(k ? { Authorization: `Bearer ${k}` } : {}) },
      credentials: "include",
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    let j = null;
    try { j = await r.json(); } catch { j = null; }
    return { status: r.status, body: j };
  }, { m: method, p: path, b: body, k: t });
}

function claims(tok) {
  const p = tok.split(".")[1];
  return JSON.parse(Buffer.from(p, "base64").toString("utf8"));
}

/** Ring a check on the terminal and fire it. Returns {orderNo, orderId}. */
async function ringAndFire(page, label, tiles = 2) {
  const t = await go(page, "/app/pos", 8000);
  if (page.url().includes("/login")) { await login(page, PEOPLE.cashier); await go(page, "/app/pos", 8000); }
  if (t.bad.length) { await shot(page, `${label}-terminal-trouble`); finding(`/app/pos showed ${t.bad.join(",")}`); }

  // Ensure a till is open — a cash tender and (per TillService) order creation need one.
  if (await page.locator("[data-testid=open-till-button]").count()) {
    log("  no active till — opening one with a Rs 5,000.00 float");
    await page.locator("[data-testid=open-till-button]").click();
    await page.waitForTimeout(900);
    await page.locator('[data-testid=open-till-panel] input[type=number]').fill("5000.00");
    await page.locator("[data-testid=open-till-confirm-button]").click();
    await page.waitForTimeout(4000);
    const err = page.locator("[data-testid=open-till-error]");
    if (await err.count()) record("open-till-error", (await err.first().textContent())?.trim());
  }

  await page.locator("[data-testid=order-type-dine_in]").waitFor({ timeout: 25000 });
  await page.locator("[data-testid=order-type-dine_in]").click();
  await page.waitForTimeout(700);

  const trigger = page.locator("[data-testid=table-select-trigger]");
  if (await trigger.count()) {
    await trigger.click();
    await page.waitForTimeout(1400);
    const opts = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="table-option-"]')).map((n) => ({
      id: n.getAttribute("data-testid"), t: n.innerText.replace(/\s+/g, " ").trim(), disabled: n.getAttribute("aria-disabled") === "true",
    })));
    const free = opts.find((o) => !o.disabled && /AVAILABLE/i.test(o.t)) ?? opts.find((o) => !o.disabled);
    if (!free) throw new Error("no selectable table");
    log(`  table: ${free.t}`);
    await page.locator(`[data-testid="${free.id}"]`).click();
    await page.waitForTimeout(1000);
  }

  const grid = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await grid.first().waitFor({ timeout: 30000 });
  for (let i = 0; i < tiles; i++) {
    await grid.nth(i).click();
    await page.waitForTimeout(700);
    // Some items open the modifier picker. Take the required choices and Add, otherwise the
    // dialog silently swallows every later click and the run reads as a broken menu grid.
    const dlg = page.locator("[data-testid=modifier-dialog]");
    if (await dlg.count()) {
      await page.waitForTimeout(1200);
      const add = page.locator("[data-testid=modifier-dialog-add]");
      if (await add.count() && await add.first().isEnabled()) {
        await add.first().click();
      } else {
        const opts = page.locator('[data-testid^="modifier-option-"]');
        const n = await opts.count();
        for (let j = 0; j < Math.min(n, 3); j++) {
          await opts.nth(j).click();
          await page.waitForTimeout(250);
          if (await add.count() && await add.first().isEnabled()) break;
        }
        if (await add.count() && await add.first().isEnabled()) await add.first().click();
        else await page.keyboard.press("Escape");
      }
      await page.waitForTimeout(1200);
    }
  }
  await page.waitForTimeout(900);
  await shot(page, `${label}-cart`);

  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(7000);
  await shot(page, `${label}-fired`);

  const orderNo = await page.evaluate(() => (document.body.innerText.match(/ORD-\d{8}-\d+/g) || [])[0] ?? null);
  const tok = await token(page);
  const c = claims(tok);
  const branch = c.branch_id ?? c.branchId;
  const list = await api(page, "GET", `/api/v1/pos/orders?branchId=${branch}&size=30`, undefined, tok);
  const row = (list.body?.data ?? []).find((r) => r.orderNo === orderNo) ?? null;
  record(`${label}-fired`, { orderNo, orderId: row?.orderId, status: row?.status ?? row?.settlementStatus });
  return { orderNo, orderId: row?.orderId ?? null, row, branch, tok };
}

/** Order Management → search → open the drawer for orderNo. Returns the order id or null. */
async function openInOM(page, orderNo) {
  await go(page, "/app/pos", 7000);
  if (page.url().includes("/login")) { await login(page, PEOPLE.cashier); await go(page, "/app/pos", 7000); }
  await page.getByText("Order Management", { exact: true }).waitFor({ timeout: 60000 });
  await page.getByText("Order Management", { exact: true }).click();
  await page.waitForTimeout(4000);
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

async function main() {
  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
  const page = await newPage(browser);
  try {
    await login(page, PEOPLE.cashier);

    // ─────────────────────────────────────────────────────────────────────────
    // 1. THE HEADLINE PATH: ring → fire → void, then RELOAD and re-read.
    // ─────────────────────────────────────────────────────────────────────────
    log("\n[1] cashier rings a dine-in check, fires it, then voids it");
    const a = await ringAndFire(page, "01");
    if (!a.orderNo) throw new Error("could not read an order number off the terminal");
    const before = await api(page, "GET", `/api/v1/pos/orders/${a.orderId}?branchId=${a.branch}`);
    record("01-status-before-void", before.body?.data?.status ?? before.body?.data?.settlementStatus ?? before.status);

    // Confirm the kitchen really sees it — a void of a ticket no cook ever saw is not the claim.
    const kp = await newPage(browser);
    await login(kp, PEOPLE.kitchen);
    await go(kp, "/app/kitchen", 8000);
    const onBoard = await kp.evaluate((no) => document.body.innerText.includes(no), a.orderNo);
    const ktok0 = await token(kp);
    const kc0 = claims(ktok0);
    const kb0 = kc0.branch_id ?? kc0.branchId;
    let seenInKitchen = false;
    for (let p = 0; p < 6 && !seenInKitchen; p++) {
      const r = await api(kp, "GET",
        `/api/v1/kitchen/kds/tickets?branchId=${kb0}&status=PENDING,COOKING,READY&page=${p}&size=100`, undefined, ktok0);
      const l = r.body?.content ?? r.body?.data?.content ?? r.body?.data ?? [];
      if (l.some((t) => t.orderNo === a.orderNo)) seenInKitchen = true;
      if (l.length < 100) break;
    }
    record("01-ticket-on-kds", { visibleOnBoardScreen: onBoard, presentInKitchenService: seenInKitchen });
    await shot(kp, "01-kds-board");
    if (!seenInKitchen) finding(`${a.orderNo} never reached kitchen-service as a ticket`);

    const id = await openInOM(page, a.orderNo);
    record("01-order-drawer-opened", id);
    if (!id) throw new Error(`${a.orderNo} not findable in Order Management`);
    await shot(page, "01-drawer");

    const voidTrigger = page.locator('[aria-label="Void order"]');
    record("01-void-trigger-present", await voidTrigger.count());
    if (!(await voidTrigger.count())) {
      await shot(page, "01-no-void-trigger");
      finding("no Void trigger rendered on a SENT_TO_KDS unpaid own check");
    } else {
      await voidTrigger.first().click();
      await page.waitForTimeout(1200);
      await page.locator('[data-testid=void-refund-panel] textarea').first().fill("Reopen drive: guest left before the food went out");
      await shot(page, "01-void-panel");
      page.__net.length = 0;
      await page.getByRole("button", { name: "Confirm Void" }).click();
      await page.waitForTimeout(6000);
      const voidCalls = page.__net.filter((r) => /\/void$/.test(r.u));
      const inlineErr = await page.locator("[data-testid=void-error]").count()
        ? (await page.locator("[data-testid=void-error]").first().textContent())?.trim() : null;
      record("01-void-network", voidCalls);
      record("01-void-inline-error", inlineErr);
      await shot(page, "01-after-confirm");
    }

    // PERSISTENCE — reload, then read the row back off the server and off the screen.
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(6000);
    const afterServer = await api(page, "GET", `/api/v1/pos/orders/${a.orderId}?branchId=${a.branch}`);
    const d = afterServer.body?.data ?? {};
    record("01-after-reload-server", { status: d.status, voidReason: d.voidReason, voidedBy: d.voidedBy, voidedAt: d.voidedAt });

    // ...and on the screen, in the Voided filter, which is what "done" was defined against.
    await go(page, "/app/pos", 7000);
    await page.getByText("Order Management", { exact: true }).click();
    await page.waitForTimeout(3500);
    if (await page.locator("[data-testid=status-filter-VOIDED]").count()) {
      await page.locator("[data-testid=status-filter-VOIDED]").click();
      await page.waitForTimeout(4000);
    }
    await page.locator("[data-testid=order-management-search]").first().fill(a.orderNo);
    await page.waitForTimeout(5000);
    const chip = await page.evaluate((no) => {
      const rows = Array.from(document.querySelectorAll("tr,li,div"));
      const hit = rows.find((n) => (n.innerText || "").includes(no) && (n.innerText || "").length < 700);
      return hit ? hit.innerText.replace(/\s+/g, " ").trim() : null;
    }, a.orderNo);
    record("01-voided-chip-after-reload", chip);
    await shot(page, "01-voided-filter");

    // ─────────────────────────────────────────────────────────────────────────
    // 2. ADJACENT: the same check once the kitchen has cooked and served it.
    //    The commit says the widening "stops at the pass". Drive the pass.
    // ─────────────────────────────────────────────────────────────────────────
    log("\n[2] adjacent — void AFTER the kitchen has plated and served it");
    const b = await ringAndFire(page, "02");
    const ktok = await token(kp);
    const kc = claims(ktok);
    const kBranch = kc.branch_id ?? kc.branchId;
    let ticket = null;
    let boardSize = 0;
    for (let p = 0; p < 6 && !ticket; p++) {
      const r = await api(kp, "GET",
        `/api/v1/kitchen/kds/tickets?branchId=${kBranch}&status=PENDING,COOKING,READY&page=${p}&size=100`, undefined, ktok);
      const l = r.body?.content ?? r.body?.data?.content ?? r.body?.data ?? [];
      boardSize += l.length;
      ticket = l.find((t) => t.orderNo === b.orderNo) ?? null;
      if (l.length < 100) break;
    }
    const tlist = { length: boardSize };
    record("02-ticket", ticket ? { id: ticket.id, status: ticket.status, items: ticket.items?.length } : `NOT FOUND (${tlist.length} on board)`);
    if (ticket) {
      // Two bumps per line is PENDING -> COOKING -> READY, exactly what the cook presses.
      for (const it of ticket.items ?? []) {
        for (const pass of [1, 2]) {
          const r = await api(kp, "POST",
            `/api/v1/kitchen/kds/tickets/${ticket.id}/items/${it.id}/bump?branchId=${kBranch}`, {}, ktok);
          record(`02-bump-${it.name}-${pass}`, r.status);
        }
      }
      const det = await api(kp, "GET", `/api/v1/kitchen/kds/tickets/${ticket.id}?branchId=${kBranch}`, undefined, ktok);
      record("02-ticket-after-bumps", {
        status: det.body?.data?.status ?? det.body?.status,
        items: (det.body?.data?.items ?? det.body?.items ?? []).map((i) => i.status),
      });
      await shot(kp, "02-kds-after-bumps");
    }
    // ...and the cashier marks it served, which is what "the food went out" means on this product.
    const serve = await api(page, "POST", `/api/v1/pos/orders/${b.orderId}/serve-all`, {});
    record("02-serve-all", { status: serve.status, orderStatus: serve.body?.data?.status });
    await page.waitForTimeout(3000);
    const bAfter = await api(page, "GET", `/api/v1/pos/orders/${b.orderId}?branchId=${b.branch}`);
    record("02-order-status-after-serve", {
      status: bAfter.body?.data?.status,
      derived: bAfter.body?.data?.derivedStatus ?? bAfter.body?.data?.kitchenStatus,
    });
    const bVoid = await api(page, "POST", `/api/v1/pos/orders/${b.orderId}/void`, { reason: "Reopen drive: void on a SERVED check" });
    record("02-void-on-served-check", { status: bVoid.status, body: JSON.stringify(bVoid.body).slice(0, 260) });
    if (bVoid.status === 200) {
      finding("a cashier can void their OWN check after the kitchen has cooked AND served it — the 'stops at the pass' boundary the fix claims does not exist in the running product");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. PAID CHECK — refused for money, not for permission; tender untouched.
    // ─────────────────────────────────────────────────────────────────────────
    log("\n[3] a check with cash on it");
    const c3 = await ringAndFire(page, "03");
    const ord = await api(page, "GET", `/api/v1/pos/orders/${c3.orderId}?branchId=${c3.branch}`);
    const total = ord.body?.data?.totalPaisa;
    const pay = await api(page, "POST", `/api/v1/pos/orders/${c3.orderId}/payments`,
      { method: "CASH", amountPaisa: total, tenderedPaisa: total });
    record("03-cash-tender", { status: pay.status, total });
    const paymentsBefore = await api(page, "GET", `/api/v1/pos/orders/${c3.orderId}/payments`);
    const voidPaid = await api(page, "POST", `/api/v1/pos/orders/${c3.orderId}/void`, { reason: "Reopen drive: void a paid check" });
    record("03-void-on-paid", { status: voidPaid.status, body: JSON.stringify(voidPaid.body).slice(0, 300) });
    const paymentsAfter = await api(page, "GET", `/api/v1/pos/orders/${c3.orderId}/payments`);
    record("03-payment-rows-identical",
      JSON.stringify(paymentsBefore.body?.data) === JSON.stringify(paymentsAfter.body?.data));
    if (voidPaid.status === 403) finding("a paid check is refused with a PERMISSION error, not the ORDER_HAS_PAYMENTS message");
    if (voidPaid.status === 200) finding("a paid check can be VOIDED — the tender is stranded");

    // ...and the drawer must offer no Void trigger, only the notice.
    const pid = await openInOM(page, c3.orderNo);
    if (pid) {
      const hasVoid = await page.locator('[aria-label="Void order"]').count();
      const notice = await page.locator("[data-testid=void-blocked-paid-notice]").count()
        ? (await page.locator("[data-testid=void-blocked-paid-notice]").first().textContent())?.trim() : null;
      record("03-paid-drawer", { voidTrigger: hasVoid, notice });
      await shot(page, "03-paid-drawer");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. WRONG PERSONA / WRONG TENANT — did anything get widened?
    // ─────────────────────────────────────────────────────────────────────────
    log("\n[4] the wrong persona, and the wrong tenant");
    // 4a. waiter holds no void permission at all.
    const wp = await newPage(browser);
    await login(wp, PEOPLE.waiter);
    const d4 = await ringAndFire(page, "04");           // cashier's own fresh check
    const wVoid = await api(wp, "POST", `/api/v1/pos/orders/${d4.orderId}/void`, { reason: "waiter tries" });
    record("04a-waiter-void", { status: wVoid.status, body: JSON.stringify(wVoid.body).slice(0, 200) });
    if (wVoid.status === 200) finding("a WAITER can void a cashier's check");

    // 4b. the manager's own check, voided by the cashier — void.own must refuse.
    const mp = await newPage(browser);
    await login(mp, PEOPLE.manager);
    const mtok = await token(mp);
    const mc = claims(mtok);
    const mBranch = mc.branch_id ?? mc.branchId;
    const mCreate = await api(mp, "POST", "/api/v1/pos/orders",
      { branchId: mBranch, clientOrderId: crypto.randomUUID(), guestCount: 1 }, mtok);
    const mOrderId = mCreate.body?.data?.id ?? mCreate.body?.data?.orderId;
    record("04b-manager-order", { status: mCreate.status, id: mOrderId });
    if (mOrderId) {
      const xVoid = await api(page, "POST", `/api/v1/pos/orders/${mOrderId}/void`, { reason: "cashier tries a manager's check" });
      record("04b-cashier-voids-managers-check", { status: xVoid.status, body: JSON.stringify(xVoid.body).slice(0, 200) });
      if (xVoid.status === 200) finding("a cashier can void an order they did not create");
    }

    // 4c. another tenant.
    const cp = await newPage(browser);
    await login(cp, PEOPLE.ctrlCashier);
    const xt = await api(cp, "POST", `/api/v1/pos/orders/${a.orderId}/void`, { reason: "cross-tenant" });
    record("04c-control-bistro-cashier-on-terrace-order", { status: xt.status, body: JSON.stringify(xt.body).slice(0, 200) });
    if (xt.status === 200) finding("CROSS-TENANT: Control Bistro's cashier voided a Floating Terrace order");

    // ─────────────────────────────────────────────────────────────────────────
    // 5. CLOSE TILL, as the cashier, in the same session.
    // ─────────────────────────────────────────────────────────────────────────
    log("\n[5] close the drawer, as the cashier");
    await go(page, "/app/pos", 8000);
    const tok5 = await token(page);
    const c5 = claims(tok5);
    const mine = await api(page, "GET", `/api/v1/pos/tills?cashierId=${c5.sub}&status=OPEN`, undefined, tok5);
    const till = (mine.body?.data ?? [])[0] ?? null;
    record("05-open-till", till ? { id: till.id, float: till.openingFloatPaisa } : "none");
    if (till) {
      const recon = await api(page, "GET", `/api/v1/pos/tills/${till.id}/reconciliation`, undefined, tok5);
      const lines = recon.body?.data?.lines ?? [];
      const blocking = lines.filter((l) => !["CLOSED", "VOIDED", "REFUNDED", "DRAFT"].includes(l.status));
      record("05-till-orders", { total: lines.length, blocking: blocking.length, blockingStatuses: [...new Set(blocking.map((l) => l.status))] });
      await shot(page, "05-till-strip");
      if (await page.locator("[data-testid=close-till-button]").count()) {
        await page.locator("[data-testid=close-till-button]").click();
        await page.waitForTimeout(2500);
        const expected = await page.locator("[data-testid=close-till-expected]").first().textContent();
        record("05-expected-on-panel", expected?.trim());
        const declared = (recon.body?.data?.liveExpectedCashPaisa ?? 0) / 100;
        await page.locator('[data-testid=close-till-panel] input[type=number]').fill(declared.toFixed(2));
        await shot(page, "05-close-panel");
        page.__net.length = 0;
        await page.locator("[data-testid=close-till-confirm-button]").click();
        await page.waitForTimeout(6000);
        record("05-close-network", page.__net.filter((r) => /\/close$/.test(r.u)));
        const banner = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400));
        record("05-after-close-text", banner.slice(0, 220));
        await shot(page, "05-after-close");
        const readback = await api(page, "GET", `/api/v1/pos/tills/${till.id}`, undefined, await token(page));
        record("05-till-readback", {
          status: readback.body?.data?.status,
          expected: readback.body?.data?.expectedClosingPaisa,
          declared: readback.body?.data?.declaredClosingPaisa,
          variance: readback.body?.data?.variancePaisa,
        });
        if (readback.body?.data?.status !== "CLOSED") finding("the cashier could not close their own drawer in the same session");
      } else {
        finding("no Close Till control on the terminal");
      }
    }
  } catch (e) {
    REPORT.fatal = String(e && e.stack ? e.stack : e);
    log("FATAL", REPORT.fatal);
    try { await shot(page, "fatal"); } catch { /* ignore */ }
  } finally {
    writeFileSync(`${OUT}/report.json`, JSON.stringify(REPORT, null, 2));
    log(`\nreport → ${OUT}/report.json`);
    log(`findings: ${REPORT.findings.length}`);
    REPORT.findings.forEach((f) => log(` - ${f}`));
    await browser.close();
  }
}

main();
