/* DIAGNOSIS ONLY — per-branch staff: roster, filters, and assigning a role AT a branch, as OWNER. */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/branch-management");
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const P = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };

function b32(input) { const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const o = []; for (const c of input.replace(/=+$/, "").toUpperCase()) { const i = a.indexOf(c); if (i === -1) continue; v = (v << 5) | i; bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 0xff); bits -= 8; } } return Buffer.from(o); }
function totpNow(s) { const k = b32(s); const c = Math.floor(Date.now() / 1000 / 30); const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4); const h = createHmac("sha1", k).update(b).digest(); const o = h[h.length - 1] & 0xf; return String((((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff)) % 1e6).padStart(6, "0"); }

const log = [];
const rec = (k, v) => { log.push({ k, v }); console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v)); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const net = [];
page.on("response", async (r) => {
  const u = r.url();
  if (/\/api\/v1\/(users|branches|roles)/.test(u) && r.request().method() !== "GET") {
    let b = ""; try { b = (await r.text()).slice(0, 300); } catch {}
    net.push({ m: r.request().method(), u: u.replace("http://localhost:8080", ""), req: r.request().postData()?.slice(0, 200), s: r.status(), b });
  }
});

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
const slug = page.locator('input[name="tenantSlug"], input[id*="tenant" i]').first();
if (await slug.count()) await slug.fill(P.slug).catch(() => {});
await page.locator('input[type="email"], input[name="email"]').first().fill(P.email);
await page.locator('input[type="password"]').first().fill(P.password);
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(2500);
for (let i = 0; i < 4 && /\/login/.test(page.url()); i++) {
  const otp = page.locator('input[name="totpCode"], input[autocomplete="one-time-code"], input[inputmode="numeric"]').first();
  if (await otp.count()) { await otp.fill(""); await otp.fill(totpNow(P.totpSecret)); await page.locator('button[type="submit"]').first().click(); }
  await page.waitForTimeout(3200);
}
rec("url", page.url());
if (/\/login/.test(page.url())) { rec("LOGIN-FAILED", (await page.locator("body").innerText()).slice(0, 300)); await browser.close(); process.exit(1); }

await page.goto(`${BASE}/app/users`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
const h = await page.evaluate(() => ({
  alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
  headers: Array.from(document.querySelectorAll("th")).map((n) => n.innerText.trim()),
  rowCount: document.querySelectorAll("tbody tr").length,
  controls: Array.from(document.querySelectorAll("button, select, input")).map((n) => (n.innerText || n.getAttribute("placeholder") || n.getAttribute("name") || "").trim().replace(/\s+/g, " ")).filter(Boolean),
  bodyHasBranchWord: /Rooftop|HQ/i.test(document.querySelector("tbody")?.innerText || ""),
}));
rec("users-page", h);
await page.screenshot({ path: resolve(OUT, "staff-01-users.png"), fullPage: true });

// open the first user row -> detail panel
await page.getByText("manager@terrace.local", { exact: true }).first().click({ force: true });
rec("row-click", "clicked Terrace Manager");
await page.waitForTimeout(3500);
const detail = await page.evaluate(() => ({
  text: (document.body.innerText || "").slice(-2200),
  buttons: Array.from(document.querySelectorAll("button")).map((b) => b.innerText.trim().replace(/\s+/g, " ")).filter(Boolean).slice(-25),
}));
rec("user-detail", detail);
await page.screenshot({ path: resolve(OUT, "staff-02-detail.png"), fullPage: true });

// Try to assign a role at the ROOFTOP branch
const assignBtn = page.locator("button").filter({ hasText: /Assign role|Add role|Assign/i }).first();
rec("assign-button-present", await assignBtn.count());
if (await assignBtn.count()) {
  await assignBtn.click();
  await page.waitForTimeout(2000);
  const dlg = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      text: d.innerText.replace(/\s+/g, " ").slice(0, 700),
      selects: Array.from(d.querySelectorAll("select, [role=combobox], button[aria-haspopup]")).map((n) => (n.innerText || n.getAttribute("name") || "").trim().replace(/\s+/g, " ")),
    };
  });
  rec("assign-dialog", dlg);
  await page.screenshot({ path: resolve(OUT, "staff-03-assign-dialog.png"), fullPage: true });
}

writeFileSync(resolve(OUT, "transcript-staff.json"), JSON.stringify({ log, net }, null, 2));
await browser.close();
