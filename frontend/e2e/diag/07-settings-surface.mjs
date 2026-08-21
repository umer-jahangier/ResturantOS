/* (d) Settings architecture, and the dialogs an owner must fill to open a restaurant. */
import { launch, login, visit, OUT, BASE } from "./onboarding-lib.mjs";

const { browser, page } = await launch();
async function dump(name, opener) {
  const btn = page.getByRole("button", { name: opener });
  if (!(await btn.count())) { console.log(`  no "${opener}" button`); return; }
  await btn.first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  const d = page.locator('[role="dialog"]').last();
  if (!(await d.count())) { console.log(`  ${name}: no dialog appeared`); return; }
  console.log(`  ${name} BOX:`, JSON.stringify(await d.boundingBox()));
  console.log(`  ${name} LABELS:`, JSON.stringify(await d.locator("label").allInnerTexts()));
  console.log(`  ${name} TEXT:`, (await d.innerText()).replace(/\s+/g, " ").slice(0, 800));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
}
try {
  await login(page, "owner");
  const s = await visit(page, "/app/settings", "st-01-settings", { chars: 2500 });
  console.log("SETTINGS LABELS:", JSON.stringify(await page.locator("label").allInnerTexts()));
  const links = await page.locator("main a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  console.log("SETTINGS LINKS:", JSON.stringify([...new Set(links)]));
  await page.waitForTimeout(3000);

  await visit(page, "/app/tables", "st-02-tables", { chars: 400 });
  await dump("st-03-table-dialog", /add table/i);
  await page.waitForTimeout(3000);

  await visit(page, "/app/users", "st-04-users", { chars: 400 });
  await dump("st-05-user-dialog", /add user/i);
  await page.waitForTimeout(3000);

  await visit(page, "/app/stations", "st-06-stations", { chars: 400 });
  await dump("st-07-station-dialog", /add station/i);
  await page.waitForTimeout(3000);

  await visit(page, "/app/menu/items", "st-08-menu", { chars: 400 });
  await dump("st-09-item-dialog", /add item/i);
} catch (e) {
  console.error("FAILED:", e.message);
  await page.screenshot({ path: `${OUT}/st-FAIL.png`, fullPage: true });
} finally {
  await browser.close();
}
