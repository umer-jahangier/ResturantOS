// Red-team harness for the inventory/purchasing re-audit. DIAGNOSTIC ONLY.
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const BASE = "http://localhost:3000";
export const GW = "http://localhost:8080";
export const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/inventory-purchasing-redteam";

export const PERSONAS = {
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  storekeeper: { slug: "floating-terrace", email: "storekeeper@terrace.local", password: "Terrace#Storekeeper1" },
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  owner: {
    slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1",
    totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
  },
  admin: {
    slug: "floating-terrace", email: "admin@terrace.local", password: "Terrace#Admin1",
    totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS",
  },
  accountant: {
    slug: "floating-terrace", email: "accountant@terrace.local", password: "Terrace#Accountant1",
    totpSecret: "2XPUJEA7F6YYOV4P7ME5OH6PUBJWTV5C",
  },
};

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

export function totpNow(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[o] & 0x7f) << 24) | ((hmac[o + 1] & 0xff) << 16) | ((hmac[o + 2] & 0xff) << 8) | (hmac[o + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

/** Signs in, RETRIES on the known empty-login-body flake, and ASSERTS the session is real. */
export async function login(page, key) {
  const p = PERSONAS[key];
  if (!p) throw new Error(`unknown persona ${key}`);
  for (let attempt = 1; attempt <= 4; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (p.slug && (await slug.count())) await slug.first().fill(p.slug);
    await page.locator('input[name="email"], input#email').first().fill(p.email);
    await page.locator('input[name="password"], input#password').first().fill(p.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(3000);
    const totp = page.locator('input[name="totpCode"], input#totpCode');
    if (await totp.count()) {
      if (!p.totpSecret) throw new Error(`${key} was challenged for TOTP but has no secret`);
      await totp.first().fill(totpNow(p.totpSecret));
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(4000);
    }
    if (!page.url().includes("/login")) {
      console.log(`  signed in as ${key} (attempt ${attempt}) → ${page.url()}`);
      return true;
    }
    console.log(`  ! login attempt ${attempt} for ${key} failed, url=${page.url()}`);
    await page.waitForTimeout(1500);
  }
  return false;
}

/** Proves the session is still alive RIGHT NOW. Guards against the mid-sweep logout trap. */
export async function assertSession(page, where) {
  const url = page.url();
  if (url.includes("/login")) throw new Error(`SESSION LOST at ${where} — url=${url}`);
}

export async function shot(page, name) {
  const file = `${OUT}/${name}.png`;
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

/**
 * Navigates and returns a structured read of the page, retrying if it lands on an error state.
 * An error screenshot looks exactly like an empty product, so a failed read is retried, loudly.
 */
export async function probe(page, route, { retries = 2, wait = 4500 } = {}) {
  let last = null;
  for (let i = 0; i <= retries; i++) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(wait);
    const r = await page.evaluate(() => {
      const body = document.body.innerText || "";
      return {
        url: location.pathname + location.search,
        alerts: [...document.querySelectorAll('[role="alert"]')].map((e) => e.innerText.trim().slice(0, 200)),
        h1: [...document.querySelectorAll("h1,h2")].map((e) => e.innerText.trim()).slice(0, 6),
        is404: /This page doesn.t exist|404/.test(body),
        denied: /Access denied|You do not have permission|Forbidden/i.test(body),
        failed: /Couldn.t load|Something went wrong|Try again|Failed to/i.test(body),
        text: body.slice(0, 4000),
      };
    });
    last = { ...r, attempt: i + 1 };
    if (!r.failed && r.alerts.length === 0) return last;
    if (r.url.includes("/login")) throw new Error(`SESSION LOST probing ${route}`);
    console.log(`  ! ${route} looked like an error state on attempt ${i + 1}; retrying`);
    await page.waitForTimeout(2500);
  }
  console.log(`  !! ${route} STILL an error state after retries — reporting as observed`);
  return last;
}

export async function newCtx(browser, { width = 1440, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("    ! pageerror:", String(e).slice(0, 140)));
  return { ctx, page };
}

export { chromium, resolve };
