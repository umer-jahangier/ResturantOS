/*
 * F5 ADJACENT PATH — the owner dashboard's own "Net sales" KPI.
 *
 * F5 was fixed on /app/finance/takings. This asks whether the SAME defect — a tile
 * labelled "Net sales" that is actually the tax-inclusive bill total — is still live
 * on the screen an owner opens FIRST.
 *
 * It proves it numerically rather than by reading code: it reads the figure off the
 * rendered dashboard, then runs the very report the dashboard consumes and shows
 * which sum the screen equals — Σtotal_paisa (tax inside) or Σ(subtotal − discount).
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F5/verify");
mkdirSync(OUT, { recursive: true });

const OWNER = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };

function base32Decode(input) {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const out = [];
  for (const c of input.replace(/=+$/, "").toUpperCase()) {
    const i = a.indexOf(c); if (i === -1) continue;
    v = (v << 5) | i; bits += 5;
    if (bits >= 8) { out.push((v >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpNow(s) {
  const ctr = Math.floor(Date.now() / 1000 / 30); const b = Buffer.alloc(8);
  b.writeUInt32BE(Math.floor(ctr / 2 ** 32), 0); b.writeUInt32BE(ctr >>> 0, 4);
  const h = createHmac("sha1", base32Decode(s)).update(b).digest();
  const o = h[h.length - 1] & 0x0f;
  const c = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(c % 1_000_000).padStart(6, "0");
}

async function loginOnce(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4000);
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    const s = Math.floor(Date.now() / 1000) % 30;
    if (s > 24) await page.waitForTimeout((31 - s) * 1000);
    await totp.first().fill(totpNow(who.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(5000);
  }
  if (page.url().includes("/login")) throw new Error(`login failed — at ${page.url()}`);
}
async function login(page, who) {
  let last = null;
  for (let a = 0; a < 4; a++) {
    try { await loginOnce(page, who); return; }
    catch (e) { last = e; console.log(`   login attempt ${a + 1} failed, backing off`); await page.waitForTimeout(15000); }
  }
  throw last;
}

const money = (p) => `Rs ${(p / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

(async () => {
  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const page = await ctx.newPage();
  await login(page, OWNER);
  console.log("  · signed in as owner@terrace.local");

  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);

  // The KPI as a human reads it.
  const kpi = await page.evaluate(() => {
    const tile = document.querySelector('[data-testid="kpi-owner-net-sales"]')
      || [...document.querySelectorAll("*")].find(
        (e) => e.children.length === 0 && /^Net sales$/i.test((e.textContent || "").trim()),
      )?.closest("div,article,section");
    if (!tile) return null;
    let card = tile;
    for (let i = 0; i < 5 && card.parentElement; i++) {
      if (/Rs\s[\d,]+/.test(card.innerText || "")) break;
      card = card.parentElement;
    }
    const txt = (card.innerText || "").replace(/\s+/g, " ");
    const m = txt.match(/Net sales\s*(Rs\s[\d,]+(?:\.\d{2})?)/i) || txt.match(/(Rs\s[\d,]+(?:\.\d{2})?)/);
    return { text: txt.slice(0, 400), amount: m ? m[1] : null };
  });
  console.log(`\n  DASHBOARD KPI  -> ${JSON.stringify(kpi, null, 2)}`);

  // The exact window the dashboard uses, and the exact report it consumes.
  const probe = await page.evaluate(async () => {
    const r0 = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    const tok = (await r0.json())?.data?.accessToken;
    const isoDay = (back) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
    const body = { from: isoDay(30), to: isoDay(0) };
    const r = await fetch("http://localhost:8080/api/v1/reporting/reports/sales-by-day/run", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    return { status: r.status, rows: j?.data?.rows ?? [], window: body };
  });

  const rows = probe.rows;
  const sumTotal = rows.reduce((s, r) => s + Number(r.total_paisa ?? 0), 0);
  const sumSubtotal = rows.reduce((s, r) => s + Number(r.subtotal_paisa ?? 0), 0);
  const sumDiscount = rows.reduce((s, r) => s + Number(r.discount_paisa ?? 0), 0);
  const sumTax = rows.reduce((s, r) => s + Number(r.tax_paisa ?? 0), 0);
  const trueNet = sumSubtotal - sumDiscount;

  console.log(`\n  the report the tile is built from (${probe.window.from} .. ${probe.window.to}), ${rows.length} rows:`);
  console.log(`    Σ subtotal_paisa (gross)          = ${money(sumSubtotal)}`);
  console.log(`    Σ discount_paisa                  = ${money(sumDiscount)}`);
  console.log(`    Σ tax_paisa                       = ${money(sumTax)}`);
  console.log(`    Σ total_paisa  (the BILL TOTAL)   = ${money(sumTotal)}`);
  console.log(`    TRUE net sales (gross − discount) = ${money(trueNet)}`);
  console.log(`\n  the tile says                       = ${kpi?.amount}`);

  const tilePaisa = kpi?.amount ? Math.round(parseFloat(kpi.amount.replace(/Rs\s*/, "").replace(/,/g, "")) * 100) : null;
  const equalsBillTotal = tilePaisa !== null && Math.abs(tilePaisa - sumTotal) <= 100;
  const equalsTrueNet = tilePaisa !== null && Math.abs(tilePaisa - trueNet) <= 100;
  const netExceedsGross = sumTotal > sumSubtotal;

  console.log(`\n  ===================== VERDICT =====================`);
  console.log(`  tile === Σ total_paisa (bill total, TAX INSIDE) : ${equalsBillTotal}`);
  console.log(`  tile === gross − discounts (true net sales)     : ${equalsTrueNet}`);
  console.log(`  a tile labelled "Net sales" EXCEEDS its gross   : ${netExceedsGross}  (${money(sumTotal)} > ${money(sumSubtotal)})`);
  console.log(`  over-statement of revenue                      : ${money(sumTotal - trueNet)}`);
  console.log(`  ==================================================`);

  await page.screenshot({ path: `${OUT}/adjacent-dashboard-net-sales.png`, fullPage: false });
  writeFileSync(`${OUT}/adjacent-dashboard.json`, JSON.stringify(
    { kpi, tilePaisa, sumSubtotal, sumDiscount, sumTax, sumTotal, trueNet, equalsBillTotal, equalsTrueNet, netExceedsGross, rows, window: probe.window }, null, 2));

  await browser.close();
})();
