/*
 * DIAGNOSIS stage 7 — is the branch selection durable?
 *  switch -> CLIENT-SIDE nav (sidebar click)  : does it hold?
 *  switch -> F5 reload                        : does it hold?
 * Plus: the remaining per-branch config surfaces (receipt/printers, stations, terminals).
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/branches-users";
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });
const MANAGER = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };
const HQ = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03", ROOF = "c2d74ade-7ff8-4167-8cd0-131bfbdf4fba";
const log = [];
const rec = (k, v) => { log.push({ k, v }); console.log(`[${k}]`, typeof v === "string" ? v.slice(0, 700) : JSON.stringify(v).slice(0, 800)); };
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); };
function tokBranch(a) { if (!a?.startsWith("Bearer ")) return null; try { return JSON.parse(Buffer.from(a.slice(7).split(".")[1], "base64").toString()).branch_id; } catch { return "?"; } }
const tag = (i) => (i === HQ ? "HQ" : i === ROOF ? "ROOFTOP" : i);

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const page = await ctx.newPage();
  const calls = [];
  page.on("request", (r) => { if (r.url().includes("/api/v1/pos/tables")) calls.push({ url: r.url().replace("http://localhost:8080", ""), tok: tag(tokBranch(r.headers()["authorization"])) }); });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill(MANAGER.slug);
  await page.locator('input#email, input[name="email"]').first().fill(MANAGER.email);
  await page.locator('input#password, input[name="password"]').first().fill(MANAGER.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6500);

  // switch on the dashboard
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  const sw = page.locator('[aria-label="Switch branch"]');
  await sw.first().click();
  await page.waitForTimeout(1500);
  await page.locator('[role="menuitem"]:has-text("Rooftop")').first().click();
  await page.waitForTimeout(8000);
  rec("label-right-after-switch", await sw.first().innerText());

  // --- CLIENT-SIDE navigation: click the sidebar "Tables" link ---
  calls.length = 0;
  await page.locator('a[href="/app/tables"]').first().click();
  await page.waitForTimeout(8000);
  rec("label-after-clientside-nav", await page.locator('[aria-label="Switch branch"]').first().innerText().catch(() => "(gone)"));
  rec("tables-calls-after-clientside-nav", calls);
  const t1 = await page.locator("body").innerText();
  rec("tables-content-clientside", t1.slice(t1.indexOf("Add table"), t1.indexOf("Add table") + 300));
  await shot(page, "80-tables-after-clientside-nav");

  // --- F5 ---
  calls.length = 0;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  rec("label-after-F5", await page.locator('[aria-label="Switch branch"]').first().innerText().catch(() => "(gone)"));
  rec("tables-calls-after-F5", calls);
  const t2 = await page.locator("body").innerText();
  rec("tables-content-after-F5", t2.slice(t2.indexOf("Add table"), t2.indexOf("Add table") + 300));
  await shot(page, "81-tables-after-F5");

  // --- per-branch config surfaces ---
  for (const [route, name] of [["/app/stations", "82-stations"], ["/app/terminals", "83-terminals"]]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7000);
    const b = await page.locator("body").innerText();
    const i = b.indexOf("⌘K");
    rec(`route${route}`, { denied: /Access denied/i.test(b), is404: /This page doesn't exist/i.test(b), content: (i > 0 ? b.slice(i + 2) : b).slice(0, 700) });
    await shot(page, name);
  }
  writeFileSync(`${OUT}/transcript-7.json`, JSON.stringify(log, null, 2));
  await browser.close();
}
main();
