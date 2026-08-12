/* S8 RE-OPEN — read the registry + stations off the correct endpoints, as OWNER. */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { newBrowser, newPage, login, go, PEOPLE, apiGet, branchOf } from "../s8/lib.mjs";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S8-reopen");
mkdirSync(OUT, { recursive: true });
const rec = {};
const say = (k, v) => {
  console.log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  rec[k] = v;
};

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.owner);
  const branchId = await branchOf(page);
  await go(page, "/app/settings/printers", { waitMs: 5000 });

  const cfg = await apiGet(page, `/api/v1/branches/${branchId}/receipt-config`);
  say("receiptConfig.status", cfg.status);
  say("receiptConfig", cfg.body?.data ?? cfg.body);

  const stations = await apiGet(page, `/api/v1/pos/stations?branchId=${branchId}`);
  say("stations.status", stations.status);
  const s = stations.body?.data ?? stations.body ?? [];
  say("stations", (Array.isArray(s) ? s : []).map((x) => `${x.code}|${x.name}`));
} catch (e) {
  say("ERROR", String(e));
} finally {
  writeFileSync(`${OUT}/r02-registry.json`, JSON.stringify(rec, null, 2));
  await browser.close();
}
