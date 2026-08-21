// DIAGNOSIS ONLY — CRM / loyalty / rewards / subscriptions.
// node e2e/diag/crm-loyalty.mjs
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/crm-loyalty");
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });

const PERSONAS = {
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  admin: { slug: "floating-terrace", email: "admin@terrace.local", password: "Terrace#Admin1", totp: true },
};

const log = [];
function say(...a) {
  const s = a.join(" ");
  console.log(s);
  log.push(s);
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  say("   shot:", `${name}.png`);
}

async function totpFor(email) {
  const { execSync } = await import("node:child_process");
  return execSync(`python3 ../scripts/generate_totp.py ${email}`).toString().trim().split(/\s+/).pop();
}

async function login(page, p) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const slugField = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (p.slug && (await slugField.count())) await slugField.first().fill(p.slug);
  await page.locator('input[name="email"], input#email').first().fill(p.email);
  await page.locator('input[name="password"], input#password').first().fill(p.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  if (p.totp) {
    const code = await totpFor(p.email);
    const otp = page.locator('input[name="code"], input#code, input[autocomplete="one-time-code"], input[inputmode="numeric"]');
    if (await otp.count()) {
      say("   TOTP challenge shown; entering", code);
      await otp.first().fill(code);
      const btn = page.locator('button[type="submit"]');
      if (await btn.count()) await btn.first().click();
      await page.waitForTimeout(3500);
    }
  }
  await page.waitForTimeout(1500);
  return !page.url().includes("/login");
}

/** Reports whether the visible page is an error/denied state rather than a real product surface. */
async function statusOf(page) {
  const txt = (await page.locator("body").innerText().catch(() => "")) || "";
  const alerts = await page.locator('[role="alert"]').count();
  const denied = /access denied|you (do not|don't) have|forbidden|not authoris|not authoriz/i.test(txt);
  const failed = /couldn'?t load|could not load|something went wrong|failed to|404|not found/i.test(txt);
  return { alerts, denied, failed, txt: txt.replace(/\n{2,}/g, "\n").slice(0, 2500) };
}

async function visit(page, name, route, { retry = true } = {}) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  let st = await statusOf(page);
  if (retry && (st.alerts > 0 || st.failed)) {
    say(`   !! ${route} showed an error/alert state — RETRYING`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    st = await statusOf(page);
    st.retried = true;
  }
  say(`-- ${name} ${route} :: url=${page.url()} alerts=${st.alerts} denied=${st.denied} failed=${st.failed}${st.retried ? " (after retry)" : ""}`);
  say("   TEXT >>>", st.txt.replace(/\n/g, " | ").slice(0, 900));
  await shot(page, name);
  return st;
}

async function main() {
  const browser = await chromium.launch();

  // ---------------- 1. PUBLIC surfaces: QR self-registration for diners ----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await ctx.newPage();
    for (const r of ["/register", "/join", "/loyalty", "/signup", "/enroll", "/r/floating-terrace", "/public/loyalty", "/app/crm"]) {
      const resp = await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" }).catch(() => null);
      await page.waitForTimeout(1200);
      say(`PUBLIC ${r} -> http=${resp ? resp.status() : "ERR"} landed=${page.url()}`);
    }
    await shot(page, "public-register-attempt");
    await ctx.close();
  }

  // ---------------- 2. MANAGER: the CRM screen ----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => say("   ! page error:", String(e).slice(0, 160)));
    const ok = await login(page, PERSONAS.manager);
    say(`MANAGER login ok=${ok} url=${page.url()}`);
    if (ok) {
      await visit(page, "manager-dashboard", "/app/dashboard");
      // Sidebar: is there a CRM entry at all, and what sits under it?
      const nav = await page.locator("nav, aside").first().innerText().catch(() => "");
      say("SIDEBAR >>>", nav.replace(/\n/g, " | ").slice(0, 1200));

      const crm = await visit(page, "manager-crm", "/app/crm");
      // Enumerate every interactive control on the CRM page — this is the whole product surface.
      const controls = await page.evaluate(() =>
        Array.from(document.querySelectorAll("button, a[href], input, select, [role=tab]"))
          .map((e) => `${e.tagName}:${(e.getAttribute("aria-label") || e.textContent || e.getAttribute("placeholder") || "").trim().slice(0, 50)}`)
          .filter((s) => s.length > 4),
      );
      say("CRM CONTROLS >>>", JSON.stringify(controls));

      // Search a customer by phone.
      const box = page.locator('input[type="search"], input[placeholder*="hone" i], input[placeholder*="earch" i]');
      if (await box.count()) {
        await box.first().fill("03");
        await page.waitForTimeout(2500);
        await shot(page, "manager-crm-search-03");
        say("SEARCH RESULT >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1200));
        // Click the first row and inspect the detail panel.
        const row = page.locator("table tbody tr, ul li button, [role=row]").first();
        if (await row.count()) {
          await row.click().catch(() => {});
          await page.waitForTimeout(2000);
          await shot(page, "manager-crm-customer-detail");
          say("DETAIL >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1500));
        }
      } else {
        say("!! no search box found on /app/crm");
      }
      void crm;

      // Settings: is there ANY loyalty-programme configuration?
      await visit(page, "manager-settings", "/app/settings");
      const settingsText = await page.locator("body").innerText().catch(() => "");
      say("SETTINGS mentions loyalty/points/rewards?",
        /loyalt|points|reward|tier|promotion|campaign|referral|cashback|subscription|membership/i.test(settingsText));
    }
    await ctx.close();
  }

  // ---------------- 3. CASHIER at the till: find by phone + apply rewards ----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await ctx.newPage();
    const ok = await login(page, PERSONAS.cashier);
    say(`CASHIER login ok=${ok} url=${page.url()}`);
    if (ok) {
      await visit(page, "cashier-pos", "/app/pos");
      // Add an item so there is a bill to discount.
      const tile = page.locator('button:has-text("Rs"), [data-testid*="menu-item"], .menu-item, button').filter({ hasText: /Rs|PKR|\d{2,}/ });
      const n = await tile.count();
      say(`POS menu tiles found: ${n}`);
      if (n) {
        await tile.first().click().catch(() => {});
        await page.waitForTimeout(1500);
        // modifier dialog may open — confirm dialog width (the 24px regression)
        const dlg = page.locator('[role="dialog"]');
        if (await dlg.count()) {
          const bb = await dlg.first().boundingBox();
          say(`POS item dialog box: ${JSON.stringify(bb)}`);
          await shot(page, "cashier-pos-item-dialog");
          const confirm = dlg.locator('button:has-text("Add"), button:has-text("Confirm"), button:has-text("Save")');
          if (await confirm.count()) await confirm.first().click().catch(() => {});
          await page.waitForTimeout(1200);
        }
      }
      await shot(page, "cashier-pos-cart");

      // Attach a customer by typing a phone number.
      const addBtn = page.locator('button:has-text("Add customer")');
      say(`POS "Add customer" button present: ${await addBtn.count()}`);
      if (await addBtn.count()) {
        await addBtn.first().click();
        await page.waitForTimeout(800);
        const inp = page.locator('input[aria-label="Search for a customer"]');
        await inp.fill("0300");
        await page.waitForTimeout(2500);
        await shot(page, "cashier-pos-customer-search");
        say("PICKER >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1400));
        const first = page.locator('ul li button').first();
        if (await first.count()) {
          await first.click();
          await page.waitForTimeout(1500);
          await shot(page, "cashier-pos-customer-attached");
          const panel = await page.locator("body").innerText();
          say("ATTACHED >>>", panel.replace(/\n/g, " | ").slice(0, 1600));
          say("POS offers redeem/points/discount control?",
            /redeem|apply points|use points|reward|voucher|loyalty discount/i.test(panel));
          const allBtns = await page.evaluate(() =>
            Array.from(document.querySelectorAll("button")).map((b) => b.textContent.trim().slice(0, 40)).filter(Boolean));
          say("POS BUTTONS >>>", JSON.stringify(allBtns));
        } else {
          say("!! no customer matched 0300 in the picker");
        }
      }
    }
    await ctx.close();
  }

  // ---------------- 4. TENANT ADMIN: loyalty programme admin choice? ----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await ctx.newPage();
    const ok = await login(page, PERSONAS.admin);
    say(`ADMIN login ok=${ok} url=${page.url()}`);
    if (ok) {
      const nav = await page.locator("nav, aside").first().innerText().catch(() => "");
      say("ADMIN SIDEBAR >>>", nav.replace(/\n/g, " | ").slice(0, 1600));
      await visit(page, "admin-settings", "/app/settings");
      for (const [n, r] of [
        ["admin-crm", "/app/crm"],
        ["admin-loyalty-guess", "/app/crm/loyalty"],
        ["admin-promotions-guess", "/app/crm/promotions"],
        ["admin-campaigns-guess", "/app/crm/campaigns"],
        ["admin-settings-loyalty-guess", "/app/settings/loyalty"],
      ]) {
        await visit(page, n, r, { retry: false });
      }
    }
    await ctx.close();
  }

  await browser.close();
  writeFileSync(`${OUT}/run-log.txt`, log.join("\n"));
  say("\nlog ->", `${OUT}/run-log.txt`);
}

main().catch((e) => {
  console.error(e);
  writeFileSync(`${OUT}/run-log.txt`, log.join("\n") + "\nFATAL " + String(e));
  process.exit(1);
});
