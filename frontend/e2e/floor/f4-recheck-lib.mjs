/*
 * F4 RE-CHECK — a second, independent verifier. Written fresh; nothing imported from
 * f4-prove.mjs or f4-reopen-lib.mjs so a bug in their helpers cannot hide in mine too.
 *
 * The browser clock is pinned to Europe/Lisbon (UTC+1 in August) — neither the machine's zone
 * (Asia/Karachi) nor the branch's, and not the zone the previous verifier used either. If the
 * screen were rendering the BROWSER's clock it would be an hour off, visibly.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export const BASE = "http://localhost:3000";
export const API = "http://localhost:8080";
export const OUT = resolve(process.cwd(), "../.planning/audits/floor/F4/recheck");
mkdirSync(OUT, { recursive: true });

export const WHO = {
  owner: {
    slug: "floating-terrace",
    email: "owner@terrace.local",
    password: "Terrace#Owner1",
    totp: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
  },
  admin: {
    slug: "floating-terrace",
    email: "admin@terrace.local",
    password: "Terrace#Admin1",
    totp: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS",
  },
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  waiter: { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" },
  accountant: {
    slug: "floating-terrace",
    email: "accountant@terrace.local",
    password: "Terrace#Accountant1",
    totp: "2XPUJEA7F6YYOV4P7ME5OH6PUBJWTV5C",
  },
  storekeeper: {
    slug: "floating-terrace",
    email: "storekeeper@terrace.local",
    password: "Terrace#Storekeeper1",
  },
  controlOwner: {
    slug: "control-bistro-isolation-test-tenant",
    email: "owner@control.local",
    password: "Control#Owner1",
    totp: "77YCNG564SWVW7YPUCJRGDSE6ZSCC3GQ",
  },
  controlManager: {
    slug: "control-bistro-isolation-test-tenant",
    email: "manager@control.local",
    password: "Control#Manager1",
  },
};

export const say = (...a) => console.log(...a);

const JOURNAL = resolve(OUT, "_recheck.json");
export function note(key, value) {
  const cur = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : {};
  cur[key] = value;
  writeFileSync(JOURNAL, JSON.stringify(cur, null, 2));
  say(`  · ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  return value;
}

// ── TOTP, written from RFC 4226 rather than copied ──────────────────────────
function decodeBase32(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = [];
  let acc = 0;
  let nbits = 0;
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const v = A.indexOf(ch);
    if (v < 0) continue;
    acc = (acc << 5) | v;
    nbits += 5;
    while (nbits >= 8) {
      nbits -= 8;
      bytes.push((acc >>> nbits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}
export function totpNow(secret) {
  const step = Math.floor(Date.now() / 30000);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", decodeBase32(secret)).update(msg).digest();
  const off = mac[19] & 0x0f;
  const bin =
    ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 1000000).padStart(6, "0");
}

export const launch = () => chromium.launch({ args: ["--disable-dev-shm-usage"] });

export async function tab(
  browser,
  { tz = "Europe/Lisbon", width = 1440, height = 950, colorScheme = "light" } = {},
) {
  const c = await browser.newContext({ viewport: { width, height }, colorScheme, timezoneId: tz });
  const p = await c.newPage();
  p.setDefaultNavigationTimeout(180_000);
  p.setDefaultTimeout(90_000);
  p.__errors = [];
  p.__net = [];
  p.on("console", (m) => m.type() === "error" && p.__errors.push(m.text().slice(0, 240)));
  p.on("response", (r) => r.url().startsWith(API) && p.__net.push({ s: r.status(), u: r.url().replace(API, "") }));
  return p;
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
  const otp = page.locator('input[name="totpCode"], input#totpCode');
  if (await otp.count()) {
    if (!who.totp) throw new Error(`${who.email} was challenged for TOTP but has no secret`);
    await otp.first().fill(totpNow(who.totp));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(5000);
  }
  for (let i = 0; i < 22 && page.url().includes("/login"); i++) await page.waitForTimeout(1500);
  if (page.url().includes("/login")) {
    const why = await page.evaluate(() => ({
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
        n.textContent.trim().slice(0, 200),
      ),
    }));
    if (attempt < 3) {
      say(`  login refused for ${who.email} ${JSON.stringify(why.alerts)} — retry`);
      await page.waitForTimeout(9000);
      return signIn(page, who, attempt + 1);
    }
    throw new Error(`login failed for ${who.email}: ${JSON.stringify(why)}`);
  }
  say(`  ✓ ${who.email}`);
}

export async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  say(`    shot ${name}.png`);
}

/** Never score a screen while it is failing. */
export async function health(page) {
  return page.evaluate(() => {
    const t = document.body.innerText || "";
    const bad = [];
    if (/Couldn.t load|Something went wrong|is unavailable right now|Failed to fetch/i.test(t))
      bad.push("load-failure");
    if (/Access denied|You cannot read|do not have permission/i.test(t)) bad.push("access-denied");
    if (/This page could not be found|404: /i.test(t)) bad.push("404");
    return {
      bad,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
        n.textContent.trim().slice(0, 260),
      ),
    };
  });
}

/** The screen as a human sees it. Table on desktop, cards on mobile. */
export async function readScreen(page) {
  return page.evaluate(() => {
    const table = document.querySelector('table[aria-label="Audit log"]') || document.querySelector("table");
    const rows = table
      ? Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
          Array.from(tr.querySelectorAll("td")).map((td) =>
            (td.innerText || "").replace(/\s+/g, " ").trim(),
          ),
        )
      : [];
    const q = (s) => document.querySelector(s);
    return {
      url: location.href,
      h1: q("h1")?.textContent?.trim() ?? null,
      zoneNote: q("[data-testid=audit-zone-note]")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      summary: q("[data-testid=audit-page-summary]")?.textContent?.trim() ?? null,
      pageLabel: q("[data-testid=audit-page-number]")?.textContent?.trim() ?? null,
      headers: table ? Array.from(table.querySelectorAll("thead th")).map((n) => n.textContent.trim()) : [],
      rowCount: rows.length,
      rows,
      tablesVisible: Array.from(document.querySelectorAll("table")).filter(
        (t) => t.offsetParent !== null,
      ).length,
      prevDisabled: q("[data-testid=audit-prev-page]")?.disabled ?? null,
      nextDisabled: q("[data-testid=audit-next-page]")?.disabled ?? null,
      rangeError: q("[data-testid=audit-range-error]")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      bodyText: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 4000),
    };
  });
}

/** A bearer token for this signed-in session, minted from the refresh cookie. */
export async function bearer(page) {
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
  return page.evaluate(
    async ({ p, k }) => {
      const r = await fetch(`http://localhost:8080${p}`, {
        credentials: "include",
        headers: k ? { Authorization: `Bearer ${k}` } : {},
      });
      let body = null;
      try {
        body = await r.json();
      } catch {
        body = null;
      }
      return { status: r.status, body };
    },
    { p: path, k: tok ?? null },
  );
}

/** Wait for the grid to settle after a filter/page change. */
export async function settle(page, ms = 2600) {
  await page.waitForTimeout(ms);
}
