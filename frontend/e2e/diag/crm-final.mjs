// DIAGNOSIS ONLY — two loose ends:
//  (1) the manager's access to /app/crm flapped mid-session in an earlier run;
//  (2) is there ANY admin choice of loyalty model, e.g. on the platform tenant console?
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/crm-loyalty");
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });
const log = [];
const say = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); say("   shot:", n + ".png"); };

async function login(page, email, password, slug = "floating-terrace") {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1300);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (slug && (await s.count())) await s.first().fill(slug);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);
  return !page.url().includes("/login");
}

async function main() {
  const browser = await chromium.launch();

  // (1) manager /app/crm three times in one session
  const c1 = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const p1 = await c1.newPage();
  say("manager login:", await login(p1, "manager@terrace.local", "Terrace#Manager1"));
  for (let i = 1; i <= 3; i++) {
    await p1.goto(`${BASE}/app/crm`, { waitUntil: "domcontentloaded" });
    await p1.waitForTimeout(4500);
    const b = await p1.locator("body").innerText();
    say(`manager /app/crm attempt ${i}: denied=${/Access denied/i.test(b)} sidebarHasCustomers=${/Customers/.test(b)}`);
    if (i === 3) await shot(p1, "final-manager-crm-attempt3");
    await p1.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
    await p1.waitForTimeout(3000);
  }
  await c1.close();

  // (2) SuperAdmin platform console — module toggles / loyalty model choice
  const c2 = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const p2 = await c2.newPage();
  say("superadmin login:", await login(p2, "superadmin@softxlogic.com", "Test@123!", ""));
  await p2.goto(`${BASE}/platform/tenants`, { waitUntil: "domcontentloaded" });
  await p2.waitForTimeout(5000);
  await shot(p2, "final-platform-tenants");
  const row = p2.locator("table tbody tr, a[href*='/platform/tenants/']").first();
  if (await row.count()) { await row.click().catch(() => {}); await p2.waitForTimeout(5500); }
  await shot(p2, "final-platform-tenant-detail");
  const t = await p2.locator("body").innerText();
  say("PLATFORM TENANT DETAIL >>>", t.replace(/\n/g, " | ").slice(0, 2200));
  say("mentions CRM module toggle?", /CRM/i.test(t));
  say("mentions any loyalty MODEL choice (points/visit/tier/cashback/punch)?",
    /points-per|visit-based|punch|cashback|store credit|tiered membership|loyalty model/i.test(t));
  await c2.close();

  await browser.close();
  writeFileSync(`${OUT}/final-log.txt`, log.join("\n"));
}
main().catch((e) => { console.error(e); writeFileSync(`${OUT}/final-log.txt`, log.join("\n") + "\nFATAL " + e); process.exit(1); });
