/*
 * S1 — Station routing UI. Shared harness.
 *
 * Copied from e2e/shift/lib.mjs (the full-day harness) with the output directory pointed at
 * .planning/audits/floor/S1 and the persona table extended with the bartender this item needs.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export const BASE = "http://localhost:3000";
export const API = "http://localhost:8080";
export const OUT = resolve(process.cwd(), "../.planning/audits/floor/S1");
export const STATE = resolve(OUT, "_state.json");

mkdirSync(OUT, { recursive: true });

export const PEOPLE = {
  owner: {
    slug: "floating-terrace",
    email: "owner@terrace.local",
    password: "Terrace#Owner1",
    totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
  },
  manager: {
    slug: "floating-terrace",
    email: "manager@terrace.local",
    password: "Terrace#Manager1",
  },
  cashier: {
    slug: "floating-terrace",
    email: "cashier@terrace.local",
    password: "Terrace#Cashier1",
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

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0,
    value = 0;
  const out = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export function totpNow(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[off] & 0x7f) << 24) |
    ((hmac[off + 1] & 0xff) << 16) |
    ((hmac[off + 2] & 0xff) << 8) |
    (hmac[off + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export async function newBrowser() {
  return chromium.launch({ args: ["--disable-dev-shm-usage"] });
}

export async function newPage(browser, viewport = { width: 1440, height: 950 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.__console = [];
  page.__requests = [];
  page.on("console", (m) => {
    if (m.type() === "error") page.__console.push(m.text().slice(0, 300));
  });
  page.on("response", (r) => {
    const u = r.url();
    if (u.startsWith(API)) page.__requests.push({ m: r.request().method(), s: r.status(), u });
  });
  return page;
}

/** Poll until the URL leaves /login, a TOTP field appears, or an error is rendered. */
async function settleLogin(page, budgetMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < budgetMs) {
    if (!page.url().includes("/login")) return "in";
    if (await page.locator('input[name="totpCode"], input#totpCode').count()) return "totp";
    if (await page.locator('input[name="newPassword"], input#newPassword').count())
      return "change-password";
    const err = await page
      .locator('[role="alert"]')
      .first()
      .innerText()
      .catch(() => "");
    if (err && !/signing in/i.test(err)) return `error:${err.trim().slice(0, 200)}`;
    await page.waitForTimeout(700);
  }
  return "timeout";
}

export async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slugToggle = page.getByText(/Use a restaurant identifier instead/i);
  if (who.slug && (await slugToggle.count())) {
    await slugToggle.first().click();
    await page.waitForTimeout(400);
  }
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (who.slug && (await slug.count())) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();

  let state = await settleLogin(page);
  if (state === "totp") {
    if (!who.totpSecret) throw new Error(`${who.email} was challenged for TOTP and has no secret`);
    await page.locator('input[name="totpCode"], input#totpCode').first().fill(totpNow(who.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(5000);
    state = await settleLogin(page);
    if (state !== "in") {
      const detail = await page.evaluate(() => ({
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
          (n.textContent || "").trim(),
        ),
        body: (document.body.innerText || "").slice(0, 600),
      }));
      console.log("  totp step did not land:", JSON.stringify(detail));
    }
  }
  if (state !== "in") {
    throw new Error(`login failed for ${who.email} — ${state} — url ${page.url()}`);
  }
  await page.waitForTimeout(2000);
  console.log(`  ✓ signed in as ${who.email}`);
  return page;
}

export async function shot(page, name) {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  console.log(`    shot: ${name}.png`);
  return p;
}

/** Never score a screen while it is failing. */
export async function pageTrouble(page) {
  return page.evaluate(() => {
    const t = document.body.innerText || "";
    const alerts = Array.from(document.querySelectorAll('[role="alert"]'))
      .map((n) => (n.textContent || "").trim())
      .filter(Boolean);
    const bad = [];
    if (/Couldn.t load|Something went wrong|SERVICE_UNAVAILABLE|Failed to fetch/i.test(t))
      bad.push("load-failure text");
    if (/Access denied|You do not have permission/i.test(t)) bad.push("access-denied");
    if (/This page doesn.t exist/i.test(t) && t.length < 900) bad.push("404");
    return { bad, alerts, url: location.href };
  });
}

export async function go(page, route, { waitMs = 3000, allowTrouble = false } = {}) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(waitMs);
  const t = await pageTrouble(page);
  if (t.bad.length && !allowTrouble) {
    console.log(`    ! ${route} showed ${t.bad.join(",")}, retrying once`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(waitMs + 1500);
    return page.evaluate(() => {
      const t2 = document.body.innerText || "";
      const alerts = Array.from(document.querySelectorAll('[role="alert"]'))
        .map((n) => (n.textContent || "").trim())
        .filter(Boolean);
      const bad = [];
      if (/Couldn.t load|Something went wrong|SERVICE_UNAVAILABLE|Failed to fetch/i.test(t2))
        bad.push("load-failure text");
      if (/Access denied|You do not have permission/i.test(t2)) bad.push("access-denied");
      if (/This page doesn.t exist/i.test(t2) && t2.length < 900) bad.push("404");
      return { bad, alerts, url: location.href, retried: true };
    });
  }
  return t;
}

export async function tokenOf(page) {
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

export async function apiGet(page, path, token) {
  const t = token ?? (await tokenOf(page));
  return page.evaluate(
    async ({ p, tok }) => {
      const r = await fetch(`http://localhost:8080${p}`, {
        credentials: "include",
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      let body = null;
      try {
        body = await r.json();
      } catch {
        body = null;
      }
      return { status: r.status, body };
    },
    { p: path, tok: t },
  );
}

export async function apiSend(page, method, path, payload, token) {
  const t = token ?? (await tokenOf(page));
  return page.evaluate(
    async ({ m, p, b, tok }) => {
      const r = await fetch(`http://localhost:8080${p}`, {
        method: m,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        },
        body: b === undefined ? undefined : JSON.stringify(b),
      });
      let body = null;
      try {
        body = await r.json();
      } catch {
        body = null;
      }
      return { status: r.status, body };
    },
    { m: method, p: path, b: payload, tok: t },
  );
}

export function log(...a) {
  console.log(...a);
}
