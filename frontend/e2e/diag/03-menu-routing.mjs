// (b) Can an admin route an ITEM or a whole CATEGORY to a station, from a screen?
import { chromium } from "@playwright/test";
import { login, openAndCheck, shot } from "./lib-login.mjs";

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
page.on("response", (res) => {
  const u = res.url();
  if (/station/i.test(u)) console.log(`  NET ${res.request().method()} ${res.status()} ${u.replace("http://localhost:8080", "")}`);
});

try {
  await login(page, { email: "admin@terrace.local", password: "Terrace#Admin1" });
  const r = await openAndCheck(page, "/app/menu/items");
  console.log("h1:", r.h1, "| denied:", r.denied, "| failed:", r.failed);

  // 1. the ITEM row "..." menu
  const itemMenus = page.locator('tbody tr button, [data-testid="menu-item-row"] button');
  console.log("\n--- ITEM row action menu ---");
  // find the row for Chicken Karahi
  const row = page.locator("div,tr").filter({ hasText: /^Chicken Karahi/ }).last();
  const dots = page.getByRole("button", { name: /more|actions|options/i });
  console.log("named-more buttons:", await dots.count());
  // fall back: click the last button in the Chicken Karahi row
  const rowBtns = row.getByRole("button");
  console.log("buttons in Chicken Karahi row:", await rowBtns.count().catch(() => -1));
  await rowBtns.last().click().catch((e) => console.log("  row menu click failed:", e.message));
  await page.waitForTimeout(1000);
  const menuItems = await page.getByRole("menuitem").allInnerTexts().catch(() => []);
  console.log("ITEM action menu entries:", JSON.stringify(menuItems));
  await shot(page, "b4-item-action-menu");
  const routeEntry = menuItems.find((m) => /station|route|destination|kitchen/i.test(m));
  console.log("=> item routing entry present:", routeEntry ?? "NONE");

  // open Edit and enumerate every field
  const editEntry = page.getByRole("menuitem", { name: /edit/i }).first();
  if (await editEntry.isVisible().catch(() => false)) {
    await editEntry.click();
    await page.waitForTimeout(1800);
    const dlg = page.locator('[role="dialog"]').first();
    const labels = await dlg.locator("label").allInnerTexts().catch(() => []);
    console.log("EDIT ITEM dialog labels:", JSON.stringify(labels));
    console.log("EDIT ITEM dialog mentions station:", /station|route|destination/i.test(await dlg.innerText().catch(() => "")));
    await shot(page, "b5-item-edit-dialog");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  } else {
    console.log("no Edit menuitem");
    await page.keyboard.press("Escape");
  }

  // 2. the CATEGORY header "..." menu
  console.log("\n--- CATEGORY action menu ---");
  await openAndCheck(page, "/app/menu/items");
  const catHeader = page.locator("div").filter({ hasText: /^Drinks/ }).last();
  const catBtns = catHeader.getByRole("button");
  console.log("buttons in Drinks category header:", await catBtns.count().catch(() => -1));
  await catBtns.last().click().catch((e) => console.log("  cat menu click failed:", e.message));
  await page.waitForTimeout(1000);
  const catMenu = await page.getByRole("menuitem").allInnerTexts().catch(() => []);
  console.log("CATEGORY action menu entries:", JSON.stringify(catMenu));
  await shot(page, "b6-category-action-menu");
  const catRoute = catMenu.find((m) => /station|route|destination|kitchen/i.test(m));
  console.log("=> CATEGORY routing entry present:", catRoute ?? "NONE");

  // 3. whole-app search for any routing screen
  console.log("\n--- routes that might host routing ---");
  for (const p of ["/app/menu/routing", "/app/menu/stations", "/app/settings/stations", "/app/menu/categories"]) {
    const res = await openAndCheck(page, p, { settle: 1500 });
    console.log(`  ${p} -> h1="${res.h1}"`);
  }
} catch (err) {
  console.error("FAILED:", err.message);
  await shot(page, "zz-menu-routing-failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
