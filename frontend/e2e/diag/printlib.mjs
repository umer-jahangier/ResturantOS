/* Shared login + guard helpers for the printing re-audit. DIAGNOSTIC ONLY. */
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const BASE = "http://localhost:3000";
export const GW = "http://localhost:8080";
export const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/printing-recheck";

export const USERS = {
  owner: { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" },
  admin: { slug: "floating-terrace", email: "admin@terrace.local", password: "Terrace#Admin1", totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS" },
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  kitchen: { slug: "floating-terrace", email: "kitchen@terrace.local", password: "Terrace#Kitchen1" },
  waiter: { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" },
};

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0; const out = [];
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
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

/** Instrument window.print BEFORE any app script runs. Counts calls, does not suppress side effects. */
export async function instrumentPrint(ctx) {
  await ctx.addInitScript(() => {
    window.__printCalls = 0;
    const orig = window.print?.bind(window);
    window.__origPrint = orig;
    // Replace so the harness does not hang on a modal OS dialog, but COUNT every call.
    window.print = function () { window.__printCalls = (window.__printCalls || 0) + 1; };
  });
}

/** Logs every auth POST status so a 429 is never mistaken for "feature missing". */
export function watchAuth(page, tag = "") {
  page.on("response", async (r) => {
    const s = r.status();
    if (s === 429) console.log(`  !! 429 RATE LIMITED ${tag} ${r.url().slice(0, 90)}`);
    if (/\/auth\/(login|refresh)/.test(r.url()) && r.request().method() === "POST")
      console.log(`  auth POST ${r.url().split("/api")[1]} -> ${s} ${tag}`);
  });
}

export async function login(page, who, { attempts = 3 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    const ok = await loginOnce(page, who);
    if (ok) return true;
    console.log(`  .. login attempt ${i}/${attempts} failed as ${who}; backing off 20s (TOTP window + limiter)`);
    await page.waitForTimeout(20000);
  }
  return false;
}

async function loginOnce(page, who) {
  const u = USERS[who];
  if (!u) throw new Error(`unknown persona ${who}`);
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(u.slug);
  await page.locator('input[name="email"], input#email').first().fill(u.email);
  await page.locator('input[name="password"], input#password').first().fill(u.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4000);
  // The password POST 401s when step-up is required; the form then reveals the code field.
  const totp = page.locator('input[name="totpCode"], input#totpCode, input[placeholder="123456"]');
  if (u.totpSecret) {
    await totp.first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  }
  if (await totp.count()) {
    await totp.first().fill(totpNow(u.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(5000);
  }
  const ok = !page.url().includes("/login");
  if (!ok) console.log(`  !! LOGIN FAILED as ${who}: url=${page.url()}`);
  return ok;
}

export async function shot(page, name) {
  const file = `${OUT}/${name}.png`;
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

/**
 * Visit with the two traps guarded: an error/alert state, and a refusal page.
 * Retries once on a transient error before believing what it sees.
 */
export async function visit(page, route, { settle = 4500, retries = 1 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(settle);
    const body = await page.locator("body").innerText().catch(() => "");
    const alerts = await page.locator('[role="alert"]').count();
    const errorish = /Couldn't load|Could not load|Something went wrong|try again/i.test(body);
    const refused = /Access denied|You do not have permission|not authori[sz]ed/i.test(body);
    const notfound = /This page doesn't exist|404|may not be built yet/i.test(body);
    if ((alerts > 0 || errorish) && attempt < retries) {
      console.log(`  .. transient error on ${route} (alerts=${alerts}); RETRYING`);
      await page.waitForTimeout(2500);
      continue;
    }
    return { body, alerts, errorish, refused, notfound, url: page.url() };
  }
}
