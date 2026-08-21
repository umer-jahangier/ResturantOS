/*
 * DIAGNOSIS ONLY — the OWNER half of the NLQ/analytics audit.
 *
 * The manager persona gets "Access denied" on /app/settings, which is the exact trap that made a
 * whole settings area look "verified" for weeks. So the AI-provider/model settings question MUST
 * be asked as the OWNER, who holds rbac.manage. The owner is also the only persona whose
 * dashboard preset includes the single TrendChart in the product.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OUT = resolve("/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/nlq-reporting");
const BASE = "http://localhost:3000";
const OWNER = {
  slug: "floating-terrace",
  email: "owner@terrace.local",
  password: "Terrace#Owner1",
  totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
};

const findings = [];
const note = (k, v) => (findings.push({ k, v }), console.log(`  [${k}] ${v}`));

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const c of input.replace(/=+$/, "").toUpperCase()) {
    const i = alphabet.indexOf(c);
    if (i === -1) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpNow(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const code = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

async function shot(page, name) {
  const file = `${OUT}/${name}.png`;
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: true });
  console.log("   shot →", `${name}.png`);
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(OWNER.slug);
  await page.locator('input[name="email"], input#email').first().fill(OWNER.email);
  await page.locator('input[name="password"], input#password').first().fill(OWNER.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    await totp.first().fill(totpNow(OWNER.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4500);
  }
  return !page.url().includes("/login");
}

async function probe(page, route, ms = 6500) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(ms);
  const body = await page.locator("body").innerText().catch(() => "");
  const denied = /Access denied|You do not have permission/i.test(body);
  const notFound = /404|This page could not be found|not found/i.test(body);
  return { body, denied, notFound, url: page.url() };
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  const netFails = [];
  page.on("response", (r) => {
    if (r.status() >= 400 && /\/api\//.test(r.url())) netFails.push(`${r.status()} ${r.request().method()} ${r.url().replace("http://localhost:8080", "")}`);
  });

  if (!(await login(page))) { note("login", "FAILED as owner"); await shot(page, "OWNER-LOGIN-FAILED"); await browser.close(); return; }
  note("login", `signed in as owner → ${page.url()}`);

  // ---- Owner dashboard: the single chart in the product ----
  const dash = await probe(page, "/app/dashboard", 8000);
  const trend = await page.locator('[data-testid="trend-chart"]').count();
  const anySvgChart = await page.locator('[data-testid="trend-chart"] svg, svg.recharts-surface, canvas').count();
  note("owner-dashboard", `denied=${dash.denied} trendChart=${trend} chartSvg=${anySvgChart}`);
  note("owner-dashboard-body", dash.body.replace(/\s+/g, " ").slice(0, 1000));
  await shot(page, "10-owner-dashboard");

  // ---- Settings: is there ANY AI provider / model picker? ----
  const set = await probe(page, "/app/settings", 6000);
  note("owner-settings", `denied=${set.denied} notFound=${set.notFound}`);
  note("owner-settings-body", set.body.replace(/\s+/g, " ").slice(0, 1600));
  const providerHits = /claude|anthropic|gemini|openai|gpt|llm|ai provider|model/i.test(set.body);
  note("owner-settings-ai", `page mentions any AI provider/model word: ${providerHits}`);
  await shot(page, set.denied ? "ERROR-11-owner-settings" : "11-owner-settings");

  // enumerate every link reachable from settings, looking for an AI/NLQ area
  const links = await page.locator("a[href]").evaluateAll((els) => els.map((e) => `${e.textContent.trim().slice(0,40)} => ${e.getAttribute("href")}`));
  note("owner-settings-links", JSON.stringify(links.filter((l) => !/^$/.test(l))).slice(0, 1800));

  for (const route of ["/app/settings/ai", "/app/settings/nlq", "/app/settings/integrations", "/app/nlq/settings", "/app/settings/ai-provider"]) {
    const r = await probe(page, route, 3500);
    note(`route-exists:${route}`, `notFound=${r.notFound} denied=${r.denied} first120="${r.body.replace(/\s+/g," ").slice(0,120)}"`);
  }

  // ---- A real data report detail page (not FBR) ----
  const rep = await probe(page, "/app/reports/sales-by-day", 8000);
  const tables = await page.locator("table").count();
  const rows = await page.locator("tbody tr").count();
  const charts = await page.locator("svg.recharts-surface, canvas, [data-testid='trend-chart']").count();
  const exportCtl = await page.locator('button:has-text("Export"), button:has-text("CSV"), button:has-text("Download"), a[download]').count();
  note("report-sales-by-day", `denied=${rep.denied} notFound=${rep.notFound} tables=${tables} rows=${rows} charts=${charts} exportControls=${exportCtl}`);
  note("report-sales-by-day-body", rep.body.replace(/\s+/g, " ").slice(0, 1200));
  await shot(page, "12-report-sales-by-day");

  // ---- NLQ as owner (does the owner get a different NLQ?) ----
  const nlq = await probe(page, "/app/nlq", 5000);
  note("owner-nlq", `denied=${nlq.denied} notFound=${nlq.notFound}`);
  const box = page.locator("#nlq-question, textarea");
  if (await box.count()) {
    await box.first().fill("Compare revenue this month against last month by branch");
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(14000);
    const alerts = await page.locator('[role="alert"], [role="status"]').allInnerTexts();
    const chartsAfter = await page.locator("svg, canvas").count();
    const tablesAfter = await page.locator("table").count();
    note("owner-nlq-result", `alerts=${JSON.stringify(alerts).slice(0,300)} svgAnywhere=${chartsAfter} tables=${tablesAfter}`);
    await shot(page, "13-owner-nlq-comparison-question");
  }

  // ---- Realtime dashboard: is the socket actually live? ----
  await page.goto(`${BASE}/app/dashboard/realtime`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  const rtBody = await page.locator("body").innerText();
  const wsInfo = await page.evaluate(() => (window.__wsProbe ? window.__wsProbe : "n/a"));
  note("realtime", rtBody.replace(/\s+/g, " ").slice(0, 700));
  note("realtime-ws", String(wsInfo));
  await shot(page, "14-owner-realtime");

  note("failed-api-calls", JSON.stringify([...new Set(netFails)].slice(0, 40)));
  writeFileSync(`${OUT}/findings-owner.json`, JSON.stringify(findings, null, 2));
  await browser.close();
  console.log("\nevidence →", OUT);
}
main();
