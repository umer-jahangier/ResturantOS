/*
 * B3 — the parts of DONE MEANS the first pass could not photograph:
 *   a. the control at 390 / 768 / 1440 in BOTH themes, with COMPUTED STYLE asserted
 *      (never the class list — cn()/tailwind-merge has silently dropped utilities here before)
 *   b. the journal entry for the discounted check, on screen, carrying the same figure
 *
 * One login, reused as a storage state across every viewport — six sequential logins tripped the
 * auth rate limiter on the third, which reads exactly like a broken screen if you do not look.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/B3");
mkdirSync(OUT, { recursive: true });

const prev = JSON.parse(readFileSync(`${OUT}/01-verify.json`, "utf8"));
const ORDER_NO = prev.order.orderNo;

const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };
const MANAGER = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };
const log = (...a) => console.log(...a);
const J = { orderNo: ORDER_NO };

/**
 * Retries, and SAYS WHAT THE SCREEN SAID when it gives up.
 *
 * A login that fails because ten agents are bouncing the gateway looks exactly like a login that
 * fails because the account is locked, and throwing "login failed" tells the reader neither.
 */
async function login(page, who, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await slug.count()) await slug.first().fill(who.slug);
    await page.locator('input[name="email"], input#email').first().fill(who.email);
    await page.locator('input[name="password"], input#password').first().fill(who.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(6000);
    if (!page.url().includes("/login")) {
      log("  ✓", who.email);
      return;
    }
    const said = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="alert"], .text-destructive'))
        .map((n) => (n.textContent || "").trim()).filter(Boolean).join(" | ") || "(no message on screen)");
    log(`  ! login attempt ${i}/${attempts} for ${who.email} — screen said: ${said}`);
    await page.waitForTimeout(6000 * i);
  }
  throw new Error("login failed after " + attempts + " attempts: " + who.email);
}

/**
 * ONE bearer per page, cached.
 *
 * Refresh tokens ROTATE: every POST /auth/refresh invalidates the cookie the previous call
 * returned. Minting a fresh token per request — which the first draft of this harness did —
 * therefore poisons its own session after a handful of calls and comes back as
 * `401 UNAUTHENTICATED` several steps later, looking exactly like a permission defect.
 */
const bearers = new WeakMap();
async function tokenOf(page) {
  if (bearers.has(page)) return bearers.get(page);
  const t = await page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: "{}",
    });
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
  bearers.set(page, t);
  return t;
}

/**
 * Ten agents share this stack and bounce services under each other. A 503 read as "the screen is
 * broken" is the single most expensive misreading available here, so nothing is measured until
 * the gateway can actually reach pos-service.
 */
async function waitForStack(page, branchId, tries = 30) {
  for (let i = 1; i <= tries; i++) {
    const r = await api(page, "GET", `/api/v1/pos/menu/items?branchId=${branchId}&size=1`);
    if (r.status === 200) return;
    log(`    stack not ready (${r.status}) — waiting, attempt ${i}/${tries}`);
    await page.waitForTimeout(10000);
  }
  throw new Error("gateway could not reach pos-service after 5 minutes");
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

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });

// ── one login, one live check to photograph ──────────────────────────────────
log("\n=== setting up: one live, discountable check ===");
const setupCtx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const setup = await setupCtx.newPage();
await login(setup, CASHIER);
const tok = await tokenOf(setup);
const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));
const branchId = claims.branch_id ?? claims.branchId;

await waitForStack(setup, branchId);
const menu = await api(setup, "GET", `/api/v1/pos/menu/items?branchId=${branchId}&size=8`);
const menuItems = menu.body?.data?.content ?? menu.body?.data ?? menu.body?.content ?? [];
if (menuItems.length < 2) throw new Error("menu read failed: " + JSON.stringify(menu).slice(0, 400));

/**
 * A fresh fired check per screenshot. A single shared one does not survive: another agent's void
 * sweep reached it within seconds last run, and the charge page then correctly hid the control —
 * which would have been photographed as "the control is missing".
 */
async function freshFiredCheck(page) {
  const c = await api(page, "POST", "/api/v1/pos/orders",
    { branchId, type: "DINE_IN", coverCount: 2, clientOrderId: crypto.randomUUID() });
  const id = (c.body?.data ?? c.body)?.id;
  const a1 = await api(page, "POST", `/api/v1/pos/orders/${id}/items`, { menuItemId: menuItems[0].id, branchId, quantity: 2 });
  const a2 = await api(page, "POST", `/api/v1/pos/orders/${id}/items`, { menuItemId: menuItems[1].id, branchId, quantity: 1 });
  const f = await api(page, "POST", `/api/v1/pos/orders/${id}/send-to-kds`);
  const now = await api(page, "GET", `/api/v1/pos/orders/${id}?branchId=${branchId}`);
  const status = (now.body?.data ?? now.body)?.status;
  log(`    check ${id}: create=${c.status} add=${a1.status}/${a2.status} fire=${f.status} status=${status}`);
  if (status !== "SENT_TO_KDS") {
    throw new Error(`check did not reach SENT_TO_KDS (got ${status}) — fire body: ${JSON.stringify(f.body).slice(0, 300)}`);
  }
  return id;
}
await setupCtx.close();

// ── a. the control, three widths, two themes ─────────────────────────────────
log("\n=== a. 390 / 768 / 1440, light and dark ===");
J.viewports = {};
for (const scheme of ["light", "dark"]) {
  for (const [w, h, label] of [[390, 844, "390"], [768, 1024, "768"], [1440, 950, "1440"]]) {
    // A FRESH login per context, not a shared storageState: refresh tokens ROTATE, so the
    // first context to call /auth/refresh invalidates the cookie every other context copied —
    // which surfaces three viewports later as a 401 that looks like a broken screen.
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
    const page = await ctx.newPage();
    await login(page, CASHIER);
    await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    const liveId = await freshFiredCheck(page);
    await page.goto(`${BASE}/app/pos/orders/${liveId}/charge`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7000);
    const btn = page.locator("[data-testid=add-discount-button]");
    const present = (await btn.count()) > 0;
    if (present) {
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      await page.waitForTimeout(1000);
      await page.locator("[data-testid=discount-value-input]").fill("10");
      await page.waitForTimeout(400);
    }
    await page.screenshot({ path: `${OUT}/30-${scheme}-${label}.png`, fullPage: false });

    // Computed style, never the class list.
    const probe = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="discount-panel"]');
      if (!panel) return { panel: false, bodyText: document.body.innerText.slice(0, 200) };
      const cs = getComputedStyle(panel);
      const submit = document.querySelector('[data-testid="apply-discount-submit"]');
      const sb = submit ? getComputedStyle(submit) : null;
      const r = panel.getBoundingClientRect();
      const reason = document.querySelector('[data-testid="discount-reason-input"]');
      return {
        panel: true,
        panelBg: cs.backgroundColor,
        panelColor: cs.color,
        panelWidth: Math.round(r.width),
        overflowsViewport: r.right > window.innerWidth + 1 || r.left < -1,
        bodyScrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 1,
        submitBg: sb?.backgroundColor ?? null,
        submitColor: sb?.color ?? null,
        submitTapHeight: submit ? Math.round(submit.getBoundingClientRect().height) : null,
        reasonBoxHeight: reason ? Math.round(reason.getBoundingClientRect().height) : null,
        validationText: document.querySelector('[data-testid="discount-validation-error"]')?.textContent?.trim() ?? null,
      };
    });
    J.viewports[`${scheme}-${label}`] = { controlPresent: present, ...probe };
    log(`  ${scheme} ${label}px:`, JSON.stringify(probe));
    await ctx.close();
  }
}

// ── b. the journal entry, on screen ──────────────────────────────────────────
log("\n=== b. the journal entry for", ORDER_NO, "===");
const mctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const mgr = await mctx.newPage();
await login(mgr, MANAGER);
for (const route of ["/app/finance/journal-entries", "/app/finance/gl", "/app/finance/transactions"]) {
  await mgr.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await mgr.waitForTimeout(6500);
  const seen = await mgr.evaluate((no) => ({
    hasOrder: document.body.innerText.includes(no),
    is404: /doesn.t exist|Not Found/i.test(document.body.innerText) && document.body.innerText.length < 900,
    head: document.body.innerText.replace(/\s+/g, " ").slice(0, 180),
  }), ORDER_NO);
  log(`  ${route}: hasOrder=${seen.hasOrder} 404=${seen.is404}`);
  if (seen.hasOrder) {
    J.journalRoute = route;
    await mgr.screenshot({ path: `${OUT}/31-journal-list.png`, fullPage: false });
    const row = mgr.locator(`tr:has-text("${ORDER_NO}"), [role=row]:has-text("${ORDER_NO}")`).first();
    if (await row.count()) {
      await row.click();
      await mgr.waitForTimeout(4500);
      await mgr.screenshot({ path: `${OUT}/32-journal-entry.png`, fullPage: false });
    }
    J.journalOnScreen = await mgr.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 1600));
    break;
  }
}
log("  journal on screen:", (J.journalOnScreen ?? "NOT FOUND").slice(0, 600));

writeFileSync(`${OUT}/02-responsive-and-ledger.json`, JSON.stringify(J, null, 2));
log("\njournal →", `${OUT}/02-responsive-and-ledger.json`);
await browser.close();
