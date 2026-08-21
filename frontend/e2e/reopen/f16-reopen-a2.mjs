/*
 * F16 RE-OPEN — PASS A2: the S0-03 half (description-only edit) + legacy-rate adjacency.
 *   node e2e/reopen/f16-reopen-a2.mjs
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, apiSend, tokenOf, log } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/reopen/F16");
const S = "988362";
const CAT = "e910df58-ed7a-4bee-af38-0fe7060d4c47";
const prev = {};
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); log(`    shot ${n}.png`); };
const F = {};
const rec = (k, v) => { F[k] = v; log(`  > ${k}: ${JSON.stringify(v)}`); };

const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
const otok = await tokenOf(owner);

const readItems = async () => {
  const r = await apiGet(owner, "/api/v1/pos/menu/items?size=300", otok);
  return Object.fromEntries((r.body?.data ?? []).filter((i) => i.categoryId === CAT).map((i) => [
    i.name.replace(`ROPEN `, "").replace(` ${S}`, ""),
    { eff: i.effectiveTaxRatePct, code: i.effectiveTaxRateCode, src: i.effectiveTaxSource,
      classId: i.taxClassId ? "set" : null, legacy: i.taxRatePct, legacyCode: i.taxRateCode,
      desc: i.description, price: i.basePricePaisa },
  ]));
};
const openItemEdit = async (name) => {
  await owner.locator(`button[aria-label="Actions for ${name}"]`).first().click();
  await owner.waitForTimeout(600);
  await owner.getByRole("menuitem", { name: "Edit", exact: true }).first().click();
  await owner.waitForTimeout(1500);
};
const saveDialog = async () => {
  await owner.locator("[role=dialog] button", { hasText: /^(Save|Update|Save changes)$/i }).last().click();
  await owner.waitForTimeout(2800);
};
const descInput = () => owner.locator('[role=dialog] input[name="description"], [role=dialog] input[placeholder="Optional"]').first();

// ── 5. CLASSIFIED item, description-only edit ────────────────────────────────
log("\n=== 5. Charlie (zero-rated override): edit ONLY the description ===");
rec("before", (await readItems())["Charlie"]);
await go(owner, "/app/menu/items", { waitMs: 4500 });
await openItemEdit(`ROPEN Charlie ${S}`);
await shot(owner, "a09-charlie-dialog");
rec("dialogTaxSelect", await owner.evaluate(() => {
  const s = document.querySelector("[data-testid=item-tax-class]");
  return s ? { value: s.value ? "set" : "", label: s.selectedOptions?.[0]?.textContent?.trim() } : null;
}));
await descInput().fill(`desc changed by reopen ${S}`);
await owner.waitForTimeout(300);
await shot(owner, "a09b-description-only");
await saveDialog();
await go(owner, "/app/menu/items", { waitMs: 4000 });
await shot(owner, "a10-after-reload");
rec("afterDescOnly_Charlie", (await readItems())["Charlie"]);

// ── 6. LEGACY per-item rate + code, in a category with NO rule ───────────────
log("\n=== 6. a legacy per-item rate + code, category with NO rule ===");
const bareCat = (await apiSend(owner, "POST", "/api/v1/pos/menu/categories",
  { name: `ROPEN Bare ${S}`, description: null, sortOrder: 51, taxClassId: null }, otok)).body?.data?.id;
const legacy = await apiSend(owner, "POST", "/api/v1/pos/menu/items", {
  categoryId: bareCat, name: `ROPEN Legacy ${S}`, description: "legacy probe",
  basePricePaisa: 10000, taxRatePct: 13.5, taxRateCode: `LEG-${S}`,
  imageFileId: null, active: true, taxClassId: null,
}, otok);
rec("legacyCreated", { status: legacy.status });
const readOne = async (id) => {
  const r = await apiGet(owner, "/api/v1/pos/menu/items?size=300", otok);
  const i = (r.body?.data ?? []).find((x) => x.id === id);
  return i && { eff: i.effectiveTaxRatePct, code: i.effectiveTaxRateCode, src: i.effectiveTaxSource,
                legacy: i.taxRatePct, legacyCode: i.taxRateCode, desc: i.description };
};
const LEG = legacy.body?.data?.id;
rec("legacyBefore", await readOne(LEG));

await go(owner, "/app/menu/items", { waitMs: 4500 });
await openItemEdit(`ROPEN Legacy ${S}`);
await shot(owner, "a11-legacy-dialog");
rec("legacyDialogSelect", await owner.evaluate(() => {
  const s = document.querySelector("[data-testid=item-tax-class]");
  const rate = document.querySelector('[role=dialog] input[name="taxRatePct"]');
  const code = document.querySelector('[role=dialog] input[name="taxRateCode"]');
  return { sel: s?.selectedOptions?.[0]?.textContent?.trim(), rate: rate?.value, code: code?.value };
}));
await descInput().fill(`legacy desc changed ${S}`);
await owner.waitForTimeout(300);
await saveDialog();
await go(owner, "/app/menu/items", { waitMs: 3500 });
rec("legacyAfterDescOnly", await readOne(LEG));

// ── 7. ADJACENT: a legacy-rate item whose CATEGORY later gets a rule ─────────
log("\n=== 7. category rule outranks a legacy per-item rate ===");
const stdId = ((await apiGet(owner, "/api/v1/pos/tax-classes", otok)).body?.data ?? [])
  .find((c) => c.code === `RO-STD-${S}`)?.id;
const upd = await apiSend(owner, "PUT", `/api/v1/pos/menu/categories/${bareCat}`,
  { name: `ROPEN Bare ${S}`, description: null, sortOrder: 51, taxClassId: stdId }, otok);
rec("bareCatNowRuled", upd.status);
rec("legacyUnderRule", await readOne(LEG));

writeFileSync(`${OUT}/reopen-a2.json`, JSON.stringify({ S, CAT, bareCat, LEG, F }, null, 2));
log("\nWROTE reopen-a2.json");
await browser.close();
