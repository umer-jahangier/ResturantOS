/* DIAGNOSIS ONLY — does the SuperAdmin platform console expose branches for a tenant? */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/branch-management");
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const TERRACE = "d108c2e6-a70d-49c8-acdc-37531fd752d8";
const log = [];
const rec = (k, v) => { log.push({ k, v }); console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v)); };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();

page.on("response", async (r) => {
  if (/\/api\/v1\/auth\/login/.test(r.url())) {
    let b = ""; try { b = (await r.text()).slice(0, 250); } catch {}
    rec("login-response", { s: r.status(), req: r.request().postData(), b });
  }
});
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
rec("login-form", await page.evaluate(() => ({
  inputs: Array.from(document.querySelectorAll("input")).map((i) => ({ name: i.name, type: i.type, ph: i.placeholder })),
  buttons: Array.from(document.querySelectorAll("button")).map((b) => b.innerText.trim()),
})));
const slug = page.locator('input[name="tenantSlug"], input[id*="tenant" i]').first();
if (await slug.count()) await slug.fill("").catch(() => {});
await page.locator('input[type="email"]').first().fill("superadmin@softxlogic.com");
await page.locator('input[type="password"]').first().fill("Test@123!");
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(5000);
rec("url", page.url());
rec("post-login-body", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 400));

// NAVIGATE BY CLICKING — a hard goto drops the SuperAdmin session (observed), which would
// have made every platform screenshot a picture of the login page.
const steps = [
  ["dashboard", null],
  ["tenants", "Manage tenants"],
  ["tenant-detail", "__ROW__"],
];
for (const [r, linkText] of steps) {
  if (linkText) {
    if (linkText === "__ROW__") { await page.getByText("Floating Terrace", { exact: true }).first().click({ force: true }); } else { await page.locator("a, button, tr, li").filter({ hasText: linkText }).first().click({ force: true }); }
    await page.waitForTimeout(3000);
  }
  const s = await page.evaluate(() => {
    const t = document.body.innerText || "";
    return {
      is404: /This page doesn.?t exist/i.test(t),
      denied: /Access denied/i.test(t),
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim().slice(0, 120)),
      branchWord: (t.match(/[^\n]*[Bb]ranch[^\n]*/g) || []).slice(0, 8),
      rooftop: /Rooftop/i.test(t),
      buttons: Array.from(document.querySelectorAll("button, a")).map((b) => b.innerText.trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, 30),
    };
  });
  rec("platform-route", { route: r, url: page.url(), ...s });
  await page.screenshot({ path: resolve(OUT, `platform-${r.replace(/\//g, "_")}.png`), fullPage: true });
}
writeFileSync(resolve(OUT, "transcript-platform.json"), JSON.stringify(log, null, 2));
await browser.close();
