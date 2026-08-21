// DIAGNOSIS ONLY — the OWNER is the persona who would choose a loyalty model.
// Enumerate every surface the owner can reach that touches CRM/loyalty/rewards/subscriptions.
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/crm-loyalty");
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });

const OWNER = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };
const log = [];
const say = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); say("   shot:", n + ".png"); };

function b32(input) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const o = [];
  for (const c of input.replace(/=+$/, "").toUpperCase()) { const i = A.indexOf(c); if (i === -1) continue; v = (v << 5) | i; bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 0xff); bits -= 8; } }
  return Buffer.from(o);
}
function totpNow(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30); const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0); buf.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", b32(secret)).update(buf).digest(); const off = h[h.length - 1] & 0x0f;
  const code = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill(OWNER.slug);
  await page.locator('input[name="email"], input#email').first().fill(OWNER.email);
  await page.locator('input[name="password"], input#password').first().fill(OWNER.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  const t = page.locator('input[name="totpCode"], input#totpCode');
  if (await t.count()) { await t.first().fill(totpNow(OWNER.totpSecret)); await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(5000); }
  return !page.url().includes("/login");
}

async function visit(page, name, route) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  let body = await page.locator("body").innerText().catch(() => "");
  let alerts = await page.locator('[role="alert"]').count();
  if (alerts > 0 || /couldn'?t load|something went wrong/i.test(body)) {
    say(`   !! ${route} error state — RETRY`);
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(5500);
    body = await page.locator("body").innerText().catch(() => ""); alerts = await page.locator('[role="alert"]').count();
  }
  const denied = /Access denied|You do not have permission/i.test(body);
  const nf = /404|This page could not be found/i.test(body);
  say(`-- ${name} ${route} :: denied=${denied} 404=${nf} alerts=${alerts}`);
  say("   TEXT >>>", body.replace(/\n/g, " | ").slice(0, 1100));
  await shot(page, name);
  return { body, denied, nf };
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  say("owner login:", await login(page), page.url());

  const nav = await page.locator("nav, aside").first().innerText().catch(() => "");
  say("OWNER SIDEBAR >>>", nav.replace(/\n/g, " | "));

  const s = await visit(page, "owner-settings", "/app/settings");
  say("settings mentions loyalty/rewards/promotions/subscription/campaign?",
    /loyalt|reward|promotion|campaign|subscription|membership|referral|cashback|punch|voucher|gift/i.test(s.body));
  const settingsLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll("main a[href], main button")).map(e => `${e.tagName}:${(e.textContent || "").trim().slice(0, 60)}`).filter(x => x.length > 8));
  say("SETTINGS ENTRIES >>>", JSON.stringify(settingsLinks));

  await visit(page, "owner-crm", "/app/crm");
  for (const [n, r] of [
    ["owner-crm-loyalty", "/app/crm/loyalty"],
    ["owner-crm-promotions", "/app/crm/promotions"],
    ["owner-crm-campaigns", "/app/crm/campaigns"],
    ["owner-crm-segments", "/app/crm/segments"],
    ["owner-crm-feedback", "/app/crm/feedback"],
    ["owner-settings-loyalty", "/app/settings/loyalty"],
    ["owner-marketing", "/app/marketing"],
    ["owner-subscriptions", "/app/subscriptions"],
  ]) await visit(page, n, r);

  await ctx.close(); await browser.close();
  writeFileSync(`${OUT}/owner-log.txt`, log.join("\n"));
}
main().catch((e) => { console.error(e); writeFileSync(`${OUT}/owner-log.txt`, log.join("\n") + "\nFATAL " + e); process.exit(1); });
