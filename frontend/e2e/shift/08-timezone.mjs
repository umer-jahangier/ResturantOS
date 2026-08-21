/*
 * SHIFT STEP 8 — the branch says its business dates are cut on its own time zone.
 * Are they? And does the item editor carry a tax code now?
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, apiGet, tokenOf, log } from "./lib.mjs";

const st = loadState();
const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);

await go(owner, "/app/settings", { waitMs: 7000 });
await shot(owner, "08a-branch-settings");
const settings = await owner.evaluate(() => {
  const out = {};
  for (const l of document.querySelectorAll("label")) {
    const name = l.textContent.replace(/\s+/g, " ").trim().slice(0, 40);
    const c = l.querySelector("input,select,textarea") ?? document.getElementById(l.getAttribute("for") ?? "");
    if (c) out[name] = c.value ?? c.textContent;
  }
  return out;
});
log("  branch settings:", JSON.stringify(settings, null, 1));
saveState({ branchSettings: settings });

log("\n  server now:", new Date().toISOString());
log("  my CASH payment recordedAt: 2026-08-12T02:59:24.132156Z  (shown by Transactions as 8/12/2026 7:59 AM)");
log("  Takings put it on business date 2026-08-11; asking Takings for 2026-08-12 gives 0 orders.");

// The item editor — did the tax code field survive?
await go(owner, "/app/menu/items", { waitMs: 9000 });
await shot(owner, "08b-menu-items");
const rows = await owner.evaluate(() => ({
  rows: document.querySelectorAll("tbody tr").length,
  firstRow: document.querySelector("tbody tr")?.innerText.replace(/\s+/g, " ").trim() ?? null,
  headers: Array.from(document.querySelectorAll("thead th")).map((n) => n.textContent.trim()),
}));
log("  menu items:", JSON.stringify(rows));
if (rows.rows) {
  const trigger = owner.locator("tbody tr").first().locator("button").last();
  await trigger.click();
  await owner.waitForTimeout(1500);
  const menu = await owner.evaluate(() => Array.from(document.querySelectorAll("[role=menuitem]")).map((n) => n.textContent.trim()));
  log("  row menu:", JSON.stringify(menu));
  const edit = owner.getByRole("menuitem", { name: /^Edit/i });
  if (await edit.count()) {
    await edit.click();
    await owner.waitForTimeout(2500);
    await shot(owner, "08c-item-editor");
    const fields = await owner.evaluate(() => {
      const d = document.querySelector("[role=dialog]");
      if (!d) return null;
      return {
        labels: Array.from(d.querySelectorAll("label")).map((l) => l.textContent.replace(/\s+/g, " ").trim()),
        title: d.querySelector("h2,[id$=title]")?.textContent?.trim() ?? null,
      };
    });
    log("  item editor:", JSON.stringify(fields, null, 1));
    saveState({ itemEditor: fields });
  }
}

await browser.close();
log("\nstep 8 done");
