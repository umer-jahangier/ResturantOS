/* Pass 9: once a shift exists or a person is rostered, can either be undone from the screen? */
import { newBrowser, ctxPage, login, visit, shot, PERSONAS } from "./hr-lib.mjs";

const browser = await newBrowser();
const { page } = await ctxPage(browser);
page.on("response", (r) => {
  if (r.url().includes("/hr/shifts") && r.request().method() !== "GET")
    console.log(`    NET ${r.request().method()} ${r.url().split("/api")[1]} -> ${r.status()}`);
});
await login(page, PERSONAS.owner);
await visit(page, "/app/hr/schedule", { persona: PERSONAS.owner });

const chips = page.locator("td").locator('[draggable="true"], span, div').filter({ hasText: /TESt|test|Diag/ });
console.log("assigned chips in the grid:", await page.locator("td").filter({ hasText: /TESt|Diag/ }).count());

const cell = page.locator("td").filter({ hasText: /TESt|Diag/ }).first();
if (await cell.count()) {
  console.log("cell html:", (await cell.innerHTML()).slice(0, 600));
  await cell.click({ button: "right" }).catch(() => {});
  await page.waitForTimeout(1200);
  console.log("after right-click, any menu?", await page.locator('[role="menu"]').count());
  await cell.dblclick().catch(() => {});
  await page.waitForTimeout(1200);
  console.log("after dblclick, dialogs?", await page.locator('[role="dialog"]').count());
  await shot(page, "09-roster-chip-interactions");
}

console.log("\nbuttons anywhere on the schedule page:", JSON.stringify(await page.locator("button").allInnerTexts()));
await shot(page, "09-schedule-full");
await browser.close();
