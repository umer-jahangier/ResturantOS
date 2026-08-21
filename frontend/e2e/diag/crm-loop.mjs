// DIAGNOSIS ONLY — drive the whole loyalty value loop at the till.
// enrol a diner by phone -> ring a bill -> charge it -> check points accrued -> try to redeem.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/crm-loyalty");
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });

const PHONE = process.env.DIAG_PHONE || "03009" + String(Date.now()).slice(-6);
const NAME = "Diag Loyalty " + String(Date.now()).slice(-5);

const log = [];
const say = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); say("   shot:", n + ".png"); };

function totp(email) {
  return execSync(`python3 ../scripts/generate_totp.py ${email}`).toString().match(/TOTP code:\s*(\d{6})/)[1];
}

async function login(page, { slug, email, password, needsTotp }) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (slug && (await s.count())) await s.first().fill(slug);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3500);
  if (needsTotp && page.url().includes("/login")) {
    const code = totp(email);
    const otp = page.locator('input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name="code"], input#code, input[name="totpCode"]');
    if (await otp.count()) {
      const boxes = await otp.count();
      say(`   TOTP: ${boxes} field(s), code ${code}`);
      if (boxes >= 6) { for (let i = 0; i < 6; i++) await otp.nth(i).fill(code[i]); }
      else await otp.first().fill(code);
      await page.waitForTimeout(600);
      const b = page.locator('button[type="submit"]');
      if (await b.count()) await b.first().click().catch(() => {});
      await page.waitForTimeout(4000);
    } else {
      await shot(page, "totp-screen-unknown");
      say("   !! no TOTP field found; page text:", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 600));
    }
  }
  await page.waitForTimeout(1500);
  return !page.url().includes("/login");
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => say("   ! pageerror:", String(e).slice(0, 150)));
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/crm/") || u.includes("/orders") || u.includes("/payments")) {
      if (r.status() >= 400) say(`   HTTP ${r.status()} ${r.request().method()} ${u}`);
    }
  });

  say(`=== enrolling ${NAME} / ${PHONE} at the till ===`);
  const ok = await login(page, { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" });
  say("cashier login:", ok, page.url());
  if (!ok) { await ctx.close(); await browser.close(); return; }

  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  // 1. Ring an item.
  const karahi = page.locator('button', { hasText: "Chicken Karahi" });
  if (await karahi.count()) { await karahi.first().click(); await page.waitForTimeout(2000); }
  const dlg = page.locator('[role="dialog"]');
  if (await dlg.count()) {
    say("   modifier dialog opened, box:", JSON.stringify(await dlg.first().boundingBox()));
    await shot(page, "loop-1-item-dialog");
    const add = dlg.locator('button').filter({ hasText: /^(Add|Add to order|Confirm|Done|Save)/i });
    if (await add.count()) await add.last().click().catch(() => {});
    await page.waitForTimeout(1500);
  }
  await shot(page, "loop-1-cart");
  say("CART >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1000));

  // 2. Enrol the diner by phone at the till.
  const addCust = page.locator('button:has-text("Add customer")');
  if (await addCust.count()) {
    await addCust.first().click();
    await page.waitForTimeout(700);
    await page.locator('input[aria-label="Search for a customer"]').fill(PHONE);
    await page.waitForTimeout(2500);
    await shot(page, "loop-2-phone-typed");
    const nameField = page.locator('input[aria-label="New customer name"]');
    if (await nameField.count()) {
      await nameField.fill(NAME);
      await page.waitForTimeout(400);
      const enrol = page.locator('button', { hasText: /^Enrol/ });
      say("   enrol button:", await enrol.count());
      if (await enrol.count()) { await enrol.first().click(); await page.waitForTimeout(3500); }
    } else {
      say("   !! no enrolment field appeared for a full phone number");
      say("   PICKER TEXT >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 800));
    }
  }
  await shot(page, "loop-3-customer-attached");
  const attached = await page.locator("body").innerText();
  say("ATTACHED? contains phone:", attached.includes(PHONE), "| contains 'pts':", /\d+\s*pts/.test(attached));
  say("POS BUTTONS >>>", JSON.stringify(await page.evaluate(() =>
    Array.from(document.querySelectorAll("button")).map(b => b.textContent.trim()).filter(Boolean))));
  say("Any redeem/points/reward/discount control on the till?",
    /redeem|apply points|use points|reward|voucher|loyalty/i.test(attached));

  // 3. Charge the order.
  const charge = page.locator('button:has-text("Charge Now")');
  if (await charge.count()) {
    const disabled = await charge.first().isDisabled();
    say("   'Charge Now' disabled:", disabled);
    if (disabled) {
      const send = page.locator('button:has-text("Send to Kitchen")');
      if (await send.count()) { await send.first().click(); await page.waitForTimeout(5000); }
      await shot(page, "loop-4-sent");
    }
    const charge2 = page.locator('button:has-text("Charge Now")');
    if (await charge2.count() && !(await charge2.first().isDisabled())) {
      await charge2.first().click();
      await page.waitForTimeout(5000);
      say("   charge page:", page.url());
      await shot(page, "loop-5-charge");
      const txt = await page.locator("body").innerText();
      say("CHARGE SCREEN >>>", txt.replace(/\n/g, " | ").slice(0, 1400));
      say("Charge screen offers points redemption?", /redeem|points|loyalty|reward/i.test(txt));
      // Pay cash.
      const cash = page.locator('button', { hasText: /^Cash$/i });
      if (await cash.count()) { await cash.first().click(); await page.waitForTimeout(1200); }
      const amt = page.locator('input[type="number"], input[inputmode="decimal"]');
      if (await amt.count()) { await amt.first().fill("2000"); await page.waitForTimeout(600); }
      const settle = page.locator('button').filter({ hasText: /Take payment|Settle|Complete|Pay|Confirm/i });
      say("   settle buttons:", JSON.stringify(await settle.allTextContents()));
      if (await settle.count()) { await settle.last().click(); await page.waitForTimeout(7000); }
      await shot(page, "loop-6-after-payment");
      say("AFTER PAY >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1200));
    }
  }

  // 4. Did points accrue? Check the CRM screen.
  await page.waitForTimeout(6000);
  await page.goto(`${BASE}/app/crm`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  const sb = page.locator('input[aria-label="Search customers"], input[placeholder*="earch" i]');
  if (await sb.count()) { await sb.first().fill(PHONE); await page.waitForTimeout(3000); }
  await shot(page, "loop-7-crm-after-order");
  say("CRM AFTER ORDER >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1500));
  const row = page.locator("table tbody tr, ul li button").first();
  if (await row.count()) { await row.click().catch(() => {}); await page.waitForTimeout(2500); }
  await shot(page, "loop-8-crm-detail");
  say("CRM DETAIL >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1600));

  await ctx.close();
  await browser.close();
  writeFileSync(`${OUT}/loop-log.txt`, log.join("\n"));
  say("phone used:", PHONE);
}

main().catch((e) => { console.error(e); writeFileSync(`${OUT}/loop-log.txt`, log.join("\n") + "\nFATAL " + e); process.exit(1); });
