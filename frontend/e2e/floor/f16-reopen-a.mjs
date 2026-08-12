/*
 * F16 RE-OPEN — Stage A. An INDEPENDENT drive of the owner-side configuration path.
 *
 * My own category, my own dishes, my own rates. Probing where their script did not:
 *   - the rate survives a RELOAD (not just an optimistic cache)
 *   - a dish added to the category AFTER the rule is applied inherits it
 *   - description-only edit keeps rate AND code   (the S0-03 half)
 *   - NAME-only and PRICE-only edits through the same PUT (they only tried description)
 *   - the CATEGORY's own name edited alone: does the category keep its class?
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet as rawGet, apiSend as rawSend, tokenOf, log } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F16-reopen");
mkdirSync(OUT, { recursive: true });
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); log(`    shot ${n}`); };
const F = {};
const rec = (k, v) => { F[k] = v; log(`  > ${k}: ${JSON.stringify(v)}`); };

const S = Date.now().toString().slice(-6);
const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);

// Mint ONE token and reuse it. tokenOf() spends the rotating refresh cookie, so calling it
// per-request races itself and 401s mid-run — which is what happened on my first attempt.
let TOK = await tokenOf(owner);
const apiGet = (p) => rawGet(owner, p, TOK);
const apiSend = (m, p, b) => rawSend(owner, m, p, b, TOK);

// ── A1. rates ───────────────────────────────────────────────────────────────
log("\n=== A1. rates on /app/settings/tax ===");
rec("routeTrouble", (await go(owner, "/app/settings/tax", { waitMs: 3500 })).bad);
rec("h1", await owner.evaluate(() => document.querySelector("h1")?.textContent?.trim() ?? null));

async function newClass(code, name, rate) {
  await owner.locator("[data-testid=add-tax-class]").first().click();
  await owner.waitForTimeout(600);
  await owner.locator("#new-tax-code").fill(code);
  await owner.locator("#new-tax-name").fill(name);
  await owner.locator("#new-tax-rate").fill(rate);
  await owner.waitForTimeout(300);
  await owner.locator("[data-testid=save-new-tax-class]").click();
  await owner.waitForTimeout(2500);
}
await newClass(`RX-STD-${S}`, `RX Standard ${S}`, "17");
await newClass(`RX-ZERO-${S}`, `RX Zero ${S}`, "0");
await owner.reload({ waitUntil: "domcontentloaded" });
await owner.waitForTimeout(3000);
rec("codesOnScreenAfterReload", await owner.evaluate((s) =>
  Array.from(document.querySelectorAll("[data-testid=tax-class-row] input"))
    .map((i) => i.value).filter((v) => String(v).includes(s)), S));
await shot(owner, "a01-rates-after-reload");

const cls = await apiGet("/api/v1/pos/tax-classes");
const mine = (cls.body?.data ?? cls.body ?? []).filter((c) => String(c.code).includes(S));
const STD = mine.find((c) => c.code.startsWith("RX-STD"));
const ZERO = mine.find((c) => c.code.startsWith("RX-ZERO"));
rec("classes", mine.map((c) => ({ code: c.code, rate: c.ratePct })));

// ── A2. my category + 3 dishes ──────────────────────────────────────────────
log("\n=== A2. category + dishes ===");
const cat = await apiSend("POST", "/api/v1/pos/menu/categories", {
  name: `RX Cat ${S}`, sortOrder: 1, active: true,
});
const CAT = cat.body?.data?.id ?? cat.body?.id;
rec("categoryCreated", { status: cat.status, id: CAT });

const mk = async (n, price) => {
  const r = await apiSend("POST", "/api/v1/pos/menu/items", {
    categoryId: CAT, name: `${n} ${S}`, basePricePaisa: price, active: true,
    description: "orig-desc",
  });
  return { n, status: r.status, id: r.body?.data?.id ?? r.body?.id };
};
const alpha = await mk("RX Alpha", 50000);
const beta = await mk("RX Beta", 30000);
const gamma = await mk("RX Gamma", 20000);
rec("dishes", [alpha, beta, gamma].map((d) => ({ n: d.n, s: d.status })));

const readItems = async () => {
  const r = await apiGet(`/api/v1/pos/menu/items?categoryId=${CAT}&size=50`);
  const arr = r.body?.data?.content ?? r.body?.content ?? r.body?.data ?? r.body ?? [];
  return (Array.isArray(arr) ? arr : []).map((i) => ({
    name: i.name.replace(` ${S}`, ""), rate: i.effectiveTaxRatePct, code: i.effectiveTaxRateCode,
    src: i.taxSource ?? i.effectiveTaxSource, own: i.taxClassId ? "set" : null,
    legacy: i.taxRatePct, desc: i.description, price: i.basePricePaisa,
  })).sort((a, b) => a.name.localeCompare(b.name));
};
rec("beforeRule", await readItems());

// ── A3. the category rule, through the browser dialog ───────────────────────
log("\n=== A3. category rule via the ... > Edit dialog ===");
await go(owner, "/app/menu/items", { waitMs: 4000 });
const catActions = owner.locator(`button[aria-label="Actions for RX Cat ${S}"]`);
await catActions.scrollIntoViewIfNeeded();
await catActions.click();
await owner.waitForTimeout(900);
await shot(owner, "a02-category-menu");
await owner.getByRole("menuitem", { name: /edit/i }).first().click();
await owner.waitForTimeout(2000);
await shot(owner, "a03-category-dialog");

rec("categoryTaxSelectPresent", await owner.locator("[data-testid=category-tax-class]").count());
rec("categoryTaxOptions", await owner.evaluate(() => {
  const s = document.querySelector("[data-testid=category-tax-class]");
  return s ? Array.from(s.options).map((o) => o.textContent.trim()) : null;
}));
await owner.selectOption("[data-testid=category-tax-class]", { label: `RX Standard ${S} — 17.00%` }).catch(async () => {
  const v = await owner.evaluate((code) => {
    const s = document.querySelector("[data-testid=category-tax-class]");
    const o = Array.from(s.options).find((x) => x.textContent.includes(code));
    return o?.value ?? null;
  }, `RX Standard ${S}`);
  await owner.selectOption("[data-testid=category-tax-class]", v);
});
await owner.waitForTimeout(400);
await shot(owner, "a04-category-tax-chosen");
await owner.locator('[role="dialog"] button[type="submit"], [role="dialog"] button:has-text("Save")').first().click();
await owner.waitForTimeout(3000);
await shot(owner, "a05-category-saved");

// ── A4. inheritance, including a dish added AFTER ───────────────────────────
log("\n=== A4. inheritance ===");
rec("afterCategoryRule", await readItems());
const delta = await mk("RX Delta", 10000);   // added AFTER the rule
rec("deltaCreated", delta.status);
rec("deltaInherits", (await readItems()).find((i) => i.name === "RX Delta"));

// ── A5. override ONE dish to zero-rated, in the browser ─────────────────────
log("\n=== A5. item override ===");
await go(owner, "/app/menu/items", { waitMs: 4000 });
const openItem = async (label) => {
  const b = owner.locator(`button[aria-label="Actions for ${label}"]`);
  await b.scrollIntoViewIfNeeded();
  await b.click();
  await owner.waitForTimeout(800);
  await owner.getByRole("menuitem", { name: /edit/i }).first().click();
  await owner.waitForTimeout(2000);
};
await openItem(`RX Gamma ${S}`);
await shot(owner, "a06-item-dialog");
rec("itemTaxSelect", await owner.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]') || document;
  const s = Array.from(dlg.querySelectorAll("select"))
    .find((x) => /tax/i.test((x.getAttribute("aria-label") || "") + (x.name || "") + (x.id || "") + (x.getAttribute("data-testid") || "")));
  return s ? { testid: s.getAttribute("data-testid"), id: s.id,
               selected: s.options[s.selectedIndex]?.textContent?.trim(),
               opts: Array.from(s.options).map((o) => o.textContent.trim()).slice(0, 6) } : null;
}));
const itemSel = "[data-testid=item-tax-class]";
const haveItemSel = await owner.locator(itemSel).count();
if (haveItemSel) {
  const v = await owner.evaluate(({ sel, code }) => {
    const s = document.querySelector(sel);
    return Array.from(s.options).find((x) => x.textContent.includes(code))?.value ?? null;
  }, { sel: itemSel, code: `RX Zero ${S}` });
  await owner.selectOption(itemSel, v);
  await owner.waitForTimeout(400);
  await shot(owner, "a07-item-override-chosen");
  await owner.locator('[role="dialog"] button[type="submit"], [role="dialog"] button:has-text("Save")').first().click();
  await owner.waitForTimeout(3000);
}
rec("afterOverride", await readItems());
await shot(owner, "a08-after-override");

writeFileSync(`${OUT}/stage-a.json`, JSON.stringify(
  { ...F, S, CAT, STD, ZERO, ids: { alpha: alpha.id, beta: beta.id, gamma: gamma.id, delta: delta.id } },
  null, 2));
log("\nSTAGE A written");
await browser.close();
