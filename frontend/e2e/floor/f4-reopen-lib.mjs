/*
 * F4 RE-OPEN — independent harness. Written from scratch by the verifier, not reused from
 * f4-prove.mjs, so a bug shared with the prover's helpers cannot hide in both.
 *
 * Browser time zone is deliberately NOT the machine's. The machine sits in Asia/Karachi, which is
 * also the branch's zone, so a screen that rendered the BROWSER's clock would look correct here.
 * Every context below is pinned to a zone that is not Karachi.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export const BASE = "http://localhost:3000";
export const API = "http://localhost:8080";
export const OUT = resolve(process.cwd(), "../.planning/audits/floor/F4/reopen");
mkdirSync(OUT, { recursive: true });

export const PEOPLE = {
  owner: {
    slug: "floating-terrace",
    email: "owner@terrace.local",
    password: "Terrace#Owner1",
    totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
  },
  tenantAdmin: {
    slug: "floating-terrace",
    email: "admin@terrace.local",
    password: "Terrace#Admin1",
    totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS",
  },
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  accountant: {
    slug: "floating-terrace",
    email: "accountant@terrace.local",
    password: "Terrace#Accountant1",
    totpSecret: "2XPUJEA7F6YYOV4P7ME5OH6PUBJWTV5C",
  },
  controlOwner: {
    slug: "control-bistro-isolation-test-tenant",
    email: "owner@control.local",
    password: "Control#Owner1",
    totpSecret: "77YCNG564SWVW7YPUCJRGDSE6ZSCC3GQ",
  },
};

export function log(...a) {
  console.log(...a);
}

const JOURNAL = resolve(OUT, "_reopen.json");
export function record(key, value) {
  const cur = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : {};
  cur[key] = value;
  writeFileSync(JOURNAL, JSON.stringify(cur, null, 2));
  log(`  · ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  return value;
}

function b32(input) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const c of input.replace(/=+$/, "").toUpperCase()) {
    const i = A.indexOf(c);
    if (i === -1) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
export function totpNow(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", b32(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const code = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export async function launch() {
  return chromium.launch({ args: ["--disable-dev-shm-usage"] });
}

export async function ctx(browser, { tz = "America/New_York", width = 1440, height = 950, colorScheme = "light" } = {}) {
  const c = await browser.newContext({ viewport: { width, height }, colorScheme, timezoneId: tz });
  const page = await c.newPage();
  page.setDefaultNavigationTimeout(180_000);
  page.setDefaultTimeout(90_000);
  page.__errors = [];
  page.__api = [];
  page.on("console", (m) => m.type() === "error" && page.__errors.push(m.text().slice(0, 240)));
  page.on("response", (r) => {
    const u = r.url();
    if (u.startsWith(API)) page.__api.push({ s: r.status(), u: u.replace(API, "") });
  });
  return page;
}

export async function signIn(page, who, attempt = 0) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3500);
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    if (!who.totpSecret) throw new Error(`${who.email} was challenged for TOTP with no secret`);
    await totp.first().fill(totpNow(who.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(5000);
  }
  for (let i = 0; i < 20 && page.url().includes("/login"); i++) await page.waitForTimeout(1500);
  if (page.url().includes("/login")) {
    const why = await page.evaluate(() => ({
      url: location.href,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim().slice(0, 200)),
    }));
    if (attempt < 3) {
      log(`  login refused for ${who.email} (${JSON.stringify(why.alerts)}) — retry ${attempt + 1}`);
      await page.waitForTimeout(9000);
      return signIn(page, who, attempt + 1);
    }
    throw new Error(`login failed for ${who.email}: ${JSON.stringify(why)}`);
  }
  log(`  ✓ signed in as ${who.email}`);
}

export async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  log(`    shot: ${name}.png`);
}

export async function trouble(page) {
  return page.evaluate(() => {
    const t = document.body.innerText || "";
    const bad = [];
    if (/Couldn.t load|Something went wrong|is unavailable right now|Failed to fetch/i.test(t)) bad.push("load-failure");
    if (/Access denied|You cannot read|do not have permission/i.test(t)) bad.push("access-denied");
    if (/This page doesn.t exist|404/i.test(t) && t.length < 1200) bad.push("404");
    return { bad, alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim().slice(0, 240)) };
  });
}

/** The audit table exactly as a person sees it. */
export async function readAudit(page) {
  return page.evaluate(() => {
    const table = document.querySelector('table[aria-label="Audit log"]');
    const rows = table
      ? Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
          Array.from(tr.querySelectorAll("td")).map((td) => (td.innerText || "").replace(/\s+/g, " ").trim()),
        )
      : [];
    return {
      h1: document.querySelector("h1")?.textContent?.trim() ?? null,
      zoneNote: document.querySelector("[data-testid=audit-zone-note]")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      summary: document.querySelector("[data-testid=audit-page-summary]")?.textContent?.trim() ?? null,
      pageNumber: document.querySelector("[data-testid=audit-page-number]")?.textContent?.trim() ?? null,
      headers: table ? Array.from(table.querySelectorAll("thead th")).map((n) => n.textContent.trim()) : [],
      rowCount: rows.length,
      rows,
      cardCount: document.querySelectorAll("[data-testid=data-grid-card], li[data-card]").length,
      nextDisabled: document.querySelector("[data-testid=audit-next-page]")?.disabled ?? null,
      prevDisabled: document.querySelector("[data-testid=audit-prev-page]")?.disabled ?? null,
    };
  });
}

export async function token(page) {
  return page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
}

export async function apiGet(page, path, tok) {
  const t = tok ?? (await token(page));
  return page.evaluate(
    async ({ p, k }) => {
      const r = await fetch(`http://localhost:8080${p}`, {
        credentials: "include",
        headers: k ? { Authorization: `Bearer ${k}` } : {},
      });
      let body = null;
      try { body = await r.json(); } catch { body = null; }
      return { status: r.status, body };
    },
    { p: path, k: t },
  );
}
