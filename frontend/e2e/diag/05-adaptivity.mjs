/*
 * (b) Can a tenant CHOOSE an operating model, and does the app behave differently?
 * Driven on the seeded working tenant so there is real menu/table data behind it.
 */
import { launch, login, visit, OUT, BASE } from "./onboarding-lib.mjs";

const STAMP = Date.now().toString().slice(-4);
const { browser, page } = await launch();
try {
  await login(page, "owner");

  // --- 1. The terminals screen: what "operating models" are on offer?
  await visit(page, "/app/terminals", "ad-01-terminals", { chars: 900 });
  const add = page.getByRole("button", { name: /add terminal/i });
  await add.first().click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/ad-02-terminal-dialog.png`, fullPage: true });
  const dlg = page.locator('[role="dialog"]').last();
  const box = await dlg.boundingBox();
  console.log("TERMINAL DIALOG BOX:", JSON.stringify(box));
  console.log("TERMINAL DIALOG TEXT:", (await dlg.innerText()).replace(/\s+/g, " ").slice(0, 1200));
  const selects = await dlg.locator("select").evaluateAll((els) =>
    els.map((e) => ({ id: e.id, options: [...e.options].map((o) => o.value) })),
  );
  console.log("TERMINAL SELECTS:", JSON.stringify(selects));

  // Create a SELF_SERVE kiosk terminal
  const inputs = await dlg.locator("input").evaluateAll((els) => els.map((e) => ({ id: e.id, type: e.type })));
  console.log("TERMINAL INPUTS:", JSON.stringify(inputs));
  const codeInput = dlg.locator("input").first();
  await codeInput.fill(`KIOSK${STAMP}`);
  await dlg.locator("input").nth(1).fill(`Diag Kiosk ${STAMP}`);
  for (const s of selects) {
    if (s.options.includes("SELF_SERVE")) await dlg.locator(`#${s.id}`).selectOption("SELF_SERVE");
  }
  await page.screenshot({ path: `${OUT}/ad-03-kiosk-filled.png`, fullPage: true });
  const saveBtn = dlg.getByRole("button", { name: /create|save|add/i }).last();
  await saveBtn.click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/ad-04-kiosk-created.png`, fullPage: true });
  console.log("AFTER SAVE:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 900));

  // --- 2. Does the POS know about terminals at all?
  const pos = await visit(page, "/app/pos", "ad-05-pos-after-kiosk", { chars: 1200 });
  console.log("POS mentions terminal picker?", /choose a terminal|which till|terminal:/i.test(pos.text));
  const posSelects = await page.locator("select").evaluateAll((els) =>
    els.map((e) => ({ id: e.id, name: e.name, options: [...e.options].map((o) => o.textContent) })),
  );
  console.log("POS SELECTS:", JSON.stringify(posSelects).slice(0, 800));
  const posButtons = await page.locator("button").allInnerTexts();
  console.log("POS BUTTONS:", JSON.stringify(posButtons.slice(0, 30)));

  // --- 3. Tables: is there a floor plan / areas / QR per table?
  await visit(page, "/app/tables", "ad-06-tables", { chars: 1200 });
  const tAdd = page.getByRole("button", { name: /add table/i });
  if (await tAdd.count()) {
    await tAdd.first().click();
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${OUT}/ad-07-table-dialog.png`, fullPage: true });
    const td = page.locator('[role="dialog"]').last();
    console.log("TABLE DIALOG BOX:", JSON.stringify(await td.boundingBox()));
    console.log("TABLE DIALOG:", (await td.innerText()).replace(/\s+/g, " ").slice(0, 900));
    const tLabels = await td.locator("label").allInnerTexts();
    console.log("TABLE FIELDS:", JSON.stringify(tLabels));
    await page.keyboard.press("Escape");
  }

  // --- 4. Settings: the whole tenant-configuration surface
  await visit(page, "/app/settings", "ad-08-settings", { chars: 2500 });
  const sLabels = await page.locator("label").allInnerTexts();
  console.log("SETTINGS FIELDS:", JSON.stringify(sLabels));
  const sLinks = await page.locator("a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  console.log("SETTINGS LINKS:", JSON.stringify([...new Set(sLinks)].slice(0, 40)));
} catch (e) {
  console.error("FAILED:", e.message);
  await page.screenshot({ path: `${OUT}/ad-FAIL.png`, fullPage: true });
} finally {
  await browser.close();
}
