/* HR red-team lib. Uniquely named — a sibling agent clobbered rt-lib.mjs mid-run. */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const BASE = "http://localhost:3000";
export const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/hr-payroll-redteam";

export const P = {
  owner: { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" },
  admin: { slug: "floating-terrace", email: "admin@terrace.local", password: "Terrace#Admin1", totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS" },
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  accountant: { slug: "floating-terrace", email: "accountant@terrace.local", password: "Terrace#Accountant1", totpSecret: "2XPUJEA7F6YYOV4P7ME5OH6PUBJWTV5C" },
};

function b32(input) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0; const out = [];
  for (const c of input.replace(/=+$/, "").toUpperCase()) {
    const i = A.indexOf(c); if (i === -1) continue;
    value = (value << 5) | i; bits += 5;
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
  const code = ((h[o] & 0x7f) << 24) | ((h[o+1] & 0xff) << 16) | ((h[o+2] & 0xff) << 8) | (h[o+3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}
export async function login(page, p, tries = 5) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try { return await loginOnce(page, p); }
    catch (e) { last = e; console.log(`  [login retry ${i}] ${String(e).slice(0,160)}`); await page.waitForTimeout(6000 + i*3000); }
  }
  throw last;
}
async function loginOnce(page, p) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(p.slug);
  await page.locator('input[name="email"], input#email').first().fill(p.email);
  await page.locator('input[name="password"], input#password').first().fill(p.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3500);
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    if (!p.totpSecret) throw new Error(`TOTP demanded for ${p.email}`);
    await totp.first().fill(totpNow(p.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4500);
  }
  if (page.url().includes("/login")) {
    const b = await page.locator("body").innerText().catch(() => "");
    throw new Error(`login failed ${p.email}: ${b.slice(0,180)}`);
  }
  console.log(`  logged in ${p.email}`);
  return true;
}
export async function shot(page, name) {
  const f = `${OUT}/${name}.png`;
  mkdirSync(dirname(f), { recursive: true });
  await page.screenshot({ path: f, fullPage: true }).catch(() => {});
  console.log("  shot ->", `${name}.png`);
}
export async function newPage() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("    ! pageerror:", String(e).slice(0,160)));
  return { browser, ctx, page };
}
export async function visit(page, route, { persona = null, waitMs = 4500, tries = 3 } = {}) {
  let state = null;
  for (let a = 1; a <= tries; a++) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(waitMs);
    if (page.url().includes("/login")) {
      console.log(`  [BOUNCED TO LOGIN] ${route}`);
      if (persona) { await page.waitForTimeout(5000); await login(page, persona); continue; }
    }
    const body = await page.locator("body").innerText().catch(() => "");
    const denied = /Access denied|You do not have permission|not permitted/i.test(body);
    const notfound = /This page doesn'?t exist/i.test(body);
    const broken = /Couldn'?t load|Something went wrong|Failed to fetch|Unable to load/i.test(body);
    state = { url: page.url(), body, denied, notfound, broken };
    if (broken && a < tries) { console.log(`  [retry ${a}] ${route} error state`); continue; }
    return state;
  }
  return state;
}
