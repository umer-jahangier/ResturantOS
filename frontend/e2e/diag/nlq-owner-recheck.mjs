/*
 * Owner-persona re-audit: branch switching on reports, the dashboard chart, the settings
 * sweep for an AI provider picker, and NLQ. Diagnose only.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/nlq-analytics-recheck";
const BASE = "http://localhost:3000";
const OWNER = {
  slug: "floating-terrace",
  email: "owner@terrace.local",
  password: "Terrace#Owner1",
  totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
};
mkdirSync(OUT, { recursive: true });
const out = [];

function base32Decode(input) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0; const o = [];
  for (const c of input.replace(/=+$/, "").toUpperCase()) {
    const i = A.indexOf(c); if (i === -1) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { o.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(o);
}
function totpNow(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const b = Buffer.alloc(8);
  b.writeUInt32BE(Math.floor(counter / 2 ** 32), 0); b.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", base32Decode(secret)).update(b).digest();
  const off = h[h.length - 1] & 0x0f;
  const code = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}
const snap = (page) => page.evaluate(() => {
  const t = document.body.innerText;
  return {
    url: location.href,
    alerts: Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).map((n) => n.innerText.trim()).filter(Boolean),
    accessDenied: /access denied|do not have permission/i.test(t),
    notFound: /this page doesn'?t exist/i.test(t),
    tableRows: document.querySelectorAll("table tbody tr").length,
    trendChart: document.querySelectorAll('[data-testid="trend-chart"]').length,
    polylinePoints: Array.from(document.querySelectorAll('[data-testid="trend-chart"] polyline')).map((p) => (p.getAttribute("points") || "").trim().split(/\s+/).length),
    mainText: t.slice(t.indexOf("⌘K") + 2, t.indexOf("⌘K") + 2400),
    fullText: t,
  };
});
const shot = async (page, n) => { const f = `${OUT}/owner-${n}.png`; await page.screenshot({ path: f, fullPage: true }); return f; };

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  const net = [];
  page.on("response", (r) => { if (r.status() >= 400 && /\/api\//.test(r.url())) net.push(`${r.status()} ${r.request().method()} ${r.url()}`); });

  // The owner login is flaky: the SAME request returns 401 TOTP_REQUIRED, 409
  // CONCURRENT_MODIFICATION or 429 non-deterministically, and only the 401 renders the
  // authenticator field. Retry so a transient 409 is not mistaken for "no TOTP support".
  let attempts = 0;
  for (;;) {
    if (attempts >= 6) break;
    attempts++;
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1600);
    await page.locator('input[name="email"], input#email').first().fill(OWNER.email);
    await page.locator('input[name="password"], input#password').first().fill(OWNER.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4000);
    const totp = page.locator('input[name="totpCode"], input#totpCode, input[name="totp"]');
    if (await totp.count()) {
      await totp.first().fill(totpNow(OWNER.totpSecret));
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(6000);
    }
    if (!page.url().includes("/login")) break;
    console.log(`  login attempt ${attempts} failed: ${(await page.evaluate(() => document.body.innerText)).replace(/\n+/g, " / ").slice(0, 200)}`);
    await page.waitForTimeout(20000); // the endpoint rate-limits hard
  }
  console.log(`owner url after ${attempts} attempt(s):`, page.url());
  if (page.url().includes("/login")) { console.log("LOGIN FAILED"); await browser.close(); return; }

  // --- dashboard: how many points does the chart actually have? ---
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  let s = await snap(page);
  console.log("dashboard trendChart=", s.trendChart, "polylinePoints=", JSON.stringify(s.polylinePoints));
  out.push({ probe: "owner-dashboard", trendChart: s.trendChart, polylinePoints: s.polylinePoints, screenshot: await shot(page, "01-dashboard"), text: s.mainText });

  // --- settings sweep for an AI provider / model picker ---
  await page.goto(`${BASE}/app/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  s = await snap(page);
  const aiHit = /claude|anthropic|gemini|openai|gpt|\bllm\b|ai provider|language model/i.test(s.fullText);
  const settingsLinks = await page.evaluate(() => Array.from(document.querySelectorAll("main a, a")).map((a) => `${a.innerText.trim()} -> ${a.getAttribute("href")}`).filter((x) => x.trim() && !x.startsWith("->")));
  console.log("settings denied=", s.accessDenied, "aiMention=", aiHit);
  console.log("settings links:", JSON.stringify(settingsLinks.slice(0, 60), null, 1));
  out.push({ probe: "owner-settings", accessDenied: s.accessDenied, aiMention: aiHit, links: settingsLinks, screenshot: await shot(page, "02-settings"), text: s.mainText });

  // --- branch switcher: can the owner see the OTHER branch's report? ---
  await page.goto(`${BASE}/app/reports/sales-by-day`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  s = await snap(page);
  const before = { rows: s.tableRows, text: s.mainText };
  console.log("report BEFORE switch rows=", s.tableRows);
  await shot(page, "03-report-branch-hq");

  const switcher = page.locator('button:has-text("Floating Terrace HQ"), [aria-label*="branch" i], [data-testid*="branch" i]').first();
  let switched = false;
  if (await switcher.count()) {
    await switcher.click();
    await page.waitForTimeout(1500);
    await shot(page, "04-branch-menu-open");
    const menuText = await page.evaluate(() => document.body.innerText.slice(-1500));
    console.log("branch menu tail:", menuText.replace(/\n+/g, " | ").slice(0, 400));
    const roof = page.locator('[role="option"]:has-text("Rooftop"), [role="menuitem"]:has-text("Rooftop"), li:has-text("Rooftop"), button:has-text("Rooftop")').first();
    if (await roof.count()) {
      await roof.click();
      switched = true;
      await page.waitForTimeout(6000);
    } else {
      console.log("NO Rooftop option found in the open switcher");
    }
  } else {
    console.log("NO branch switcher control found");
  }
  await page.waitForTimeout(2000);
  s = await snap(page);
  console.log("report AFTER switch url=", s.url, "rows=", s.tableRows, "alerts=", JSON.stringify(s.alerts));
  out.push({ probe: "owner-report-branch-switch", switched, before, after: { rows: s.tableRows, alerts: s.alerts, url: s.url, text: s.mainText }, screenshot: await shot(page, "05-report-branch-rooftop") });

  // --- NLQ as owner ---
  await page.goto(`${BASE}/app/nlq`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const box = page.locator("textarea").first();
  if (await box.count()) {
    await box.fill("Compare revenue this month against last month by branch");
    await page.locator('button:has-text("Ask"), button[type="submit"]').first().click();
    await page.waitForTimeout(10000);
  }
  s = await snap(page);
  console.log("owner NLQ alerts:", JSON.stringify(s.alerts), "rows=", s.tableRows);
  out.push({ probe: "owner-nlq", alerts: s.alerts, rows: s.tableRows, screenshot: await shot(page, "06-nlq"), text: s.mainText });

  writeFileSync(`${OUT}/owner-findings2.json`, JSON.stringify({ net, out }, null, 2));
  console.log("\nAPI failures:", JSON.stringify(net.slice(0, 40), null, 2));
  await browser.close();
}
main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(1); });
