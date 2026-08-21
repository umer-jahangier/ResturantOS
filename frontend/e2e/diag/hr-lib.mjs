/* Shared login + shot helpers for the HR/payroll diagnosis. Scratch only — no product code. */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const BASE = "http://localhost:3000";
export const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/hr-payroll";

export const PERSONAS = {
  owner: {
    slug: "floating-terrace",
    email: "owner@terrace.local",
    password: "Terrace#Owner1",
    totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
  },
  admin: {
    slug: "floating-terrace",
    email: "admin@terrace.local",
    password: "Terrace#Admin1",
    totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS",
  },
  manager: {
    slug: "floating-terrace",
    email: "manager@terrace.local",
    password: "Terrace#Manager1",
  },
  accountant: {
    slug: "floating-terrace",
    email: "accountant@terrace.local",
    password: "Terrace#Accountant1",
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
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export async function login(page, p) {
  let last;
  for (let i = 1; i <= 4; i++) {
    try {
      return await loginOnce(page, p);
    } catch (e) {
      last = e;
      console.log(`  [login retry ${i}] ${String(e).slice(0, 160)}`);
      await page.waitForTimeout(4000);
    }
  }
  throw last;
}

async function loginOnce(page, p) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slugField = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slugField.count()) await slugField.first().fill(p.slug);
  await page.locator('input[name="email"], input#email').first().fill(p.email);
  await page.locator('input[name="password"], input#password').first().fill(p.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  const totpField = page.locator('input[name="totpCode"], input#totpCode');
  if (await totpField.count()) {
    if (!p.totpSecret) throw new Error(`TOTP asked for ${p.email} but no secret configured`);
    await totpField.first().fill(totpNow(p.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4000);
  }
  if (page.url().includes("/login")) {
    const body = await page.locator("body").innerText();
    throw new Error(`login failed for ${p.email}: ${body.slice(0, 300)}`);
  }
  return true;
}

export async function shot(page, name) {
  const file = `${OUT}/${name}.png`;
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: true });
  console.log("  shot ->", `${name}.png`);
}

export async function newBrowser() {
  return chromium.launch();
}

export async function ctxPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("    ! pageerror:", String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") console.log("    ! console:", m.text().slice(0, 200)); });
  return { ctx, page };
}

/** Visit a route, retry once on an error state, report honestly. */
export async function visit(page, route, { waitMs = 4000, persona = null } = {}) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(waitMs);
    if (page.url().includes("/login")) {
      console.log(`  [BOOTED TO LOGIN] ${route} — url ${page.url()}`);
      if (persona) { await page.waitForTimeout(5000); await login(page, persona); continue; }
    }
    const body = await page.locator("body").innerText();
    const alerts = await page.locator('[role="alert"]').allInnerTexts();
    const denied = /Access denied|You do not have permission|not permitted/i.test(body);
    const failed = alerts.length > 0 || /Couldn'?t load|Something went wrong/i.test(body);
    if ((denied || failed) && attempt === 1) {
      console.log(`  [retry] ${route} showed ${denied ? "ACCESS-DENIED" : "ERROR"} — retrying`);
      continue;
    }
    return { body, alerts, denied, failed };
  }
}
