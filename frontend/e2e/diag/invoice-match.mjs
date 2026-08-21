// DIAGNOSIS ONLY — can a user reach the three-way match screen and act on a mismatch?
import { chromium } from "@playwright/test";
const BASE = "http://localhost:3000";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/inventory-purchasing";
const P = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };

async function login(page, p) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill(p.slug);
  await page.locator('input#email, input[name="email"]').first().fill(p.email);
  await page.locator('input#password, input[name="password"]').first().fill(p.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);
}
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
const page = await ctx.newPage();
// Retry the sign-in until it takes — a logged-out page reads exactly like a missing feature.
for (let i = 1; i <= 4; i++) {
  await login(page, P);
  if (!page.url().includes("/login")) { console.log(`signed in (attempt ${i})`); break; }
  console.log(`login attempt ${i} failed, retrying`);
  await page.waitForTimeout(4000);
}
if (page.url().includes("/login")) { console.log("COULD NOT SIGN IN — aborting rather than reporting a login page"); await browser.close(); process.exit(1); }

await page.goto(`${BASE}/app/purchasing/invoices`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6500);
const anchors = await page.evaluate(() =>
  [...document.querySelectorAll("a")].map((a) => a.getAttribute("href")).filter((h) => h && h.includes("invoice")));
console.log("invoice links on list:", JSON.stringify(anchors.slice(0, 6)));
const btns = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean));
console.log("invoice list buttons:", JSON.stringify(btns.filter((x) => !/Collapse|Search|^F$|Floating Terrace HQ/.test(x))));

// Click the MISMATCHED invoice row — that is the one a buyer must act on.
const mis = page.locator("tr").filter({ hasText: /MISMATCHED/ });
console.log("mismatched rows:", await mis.count());
if (await mis.count()) {
  await mis.first().click();
  await page.waitForTimeout(5000);
  console.log("after clicking mismatched row, url =", page.url());
}
if (anchors.length) {
  await page.goto(`${BASE}${anchors[0]}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const t = await page.locator("body").innerText();
  const b2 = await page.evaluate(() => [...document.querySelectorAll("button")].map((x) => x.innerText.trim()).filter(Boolean));
  console.log("\n=== INVOICE DETAIL", page.url());
  console.log("buttons:", JSON.stringify(b2.filter((x) => !/Collapse|Search|^F$|Floating Terrace HQ/.test(x))));
  console.log((t.split("Collapse").pop() || t).replace(/\n{2,}/g, "\n").slice(0, 2000));
  await page.screenshot({ path: `${OUT}/invoice-detail.png`, fullPage: true });
}
// Book Invoice dialog
await page.goto(`${BASE}/app/purchasing/invoices`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
const bi = page.locator("button").filter({ hasText: /Book Invoice/i });
if (await bi.count()) {
  await bi.first().click();
  await page.waitForTimeout(2500);
  const dlg = page.locator('[role="dialog"]');
  if (await dlg.count()) {
    const box = await dlg.first().boundingBox();
    console.log(`\n=== BOOK INVOICE DIALOG size=${box ? Math.round(box.width) + "x" + Math.round(box.height) : "none"}`);
    console.log((await dlg.first().innerText()).replace(/\n{2,}/g, "\n").slice(0, 1500));
    await page.screenshot({ path: `${OUT}/book-invoice-dialog.png`, fullPage: false });
  } else console.log("BOOK INVOICE DIALOG DID NOT OPEN");
}
await browser.close();
