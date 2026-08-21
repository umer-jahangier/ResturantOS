/*
 * PROBE A — is there ANY way, in any dialog on any reachable screen, to bind a menu item or a
 * category to a station? Attacks the "API_ONLY" verdict on routing from the highest-privilege
 * tenant persona, opening every create AND edit dialog rather than guessing from a URL list.
 */
import { launch, newPage, login, probe, shot, readDialog, api, BRANCH } from "./skpx-lib.mjs";

const persona = process.argv[2] ?? "owner";

async function openDialogFrom(page, buttonSel, label) {
  const b = page.locator(buttonSel).first();
  if (!(await b.count())) { console.log(`  [${label}] trigger not found: ${buttonSel}`); return null; }
  await b.click();
  await page.waitForTimeout(1400);
  const d = await readDialog(page);
  console.log(`  [${label}] dialog:`, JSON.stringify(d, null, 1));
  return d;
}

async function main() {
  const browser = await launch();
  const { page } = await newPage(browser);
  if (!(await login(page, persona))) process.exit(1);

  // ---------- MENU ITEMS ----------
  const mi = await probe(page, "/app/menu/items", { who: persona });
  console.log(`\n=== /app/menu/items (${persona}) 404=${mi.is404} denied=${mi.denied} failed=${mi.failed} heads=${JSON.stringify(mi.heads)}`);

  // ADD ITEM dialog
  await openDialogFrom(page, 'button:has-text("Add item")', "ADD ITEM");
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);

  // ADD CATEGORY dialog
  await openDialogFrom(page, 'button:has-text("Add category")', "ADD CATEGORY");
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);

  // EDIT dialog for an actual ITEM (not a category)
  for (const itemName of ["Chicken Karahi", "Fresh Lime", "Pinacolada"]) {
    const btn = page.locator(`button[aria-label="Actions for ${itemName}"]`).first();
    if (!(await btn.count())) { console.log(`  no action menu for ${itemName}`); continue; }
    await btn.click(); await page.waitForTimeout(700);
    const items = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map((n) => n.innerText.trim()));
    console.log(`  MENU for item "${itemName}" -> ${JSON.stringify(items)}`);
    const edit = page.locator('[role="menuitem"]').filter({ hasText: /^Edit$/ }).first();
    if (await edit.count()) {
      await edit.click(); await page.waitForTimeout(1500);
      const d = await readDialog(page);
      console.log(`  EDIT ITEM "${itemName}" dialog:`, JSON.stringify(d, null, 1));
      await shot(page, `skpx-a-edit-item-${itemName.replace(/\s+/g, "-")}`);
      // Does the word "station" appear anywhere in that dialog, incl. after scrolling?
      const hasStation = d && /station/i.test(d.text + JSON.stringify(d.labels) + JSON.stringify(d.combos));
      console.log(`  >>> item dialog offers a station field: ${hasStation}`);
      await page.keyboard.press("Escape"); await page.waitForTimeout(600);
    }
    break;
  }

  // ---------- STATIONS ----------
  const st = await probe(page, "/app/stations", { who: persona });
  console.log(`\n=== /app/stations 404=${st.is404} denied=${st.denied} failed=${st.failed}`);
  console.log("  body:", st.text.replace(/\s+/g, " ").slice(0, 900));
  await shot(page, `skpx-a-stations-${persona}`);
  console.log("  buttons:", JSON.stringify(await page.evaluate(() =>
    [...document.querySelectorAll("button")].map((b) => (b.innerText || b.getAttribute("aria-label") || "").trim()).filter(Boolean))));
  // does a station row offer anything that routes items to it?
  await openDialogFrom(page, 'button:has-text("Add station")', "ADD STATION");
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);

  // ---------- TERMINALS ----------
  const tm = await probe(page, "/app/terminals", { who: persona });
  console.log(`\n=== /app/terminals 404=${tm.is404} denied=${tm.denied} failed=${tm.failed}`);
  console.log("  body:", tm.text.replace(/\s+/g, " ").slice(0, 1200));
  await shot(page, `skpx-a-terminals-${persona}`);
  await openDialogFrom(page, 'button:has-text("Add terminal")', "ADD TERMINAL");
  await shot(page, `skpx-a-add-terminal-dialog`);
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);

  // ---------- what the API says right now ----------
  console.log("\n=== API cross-check (through the browser session) ===");
  for (const p of [
    `/api/v1/pos/stations?branchId=${BRANCH}`,
    `/api/v1/pos/terminals?branchId=${BRANCH}`,
    `/api/v1/pos/menu/items?branchId=${BRANCH}`,
    `/api/v1/pos/menu/categories?branchId=${BRANCH}`,
  ]) {
    const r = await api(page, p);
    const rows = Array.isArray(r.body) ? r.body : r.body?.data;
    console.log(`  ${p} -> ${r.status} rows=${Array.isArray(rows) ? rows.length : "n/a"}`);
    if (Array.isArray(rows) && /menu\/(items|categories)/.test(p)) {
      rows.forEach((x) => console.log(`      ${x.name} stationId=${x.stationId} eff=${x.effectiveStationCode ?? x.effectiveStationId}`));
    }
  }

  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
