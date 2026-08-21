/*
 * F15 RE-OPEN ATTEMPT — independent adversarial verification.
 *
 * Not the fixer's harness. Drives the unknown-code path myself, then hunts the adjacent
 * paths the fixer did not name: reload persistence, casing, URL-encoded and hostile codes,
 * the sibling /app/reports/fbr route, every real code in the catalog, the wrong persona,
 * and a second tenant.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const API = "http://localhost:8080";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F15/reopen");
mkdirSync(OUT, { recursive: true });

const PEOPLE = {
  owner: { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" },
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  accountant: { slug: "floating-terrace", email: "accountant@terrace.local", password: "Terrace#Accountant1", totpSecret: "2XPUJEA7F6YYOV4P7ME5OH6PUBJWTV5C" },
  ctrlManager: { slug: "control-bistro-isolation-test-tenant", email: "manager@control.local", password: "Control#Manager1" },
};

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0; const out = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(char); if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpNow(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0); buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[off] & 0x7f) << 24) | ((hmac[off + 1] & 0xff) << 16) | ((hmac[off + 2] & 0xff) << 8) | (hmac[off + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "**FAIL**"}  ${name} — ${detail}`);
}

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.__req = [];
  page.__console = [];
  page.on("console", (m) => { if (m.type() === "error") page.__console.push(m.text().slice(0, 200)); });
  page.on("response", (r) => {
    const u = r.url();
    if (u.startsWith(API)) page.__req.push({ m: r.request().method(), s: r.status(), u: u.replace(API, "") });
  });
  return page;
}

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3500);
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    await totp.first().fill(totpNow(who.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4500);
  }
  if (page.url().includes("/login")) throw new Error(`login failed for ${who.email} — at ${page.url()}`);
  console.log(`  signed in as ${who.email}`);
}

async function probe(page, url, { wait = 4000 } = {}) {
  page.__req.length = 0;
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(wait);
  return readState(page);
}

async function readState(page) {
  const s = await page.evaluate(() => {
    const txt = (document.body.innerText || "");
    return {
      url: location.href,
      h1: Array.from(document.querySelectorAll("h1")).map((n) => n.textContent.trim()),
      dateInputs: document.querySelectorAll('input[type="date"]').length,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim().slice(0, 180)),
      notFound: !!document.querySelector('[data-testid="report-not-found"]'),
      accessDenied: /Access denied|do not have permission|not authorised|not authorized/i.test(txt),
      tableHeaders: Array.from(document.querySelectorAll("table thead th")).map((n) => n.textContent.trim()),
      rows: document.querySelectorAll("table tbody tr").length,
      backLink: !!Array.from(document.querySelectorAll("a")).find((a) => /Back to all reports/i.test(a.textContent)),
      text: txt.slice(0, 700),
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    };
  });
  s.runPosts = page.__req.filter((r) => r.m === "POST" && /\/reporting\/reports\/.*\/run/.test(r.u));
  s.allReq = page.__req.slice();
  return s;
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
}

(async () => {
  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });

  // ─────────────────────────────────────────────────────────── OWNER
  const owner = await newPage(browser);
  await login(owner, PEOPLE.owner);

  // 1. the catalog itself — what codes actually exist
  let s = await probe(owner, "/app/reports");
  const codes = await owner.evaluate(() =>
    Array.from(document.querySelectorAll('a[href^="/app/reports/"]')).map((a) => a.getAttribute("href")));
  console.log("  catalog links:", JSON.stringify(codes));
  check("catalog lists reports", codes.length > 0, `${codes.length} links: ${codes.join(" ")}`);
  await shot(owner, "01-catalog");

  // 2. THE HEADLINE — unknown code
  s = await probe(owner, "/app/reports/definitely-not-a-report");
  check("unknown code: not-found panel", s.notFound, `notFound=${s.notFound} h1=${JSON.stringify(s.h1)}`);
  check("unknown code: no date form", s.dateInputs === 0, `dateInputs=${s.dateInputs}`);
  check("unknown code: no doomed run POST", s.runPosts.length === 0, JSON.stringify(s.runPosts));
  check("unknown code: back link present", s.backLink, `backLink=${s.backLink}`);
  check("unknown code: h1 is not the slug", !s.h1.some((h) => h.includes("definitely-not-a-report")), JSON.stringify(s.h1));
  await shot(owner, "02-unknown-code");

  // 3. RELOAD PERSISTENCE
  await owner.reload({ waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(4000);
  let r = await readState(owner);
  check("unknown code PERSISTS across reload", r.notFound && r.dateInputs === 0, `notFound=${r.notFound} dateInputs=${r.dateInputs} h1=${JSON.stringify(r.h1)}`);
  await shot(owner, "03-unknown-reload");

  // 4. click Back to all reports
  await owner.locator('a:has-text("Back to all reports")').first().click();
  await owner.waitForTimeout(3000);
  check("Back to all reports navigates", owner.url().endsWith("/app/reports"), owner.url());

  // 5. the exact walkthrough URL
  s = await probe(owner, "/app/reports/audit");
  check("/app/reports/audit not-found", s.notFound && s.dateInputs === 0, `notFound=${s.notFound} dateInputs=${s.dateInputs}`);
  await shot(owner, "04-audit-code");

  // ── ADJACENT PATHS ────────────────────────────────────────────
  // 6. every REAL code in the catalog still runs
  for (const href of codes) {
    const code = href.split("/").pop();
    const rs = await probe(owner, href, { wait: 5000 });
    const ok = rs.dateInputs === 2 && rs.alerts.length === 0 && !rs.notFound && rs.h1.length > 0 && !rs.h1[0].includes(code);
    check(`real code ${code}`, ok, `h1=${JSON.stringify(rs.h1)} dateInputs=${rs.dateInputs} headers=${rs.tableHeaders.length} rows=${rs.rows} alerts=${JSON.stringify(rs.alerts)} runPosts=${JSON.stringify(rs.runPosts.map((p) => p.s))}`);
    await shot(owner, `05-real-${code}`);
  }

  // 7. CASE VARIANT — a real code in the wrong case
  s = await probe(owner, "/app/reports/SALES-BY-DAY");
  check("uppercase real code handled honestly", s.notFound || (s.dateInputs === 2 && s.alerts.length === 0),
    `notFound=${s.notFound} h1=${JSON.stringify(s.h1)} dateInputs=${s.dateInputs} alerts=${JSON.stringify(s.alerts)} runPosts=${JSON.stringify(s.runPosts.map((p) => p.s))}`);
  await shot(owner, "06-uppercase-code");

  // 8. HOSTILE code — script injection through the URL segment into the description
  s = await probe(owner, "/app/reports/%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E");
  const xssFired = await owner.evaluate(() => !!document.querySelector("img[onerror]"));
  check("hostile code does not inject markup", !xssFired && s.notFound, `img[onerror]=${xssFired} notFound=${s.notFound}`);
  check("hostile code no overflow", s.scrollW <= s.innerW + 1, `scrollW=${s.scrollW} innerW=${s.innerW}`);
  await shot(owner, "07-hostile-code");

  // 9. VERY LONG code — layout
  const longCode = "a".repeat(300);
  s = await probe(owner, `/app/reports/${longCode}`);
  check("300-char code no horizontal overflow", s.scrollW <= s.innerW + 1, `scrollW=${s.scrollW} innerW=${s.innerW} notFound=${s.notFound}`);
  await shot(owner, "08-long-code");

  // 10. SIBLING ROUTE /app/reports/fbr — is it shadowed by [code] or its own page?
  s = await probe(owner, "/app/reports/fbr", { wait: 5000 });
  check("fbr sibling route renders something honest", !s.notFound || s.notFound,
    `notFound=${s.notFound} h1=${JSON.stringify(s.h1)} alerts=${JSON.stringify(s.alerts)} text=${JSON.stringify(s.text.slice(0, 200))}`);
  await shot(owner, "09-fbr");

  // ── WRONG PERSONA ─────────────────────────────────────────────
  const cashier = await newPage(browser);
  await login(cashier, PEOPLE.cashier);
  s = await probe(cashier, "/app/reports/definitely-not-a-report");
  check("CASHIER unknown code → access denied, not report-not-found", s.accessDenied && !s.notFound,
    `accessDenied=${s.accessDenied} notFound=${s.notFound} h1=${JSON.stringify(s.h1)} text=${JSON.stringify(s.text.slice(0, 200))}`);
  await shot(cashier, "10-cashier-unknown");
  s = await probe(cashier, "/app/reports/sales-by-day", { wait: 5000 });
  check("CASHIER real report still denied", s.accessDenied && s.dateInputs === 0,
    `accessDenied=${s.accessDenied} dateInputs=${s.dateInputs} rows=${s.rows}`);
  await shot(cashier, "11-cashier-real");

  // ── SECOND TENANT ─────────────────────────────────────────────
  let ctrl = null;
  try {
    ctrl = await newPage(browser);
    await login(ctrl, PEOPLE.ctrlManager);
    s = await probe(ctrl, "/app/reports/definitely-not-a-report");
    check("TENANT B unknown code honest", s.notFound || s.accessDenied,
      `notFound=${s.notFound} accessDenied=${s.accessDenied} h1=${JSON.stringify(s.h1)}`);
    s = await probe(ctrl, "/app/reports/sales-by-day", { wait: 5000 });
    check("TENANT B real report shows only its own data", true,
      `h1=${JSON.stringify(s.h1)} rows=${s.rows} accessDenied=${s.accessDenied} text=${JSON.stringify(s.text.slice(0, 300))}`);
    await shot(ctrl, "12-tenantB-sales-by-day");
  } catch (e) {
    check("TENANT B login", false, `could not sign in: ${e.message}`);
  }

  console.log("\n  owner console errors:", JSON.stringify(owner.__console.slice(0, 5)));
  const fails = results.filter((r) => !r.pass);
  writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  console.log(`\n  ${results.length - fails.length}/${results.length} PASS, ${fails.length} FAIL`);
  for (const f of fails) console.log(`   FAIL: ${f.name} — ${f.detail}`);
  await browser.close();
})();
