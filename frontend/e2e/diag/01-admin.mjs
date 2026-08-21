// (a) create a station  (b) route item/category to a station  (c) create a POS terminal with menu scope
import { chromium } from "@playwright/test";
import { login, openAndCheck, shot, BASE } from "./lib-login.mjs";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const stamp = Date.now() % 100000;

try {
  console.log("== sign in as tenant admin ==");
  console.log(" ", await login(page, { email: "admin@terrace.local", password: "Terrace#Admin1" }));

  // ---------- (a) STATIONS ----------
  console.log("\n== (a) /app/stations ==");
  let r = await openAndCheck(page, "/app/stations");
  console.log("  url:", r.url, "| h1:", r.h1, "| denied:", r.denied, "| failed:", r.failed);
  console.log("  alerts:", JSON.stringify(r.alerts).slice(0, 300));
  await shot(page, "a1-stations-list");
  const stationRowsBefore = await page.getByTestId("station-row").count().catch(() => -1);
  console.log("  station-row count:", stationRowsBefore);
  console.log("  visible station names:", JSON.stringify(
    (await page.locator("table tbody tr").allInnerTexts().catch(() => [])).slice(0, 20)));

  // try to create one from the screen
  const addBtn = page.getByRole("button", { name: /add station/i }).first();
  console.log("  'Add station' button visible:", await addBtn.isVisible().catch(() => false));
  if (await addBtn.isVisible().catch(() => false)) {
    await addBtn.click();
    await page.waitForTimeout(1200);
    // dialog width check — every dialog was 24px wide until recently
    const dlg = page.locator('[role="dialog"]').first();
    const box = await dlg.boundingBox().catch(() => null);
    console.log("  dialog box:", JSON.stringify(box));
    await shot(page, "a2-station-dialog");
    const fields = await dlg.locator("input,select,textarea,button[role=combobox]").count();
    console.log("  dialog form controls:", fields);
    await dlg.getByLabel(/^code$/i).fill(`DIAGBAR${stamp}`).catch((e) => console.log("  code fill failed:", e.message));
    await dlg.getByLabel(/^name$/i).fill(`Diag Bar ${stamp}`).catch((e) => console.log("  name fill failed:", e.message));
    // station type select
    const typeCombo = dlg.getByRole("combobox").first();
    if (await typeCombo.isVisible().catch(() => false)) {
      await typeCombo.click();
      await page.waitForTimeout(600);
      const opts = await page.getByRole("option").allInnerTexts().catch(() => []);
      console.log("  station TYPE options:", JSON.stringify(opts));
      const bar = page.getByRole("option", { name: /bar/i }).first();
      if (await bar.isVisible().catch(() => false)) await bar.click();
      else await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
    await shot(page, "a3-station-dialog-filled");
    const submit = dlg.getByRole("button", { name: /add station|create|save/i }).last();
    await submit.click().catch((e) => console.log("  submit failed:", e.message));
    await page.waitForTimeout(2500);
    const formErr = await page.getByTestId("station-form-error").innerText().catch(() => null);
    console.log("  form error:", formErr);
    await shot(page, "a4-after-station-create");
  }
  r = await openAndCheck(page, "/app/stations");
  const stationRowsAfter = await page.getByTestId("station-row").count().catch(() => -1);
  console.log("  station-row count AFTER reload:", stationRowsAfter, "(before:", stationRowsBefore + ")");
  console.log("  rows:", JSON.stringify((await page.locator("table tbody tr").allInnerTexts().catch(() => [])).slice(0, 20)));
  await shot(page, "a5-stations-after");

  // ---------- (b) MENU ROUTING ----------
  console.log("\n== (b) /app/menu/items — can an admin route an item or category to a station? ==");
  r = await openAndCheck(page, "/app/menu/items");
  console.log("  url:", r.url, "| h1:", r.h1, "| denied:", r.denied, "| failed:", r.failed);
  await shot(page, "b1-menu-items");
  const bodyLower = r.body.toLowerCase();
  console.log("  page mentions 'station':", bodyLower.includes("station"));
  console.log("  page mentions 'route':", bodyLower.includes("route"));
  console.log("  table column headers:", JSON.stringify(await page.locator("table thead th").allInnerTexts().catch(() => [])));
  // open the first item's edit dialog and look for a station field
  const firstEdit = page.getByRole("button", { name: /^edit$/i }).first();
  if (await firstEdit.isVisible().catch(() => false)) {
    await firstEdit.click();
    await page.waitForTimeout(1500);
    const dlg = page.locator('[role="dialog"]').first();
    const dlgText = await dlg.innerText().catch(() => "");
    console.log("  edit-dialog labels:", JSON.stringify(await dlg.locator("label").allInnerTexts().catch(() => [])));
    console.log("  edit dialog mentions station:", /station/i.test(dlgText));
    await shot(page, "b2-menu-item-edit-dialog");
    await page.keyboard.press("Escape");
  } else {
    console.log("  no Edit button found on menu items page");
  }
  // categories screen
  r = await openAndCheck(page, "/app/menu/categories");
  console.log("  categories url:", r.url, "| h1:", r.h1, "| denied:", r.denied);
  console.log("  categories page mentions station:", /station/i.test(r.body));
  console.log("  category headers:", JSON.stringify(await page.locator("table thead th").allInnerTexts().catch(() => [])));
  await shot(page, "b3-menu-categories");

  // ---------- (c) TERMINALS ----------
  console.log("\n== (c) /app/terminals ==");
  r = await openAndCheck(page, "/app/terminals");
  console.log("  url:", r.url, "| h1:", r.h1, "| denied:", r.denied, "| failed:", r.failed);
  console.log("  alerts:", JSON.stringify(r.alerts).slice(0, 300));
  await shot(page, "c1-terminals-list");
  const termBefore = await page.getByTestId("terminal-row").count().catch(() => -1);
  console.log("  terminal-row count:", termBefore);
  console.log("  rows:", JSON.stringify((await page.locator("table tbody tr").allInnerTexts().catch(() => [])).slice(0, 20)));

  const addTerm = page.getByRole("button", { name: /add terminal/i }).first();
  console.log("  'Add terminal' visible:", await addTerm.isVisible().catch(() => false));
  if (await addTerm.isVisible().catch(() => false)) {
    await addTerm.click();
    await page.waitForTimeout(1500);
    const dlg = page.locator('[role="dialog"]').first();
    console.log("  dialog box:", JSON.stringify(await dlg.boundingBox().catch(() => null)));
    await dlg.getByLabel(/^code$/i).fill(`DIAGTERM${stamp}`).catch((e) => console.log("  code:", e.message));
    await dlg.getByLabel(/^name$/i).fill(`Diag Bar Till ${stamp}`).catch((e) => console.log("  name:", e.message));
    await page.waitForTimeout(1500);
    const menuScope = page.getByTestId("menu-scope-picker");
    const hasScope = await menuScope.isVisible().catch(() => false);
    console.log("  menu-scope-picker present:", hasScope);
    if (hasScope) {
      const cats = await menuScope.locator("label").allInnerTexts();
      console.log("  categories offered in scope picker:", JSON.stringify(cats));
      // pick only the drinks-ish one, else the first
      const drink = cats.findIndex((c) => /drink|beverage|bar|juice|shake|tea|coffee/i.test(c));
      const idx = drink >= 0 ? drink : 0;
      console.log("  choosing category index", idx, "=", cats[idx]);
      await menuScope.locator("input[type=checkbox]").nth(idx).check();
    }
    const stPicker = page.getByTestId("station-set-picker");
    if (await stPicker.isVisible().catch(() => false)) {
      const st = await stPicker.locator("label").allInnerTexts();
      console.log("  stations offered:", JSON.stringify(st));
      const barIdx = st.findIndex((s) => /bar/i.test(s));
      if (barIdx >= 0) await stPicker.locator("input[type=checkbox]").nth(barIdx).check();
    }
    console.log("  menu scope summary:", await page.getByTestId("menu-scope-summary").innerText().catch(() => "(none)"));
    console.log("  station set summary:", await page.getByTestId("station-set-summary").innerText().catch(() => "(none)"));
    await shot(page, "c2-terminal-dialog-scoped");
    await dlg.getByRole("button", { name: /add terminal|create|save/i }).last().click().catch((e) => console.log("  submit:", e.message));
    await page.waitForTimeout(3000);
    console.log("  form error:", await page.getByTestId("terminal-form-error").innerText().catch(() => null));
  }
  r = await openAndCheck(page, "/app/terminals");
  const termAfter = await page.getByTestId("terminal-row").count().catch(() => -1);
  console.log("  terminal-row count AFTER:", termAfter, "(before:", termBefore + ")");
  console.log("  rows:", JSON.stringify((await page.locator("table tbody tr").allInnerTexts().catch(() => [])).slice(0, 20)));
  console.log("  menu summaries:", JSON.stringify(await page.getByTestId("terminal-menu-summary").allInnerTexts().catch(() => [])));
  await shot(page, "c3-terminals-after");
  console.log("\nSTAMP=" + stamp);
} catch (err) {
  console.error("FAILED:", err.message);
  await shot(page, "zz-admin-failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
