/*
 * F16 PROOF — the whole DONE MEANS, driven as the OWNER, in real Chromium.
 *
 *   1. Set a 17% standard-rate tax class on /app/settings/tax (and a 0% zero-rated one).
 *   2. Apply the 17% class to a menu CATEGORY.
 *   3. Confirm every item in that category inherits it.
 *   4. Override ONE item to the zero-rated class, and confirm its siblings are untouched.
 *   5. Edit that item's DESCRIPTION only, save, reload — rate AND code must survive.
 *   6. Ring a check of three items across two rates and read the tax on the CART, the CHARGE
 *      page, the printed BILL and the JOURNAL entry. All four must agree to the paisa, and the
 *      cart must no longer say "est.".
 *
 *   node e2e/floor/f16-prove.mjs
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, apiSend, money, log } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F16");
mkdirSync(OUT, { recursive: true });
const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  log(`    shot: ${name}.png`);
};
const findings = {};
const record = (k, v) => {
  findings[k] = v;
  log(`  ▸ ${k}: ${JSON.stringify(v)}`);
};

const STAMP = Date.now().toString().slice(-6);
const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);

// ─── 1. The screen exists, and the OWNER can define a rate ────────────────────
log("\n=== 1. /app/settings/tax as OWNER ===");
let tr = await go(owner, "/app/settings/tax", { waitMs: 3500 });
record("taxRouteTrouble", tr.bad);
await shot(owner, "01a-tax-settings");
record(
  "navHasSalesTax",
  await owner.evaluate(() =>
    Array.from(document.querySelectorAll("nav a")).some(
      (a) => a.getAttribute("href") === "/app/settings/tax",
    ),
  ),
);
record("h1", await owner.evaluate(() => document.querySelector("h1")?.textContent?.trim() ?? null));

// Inline validation as the user types — register §23 measured ariaInvalid 0 everywhere.
await owner.locator("[data-testid=add-tax-class]").first().click();
await owner.waitForTimeout(500);
await owner.locator("#new-tax-rate").fill("120");
await owner.waitForTimeout(400);
record("badRateValidation", await owner.evaluate(() => {
  const input = document.querySelector("#new-tax-rate");
  return {
    ariaInvalid: input?.getAttribute("aria-invalid"),
    message: document.querySelector("#new-tax-rate-error")?.textContent?.trim() ?? null,
    saveDisabled: document.querySelector("[data-testid=save-new-tax-class]")?.disabled ?? null,
  };
}));
await shot(owner, "01b-inline-validation");

await owner.locator("#new-tax-code").fill(`SR-STD-17-${STAMP}`);
await owner.locator("#new-tax-name").fill("Standard rate");
await owner.locator("#new-tax-rate").fill("17");
await owner.waitForTimeout(400);
await shot(owner, "01c-standard-rate-filled");
await owner.locator("[data-testid=save-new-tax-class]").click();
await owner.waitForTimeout(2500);

await owner.locator("[data-testid=add-tax-class]").first().click();
await owner.waitForTimeout(500);
await owner.locator("#new-tax-code").fill(`ZR-EXEMPT-${STAMP}`);
await owner.locator("#new-tax-name").fill("Zero-rated");
await owner.locator("#new-tax-rate").fill("0");
await owner.locator("[data-testid=save-new-tax-class]").click();
await owner.waitForTimeout(2500);
await shot(owner, "01d-two-rates-saved");

const classes = await apiGet(owner, "/api/v1/pos/tax-classes");
const classRows = classes.body?.data ?? [];
record("taxClassesAfterCreate", {
  status: classes.status,
  rows: classRows.map((c) => ({ code: c.code, name: c.name, rate: c.ratePct })),
});
const standard = classRows.find((c) => c.code === `SR-STD-17-${STAMP}`);
const zero = classRows.find((c) => c.code === `ZR-EXEMPT-${STAMP}`);
if (!standard || !zero) throw new Error("the two tax classes did not persist");

// ─── 2/3. Apply to a CATEGORY and confirm inheritance ─────────────────────────
log("\n=== 2/3. Apply 17% to a category, in the browser ===");
tr = await go(owner, "/app/menu/items", { waitMs: 4500 });
record("menuItemsTrouble", tr.bad);

// A fresh category with fresh items, so the proof is not entangled with 40 rows of legacy data.
const catRes = await apiSend(owner, "POST", "/api/v1/pos/menu/categories", {
  name: `F16 Mains ${STAMP}`,
  sortOrder: 1,
  taxClassId: null,
});
const categoryId = catRes.body?.data?.id;
record("categoryCreated", { status: catRes.status, id: categoryId?.slice(0, 8) });

const mk = async (name, paisa) => {
  const r = await apiSend(owner, "POST", "/api/v1/pos/menu/items", {
    categoryId,
    name,
    basePricePaisa: paisa,
    taxRatePct: 0,
    taxRateCode: null,
    imageFileId: null,
    taxClassId: null,
  });
  return r.body?.data;
};
const karahi = await mk(`F16 Karahi ${STAMP}`, 95000);
const biryani = await mk(`F16 Biryani ${STAMP}`, 85000);
const lime = await mk(`F16 Lime ${STAMP}`, 25000);
record("itemsBeforeClass", [karahi, biryani, lime].map((i) => ({
  n: i.name.slice(0, 18),
  eff: i.effectiveTaxRatePct,
  src: i.effectiveTaxSource,
})));

// THE browser action: open the category's Edit dialog and choose the rate.
await owner.reload({ waitUntil: "domcontentloaded" });
await owner.waitForTimeout(4000);
const catHeader = owner.locator(`[role=group][aria-label="F16 Mains ${STAMP} category"]`);
await catHeader.getByRole("button", { name: /Actions for/ }).first().click();
await owner.waitForTimeout(600);
await owner.getByRole("menuitem", { name: "Edit" }).first().click();
await owner.waitForTimeout(1200);
await shot(owner, "02a-category-dialog-tax-select");
record("categoryDialogHasTaxSelect", await owner.evaluate(() =>
  !!document.querySelector("[data-testid=category-tax-class]"),
));
await owner.locator("[data-testid=category-tax-class]").selectOption(standard.id);
await owner.waitForTimeout(400);
await shot(owner, "02b-category-standard-selected");
await owner.getByRole("button", { name: "Save changes" }).click();
await owner.waitForTimeout(3000);
await shot(owner, "02c-category-saved");

const afterClass = await apiGet(owner, `/api/v1/pos/menu/items/admin?categoryId=${categoryId}`);
record("everyItemInherits", (afterClass.body?.data ?? []).map((i) => ({
  n: i.name.slice(-12),
  eff: i.effectiveTaxRatePct,
  code: i.effectiveTaxRateCode,
  label: i.effectiveTaxLabel,
  src: i.effectiveTaxSource,
  ownClass: i.taxClassId,
})));

// An item added AFTER the class is applied must inherit too — that is what makes it inheritance
// rather than a bulk write.
const naan = await mk(`F16 Naan ${STAMP}`, 12000);
record("itemAddedAfterInheritsToo", {
  n: naan.name.slice(-12),
  eff: naan.effectiveTaxRatePct,
  src: naan.effectiveTaxSource,
});

// ─── 4. One item overrides ────────────────────────────────────────────────────
log("\n=== 4. Override one dish to zero-rated, in the browser ===");
await owner.reload({ waitUntil: "domcontentloaded" });
await owner.waitForTimeout(4500);
await owner.getByRole("button", { name: `Actions for F16 Lime ${STAMP}` }).click();
await owner.waitForTimeout(600);
await owner.getByRole("menuitem", { name: "Edit" }).first().click();
await owner.waitForTimeout(1200);
record("itemDialogInheritLabel", await owner.evaluate(() => {
  const sel = document.querySelector("[data-testid=item-tax-class]");
  return { value: sel?.value, firstOption: sel?.options?.[0]?.textContent?.trim() ?? null };
}));
await shot(owner, "03a-item-dialog-inherits");
await owner.locator("[data-testid=item-tax-class]").selectOption(zero.id);
await owner.waitForTimeout(400);
await shot(owner, "03b-item-override-zero");
await owner.getByRole("button", { name: "Save changes" }).click();
await owner.waitForTimeout(3000);

const afterOverride = await apiGet(owner, `/api/v1/pos/menu/items/admin?categoryId=${categoryId}`);
record("afterOverride", (afterOverride.body?.data ?? []).map((i) => ({
  n: i.name.slice(-12),
  eff: i.effectiveTaxRatePct,
  code: i.effectiveTaxRateCode,
  src: i.effectiveTaxSource,
})));
await shot(owner, "03c-menu-after-override");

// ─── 5. Description-only edit must not disturb the classification ─────────────
log("\n=== 5. Edit ONLY the description of the overridden item ===");
await owner.reload({ waitUntil: "domcontentloaded" });
await owner.waitForTimeout(4500);
await owner.getByRole("button", { name: `Actions for F16 Lime ${STAMP}` }).click();
await owner.waitForTimeout(600);
await owner.getByRole("menuitem", { name: "Edit" }).first().click();
await owner.waitForTimeout(1200);
const desc = owner.getByRole("textbox", { name: "Description" });
await desc.fill("Fresh lime soda — typo fixed by the owner");
await shot(owner, "04a-description-only-edit");
await owner.getByRole("button", { name: "Save changes" }).click();
await owner.waitForTimeout(3000);

// Reload the whole page, then re-read: "survives a reload" is the claim, so reload.
await owner.reload({ waitUntil: "domcontentloaded" });
await owner.waitForTimeout(4000);
const reread = await apiGet(owner, `/api/v1/pos/menu/items/${lime.id}`);
record("afterDescriptionOnlyEdit", {
  description: reread.body?.data?.description,
  taxClassId: reread.body?.data?.taxClassId === zero.id ? "still-zero-rated" : reread.body?.data?.taxClassId,
  effRate: reread.body?.data?.effectiveTaxRatePct,
  effCode: reread.body?.data?.effectiveTaxRateCode,
  effLabel: reread.body?.data?.effectiveTaxLabel,
});
await shot(owner, "04b-after-reload");

writeFileSync(
  `${OUT}/f16-context.json`,
  JSON.stringify({ STAMP, categoryId, standard, zero, karahi, biryani, lime, naan }, null, 2),
);

// ─── The screen at three widths, in both themes ───────────────────────────────
log("\n=== 6. /app/settings/tax at 390 / 768 / 1440, light and dark ===");
for (const theme of ["light", "dark"]) {
  await owner.emulateMedia({ colorScheme: theme });
  await owner.evaluate((t) => {
    document.documentElement.classList.toggle("dark", t === "dark");
    document.documentElement.style.colorScheme = t;
  }, theme);
  for (const [w, h] of [[390, 844], [768, 1024], [1440, 950]]) {
    await owner.setViewportSize({ width: w, height: h });
    await go(owner, "/app/settings/tax", { waitMs: 2800 });
    await shot(owner, `05-tax-${w}-${theme}`);
    // Assert COMPUTED style, never the class list — cn()/tailwind-merge has silently dropped
    // utility classes in this codebase before.
    const measured = await owner.evaluate(() => {
      const row = document.querySelector("[data-testid=tax-class-row]");
      const body = getComputedStyle(document.body);
      return {
        bodyScrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 1,
        rowWidth: row ? Math.round(row.getBoundingClientRect().width) : null,
        bodyBg: body.backgroundColor,
        bodyColor: body.color,
      };
    });
    record(`layout-${w}-${theme}`, measured);
  }
}
await owner.setViewportSize({ width: 1440, height: 950 });

writeFileSync(`${OUT}/f16-prove-part1.json`, JSON.stringify(findings, null, 2));
writeFileSync(
  `${OUT}/f16-context.json`,
  JSON.stringify({ STAMP, categoryId, standard, zero, karahi, biryani, lime, naan }, null, 2),
);
log("\nPART 1 COMPLETE");
await browser.close();
