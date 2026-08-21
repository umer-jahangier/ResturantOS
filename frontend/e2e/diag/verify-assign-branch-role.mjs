/* DIAGNOSIS ONLY — complete a per-branch role assignment in the UI and prove it persisted. */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/branch-management");
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const TARGET = "bartender.proof@terrace.local"; // an abandoned probe account left by an earlier agent
const P = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };

function b32(i) { const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let b = 0, v = 0; const o = []; for (const c of i.replace(/=+$/, "").toUpperCase()) { const x = a.indexOf(c); if (x === -1) continue; v = (v << 5) | x; b += 5; if (b >= 8) { o.push((v >>> (b - 8)) & 0xff); b -= 8; } } return Buffer.from(o); }
function totpNow(s) { const k = b32(s), c = Math.floor(Date.now() / 1000 / 30), b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4); const h = createHmac("sha1", k).update(b).digest(), o = h[h.length - 1] & 0xf; return String((((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff)) % 1e6).padStart(6, "0"); }

const log = [];
const rec = (k, v) => { log.push({ k, v }); console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v)); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const net = [];
page.on("response", async (r) => {
  if (/branch-roles/.test(r.url())) { let b = ""; try { b = (await r.text()).slice(0, 300); } catch {} net.push({ m: r.request().method(), s: r.status(), req: r.request().postData(), b }); }
});

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
const slug = page.locator('input[name="tenantSlug"], input[id*="tenant" i]').first();
if (await slug.count()) await slug.fill(P.slug).catch(() => {});
await page.locator('input[type="email"]').first().fill(P.email);
await page.locator('input[type="password"]').first().fill(P.password);
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(2500);
for (let i = 0; i < 4 && /\/login/.test(page.url()); i++) {
  const otp = page.locator('input[name="totpCode"], input[autocomplete="one-time-code"], input[inputmode="numeric"]').first();
  if (await otp.count()) { await otp.fill(""); await otp.fill(totpNow(P.totpSecret)); await page.locator('button[type="submit"]').first().click(); }
  await page.waitForTimeout(3200);
}
if (/\/login/.test(page.url())) { rec("LOGIN-FAILED", page.url()); await browser.close(); process.exit(1); }

async function openTarget() {
  await page.goto(`${BASE}/app/users`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.getByText(TARGET, { exact: true }).first().click({ force: true });
  await page.waitForTimeout(2500);
}
async function rolesBlock() {
  return page.evaluate(() => {
    const h = Array.from(document.querySelectorAll("h3")).find((n) => /Roles by branch/i.test(n.innerText));
    return h?.parentElement?.innerText.replace(/\s+/g, " ").slice(0, 400) ?? null;
  });
}

await openTarget();
rec("roles-BEFORE", await rolesBlock());

await page.locator("button").filter({ hasText: /^Assign role$/ }).first().click();
await page.waitForTimeout(1800);
const sels = page.locator('[role="dialog"] select');
rec("select-count", await sels.count());
await sels.nth(0).selectOption({ label: "Floating Terrace — Rooftop" });
await page.waitForTimeout(700);
await sels.nth(1).selectOption({ label: "Cashier" });
await page.waitForTimeout(900);
rec("dialog-after-pick", await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText.replace(/\s+/g, " ").slice(0, 600)));
await page.screenshot({ path: resolve(OUT, "assign-01-filled.png"), fullPage: true });
await page.locator('[role="dialog"] button').filter({ hasText: /^Assign role$/ }).first().click();
await page.waitForTimeout(3500);
rec("assign-network", net.slice());
rec("assign-toasts", await page.evaluate(() => Array.from(document.querySelectorAll("[data-sonner-toast]")).map((n) => n.innerText.replace(/\s+/g, " "))));
await page.screenshot({ path: resolve(OUT, "assign-02-after.png"), fullPage: true });

// HARD reload and re-read
await openTarget();
const after = await rolesBlock();
rec("roles-AFTER-RELOAD", after);
rec("PERSISTED", /Rooftop/i.test(after || ""));

// Is there any control to take the role away again?
rec("revoke-controls", await page.evaluate(() => {
  const h = Array.from(document.querySelectorAll("h3")).find((n) => /Roles by branch/i.test(n.innerText));
  const sec = h?.parentElement;
  return {
    buttonsInsideRolesBlock: sec ? Array.from(sec.querySelectorAll("button")).map((b) => b.innerText.trim()) : null,
    panelButtons: Array.from(document.querySelectorAll("aside button, [class*=panel] button")).map((b) => b.innerText.trim()).filter(Boolean).slice(-12),
    anyRevokeText: /revoke|remove role|unassign/i.test(document.body.innerText),
  };
}));
await page.screenshot({ path: resolve(OUT, "assign-03-revoke-check.png"), fullPage: true });

writeFileSync(resolve(OUT, "transcript-assign.json"), JSON.stringify({ log, net }, null, 2));
await browser.close();
