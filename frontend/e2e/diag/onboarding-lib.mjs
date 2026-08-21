/*
 * Shared helpers for the tenant-onboarding / business-model-adaptivity diagnosis.
 * Diagnosis only — writes nothing into src/.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const BASE = "http://localhost:3000";
export const GW = "http://localhost:8080";
export const OUT = resolve(
  process.cwd(),
  "../.planning/audits/diagnosis/onboarding-config",
);

mkdirSync(OUT, { recursive: true });

export const PERSONAS = {
  superadmin: { slug: "", email: "superadmin@softxlogic.com", password: "Test@123!", totp: null },
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
  manager: {
    slug: "floating-terrace",
    email: "manager@terrace.local",
    password: "Terrace#Manager1",
    totp: null,
  },
  cashier: {
    slug: "floating-terrace",
    email: "cashier@terrace.local",
    password: "Terrace#Cashier1",
    totp: null,
  },
};

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
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
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export async function launch() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  [console.error]", m.text().slice(0, 180));
  });
  return { browser, ctx, page };
}

export async function login(page, key) {
  const p = PERSONAS[key];
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slugField = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if ((await slugField.count()) && p.slug) await slugField.first().fill(p.slug);
  await page.locator('input[name="email"], input#email').first().fill(p.email);
  await page.locator('input[name="password"], input#password').first().fill(p.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4000);
  const totpField = page.locator('input[name="totpCode"], input#totpCode');
  if (await totpField.count()) {
    if (!p.totp) throw new Error(`${key}: TOTP asked for but no secret`);
    await totpField.first().fill(totpNow(p.totp));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(6000);
  }
  for (let i = 0; i < 10 && page.url().includes("/login"); i++) await page.waitForTimeout(1500);
  const url = page.url();
  if (url.includes("/login")) {
    const body = (await page.locator("body").innerText()).slice(0, 400);
    throw new Error(`${key}: still on /login. Body: ${body}`);
  }
  console.log(`  signed in as ${key} -> ${url}`);
  return url;
}

/** Visit, retry once on an error state, screenshot, and report what was really on screen. */
export async function visit(page, route, name, opts = {}) {
  const go = async () => {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(opts.wait ?? 3500);
    return (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  };
  let text = await go();
  const bad = /Couldn't load|Could not load|Something went wrong|Unexpected error|Failed to load|500|Try again/i;
  const is404 = /404|This page could not be found|Page not found/i.test(text);
  if (bad.test(text) && !is404) {
    console.log(`  !! ${route} showed an error state — retrying`);
    await page.waitForTimeout(2500);
    text = await go();
  }
  const denied = /Access denied|You do not have permission|Not authorised|Not authorized/i.test(text);
  const alerts = await page.locator('[role="alert"]').count();
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: opts.fullPage ?? true });
  console.log(
    `  ${route} :: ${is404 ? "404" : denied ? "ACCESS-DENIED" : "rendered"} alerts=${alerts}`,
  );
  console.log(`     text: ${text.slice(0, opts.chars ?? 500)}`);
  return { text, is404, denied, alerts };
}

export async function tokenFor(key) {
  const p = PERSONAS[key];
  const body = { email: p.email, password: p.password };
  if (p.slug) body.tenantSlug = p.slug;
  let r = await fetch(`${GW}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let j = await r.json();
  if (j.accessToken) return j.accessToken;
  if (p.totp) {
    r = await fetch(`${GW}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, totpCode: totpNow(p.totp) }),
    });
    j = await r.json();
    if (j.accessToken) return j.accessToken;
  }
  throw new Error(`token for ${key}: ${JSON.stringify(j).slice(0, 300)}`);
}
