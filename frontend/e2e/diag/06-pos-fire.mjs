// (d) does the POS obey a terminal profile?  (e) does a fired ticket reach the right station board?
import { chromium } from "@playwright/test";
import { login, openAndCheck, shot, BASE } from "./lib-login.mjs";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.on("response", (res) => {
  const u = res.url();
  if (/\/pos\/orders|\/kitchen\//.test(u) && res.request().method() !== "GET")
    console.log(`  NET ${res.request().method()} ${res.status()} ${u.replace("http://localhost:8080", "")}`);
});

try {
  console.log("== sign in as CASHIER (the person who works a till) ==");
  console.log(" ", await login(page, { email: "cashier@terrace.local", password: "Terrace#Cashier1" }));

  const r = await openAndCheck(page, "/app/pos", { settle: 3500 });
  console.log("  url:", r.url, "| h1:", r.h1, "| denied:", r.denied, "| failed:", r.failed);
  console.log("  alerts:", JSON.stringify(r.alerts).slice(0, 200));
  await shot(page, "d1-pos-as-cashier");

  // --- (d) is there ANY terminal selection on the till? ---
  const bodyText = r.body;
  console.log("\n-- terminal profile on the till --");
  console.log("  page mentions 'terminal':", /terminal/i.test(bodyText));
  const termPicker = page.getByTestId("terminal-picker");
  console.log("  [data-testid=terminal-picker] present:", await termPicker.count());
  const allBtns = await page.getByRole("button").evaluateAll((els) =>
    els.map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 32)).filter(Boolean));
  console.log("  buttons on POS:", JSON.stringify(allBtns.slice(0, 40)));
  // categories offered by the menu grid
  const grid = page.getByTestId("menu-grid");
  console.log("  menu-grid present:", await grid.count());
  const tabs = await page.getByRole("tab").allInnerTexts().catch(() => []);
  console.log("  CATEGORY TABS SHOWN ON TILL:", JSON.stringify(tabs));
  // localStorage / IndexedDB active terminal
  const ls = await page.evaluate(() => JSON.stringify(Object.keys(localStorage)));
  console.log("  localStorage keys:", ls);

  // --- (e) fire a spanning order: a MAIN and a DRINK ---
  console.log("\n== fire a spanning order (Chicken Karahi + Fresh Lime) ==");
  const items = await page.getByTestId("menu-grid").locator("button").allInnerTexts().catch(() => []);
  console.log("  menu grid buttons:", JSON.stringify(items.slice(0, 30)));

  async function addItem(name) {
    const btn = page.getByRole("button").filter({ hasText: new RegExp(name, "i") }).first();
    const ok = await btn.isVisible().catch(() => false);
    if (!ok) { console.log(`  !! could not find item button for ${name}`); return false; }
    await btn.click();
    await page.waitForTimeout(900);
    console.log(`  added ${name}`);
    return true;
  }
  // Drinks may be behind a category tab
  await addItem("Chicken Karahi");
  const drinksTab = page.getByRole("tab", { name: /drinks/i }).first();
  if (await drinksTab.isVisible().catch(() => false)) { await drinksTab.click(); await page.waitForTimeout(1200); }
  await addItem("Fresh Lime");
  await shot(page, "d2-pos-cart-spanning");
  console.log("  cart text:", (await page.locator("aside, [data-testid*=cart]").first().innerText().catch(() => "(no cart)")).replace(/\n+/g, " | ").slice(0, 400));

  const send = page.getByRole("button", { name: /send to kitchen|send order|fire/i }).first();
  console.log("  'Send to Kitchen' visible:", await send.isVisible().catch(() => false));
  if (await send.isVisible().catch(() => false)) {
    await send.click();
    await page.waitForTimeout(4000);
    await shot(page, "d3-after-send");
    console.log("  post-send page snippet:", (await page.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 400));
  }
} catch (err) {
  console.error("FAILED:", err.message);
  await shot(page, "zz-pos-failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
