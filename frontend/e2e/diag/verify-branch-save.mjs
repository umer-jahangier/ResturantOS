/* DIAGNOSIS ONLY — drive the Branch details save end to end as OWNER, then reload and re-read. */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/branch-management");
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const P = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };

function base32Decode(input) {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, value = 0; const out = [];
  for (const ch of input.replace(/=+$/, "").toUpperCase()) { const i = a.indexOf(ch); if (i === -1) continue; value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; } }
  return Buffer.from(out);
}
function totpNow(s) {
  const key = base32Decode(s); const c = Math.floor(Date.now() / 1000 / 30);
  const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4);
  const h = createHmac("sha1", key).update(b).digest(); const o = h[h.length - 1] & 0xf;
  return String((((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff)) % 1e6).padStart(6, "0");
}
const log = [];
const rec = (k, v) => { log.push({ k, v }); console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v)); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const puts = [];
page.on("response", async (r) => {
  if (/\/api\/v1\/branches/.test(r.url()) && r.request().method() !== "GET") {
    let body = ""; try { body = (await r.text()).slice(0, 500); } catch {}
    puts.push({ method: r.request().method(), url: r.url().replace("http://localhost:8080", ""), reqBody: r.request().postData(), status: r.status(), body });
  }
});

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
const slug = page.locator('input[name="tenantSlug"], input[id*="tenant" i]').first();
if (await slug.count()) await slug.fill(P.slug).catch(() => {});
await page.locator('input[type="email"], input[name="email"]').first().fill(P.email);
await page.locator('input[type="password"]').first().fill(P.password);
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(2500);
for (let i = 0; i < 4 && /\/login/.test(page.url()); i++) {
  const otp = page.locator('input[name="totpCode"], input[autocomplete="one-time-code"], input[inputmode="numeric"]').first();
  if (await otp.count()) {
    await otp.fill("");
    await otp.fill(totpNow(P.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(3000);
  } else {
    rec("no-otp-field", (await page.locator("body").innerText()).slice(0, 300));
    await page.waitForTimeout(2000);
  }
}
rec("url", page.url());
if (/\/login/.test(page.url())) { rec("LOGIN-FAILED", (await page.locator("body").innerText()).slice(0, 500)); await browser.close(); process.exit(1); }

async function readForm() {
  return page.evaluate(() => Object.fromEntries(
    Array.from(document.querySelectorAll("input")).filter((i) => i.name).map((i) => [i.name, i.value])
  ));
}
async function toasts() {
  return page.evaluate(() => Array.from(document.querySelectorAll("[data-sonner-toast], [role=status], [role=alert]")).map((n) => n.innerText.trim().replace(/\s+/g, " ")).filter(Boolean));
}

async function attempt(label, field, value) {
  await page.goto(`${BASE}/app/settings`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const before = await readForm();
  const input = page.locator(`input[name="${field}"]`).first();
  await input.click();
  await input.fill("");
  await input.type(value, { delay: 20 });
  puts.length = 0;
  await page.locator('button:has-text("Save changes")').first().click();
  await page.waitForTimeout(3000);
  const t = await toasts();
  const net = JSON.parse(JSON.stringify(puts));
  await page.screenshot({ path: resolve(OUT, `save-${label}.png`), fullPage: true });
  // reload and re-read
  await page.goto(`${BASE}/app/settings`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  const after = await readForm();
  rec("SAVE-ATTEMPT", { label, field, typed: value, before: before[field], toasts: t, network: net, afterReload: after[field], persisted: after[field] === value });
  return after;
}

// 1. A real street address — the exact thing an owner would type.
await attempt("address-real", "address", "12 Khayaban-e-Iqbal, F-7 Markaz, Islamabad");
// 2. A single word, no punctuation.
await attempt("address-oneword", "address", "Islamabad");
// 3. A JSON-quoted string — the shape the previous report says the column really wants.
await attempt("address-jsonquoted", "address", '"12 Khayaban-e-Iqbal"');
// 4. Control: phone, a plain varchar column.
await attempt("phone", "phone", "+92 51 111 2233");
// 5. Control: email.
await attempt("email", "email", "hq@floatingterrace.pk");

writeFileSync(resolve(OUT, "transcript-save.json"), JSON.stringify(log, null, 2));
await browser.close();
