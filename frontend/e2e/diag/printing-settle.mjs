// DIAGNOSIS ONLY — drive a cashier through settling an order with a RECEIPT printer configured.
// Answers: (c) does a browser print dialog appear? (d) does the agent print silently too?
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/printing");
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const log = [];
const say = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };

const PRINT_SPY = () => {
  window.__printCalls = [];
  const real = window.print.bind(window);
  window.print = function () { window.__printCalls.push(Date.now()); try { real(); } catch (e) { window.__printErr = String(e); } };
};

async function shot(page, n) { await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); say("  shot:", n + ".png"); }

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await sleep(2000);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await sleep(6000);
  say(`login: ${page.url()}`);
  return !page.url().includes("/login");
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(PRINT_SPY);
  const page = await ctx.newPage();
  const net = [];
  page.on("request", (r) => { const u = r.url(); if (/print|receipt|payment|close/i.test(u)) net.push(`${r.method()} ${u}`); });
  page.on("dialog", async (d) => { say(`  !! BROWSER DIALOG: type=${d.type()} msg=${d.message()}`); await d.dismiss(); });

  if (!(await login(page, CASHIER))) { await browser.close(); return; }

  say("\n--- Cashier goes to the charge screen for an open order ---");
  const ORDER = "43857ea9-c11d-4642-9fea-ad732957a2d1"; // second open order
  await page.goto(`${BASE}/app/pos/orders/${ORDER}/charge`, { waitUntil: "domcontentloaded" });
  await sleep(7000);
  let body = await page.locator("body").innerText().catch(() => "");
  say("  charge screen:", body.replace(/\s+/g, " ").slice(0, 600));
  await shot(page, "d-charge-screen");

  // Try to complete a cash payment.
  // Tender is a <select>; amount is filled by the "Full amount" button.
  const sel = page.locator("select");
  if (await sel.count()) { await sel.first().selectOption({ label: "CASH" }).catch(() => {}); say("  selected CASH"); }
  const full = page.getByRole("button", { name: /full amount/i });
  say(`  'Full amount' buttons: ${await full.count()}`);
  if (await full.count()) { await full.first().click(); await sleep(1500); }
  await shot(page, "d-charge-after-cash");
  body = await page.locator("body").innerText().catch(() => "");
  say("  after cash click:", body.replace(/\s+/g, " ").slice(0, 600));

  const confirm = page.getByRole("button", { name: /take payment|confirm|settle|complete|pay/i });
  say(`  settle buttons: ${await confirm.count()}`);
  for (let i = 0; i < (await confirm.count()); i++) {
    say(`    [${i}] "${(await confirm.nth(i).innerText().catch(() => "")).trim()}" disabled=${await confirm.nth(i).isDisabled().catch(() => "?")}`);
  }
  if (await confirm.count()) {
    await confirm.first().click({ force: true });
    await sleep(8000);
  }
  say("  url after settle attempt:", page.url());
  body = await page.locator("body").innerText().catch(() => "");
  say("  post-settle:", body.replace(/\s+/g, " ").slice(0, 700));
  await shot(page, "d-after-settle");
  say(`  >>> window.print() calls so far = ${await page.evaluate(() => (window.__printCalls || []).length)}`);

  say("\n  network (print/payment):");
  [...new Set(net)].forEach((r) => say("    " + r));
  say(`  browser ever called the local agent on :7654? ${net.some((r) => /:765\d/.test(r))}`);

  writeFileSync(`${OUT}/settle-log.txt`, log.join("\n"));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
