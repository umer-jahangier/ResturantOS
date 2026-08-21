/*
 * F16 RE-OPEN — PASS A. The whole DONE-MEANS, driven independently in real Chromium.
 *   node e2e/reopen/f16-reopen-a.mjs
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, apiSend, tokenOf, log } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/reopen/F16");
mkdirSync(OUT, { recursive: true });
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); log(`    shot ${n}.png`); };
const F = {};
const rec = (k, v) => { F[k] = v; log(`  > ${k}: ${JSON.stringify(v)}`); };

const S = Date.now().toString().slice(-6);
const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
const otok = await tokenOf(owner);

// ── setup (API): a fresh category with three dishes, no tax anywhere ──────────
log("\n=== setup ===");
const catRes = await apiSend(owner, "POST", "/api/v1/pos/menu/categories",
  { name: `ROPEN Cat ${S}`, description: null, sortOrder: 50, taxClassId: null }, otok);
const CAT = catRes.body?.data?.id;
rec("catCreated", { status: catRes.status, id: CAT });

const mk = async (name, paisa) => {
  const r = await apiSend(owner, "POST", "/api/v1/pos/menu/items", {
    categoryId: CAT, name, description: "reopen probe", basePricePaisa: paisa,
    taxRatePct: 0, taxRateCode: null, imageFileId: null, active: true, taxClassId: null,
  }, otok);
  return r.body?.data?.id;
};
const A = await mk(`ROPEN Alpha ${S}`, 100000);
const B = await mk(`ROPEN Bravo ${S}`, 50000);
const C = await mk(`ROPEN Charlie ${S}`, 20000);
rec("itemsCreated", { A, B, C });

// ── 1. the screen, as OWNER, through the browser ─────────────────────────────
log("\n=== 1. /app/settings/tax as OWNER ===");
let t = await go(owner, "/app/settings/tax", { waitMs: 3500 });
rec("taxPageTrouble", t.bad);
rec("taxH1", await owner.evaluate(() => document.querySelector("h1")?.textContent?.trim() ?? null));
await shot(owner, "a01-tax-page");

const addClass = async (code, name, rate) => {
  await owner.locator("[data-testid=add-tax-class]").first().click();
  await owner.waitForTimeout(700);
  await owner.locator("#new-tax-code").fill(code);
  await owner.locator("#new-tax-name").fill(name);
  await owner.locator("#new-tax-rate").fill(rate);
  await owner.waitForTimeout(300);
  await owner.locator("[data-testid=save-new-tax-class]").click();
  await owner.waitForTimeout(2500);
};
await addClass(`RO-STD-${S}`, `ROPEN Standard ${S}`, "17");
await addClass(`RO-ZERO-${S}`, `ROPEN Zero ${S}`, "0");
await shot(owner, "a02-two-classes");

const classes = (await apiGet(owner, "/api/v1/pos/tax-classes", otok)).body?.data ?? [];
const STD = classes.find((c) => c.code === `RO-STD-${S}`);
const ZERO = classes.find((c) => c.code === `RO-ZERO-${S}`);
rec("classesPersisted", { std: STD && { rate: STD.ratePct }, zero: ZERO && { rate: ZERO.ratePct } });

// ── helpers for the menu page ────────────────────────────────────────────────
const openCategoryEdit = async (name) => {
  await owner.locator(`button[aria-label="Actions for ${name}"]`).first().click();
  await owner.waitForTimeout(600);
  await owner.getByRole("menuitem", { name: "Edit", exact: true }).first().click();
  await owner.waitForTimeout(1400);
};
const openItemEdit = async (name) => {
  await owner.locator(`button[aria-label="Actions for ${name}"]`).first().click();
  await owner.waitForTimeout(600);
  await owner.getByRole("menuitem", { name: "Edit", exact: true }).first().click();
  await owner.waitForTimeout(1400);
};
const saveDialog = async () => {
  await owner.locator("[role=dialog] button", { hasText: /^(Save|Update|Save changes)$/i }).last().click();
  await owner.waitForTimeout(2600);
};
const readItems = async () => {
  const r = await apiGet(owner, "/api/v1/pos/menu/items?size=300", otok);
  return Object.fromEntries((r.body?.data ?? []).filter((i) => i.categoryId === CAT).map((i) => [
    i.name.replace(`ROPEN `, "").replace(` ${S}`, ""),
    { eff: i.effectiveTaxRatePct, code: i.effectiveTaxRateCode, label: i.effectiveTaxLabel,
      src: i.effectiveTaxSource, classId: i.taxClassId ? "set" : null,
      legacy: i.taxRatePct, legacyCode: i.taxRateCode, desc: i.description },
  ]));
};

// ── 2. apply the class to the CATEGORY through the dialog ────────────────────
log("\n=== 2. apply the standard class to the category, in the UI ===");
let m = await go(owner, "/app/menu/items", { waitMs: 4500 });
rec("menuPageTrouble", m.bad);
await shot(owner, "a03-menu-page");
await openCategoryEdit(`ROPEN Cat ${S}`);
await shot(owner, "a04-category-dialog");
rec("catSelectBefore", await owner.evaluate(() => {
  const s = document.querySelector("[data-testid=category-tax-class]");
  return s ? { value: s.value, label: s.selectedOptions?.[0]?.textContent?.trim() } : null;
}));
await owner.locator("[data-testid=category-tax-class]").selectOption(STD.id);
await owner.waitForTimeout(400);
await shot(owner, "a05-category-std-selected");
await saveDialog();
await shot(owner, "a06-category-saved");

const myCat = ((await apiGet(owner, "/api/v1/pos/menu/categories", otok)).body?.data ?? []).find((c) => c.id === CAT);
rec("categoryRuleAfterUiSave", myCat && { name: myCat.taxClassName, rate: myCat.taxClassRatePct });

// ── 3. inheritance, including a dish created AFTER the rule ──────────────────
log("\n=== 3. inheritance ===");
rec("afterCategoryRule", await readItems());
const D = await mk(`ROPEN Delta ${S}`, 30000);
rec("dishAddedAfterRule", (await readItems())["Delta"]);

// ── 4. item override to zero-rated, in the item dialog ───────────────────────
log("\n=== 4. override Charlie to zero-rated, in the UI ===");
await go(owner, "/app/menu/items", { waitMs: 4500 });
await openItemEdit(`ROPEN Charlie ${S}`);
await shot(owner, "a07-item-dialog");
rec("itemSelectInherited", await owner.evaluate(() => {
  const s = document.querySelector("[data-testid=item-tax-class]");
  return s ? { value: s.value, label: s.selectedOptions?.[0]?.textContent?.trim() } : null;
}));
await owner.locator("[data-testid=item-tax-class]").selectOption(ZERO.id);
await owner.waitForTimeout(400);
await shot(owner, "a08-item-zero-selected");
await saveDialog();
rec("afterOverride", await readItems());

// ── 5. edit ONLY the description, save, reload ───────────────────────────────
log("\n=== 5. description-only edit, then reload ===");
await go(owner, "/app/menu/items", { waitMs: 4500 });
await openItemEdit(`ROPEN Charlie ${S}`);
const desc = owner.locator("[role=dialog] textarea").first();
rec("descBoxes", await owner.locator("[role=dialog] textarea").count());
await desc.fill(`description changed by reopen ${S}`);
await owner.waitForTimeout(300);
await shot(owner, "a09-description-only");
await saveDialog();
await go(owner, "/app/menu/items", { waitMs: 4000 });
await shot(owner, "a10-after-reload");
rec("afterDescriptionOnlyEdit", await readItems());

// ── 6. ADJACENT: an item with a LEGACY rate + code, description-only edit ────
log("\n=== 6. adjacent: a legacy per-item rate + code survives a description edit ===");
const legacyRes = await apiSend(owner, "POST", "/api/v1/pos/menu/items", {
  categoryId: CAT, name: `ROPEN Legacy ${S}`, description: "legacy probe", basePricePaisa: 10000,
  taxRatePct: 13.5, taxRateCode: `LEG-${S}`, imageFileId: null, active: true, taxClassId: null,
}, otok);
rec("legacyCreated", { status: legacyRes.status });
// its category HAS a rule, so the rule should outrank the legacy rate
rec("legacyResolution", (await readItems())["Legacy"]);

writeFileSync(`${OUT}/reopen-a.json`, JSON.stringify({ S, CAT, A, B, C, D, STD: STD?.id, ZERO: ZERO?.id, F }, null, 2));
log("\nWROTE reopen-a.json  CAT=" + CAT + "  S=" + S);
await browser.close();
