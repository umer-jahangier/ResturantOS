/*
 * S8 step 9 — the closing state, re-read after a sibling agent restarted pos-service.
 *
 * `check-stale-jars.sh` reads `checked=16 stale=0`, so this is the deployed build answering, not
 * the one this session happened to compile.
 */
import { newBrowser, newPage, login, go, shot, apiGet, branchOf, PEOPLE, OUT } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const browser = await newBrowser();
const page = await newPage(browser);
await login(page, PEOPLE.owner);
const branchId = await branchOf(page);

const agents = await apiGet(page, `/api/v1/pos/print-agents?branchId=${branchId}`);
const health = await apiGet(page, `/api/v1/pos/printers/health?branchId=${branchId}`);
const config = await apiGet(page, `/api/v1/branches/${branchId}/receipt-config`);

const state = {
  agentsStatus: agents.status,
  healthStatus: health.status,
  configStatus: config.status,
  reporting: (agents.body?.data ?? [])
    .filter((a) => Array.isArray(a.devices) && a.devices.length > 0)
    .map((a) => ({ label: a.label, devices: a.devices.map((d) => `${d.name} (${d.state})`) })),
  receipt: (config.body?.data?.config?.printers ?? [])
    .filter((p) => p.role === "RECEIPT")
    .map((p) => ({ id: p.id, transport: p.transport, systemPrinterName: p.systemPrinterName })),
  grill: (config.body?.data?.config?.printers ?? [])
    .filter((p) => p.stationCode === "GRILL")
    .map((p) => ({ id: p.id, host: p.host, port: p.port })),
  printerStates: (health.body?.data?.printers ?? [])
    .filter((p) => /grill-9105|audit-receipt/.test(p.printerId))
    .map((p) => ({ id: p.printerId, state: p.state, printed: p.printed, failed: p.failed })),
};
console.log(JSON.stringify(state, null, 2));

await go(page, "/app/settings/printers", { waitMs: 7000 });
await page.evaluate(() =>
  document.querySelector('[data-testid="printer-list"]')?.scrollIntoView({ block: "start" }),
);
await page.waitForTimeout(1200);
await shot(page, "09-final-state");

writeFileSync(`${OUT}/09-final-recheck.json`, JSON.stringify(state, null, 2));
await browser.close();
