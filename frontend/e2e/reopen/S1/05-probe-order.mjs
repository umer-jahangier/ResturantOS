/* Probe: what did the fired check actually become, and what did the kitchen receive. */
import { PEOPLE, newBrowser, newPage, login, apiGet, log, writeJson, loadState } from "./lib.mjs";

const st = loadState();
const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.cashier);
  for (const p of [
    "/api/v1/pos/orders?size=3",
    "/api/v1/pos/orders?page=0&size=3",
    "/api/v1/pos/orders/active",
  ]) {
    const r = await apiGet(page, p);
    log(`  ${p} -> ${r.status} ${JSON.stringify(r.body).slice(0, 500)}`);
  }
  writeJson("05-probe.json", { branchId: st.branchId });
} finally {
  await browser.close();
}
