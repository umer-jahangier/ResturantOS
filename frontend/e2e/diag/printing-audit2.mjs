// DIAGNOSIS ONLY — printing. Paced to avoid the 429 that invalidated run 1.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/printing");
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const log = [];
const say = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };

const WHO = {
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  owner: { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totp: true },
};
const ORDER = "2997f9c6-718d-41f0-8216-988d435025c0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PRINT_SPY = () => {
  window.__printCalls = [];
  const real = window.print.bind(window);
  window.print = function () { window.__printCalls.push(Date.now()); try { real(); } catch (e) { window.__printErr = String(e); } };
};

async function shot(page, name) { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); say("  shot:", name + ".png"); }

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await sleep(2000);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (who.slug && (await slug.count())) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await sleep(5000);
  if (who.totp) {
    const otp = page.locator('input[name="code"], input#code, input[autocomplete="one-time-code"]');
    if (await otp.count()) {
      const code = execSync(`python3 ../scripts/generate_totp.py ${who.email}`).toString().trim().match(/\d{6}/)[0];
      say("  TOTP challenge -> code", code);
      await otp.first().fill(code);
      await page.locator('button[type="submit"]').first().click();
      await sleep(5000);
    }
  }
  const ok = !page.url().includes("/login");
  say(`login ${who.email}: ${ok ? "OK" : "FAILED"} -> ${page.url()}`);
  return ok;
}

async function probe(page, who, path, name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await sleep(4000);
    const body = (await page.locator("body").innerText().catch(() => "")) || "";
    if (page.url().includes("/login")) { say(`  ${path}: bounced to /login (session/429) — re-auth and retry ${attempt}`); await sleep(6000); await login(page, who); continue; }
    if (/Couldn.t load|Something went wrong/i.test(body) && attempt < 3) { say(`  ${path}: error state, retry ${attempt}`); await sleep(4000); continue; }
    const is404 = /This page doesn.t exist|404/i.test(body.slice(0, 300));
    const denied = /Access denied/i.test(body);
    say(`  ${path} -> 404=${is404} denied=${denied} | ${body.replace(/\s+/g, " ").slice(0, 220)}`);
    await shot(page, name);
    await sleep(2500); // pace against the rate limiter
    return { body, is404, denied };
  }
  return { body: "", is404: false, denied: false };
}

async function run(browser, persona, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(PRINT_SPY);
  const page = await ctx.newPage();
  const net = [];
  page.on("request", (r) => { const u = r.url(); if (!u.startsWith(BASE) || /print|receipt/i.test(u)) net.push(`${r.method()} ${u}`); });
  const who = WHO[persona];
  say(`\n=== PERSONA: ${persona} ===`);
  if (await login(page, who)) await fn(page, who, net);
  await ctx.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  // --- CASHIER: the receipt path, in isolation so nothing rate-limits it away ---
  await run(browser, "cashier", async (page, who, net) => {
    say("\n--- (c) Cashier opens the printable bill ---");
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.goto(`${BASE}/app/pos/orders/${ORDER}/receipt`, { waitUntil: "domcontentloaded" });
      await sleep(8000);
      if (page.url().includes("/login")) { say("  bounced to login, re-auth"); await sleep(6000); await login(page, who); continue; }
      const body = await page.locator("body").innerText().catch(() => "");
      if (/Couldn.t load|Something went wrong/i.test(body) && attempt < 3) { say("  error state, retry"); await sleep(5000); continue; }
      say("  receipt text:", body.replace(/\s+/g, " ").slice(0, 500));
      break;
    }
    say(`  >>> window.print() AUTO-call count = ${await page.evaluate(() => (window.__printCalls || []).length)}`);
    await shot(page, "c-receipt-cashier");
    const btn = page.locator('[data-testid="print-again-button"]');
    say(`  manual Print button count = ${await btn.count()}`);
    if (await btn.count()) {
      await btn.first().click({ force: true });
      await sleep(2000);
      say(`  >>> window.print() count AFTER clicking Print = ${await page.evaluate(() => (window.__printCalls || []).length)}`);
    }
    say("  any browser->local-agent (7654/localhost:765x) call? " + net.some((r) => /:765\d/.test(r)));
    say("  non-app / print requests:"); [...new Set(net)].slice(0, 25).forEach((r) => say("    " + r));
    await sleep(3000);
    say("\n--- POS screen: is there a Printers / print-settings control? ---");
    await probe(page, who, "/app/pos", "c-pos-screen");
  });

  // --- MANAGER + OWNER: the settings hunt ---
  for (const persona of ["manager", "owner"]) {
    await run(browser, persona, async (page, who) => {
      say(`\n--- (a) ${persona}: printer settings hunt ---`);
      const routes = [["/app/settings", `a-${persona}-settings`], ["/app/settings/printers", `a-${persona}-printers`]];
      for (const [p, n] of routes) await probe(page, who, p, n);
      const navText = await page.evaluate(() => [...document.querySelectorAll("nav, aside, [role=navigation]")].map((e) => e.innerText).join(" | "));
      say(`  ${persona} nav mentions print? ${/print/i.test(navText)}`);
      say(`  ${persona} nav: ${navText.replace(/\s+/g, " ").slice(0, 700)}`);
      const pageHasPrinter = await page.evaluate(() => /printer/i.test(document.body.innerText));
      say(`  ${persona} /app/settings body mentions 'printer'? ${pageHasPrinter}`);
    });
  }

  writeFileSync(`${OUT}/drive-log-2.txt`, log.join("\n"));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
