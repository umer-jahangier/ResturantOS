/* F15 re-open, leg 2 — owner only, paced, with a fresh login per burst. */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const API = "http://localhost:8080";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F15/reopen");
mkdirSync(OUT, { recursive: true });
const OWNER = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };

function b32(input) { const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const o = []; for (const c of input.replace(/=+$/, "").toUpperCase()) { const i = a.indexOf(c); if (i === -1) continue; v = (v << 5) | i; bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 0xff); bits -= 8; } } return Buffer.from(o); }
function totpNow(s) { const c = Math.floor(Date.now() / 1000 / 30); const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4); const h = createHmac("sha1", b32(s)).update(b).digest(); const off = h[h.length - 1] & 0x0f; const code = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff); return String(code % 1e6).padStart(6, "0"); }

const results = [];
const check = (n, p, d) => { results.push({ n, p, d }); console.log(`  ${p ? "PASS" : "**FAIL**"}  ${n} — ${d}`); };

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.__req = [];
  page.on("response", (r) => { const u = r.url(); if (u.startsWith(API)) page.__req.push({ m: r.request().method(), s: r.status(), u: u.replace(API, "").split("?")[0] }); });
  return page;
}
async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(4000);
  const t = page.locator('input[name="totpCode"], input#totpCode');
  if (await t.count()) { await t.first().fill(totpNow(who.totpSecret)); await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(5000); }
  if (page.url().includes("/login")) throw new Error(`login failed: ${page.url()}`);
  console.log(`  signed in as ${who.email}`);
}
async function readState(page) {
  const s = await page.evaluate(() => ({
    url: location.href,
    h1: Array.from(document.querySelectorAll("h1")).map((n) => n.textContent.trim()),
    dateInputs: document.querySelectorAll('input[type="date"]').length,
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim().slice(0, 200)),
    notFound: !!document.querySelector('[data-testid="report-not-found"]'),
    loggedOut: /Sign in to RestaurantOS/.test(document.body.innerText || ""),
    headers: Array.from(document.querySelectorAll("table thead th")).map((n) => n.textContent.trim()),
    rows: document.querySelectorAll("table tbody tr").length,
    injected: !!document.querySelector("img[onerror], [data-pwned]"),
    text: (document.body.innerText || "").slice(0, 400),
    scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
  }));
  s.runPosts = page.__req.filter((r) => r.m === "POST" && /\/reporting\/reports\/.*\/run/.test(r.u));
  return s;
}
async function probe(page, url, wait = 5500) {
  page.__req.length = 0;
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(wait);
  let s = await readState(page);
  if (s.loggedOut) { console.log(`    ! logged out at ${url}, re-login + retry`); await login(page, OWNER); page.__req.length = 0; await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(wait); s = await readState(page); }
  return s;
}

(async () => {
  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
  const p = await newPage(browser);
  await login(p, OWNER);

  // API catalog, straight from the gateway through the browser's own session
  const catalog = await p.evaluate(async () => {
    const res = await fetch("/api/reporting/reports").catch(() => null);
    return res ? { status: res.status, body: await res.text() } : null;
  });
  console.log("  in-page /api/reporting/reports:", JSON.stringify(catalog).slice(0, 400));

  const remaining = ["sales-by-order-type", "discount-summary", "till-sessions", "purchases-by-po"];
  for (const code of remaining) {
    const s = await probe(p, `/app/reports/${code}`);
    const ok = !s.loggedOut && s.dateInputs === 2 && s.alerts.length === 0 && !s.notFound && s.h1[0] && s.h1[0] !== code;
    check(`real code ${code}`, ok, `h1=${JSON.stringify(s.h1)} dateInputs=${s.dateInputs} headers=${s.headers.length} rows=${s.rows} alerts=${JSON.stringify(s.alerts)} runPosts=${JSON.stringify(s.runPosts.map((x) => x.s))}`);
    await p.screenshot({ path: `${OUT}/20-real-${code}.png` });
    await p.waitForTimeout(2500);
  }

  // uppercase variant of a real code
  let s = await probe(p, "/app/reports/SALES-BY-DAY");
  check("uppercase real code honest", !s.loggedOut && (s.notFound || (s.dateInputs === 2 && s.alerts.length === 0)),
    `notFound=${s.notFound} h1=${JSON.stringify(s.h1)} dateInputs=${s.dateInputs} alerts=${JSON.stringify(s.alerts)} runPosts=${JSON.stringify(s.runPosts.map((x) => x.s))}`);
  await p.screenshot({ path: `${OUT}/21-uppercase.png` });
  await p.waitForTimeout(2500);

  // hostile segment
  s = await probe(p, "/app/reports/%3Cimg%20src%3Dx%20onerror%3Ddocument.body.setAttribute('data-pwned','1')%3E");
  check("hostile segment: not-found, nothing injected", !s.loggedOut && s.notFound && !s.injected,
    `notFound=${s.notFound} injected=${s.injected} h1=${JSON.stringify(s.h1)} scrollW=${s.scrollW}/${s.innerW}`);
  await p.screenshot({ path: `${OUT}/22-hostile.png` });
  await p.waitForTimeout(2500);

  // trailing-space / near-miss codes
  for (const c of ["sales-by-day2", "sales_by_day", "salesbyday", "%20", "..", "null", "undefined"]) {
    const st = await probe(p, `/app/reports/${c}`, 4500);
    check(`near-miss "${c}"`, !st.loggedOut && st.notFound && st.dateInputs === 0 && st.runPosts.length === 0,
      `notFound=${st.notFound} dateInputs=${st.dateInputs} runPosts=${JSON.stringify(st.runPosts.map((x) => x.s))} h1=${JSON.stringify(st.h1)}`);
    await p.waitForTimeout(1800);
  }

  // sales-by-day again after all of it — did anything regress?
  s = await probe(p, "/app/reports/sales-by-day");
  check("sales-by-day still runs at the end", !s.loggedOut && s.dateInputs === 2 && s.rows > 0 && s.alerts.length === 0,
    `h1=${JSON.stringify(s.h1)} rows=${s.rows} headers=${JSON.stringify(s.headers)} runPosts=${JSON.stringify(s.runPosts.map((x) => x.s))}`);
  await p.screenshot({ path: `${OUT}/23-sales-by-day-final.png` });

  const fails = results.filter((r) => !r.p);
  writeFileSync(`${OUT}/results2.json`, JSON.stringify(results, null, 2));
  console.log(`\n  ${results.length - fails.length}/${results.length} PASS, ${fails.length} FAIL`);
  for (const f of fails) console.log(`   FAIL: ${f.n} — ${f.d}`);
  await browser.close();
})();
