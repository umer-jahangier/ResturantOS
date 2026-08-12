/*
 * F16 RE-OPEN — Stage I. The rows that were ALREADY written.
 *
 * "A date fixed on the writer is not fixed on the reader or on rows already written." The
 * register measured 6 items at 16.00% carrying no tax code and belonging to no class. If the
 * resolver's step 3 (the legacy per-item rate) is wrong, every one of those silently drops to
 * zero and existing tenants stop charging tax the day this ships. So: read the WHOLE menu and
 * assert nothing that used to carry a rate has lost it.
 */
import { newBrowser, newPage, login, apiGet as rawGet, tokenOf, log } from "../shift/lib.mjs";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F16-reopen");
const F = {}; const rec = (k, v) => { F[k] = v; log(`  > ${k}: ${JSON.stringify(v)}`); };
async function loginRetry(page, who, n = 5) {
  for (let i = 0; i < n; i++) { try { await login(page, who); return; }
    catch { log("    retry"); await page.waitForTimeout(7000); } }
  throw new Error("login exhausted");
}
const browser = await newBrowser();
const o = await newPage(browser);
await loginRetry(o, { slug: "floating-terrace", email: "owner@terrace.local",
  password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" });
const tok = await tokenOf(o);

const r = await rawGet(o, "/api/v1/pos/menu/items?size=300", tok);
const arr = r.body?.data?.content ?? r.body?.data ?? [];
rec("menuItemCount", arr.length);

const bySource = {};
for (const i of arr) bySource[i.taxSource ?? "?"] = (bySource[i.taxSource ?? "?"] ?? 0) + 1;
rec("bySource", bySource);

// The dangerous class: an item whose OWN legacy column carries a rate. It must still resolve
// to that rate (ITEM_CUSTOM) unless a class now outranks it.
const legacy = arr.filter((i) => Number(i.taxRatePct) > 0);
rec("legacyRatedCount", legacy.length);
rec("legacyRated", legacy.map((i) => ({
  n: i.name.slice(0, 26), own: Number(i.taxRatePct), eff: Number(i.effectiveTaxRatePct),
  code: i.effectiveTaxRateCode, src: i.taxSource })));
const dropped = legacy.filter((i) => Number(i.effectiveTaxRatePct) === 0 && !i.taxClassId);
rec("REGRESSION_legacyRateSilentlyZeroed", dropped.map((i) => i.name));

// And the inverse: anything the resolver reports as effective must be a number, never null.
rec("nullEffectiveRate", arr.filter((i) => i.effectiveTaxRatePct === null
  || i.effectiveTaxRatePct === undefined).map((i) => i.name).slice(0, 10));

writeFileSync(`${OUT}/stage-i.json`, JSON.stringify(F, null, 2));
log("\nSTAGE I written");
await browser.close();
