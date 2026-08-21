// DIAGNOSIS ONLY — printing domain. Drives real Chromium, records evidence.
// node e2e/diag/printing-audit.mjs
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/printing");
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const log = [];
function say(...a) { const s = a.join(" "); console.log(s); log.push(s); }

const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };
const ORDER_UNPAID = "2997f9c6-718d-41f0-8216-988d435025c0";

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  say("  shot:", name + ".png");
}

// Records every window.print() call WITHOUT suppressing it, so we can also see the real dialog.
const PRINT_SPY = () => {
  window.__printCalls = [];
  const real = window.print.bind(window);
  window.print = function () {
    window.__printCalls.push({ at: Date.now(), stack: new Error().stack });
    // In headed Chromium this opens the native print preview. We call it so the
    // screenshot afterwards shows what the cashier actually sees.
    try { real(); } catch (e) { window.__printCalls.push({ error: String(e) }); }
  };
};

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (who.slug && (await slug.count())) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  const ok = !page.url().includes("/login");
  say(`login ${who.email}: ${ok ? "OK" : "FAILED"} -> ${page.url()}`);
  return ok;
}

// Retry-aware: an alert/"Couldn't load" is a failure state, not an empty product.
async function probe(page, path, name) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    const body = (await page.locator("body").innerText().catch(() => "")) || "";
    const alerts = await page.locator('[role="alert"]').count();
    const is404 = /404|This page could not be found|not found/i.test(body.slice(0, 400));
    const denied = /Access denied|You do not have|not permitted/i.test(body);
    const failed = alerts > 0 || /Couldn.t load|Something went wrong|try again/i.test(body);
    if (failed && attempt === 1) { say(`  ${path}: failure state on attempt 1, RETRYING`); continue; }
    say(`  ${path} -> url=${page.url()} 404=${is404} denied=${denied} alertEls=${alerts}`);
    say(`    text[0:260]: ${body.replace(/\s+/g, " ").slice(0, 260)}`);
    await shot(page, name);
    return { body, is404, denied, failed };
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(PRINT_SPY);
  const page = await ctx.newPage();
  const netPrint = [];
  page.on("request", (r) => { if (/print|receipt/i.test(r.url())) netPrint.push(`${r.method()} ${r.url()}`); });
  page.on("console", (m) => { if (m.type() === "error") say("  console.error:", m.text().slice(0, 160)); });

  say("=== PERSONA: CASHIER ===");
  if (!(await login(page, CASHIER))) { await browser.close(); return; }

  say("\n--- (a) Is there a printer SETTINGS screen? Hunt every plausible route ---");
  const routes = [
    ["/app/settings", "a-settings-root"],
    ["/app/settings/printers", "a-settings-printers"],
    ["/app/settings/printing", "a-settings-printing"],
    ["/app/settings/receipt", "a-settings-receipt"],
    ["/app/settings/devices", "a-settings-devices"],
    ["/app/pos/settings", "a-pos-settings"],
    ["/app/pos/printers", "a-pos-printers"],
    ["/app/printers", "a-app-printers"],
  ];
  for (const [p, n] of routes) await probe(page, p, n);

  say("\n--- (a2) Sidebar / global search: does the word 'printer' appear anywhere in nav? ---");
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const navText = await page.evaluate(() => {
    const els = [...document.querySelectorAll("nav, aside, [role=navigation]")];
    return els.map((e) => e.innerText).join(" | ");
  });
  say("  nav text:", navText.replace(/\s+/g, " ").slice(0, 900));
  say("  nav mentions printer?", /print/i.test(navText));
  await shot(page, "a2-nav");

  say("\n--- (c) Cashier prints a bill: does window.print() fire? ---");
  await page.goto(`${BASE}/app/pos/orders/${ORDER_UNPAID}/receipt`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const body = await page.locator("body").innerText().catch(() => "");
  say("  receipt page text[0:400]:", body.replace(/\s+/g, " ").slice(0, 400));
  const calls = await page.evaluate(() => (window.__printCalls || []).length);
  say(`  >>> window.print() call count = ${calls}`);
  await shot(page, "c-receipt-auto-print");

  // The manual button too.
  const btn = page.locator('[data-testid="print-again-button"]');
  if (await btn.count()) {
    const disabled = await btn.first().isDisabled();
    say(`  manual Print button present, disabled=${disabled}`);
    if (!disabled) {
      await btn.first().click();
      await page.waitForTimeout(1500);
      say(`  >>> window.print() call count after clicking Print = ${await page.evaluate(() => (window.__printCalls || []).length)}`);
    }
  } else say("  manual Print button NOT FOUND");
  await shot(page, "c-receipt-after-click");

  say("\n--- (d) Any request to a local print agent (127.0.0.1:7654) from the browser? ---");
  say("  print/receipt-ish requests observed:");
  for (const r of [...new Set(netPrint)]) say("    " + r);
  say("  any agent call (7654)?", netPrint.some((r) => /7654/.test(r)));

  writeFileSync(`${OUT}/drive-log.txt`, log.join("\n"));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
