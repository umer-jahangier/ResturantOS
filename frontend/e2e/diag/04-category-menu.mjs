// Precisely enumerate the CATEGORY header "..." menu on /app/menu/items
import { chromium } from "@playwright/test";
import { login, openAndCheck, shot } from "./lib-login.mjs";

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
try {
  await login(page, { email: "admin@terrace.local", password: "Terrace#Admin1" });
  await openAndCheck(page, "/app/menu/items");
  // Every button on the page, with its accessible name, so nothing is missed.
  const btns = await page.getByRole("button").evaluateAll((els) =>
    els.map((e) => ({ text: (e.textContent || "").trim().slice(0, 40), aria: e.getAttribute("aria-label") })));
  console.log("ALL buttons on menu items page:", JSON.stringify(btns, null, 0));

  // The category header row for "Drinks": find heading then its sibling menu trigger
  const drinksHeader = page.locator('h2,h3,[data-testid*="category"]').filter({ hasText: "Drinks" }).first();
  console.log("drinks header found:", await drinksHeader.count());
  // click the '...' trigger nearest the Drinks heading
  const trigger = page.locator('button[aria-haspopup="menu"]');
  console.log("menu-trigger buttons:", await trigger.count());
  for (let i = 0; i < Math.min(await trigger.count(), 12); i += 1) {
    const near = await trigger.nth(i).evaluate((el) => {
      const row = el.closest("div");
      return (row?.parentElement?.textContent || "").trim().slice(0, 50);
    });
    if (/Drinks/.test(near)) {
      console.log(`trigger #${i} is in the Drinks context: "${near}"`);
      await trigger.nth(i).click();
      await page.waitForTimeout(1000);
      console.log("  MENU ENTRIES:", JSON.stringify(await page.getByRole("menuitem").allInnerTexts()));
      await shot(page, "b7-drinks-category-menu");
      break;
    }
  }
} catch (err) {
  console.error("FAILED:", err.message);
} finally {
  await browser.close();
}
