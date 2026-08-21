/*
 * ADVERSARIAL RE-AUDIT of "NLQ and the analytics dashboard".
 * Diagnose only. Writes screenshots + a findings JSON. Touches no product code.
 *
 * Every probe records: url, what was clicked, the visible text, whether [role=alert] was
 * present, and a RETRY if an error state was seen (an error screenshot is not evidence of
 * an empty product).
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/nlq-analytics-recheck";
const BASE = "http://localhost:3000";
const PERSONA = process.argv[2] ?? "manager";

const PEOPLE = {
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  owner: {
    slug: "floating-terrace",
    email: "owner@terrace.local",
    password: "Terrace#Owner1",
    totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
  },
  admin: {
    slug: "floating-terrace",
    email: "admin@terrace.local",
    password: "Terrace#Admin1",
    totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS",
  },
  superadmin: { slug: "", email: "superadmin@softxlogic.com", password: "Test@123!" },
};

const findings = [];
mkdirSync(OUT, { recursive: true });

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpNow(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[o] & 0x7f) << 24) | ((hmac[o + 1] & 0xff) << 16) | ((hmac[o + 2] & 0xff) << 8) | (hmac[o + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

async function shot(page, name) {
  const file = `${OUT}/${PERSONA}-${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function snapshot(page) {
  return page.evaluate(() => {
    const alerts = Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim());
    const text = document.body.innerText;
    return {
      url: location.href,
      alerts,
      hasAlert: alerts.length > 0,
      accessDenied: /access denied|you do not have permission|don't have permission/i.test(text),
      notFound: /this page doesn'?t exist|404/i.test(text),
      couldntLoad: /couldn'?t load|something went wrong|failed to load/i.test(text),
      svgCount: document.querySelectorAll("svg").length,
      // real chart marks, not icon glyphs
      chartMarks: document.querySelectorAll("svg polyline, svg path[d*='L'], svg rect[height]").length,
      trendChart: document.querySelectorAll('[data-testid="trend-chart"]').length,
      tableCount: document.querySelectorAll("table").length,
      tableRows: document.querySelectorAll("table tbody tr").length,
      buttons: Array.from(document.querySelectorAll("button")).map((b) => b.innerText.trim()).filter(Boolean),
      links: Array.from(document.querySelectorAll("a")).map((a) => a.innerText.trim()).filter(Boolean),
      textHead: text.slice(0, 2600),
      textLen: text.length,
    };
  });
}

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const slugField = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slugField.count()) {
    if (who.slug) await slugField.first().fill(who.slug);
    else await slugField.first().fill("");
  }
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  const totpField = page.locator('input[name="totpCode"], input#totpCode');
  if (await totpField.count()) {
    await totpField.first().fill(totpNow(who.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4000);
  }
  await page.waitForTimeout(1500);
  return !page.url().includes("/login");
}

/** Visit with automatic RETRY on an error state — a mid-failure shot is not evidence. */
async function visit(page, route, name, waitMs = 3500) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(waitMs);
  let snap = await snapshot(page);
  let retried = false;
  if (snap.hasAlert || snap.couldntLoad) {
    retried = true;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(waitMs + 2500);
    snap = await snapshot(page);
  }
  const file = await shot(page, name);
  findings.push({ probe: name, route, retried, ...snap, screenshot: file });
  console.log(`[${name}] ${route} alert=${snap.hasAlert} denied=${snap.accessDenied} 404=${snap.notFound} rows=${snap.tableRows} charts=${snap.chartMarks} retried=${retried}`);
  return snap;
}

async function main() {
  const who = PEOPLE[PERSONA];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  const netFails = [];
  page.on("response", (r) => {
    if (r.status() >= 400 && /\/api\//.test(r.url())) netFails.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });

  const ok = await login(page, who);
  console.log(`login as ${PERSONA}: ${ok} -> ${page.url()}`);
  if (!ok) { writeFileSync(`${OUT}/${PERSONA}-findings.json`, JSON.stringify({ loginFailed: true, url: page.url() }, null, 2)); await browser.close(); return; }
  await shot(page, "00-after-login");

  // ---------- 1. NLQ ----------
  const nlq = await visit(page, "/app/nlq", "01-nlq-initial");
  if (!nlq.accessDenied && !nlq.notFound) {
    const box = page.locator('textarea, input[type="text"]').first();
    const questions = [
      "What was total revenue last week?",
      "How many orders did we take yesterday?",
      "Show me the top 5 selling items this month",
    ];
    for (let i = 0; i < questions.length; i++) {
      if (await box.count()) {
        await box.fill(questions[i]);
        await page.waitForTimeout(300);
        const askBtn = page.locator('button:has-text("Ask"), button[type="submit"]').first();
        await askBtn.click();
        await page.waitForTimeout(9000);
        const after = await snapshot(page);
        const file = await shot(page, `02-nlq-q${i + 1}`);
        findings.push({ probe: `nlq-question-${i + 1}`, question: questions[i], route: "/app/nlq", ...after, screenshot: file });
        console.log(`  Q${i + 1} "${questions[i]}" -> alert=${after.hasAlert} rows=${after.tableRows} charts=${after.chartMarks} | ${after.alerts.join(" | ").slice(0, 200)}`);
      }
    }
  }

  // ---------- 2. Reports catalog + EVERY report ----------
  const cat = await visit(page, "/app/reports", "03-reports-catalog");
  const codes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href^="/app/reports/"]')).map((a) => ({
      href: a.getAttribute("href"),
      title: a.innerText.trim(),
    }))
  );
  console.log("report links:", JSON.stringify(codes));
  findings.push({ probe: "reports-catalog-links", links: codes });

  for (const c of codes) {
    const slug = c.href.replace("/app/reports/", "").replace(/\W+/g, "-");
    const s = await visit(page, c.href, `04-report-${slug}`, 4500);
    findings.push({ probe: `report-detail-${slug}`, title: c.title, rows: s.tableRows, charts: s.chartMarks, exportButtons: s.buttons.filter((b) => /export|download|csv|pdf|excel|print|share|schedule/i.test(b)) });
  }

  // widen the date range on one report to see if "no data" is a period artefact
  if (codes.length) {
    const target = codes.find((c) => /sales-by-day/.test(c.href)) ?? codes[0];
    await page.goto(`${BASE}${target.href}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    const from = page.locator('input[aria-label="Report period from"]');
    if (await from.count()) {
      await from.fill("2020-01-01");
      await page.waitForTimeout(4500);
      const s = await snapshot(page);
      const file = await shot(page, "05-report-widened-range");
      findings.push({ probe: "report-widened-range", target: target.href, rows: s.tableRows, textHead: s.textHead, screenshot: file });
      console.log(`widened range on ${target.href}: rows=${s.tableRows}`);
    }
  }

  // ---------- 3. Dashboards ----------
  await visit(page, "/app/dashboard", "06-dashboard", 5000);
  await visit(page, "/app/dashboard/realtime", "07-dashboard-realtime", 6000);
  await visit(page, "/app/purchasing/analytics", "08-purchasing-analytics", 4500);

  // ---------- 4. Settings / AI provider hunt ----------
  await visit(page, "/app/settings", "09-settings");
  for (const r of ["/app/settings/ai", "/app/settings/integrations", "/app/settings/nlq", "/app/settings/ai-provider", "/app/nlq/settings", "/app/settings/analytics", "/app/settings/reporting"]) {
    await visit(page, r, `10-probe${r.replace(/\//g, "-")}`, 2500);
  }

  writeFileSync(`${OUT}/${PERSONA}-findings.json`, JSON.stringify({ persona: PERSONA, netFails, findings }, null, 2));
  console.log("\nAPI failures observed:", JSON.stringify(netFails.slice(0, 40), null, 2));
  await browser.close();
}

main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(1); });
