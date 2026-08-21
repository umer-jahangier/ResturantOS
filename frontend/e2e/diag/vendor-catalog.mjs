// ATTACK 15: supplier catalogue and price lists — "Manage catalog →" off the vendors page.
// Neither report has touched this, and it is the data the reorder engine and the PO form depend on.
import { chromium, newCtx, login, probe, shot, assertSession, BASE } from "./lib.mjs";

const persona = process.argv[2] ?? "manager";
const stamp = Date.now().toString().slice(-6);

const dstate = (page) => page.evaluate(() => {
  const ds = [...document.querySelectorAll('[role="dialog"]')]; const d = ds[ds.length - 1];
  if (!d) return null;
  const r = d.getBoundingClientRect();
  return { size: `${Math.round(r.width)}x${Math.round(r.height)}`, title: (d.querySelector("h2,h3")?.innerText || "").trim(),
    labels: [...d.querySelectorAll("label")].map((l) => l.innerText.trim()).filter(Boolean),
    fields: [...d.querySelectorAll("input,textarea,select")].map((i) => i.name || i.getAttribute("aria-label") || i.type),
    buttons: [...d.querySelectorAll("button")].map((b) => `${b.innerText.trim()}${b.disabled ? "[DIS]" : ""}`).filter((t) => t && t !== "[DIS]") };
});

async function main() {
  const browser = await chromium.launch();
  const { page } = await newCtx(browser, { width: 1440, height: 950 });
  const api = [];
  page.on("response", (r) => { const u = r.url(); if (/\/purchasing\//.test(u) && r.request().method() !== "GET") api.push(`${r.request().method()} ${r.status()} ${u.split("/api/v1")[1]?.split("?")[0]}`); });
  if (!(await login(page, persona))) { console.log("LOGIN FAILED"); process.exit(1); }

  await probe(page, "/app/purchasing/vendors");
  await assertSession(page, "vendors");
  const link = page.locator('a:has-text("Manage catalog"), button:has-text("Manage catalog")').first();
  console.log("  'Manage catalog' controls:", await page.locator('a:has-text("Manage catalog"), button:has-text("Manage catalog")').count());
  await link.click();
  await page.waitForTimeout(5000);
  await assertSession(page, "catalog");
  console.log("\n=== VENDOR CATALOG ===");
  console.log("  url:", page.url());
  const d = await page.evaluate(() => {
    const t = document.querySelector("table");
    return { h: [...document.querySelectorAll("h1,h2")].map((x) => x.innerText.trim()),
      cols: t ? [...t.querySelectorAll("th")].map((x) => x.innerText.trim()) : [],
      rows: t ? [...t.querySelectorAll("tbody tr")].map((r) => r.innerText.replace(/\n/g, " | ")).slice(0, 5) : [],
      buttons: [...document.querySelectorAll("button")].map((b) => b.innerText.trim()).filter((x) => x && !/Collapse|Search|Floating|^F$/.test(x)).slice(0, 10),
      body: document.body.innerText.split("Analytics")[1]?.slice(0, 500).replace(/\n+/g, " | ") };
  });
  console.log("  h:", JSON.stringify(d.h));
  console.log("  cols:", JSON.stringify(d.cols));
  console.log("  rows:", JSON.stringify(d.rows));
  console.log("  buttons:", JSON.stringify(d.buttons));
  console.log("  body:", d.body);
  await shot(page, "vendor-catalog");

  // add a catalogue item
  const add = page.locator('button').filter({ hasText: /Add (item|catalog)/i }).first();
  if (await add.count()) {
    await add.click(); await page.waitForTimeout(2000);
    console.log("\n  ADD ITEM dialog:", JSON.stringify(await dstate(page)));
    await shot(page, "vendor-item-dialog");
    await page.keyboard.press("Escape"); await page.waitForTimeout(1000);
  }
  // price history / update price
  const price = page.locator('button').filter({ hasText: /price/i }).first();
  if (await price.count()) {
    await price.click(); await page.waitForTimeout(2000);
    console.log("\n  PRICE dialog:", JSON.stringify(await dstate(page)));
    await shot(page, "vendor-price-dialog");
  }
  await browser.close();
}
main();
