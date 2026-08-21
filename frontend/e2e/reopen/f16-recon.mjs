/*
 * F16 RE-OPEN — recon. What does the live stack actually hold right now?
 *   node e2e/reopen/f16-recon.mjs
 */
import { PEOPLE, newBrowser, newPage, login, apiGet, tokenOf, log } from "../shift/lib.mjs";

const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
const tok = await tokenOf(owner);

const classes = await apiGet(owner, "/api/v1/pos/tax-classes", tok);
log("TAX CLASSES:", JSON.stringify(classes, null, 1).slice(0, 3000));

const cats = await apiGet(owner, "/api/v1/pos/menu/categories", tok);
log("\nCATEGORIES:", JSON.stringify(cats?.body ?? cats).slice(0, 4000));

const items = await apiGet(owner, "/api/v1/pos/menu/items?size=200", tok);
const body = items?.body ?? items;
const list = body?.content ?? body?.items ?? body;
if (Array.isArray(list)) {
  log("\nITEM COUNT:", list.length);
  for (const i of list.slice(0, 60)) {
    log(
      `  ${String(i.name).padEnd(28)} cat=${String(i.categoryName ?? i.categoryId).slice(0, 22).padEnd(24)} legacy=${i.taxRatePct} code=${i.taxRateCode} classId=${i.taxClassId} eff=${i.effectiveTaxRatePct}/${i.effectiveTaxRateCode}/${i.effectiveTaxSource}`,
    );
  }
} else {
  log("\nITEMS RAW:", JSON.stringify(body).slice(0, 3000));
}

await browser.close();
