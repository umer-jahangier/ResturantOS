/* Re-activate RX Gamma if stage B5 deactivated it, and report the tax state either way. */
import { newBrowser, newPage, login, apiGet as rawGet, apiSend as rawSend, tokenOf, log } from "../shift/lib.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F16-reopen");
const A = JSON.parse(readFileSync(`${OUT}/stage-a.json`, "utf8"));
const browser = await newBrowser();
const p = await newPage(browser);
for (let i = 0; i < 3; i++) {
  try { await login(p, { slug: "floating-terrace", email: "owner@terrace.local",
    password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" }); break; }
  catch { log("retry"); await p.waitForTimeout(6000); }
}
const tok = await tokenOf(p);
const r = await rawGet(p, `/api/v1/pos/menu/items/admin?categoryId=${A.CAT}&size=50`, tok);
const arr = r.body?.data?.content ?? r.body?.data ?? [];
log(JSON.stringify(arr.map((i) => ({ n: i.name, active: i.active, rate: i.effectiveTaxRatePct,
  code: i.effectiveTaxRateCode, src: i.taxSource })), null, 1));
const gamma = arr.find((i) => i.name.includes("Gamma"));
if (gamma && !gamma.active) {
  const a = await rawSend(p, "PATCH", `/api/v1/pos/menu/items/${gamma.id}/activate`, undefined, tok);
  log(`reactivated: ${a.status}`);
  const back = await rawGet(p, `/api/v1/pos/menu/items/${gamma.id}`, tok);
  const b = back.body?.data ?? {};
  log(`AFTER REACTIVATE gamma: rate=${b.effectiveTaxRatePct} code=${b.effectiveTaxRateCode} src=${b.taxSource} own=${b.taxClassId ? "set" : null}`);
}
await browser.close();
