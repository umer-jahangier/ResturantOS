/*
 * B2 — "a cashier cannot void a check that has gone to the kitchen".
 *
 * Shared harness. Deliberately mirrors frontend/e2e/shift/lib.mjs: every persona logs in for
 * real, every out-of-band read is made from inside the page on the persona's OWN bearer
 * (minted by spending the same HttpOnly refresh cookie the tab holds), and every navigation
 * is checked for an error state before anything is scored — an error page and an empty page
 * are the same picture.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHmac } from "node:crypto";

export const BASE = "http://localhost:3000";
export const API = "http://localhost:8080";
export const OUT = resolve(process.cwd(), "../.planning/audits/floor/B2");
export const STATE = resolve(OUT, "_state.json");

mkdirSync(OUT, { recursive: true });

export const PEOPLE = {
  cashier: {
    slug: "floating-terrace",
    email: "cashier@terrace.local",
    password: "Terrace#Cashier1",
  },
  manager: {
    slug: "floating-terrace",
    email: "manager@terrace.local",
    password: "Terrace#Manager1",
  },
  kitchen: {
    slug: "floating-terrace",
    email: "kitchen@terrace.local",
    password: "Terrace#Kitchen1",
  },
};

export function loadState() {
  if (!existsSync(STATE)) return {};
  return JSON.parse(readFileSync(STATE, "utf8"));
}
export function saveState(patch) {
  const s = { ...loadState(), ...patch };
  writeFileSync(STATE, JSON.stringify(s, null, 2));
  return s;
}

export function totpNow(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", Buffer.from(out)).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[off] & 0x7f) << 24) | ((hmac[off + 1] & 0xff) << 16)
    | ((hmac[off + 2] & 0xff) << 8) | (hmac[off + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export async function newBrowser() {
  return chromium.launch({ args: ["--disable-dev-shm-usage"] });
}

export async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.__requests = [];
  page.__console = [];
  page.on("console", (m) => { if (m.type() === "error") page.__console.push(m.text().slice(0, 300)); });
  page.on("response", (r) => {
    const u = r.url();
    if (u.startsWith(API)) page.__requests.push({ m: r.request().method(), s: r.status(), u: u.replace(API, "") });
  });
  return page;
}

export async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.password ? who.email : who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password ?? who.newPassword);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4000);
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    if (!who.totpSecret) throw new Error(`${who.email} challenged for TOTP with no secret`);
    await totp.first().fill(totpNow(who.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4000);
  }
  if (page.url().includes("/login")) throw new Error(`login failed for ${who.email} — at ${page.url()}`);
  log(`  ✓ signed in as ${who.email}`);
  return page;
}

export async function shot(page, name) {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  log(`    shot: ${name}.png`);
  return p;
}

export async function pageTrouble(page) {
  return page.evaluate(() => {
    const t = document.body.innerText || "";
    const alerts = Array.from(document.querySelectorAll('[role="alert"]'))
      .map((n) => (n.textContent || "").trim()).filter(Boolean);
    const bad = [];
    if (/Couldn.t load|Something went wrong|SERVICE_UNAVAILABLE|Failed to fetch/i.test(t)) bad.push("load-failure text");
    if (/Access denied|You do not have permission/i.test(t)) bad.push("access-denied");
    return { bad, alerts, url: location.href };
  });
}

export async function go(page, route, { waitMs = 4000, allowTrouble = false } = {}) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(waitMs);
  const t = await pageTrouble(page);
  if (t.bad.length && !allowTrouble) {
    log(`    ! ${route} showed ${t.bad.join(",")}, retrying once`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(waitMs + 1500);
    return page.evaluate(() => {
      const t2 = document.body.innerText || "";
      const alerts = Array.from(document.querySelectorAll('[role="alert"]'))
        .map((n) => (n.textContent || "").trim()).filter(Boolean);
      const bad = [];
      if (/Couldn.t load|Something went wrong|SERVICE_UNAVAILABLE|Failed to fetch/i.test(t2)) bad.push("load-failure text");
      if (/Access denied|You do not have permission/i.test(t2)) bad.push("access-denied");
      return { bad, alerts, url: location.href, retried: true };
    });
  }
  return t;
}

export async function tokenOf(page) {
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

export async function apiGet(page, path, token) {
  const t = token ?? (await tokenOf(page));
  return page.evaluate(async ({ p, tok }) => {
    const r = await fetch(`http://localhost:8080${p}`, {
      credentials: "include", headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    });
    let body = null;
    try { body = await r.json(); } catch { body = null; }
    return { status: r.status, body };
  }, { p: path, tok: t });
}

export async function apiSend(page, method, path, payload, token) {
  const t = token ?? (await tokenOf(page));
  return page.evaluate(async ({ m, p, b, tok }) => {
    const r = await fetch(`http://localhost:8080${p}`, {
      method: m,
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
        ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
      },
      credentials: "include",
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    let body = null;
    try { body = await r.json(); } catch { body = null; }
    return { status: r.status, body };
  }, { m: method, p: path, b: payload, tok: t });
}

export function money(paisa) {
  const neg = paisa < 0;
  const v = Math.abs(paisa);
  return `${neg ? "-" : ""}Rs ${(v / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function log(...a) { console.log(...a); }

/**
 * Ring a check on the POS terminal and fire it. Returns { orderNo, orderId }.
 * `type` is "dine_in" or "takeaway".
 */
export async function ringAndFire(page, { type = "dine_in", tiles = 2, label = "x" } = {}) {
  const trouble = await go(page, "/app/pos", { waitMs: 8000 });
  if (trouble.bad?.length || trouble.alerts?.length) {
    await shot(page, `${label}-terminal-trouble`);
    log(`  ! /app/pos: ${JSON.stringify(trouble)}`);
  }
  // An error state and an empty state are the same picture — screenshot before giving up.
  try {
    await page.locator(`[data-testid=order-type-${type}]`).waitFor({ timeout: 20000 });
  } catch {
    await shot(page, `${label}-no-order-type-control`);
    const seen = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 600));
    throw new Error(`POS terminal never rendered the order-type control. Page said: ${seen}`);
  }
  await page.locator(`[data-testid=order-type-${type}]`).click();
  await page.waitForTimeout(600);

  if (type === "dine_in") {
    const trigger = page.locator("[data-testid=table-select-trigger]");
    if (await trigger.count()) {
      await trigger.click();
      await page.waitForTimeout(1200);
      const opts = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid^="table-option-"]')).map((n) => ({
          id: n.getAttribute("data-testid"),
          t: n.innerText.replace(/\s+/g, " ").trim(),
          disabled: n.getAttribute("aria-disabled") === "true",
        })));
      // Only a genuinely selectable table. An Occupied row renders aria-disabled and the click
      // hangs for 30s — the harness must pick what the cashier can actually pick.
      const free = opts.find((o) => !o.disabled && /AVAILABLE/i.test(o.t)) ?? opts.find((o) => !o.disabled);
      if (!free) throw new Error("no selectable table on the picker");
      log(`  table: ${free.t}`);
      await page.locator(`[data-testid="${free.id}"]`).click();
      await page.waitForTimeout(900);
    }
  }

  const grid = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await grid.first().waitFor({ timeout: 25000 });
  for (let i = 0; i < tiles; i++) {
    await grid.nth(i).click();
    await page.waitForTimeout(350);
  }
  await page.waitForTimeout(800);
  await shot(page, `${label}-cart`);

  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(6500);
  await shot(page, `${label}-fired`);

  // The order number is read off the cashier's own panel, not off "newest row on the server" —
  // ten agents share this machine and this persona, so "newest" is somebody else's check.
  const orderNo = await page.evaluate(() => {
    const m = document.body.innerText.match(/ORD-\d{8}-\d+/g);
    return m ? m[0] : null;
  });
  const branch = await branchOf(page);
  const list = await apiGet(page, `/api/v1/pos/orders?branchId=${branch}&size=25`);
  const rows = list.body?.data ?? [];
  const o = rows.find((r) => r.orderNo === orderNo) ?? null;
  log(`  fired: ${o?.orderNo} ${o?.settlementStatus} id=${o?.orderId}`);
  return { orderNo: o?.orderNo ?? orderNo, orderId: o?.orderId ?? null, row: o };
}

/** The signed-in persona's branch, straight off their own token. */
export async function branchOf(page, token) {
  const t = token ?? (await tokenOf(page));
  const c = JSON.parse(Buffer.from(t.split(".")[1], "base64").toString("utf8"));
  return c.branch_id ?? c.branchId;
}

/** One order's summary row, found by orderNo on the persona's own bearer. */
export async function orderRow(page, orderNo, token) {
  const branch = await branchOf(page, token);
  const list = await apiGet(page, `/api/v1/pos/orders?branchId=${branch}&size=50`, token);
  return (list.body?.data ?? []).find((r) => r.orderNo === orderNo) ?? null;
}

/** Order Management: search for an order number, return its id from the open-order testid. */
export async function openInOrderManagement(page, orderNo) {
  await go(page, "/app/pos", { waitMs: 7000 });
  await page.getByText("Order Management", { exact: true }).click();
  await page.waitForTimeout(4000);
  await page.locator("[data-testid=order-management-search]").first().fill(orderNo);
  // Search spans every status and every page server-side, so it is genuinely slow on a branch
  // with 140 orders. Poll for the row rather than sleeping — a fixed wait screenshots the
  // skeleton and calls it "not found".
  let id = null;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1500);
    id = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid^="open-order-"]');
      return btn?.getAttribute("data-testid")?.replace("open-order-", "") ?? null;
    });
    if (id) break;
  }
  if (!id) {
    log(`  ! ${orderNo} not found in Order Management search after 30s`);
    return null;
  }
  await page.locator(`[data-testid="open-order-${id}"]`).click();
  await page.waitForTimeout(3500);
  return id;
}
