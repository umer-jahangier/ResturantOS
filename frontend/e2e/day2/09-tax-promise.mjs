/* DAY 2 — 9: the Sales Tax screen promises the name is printed on the guest's bill. Is it? */
import { newBrowser, newPage, go, shot, saveState, loadState, log, PEOPLE, login, apiGet } from "./lib.mjs";

const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
const tr = await go(owner, "/app/settings/tax", { waitMs: 8000 });
log("  trouble:", JSON.stringify(tr.bad));
await shot(owner, "09a-sales-tax");
const tax = await owner.evaluate(() => {
  const t = (document.body.innerText || "").replace(/\s+/g, " ");
  const i = t.indexOf("Sales Tax");
  return {
    promise: /Printed on the guest.s bill\.?/.exec(t)?.[0] ?? null,
    body: t.slice(i, i + 1400),
    classes: Array.from(document.querySelectorAll("[data-testid=tax-class-list] tr, [data-testid=tax-class-list] li")).map((n) => n.innerText.replace(/\s+/g, " ").trim().slice(0, 140)).slice(0, 10),
  };
});
log("  PROMISE ON SCREEN:", JSON.stringify(tax.promise));
log("  SCREEN:", tax.body.slice(0, 1100));
log("  CLASSES:", JSON.stringify(tax.classes, null, 1).slice(0, 900));
const api = await apiGet(owner, "/api/v1/pos/tax-classes");
log("  tax classes over HTTP:", JSON.stringify((api.body?.data ?? []).map((c) => ({ n: c.name, code: c.code, r: c.ratePct, cats: c.categoryCount }))).slice(0, 700));
saveState({ taxScreen: tax, taxClasses: api.body?.data });
await browser.close();
