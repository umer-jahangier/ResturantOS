/*
 * F16 RE-OPEN — Stage B. The data-loss half, and the field-by-field edits nobody tried.
 *
 * Their proof edited the DESCRIPTION only. The original S0-03 defect was "a PUT that omits a
 * tax key destroys it", so the honest test is EVERY other field on the same PUT, one at a
 * time, through the real dialog:
 *      description-only   (theirs)
 *      NAME-only
 *      PRICE-only
 *      the CATEGORY's name only — does the category keep its tax rule?
 *      toggling the dish INACTIVE and back
 * Each one reloads the page and re-reads rate AND code.
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet as rawGet, apiSend as rawSend, tokenOf, log } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F16-reopen");
const A = JSON.parse(readFileSync(`${OUT}/stage-a.json`, "utf8"));
const S = A.S, CAT = A.CAT;
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); log(`    shot ${n}`); };
const F = {};
const rec = (k, v) => { F[k] = v; log(`  > ${k}: ${JSON.stringify(v)}`); };

const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
let TOK = await tokenOf(owner);
const apiGet = (p) => rawGet(owner, p, TOK);

const readItems = async () => {
  const r = await apiGet(`/api/v1/pos/menu/items?categoryId=${CAT}&size=50`);
  const arr = r.body?.data?.content ?? r.body?.content ?? r.body?.data ?? r.body ?? [];
  return (Array.isArray(arr) ? arr : []).map((i) => ({
    name: i.name.replace(` ${S}`, ""), rate: i.effectiveTaxRatePct, code: i.effectiveTaxRateCode,
    src: i.taxSource, own: i.taxClassId ? "set" : null, desc: i.description, price: i.basePricePaisa,
  })).sort((a, b) => a.name.localeCompare(b.name));
};
const of = (rows, n) => rows.find((r) => r.name === n);

const openMenu = async (label) => {
  await go(owner, "/app/menu/items", { waitMs: 4000 });
  const b = owner.locator(`button[aria-label="Actions for ${label}"]`);
  await b.scrollIntoViewIfNeeded();
  await b.click();
  await owner.waitForTimeout(800);
};
const openEdit = async (label) => {
  await openMenu(label);
  await owner.getByRole("menuitem", { name: /^edit/i }).first().click();
  await owner.waitForTimeout(2000);
};
const saveDialog = async () => {
  await owner.locator('[role="dialog"] button[type="submit"], [role="dialog"] button:has-text("Save")').first().click();
  await owner.waitForTimeout(3000);
};

log("\n=== B0. baseline ===");
rec("baseline", await readItems());

// ── B1. DESCRIPTION only, on the OVERRIDDEN dish (their case) ───────────────
log("\n=== B1. description-only on RX Gamma (the ITEM override) ===");
await openEdit(`RX Gamma ${S}`);
await owner.locator('[role="dialog"] textarea, [role="dialog"] input[name=description]').first().fill(`desc-changed-${S}`);
await shot(owner, "b01-gamma-desc-edit");
await saveDialog();
await owner.reload({ waitUntil: "domcontentloaded" });
await owner.waitForTimeout(2500);
rec("afterDescOnly_Gamma", of(await readItems(), "RX Gamma"));

// ── B2. NAME only, on an INHERITING dish ────────────────────────────────────
log("\n=== B2. name-only on RX Alpha (inherits from category) ===");
await openEdit(`RX Alpha ${S}`);
await owner.locator('[role="dialog"] input[name=name]').first().fill(`RX Alpha ${S} R`);
await shot(owner, "b02-alpha-name-edit");
await saveDialog();
await owner.reload({ waitUntil: "domcontentloaded" });
await owner.waitForTimeout(2500);
rec("afterNameOnly_Alpha", (await readItems()).find((r) => r.name.startsWith("RX Alpha")));

// ── B3. PRICE only, on an inheriting dish ───────────────────────────────────
log("\n=== B3. price-only on RX Beta ===");
await openEdit(`RX Beta ${S}`);
const priceInput = owner.locator('[role="dialog"] input[name=basePrice], [role="dialog"] input[name=basePricePaisa], [role="dialog"] input[inputmode=decimal]').first();
await priceInput.fill("333");
await shot(owner, "b03-beta-price-edit");
await saveDialog();
await owner.reload({ waitUntil: "domcontentloaded" });
await owner.waitForTimeout(2500);
rec("afterPriceOnly_Beta", of(await readItems(), "RX Beta"));

// ── B4. the CATEGORY's NAME only — does the RULE survive? ───────────────────
log("\n=== B4. category name-only edit — does the category keep its tax rule? ===");
await go(owner, "/app/menu/items", { waitMs: 4000 });
const cb = owner.locator(`button[aria-label="Actions for RX Cat ${S}"]`);
await cb.scrollIntoViewIfNeeded();
await cb.click();
await owner.waitForTimeout(800);
await owner.getByRole("menuitem", { name: /^edit/i }).first().click();
await owner.waitForTimeout(2000);
rec("catDialogTaxBefore", await owner.evaluate(() => {
  const s = document.querySelector("[data-testid=category-tax-class]");
  return s ? s.options[s.selectedIndex]?.textContent?.trim() : null;
}));
await owner.locator('[role="dialog"] input[name=name]').first().fill(`RX Cat ${S} R`);
await shot(owner, "b04-category-name-edit");
await saveDialog();
await owner.reload({ waitUntil: "domcontentloaded" });
await owner.waitForTimeout(2500);
rec("afterCategoryNameOnly", await readItems());

// ── B5. deactivate + reactivate the overridden dish ─────────────────────────
log("\n=== B5. deactivate / reactivate RX Gamma ===");
await openMenu(`RX Gamma ${S}`);
const deact = owner.getByRole("menuitem", { name: /deactivate|disable/i });
if (await deact.count()) { await deact.first().click(); await owner.waitForTimeout(2500); }
else { await owner.keyboard.press("Escape"); rec("deactivateMenuItem", "absent"); }
await go(owner, "/app/menu/items", { waitMs: 3000 });
const showInactive = owner.locator('input[type=checkbox]').first();
if (await showInactive.count()) { await showInactive.check().catch(() => {}); await owner.waitForTimeout(1500); }
await openMenu(`RX Gamma ${S}`);
const react = owner.getByRole("menuitem", { name: /activate/i });
if (await react.count()) { await react.first().click(); await owner.waitForTimeout(2500); }
else await owner.keyboard.press("Escape");
rec("afterDeactivateReactivate", of(await readItems(), "RX Gamma"));

// ── B6. RETIRE the class the category depends on ────────────────────────────
log("\n=== B6. retire the standard class while a category still uses it ===");
await go(owner, "/app/settings/tax", { waitMs: 3500 });
const rowInfo = await owner.evaluate((code) => {
  const rows = Array.from(document.querySelectorAll("[data-testid=tax-class-row]"));
  const row = rows.find((r) => Array.from(r.querySelectorAll("input")).some((i) => i.value === code));
  if (!row) return null;
  row.scrollIntoView({ block: "center" });
  const usage = row.querySelector("[data-testid=tax-class-usage]")?.textContent?.trim() ?? null;
  const del = row.querySelector("[data-testid=delete-tax-class]");
  return { usage, deleteDisabled: del?.disabled ?? null };
}, `RX-STD-${S}`);
rec("classInUse", rowInfo);
await shot(owner, "b05-class-in-use");

// retire (deactivate) it — items already pointing at it must KEEP the rate
await owner.evaluate((code) => {
  const rows = Array.from(document.querySelectorAll("[data-testid=tax-class-row]"));
  const row = rows.find((r) => Array.from(r.querySelectorAll("input")).some((i) => i.value === code));
  row?.querySelector("[data-testid=toggle-tax-class-active]")?.click();
}, `RX-STD-${S}`);
await owner.waitForTimeout(3000);
rec("afterRetire", await readItems());
await shot(owner, "b06-after-retire");

writeFileSync(`${OUT}/stage-b.json`, JSON.stringify(F, null, 2));
log("\nSTAGE B written");
await browser.close();
