/*
 * F8 — the print chain, driven end to end.
 *
 * Shares the shift harness's shape but writes into .planning/audits/floor/F8.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const BASE = "http://localhost:3000";
export const API = "http://localhost:8080";
export const OUT = resolve(process.cwd(), "../.planning/audits/floor/F8");

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

/**
 * A TOTP code for a persona, minted from the LIVE encrypted secret in auth_db.
 *
 * <p>A secret hard-coded in a harness is a secret that goes stale the first time somebody re-seeds,
 * and the resulting failure ("login failed") reads exactly like a broken login screen. Ask the
 * database.
 */
export function totpFor(who) {
  if (who.totpSecret) {
    try {
      return totpNow(who.totpSecret);
    } catch {
      /* fall through to the database */
    }
  }
  const out = execFileSync("python3", [
    resolve(process.cwd(), "../scripts/generate_totp.py"),
    who.email,
  ]).toString();
  const m = out.match(/TOTP code:\s*(\d{6})/);
  if (!m) throw new Error(`could not mint a TOTP code for ${who.email}: ${out}`);
  return m[1];
}

export async function newBrowser() {
  return chromium.launch({ args: ["--disable-dev-shm-usage"] });
}

export async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
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

export async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    // Up to three attempts. A TOTP code minted a beat before the 30-second boundary is rejected
    // for a reason that has nothing to do with the product, and a harness that reports that as
    // "login is broken" is the same error-wearing-an-empty-state's-clothes trap in miniature.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const field = page.locator('input[name="totpCode"], input#totpCode');
      if ((await field.count()) === 0) break;
      await field.first().fill(totpFor(who));
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(4000);
      if (!page.url().includes("/login")) break;
      await page.waitForTimeout(2000);
    }
  }
  if (page.url().includes("/login")) {
    const txt = await page.evaluate(() => document.body.innerText.slice(0, 800));
    throw new Error(`login failed for ${who.email} — still at ${page.url()}\n${txt}`);
  }
  console.log(`  ✓ signed in as ${who.email}`);
  return page;
}

export async function shot(page, name) {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  console.log(`    shot: ${name}.png`);
  return p;
}

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
    if (/This page doesn.t exist|404/i.test(t) && t.length < 900) bad.push("404");
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
    return pageTrouble(page);
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
