/*
 * B3 — the third surface the discount figure has to agree on: the JOURNAL ENTRY.
 *
 * The charge page and the printed bill were read in 01-verify. This opens the general-ledger
 * entry pos-service' close produced for the SAME check and reads the discount line off the
 * screen, so "screen, paper and ledger agree to the paisa" is a measurement and not a claim.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/B3");
mkdirSync(OUT, { recursive: true });

const prev = JSON.parse(readFileSync(`${OUT}/01-verify.json`, "utf8"));
const ORDER_NO = prev.order.orderNo;
const ORDER_ID = prev.order.orderId;
const DISCOUNT_PAISA = prev.settled.discountPaisa;

const MANAGER = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };
const ACCOUNTANT = {
  slug: "floating-terrace", email: "accountant@terrace.local", password: "Terrace#Accountant1",
  totpSecret: "2XPUJEA7F6YYOV4P7ME5OH6PUBJWTV5C",
};
const log = (...a) => console.log(...a);
const J = { orderNo: ORDER_NO, orderId: ORDER_ID, discountPaisa: DISCOUNT_PAISA };

import { createHmac } from "node:crypto";
function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0; const out = [];
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    const i = alphabet.indexOf(ch); if (i === -1) continue;
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
  const off = h[h.length - 1] & 0x0f;
  const code = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

async function login(page, who, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await slug.count()) await slug.first().fill(who.slug);
    await page.locator('input[name="email"], input#email').first().fill(who.email);
    await page.locator('input[name="password"], input#password').first().fill(who.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(5000);
    const totp = page.locator('input[name="totpCode"], input#totpCode');
    if (await totp.count()) {
      await totp.first().fill(totpNow(who.totpSecret));
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(5000);
    }
    if (!page.url().includes("/login")) { log("  ✓", who.email); return; }
    const said = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="alert"], .text-destructive'))
        .map((n) => (n.textContent || "").trim()).filter(Boolean).join(" | ") || "(no message)");
    log(`  ! attempt ${i}/${attempts} ${who.email} — ${said}`);
    await page.waitForTimeout(8000 * i);
  }
  throw new Error("login failed: " + who.email);
}

const bearers = new WeakMap();
async function tokenOf(page) {
  if (bearers.has(page)) return bearers.get(page);
  const t = await page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: "{}",
    });
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
  bearers.set(page, t);
  return t;
}

async function api(page, method, path, payload) {
  const t = await tokenOf(page);
  return page.evaluate(async ({ m, p, b, tok }) => {
    const r = await fetch(`http://localhost:8080${p}`, {
      method: m, credentials: "include",
      headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    let body = null; try { body = await r.json(); } catch { /* not json */ }
    return { status: r.status, body };
  }, { m: method, p: path, b: payload, tok: t });
}

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();

// The accountant is the persona who reads the ledger; fall back to the manager if step-up fails.
let who = ACCOUNTANT;
try {
  await login(page, ACCOUNTANT);
} catch {
  log("  accountant unavailable — falling back to the manager");
  who = MANAGER;
  await login(page, MANAGER);
}
J.persona = who.email;

// Find the entry by the order it came from, on the persona's own bearer.
const search = await api(page, "GET",
  `/api/v1/finance/journal-entries?search=${encodeURIComponent(ORDER_NO)}&size=20`);
log("  search:", search.status, JSON.stringify(search.body).slice(0, 300));
const rows = search.body?.data?.content ?? search.body?.data ?? [];
const entry = rows.find((e) => (e.description ?? "").includes(ORDER_NO)) ?? rows[0];
J.entryFound = !!entry;
if (entry) {
  J.entry = { id: entry.id, entryNo: entry.entryNo, description: entry.description, status: entry.status };
  log("  entry:", JSON.stringify(J.entry));
  await page.goto(`${BASE}/app/finance/journal-entries/${entry.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  await page.screenshot({ path: `${OUT}/32-journal-entry.png`, fullPage: true });
  J.journalOnScreen = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 1600));
  log("  on screen:", J.journalOnScreen.slice(0, 700));

  // The discount line, read off the ledger screen and compared with the bill, to the paisa.
  const expected = `Rs ${(DISCOUNT_PAISA / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  J.expectedDiscountOnLedger = expected;
  J.ledgerShowsSameDiscount = J.journalOnScreen.includes(expected);
  J.ledgerHasDiscountAccount = /4920|Discount/i.test(J.journalOnScreen);
  log(`  ledger shows ${expected}? ${J.ledgerShowsSameDiscount}  (discount account named? ${J.ledgerHasDiscountAccount})`);
} else {
  log("  NO ENTRY FOUND over HTTP — search body above");
}

writeFileSync(`${OUT}/03-journal-entry.json`, JSON.stringify(J, null, 2));
log("\njournal →", `${OUT}/03-journal-entry.json`);
await browser.close();
