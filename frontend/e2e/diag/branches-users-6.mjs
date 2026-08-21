/*
 * DIAGNOSIS stage 6 — network ground truth for the branch switch.
 * Records every /api/ request+response around a switch, and the branch_id inside the bearer token
 * actually being sent, so "the switcher changed label" can be told apart from "the app re-scoped".
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/branches-users";
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });
const MANAGER = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };
const HQ = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
const ROOF = "c2d74ade-7ff8-4167-8cd0-131bfbdf4fba";

const log = [];
const rec = (k, v) => { log.push({ k, v }); console.log(`[${k}]`, typeof v === "string" ? v.slice(0, 800) : JSON.stringify(v).slice(0, 900)); };
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); };

function tokBranch(auth) {
  if (!auth?.startsWith("Bearer ")) return null;
  try { const p = auth.slice(7).split(".")[1]; return JSON.parse(Buffer.from(p, "base64").toString()).branch_id; } catch { return "unparseable"; }
}
const tag = (id) => (id === HQ ? "HQ" : id === ROOF ? "ROOFTOP" : id);

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const page = await ctx.newPage();

  const calls = [];
  page.on("request", (r) => {
    if (!r.url().includes("/api/")) return;
    calls.push({ t: Date.now(), method: r.method(), url: r.url().replace("http://localhost:8080", ""), tokenBranch: tag(tokBranch(r.headers()["authorization"])) });
  });
  page.on("response", async (r) => {
    if (!r.url().includes("/api/")) return;
    const c = calls.find((x) => x.url === r.url().replace("http://localhost:8080", "") && !x.status);
    if (c) { c.status = r.status(); if (r.url().includes("tables")) c.bodyHead = (await r.text().catch(() => "")).slice(0, 200); }
  });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill(MANAGER.slug);
  await page.locator('input#email, input[name="email"]').first().fill(MANAGER.email);
  await page.locator('input#password, input[name="password"]').first().fill(MANAGER.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);

  await page.goto(`${BASE}/app/tables`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  calls.length = 0;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  rec("BEFORE-switch tables calls", calls.filter((c) => c.url.includes("table")));
  const beforeText = await page.locator("body").innerText();
  rec("BEFORE-switch tables screen", beforeText.slice(beforeText.indexOf("Tables"), beforeText.indexOf("Tables") + 500));
  await shot(page, "70-tables-before-switch");

  // switch
  calls.length = 0;
  const sw = page.locator('[aria-label="Switch branch"]');
  await sw.first().click();
  await page.waitForTimeout(1500);
  await page.locator('[role="menuitem"]:has-text("Rooftop")').first().click();
  await page.waitForTimeout(9000);
  rec("switch-call", calls.filter((c) => c.url.includes("switch")));
  rec("switcher-label-after", await sw.first().innerText().catch(() => "(gone)"));
  rec("calls-during-switch", calls.map((c) => `${c.status} ${c.method} ${c.url} [tok=${c.tokenBranch}]`).slice(0, 25));
  await shot(page, "71-just-after-switch");

  // now reload the tables screen and see what it asks for
  calls.length = 0;
  await page.goto(`${BASE}/app/tables`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  rec("AFTER-switch tables calls", calls.filter((c) => c.url.includes("table")));
  const afterText = await page.locator("body").innerText();
  rec("AFTER-switch tables screen", afterText.slice(afterText.indexOf("Tables"), afterText.indexOf("Tables") + 500));
  rec("tables-screen-identical", beforeText === afterText);
  await shot(page, "72-tables-after-switch");

  // and a hard reload — does the branch survive a refresh at all?
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  rec("switcher-label-after-reload", await page.locator('[aria-label="Switch branch"]').first().innerText().catch(() => "(gone)"));
  await shot(page, "73-tables-after-reload");

  writeFileSync(`${OUT}/transcript-6.json`, JSON.stringify(log, null, 2));
  await browser.close();
}
main();
