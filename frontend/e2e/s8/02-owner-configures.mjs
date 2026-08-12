/*
 * S8 step 2 — the owner picks the till's USB printer FROM A LIST, and binds a network printer to
 * GRILL by host and port. Every click is the one an owner makes.
 */
import { newBrowser, newPage, login, go, shot, apiGet, branchOf, PEOPLE, OUT } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const GRILL_PORT = Number(process.env.S8_GRILL_PORT ?? 9105);

const browser = await newBrowser();
const page = await newPage(browser);
await login(page, PEOPLE.owner);

const trouble = await go(page, "/app/settings/printers", { waitMs: 6000 });
console.log("  page:", JSON.stringify(trouble.bad), trouble.url);
await shot(page, "02a-printers-loaded");

const evidence = {};

// ── 1. The agent's own device list is on screen ──────────────────────────────────────────────
const agentRows = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-testid="print-agent-row"]')).map((n) => ({
    liveness: n.getAttribute("data-agent-liveness"),
    text: (n.textContent || "").trim().slice(0, 80),
  })),
);
evidence.connectedAgents = agentRows.filter((a) => a.liveness === "CONNECTED").length;
console.log(`  agents: ${agentRows.length}, connected: ${evidence.connectedAgents}`);

// ── 2. Make the RECEIPT printer a USB/system one, chosen from the list ───────────────────────
const rows = page.locator('[data-testid="printer-row"]');
const rowCount = await rows.count();
console.log("  existing printer rows:", rowCount);

// The receipt printer is the row whose role select reads RECEIPT.
let receiptIndex = -1;
for (let i = 0; i < rowCount; i += 1) {
  const role = await rows.nth(i).getAttribute("data-printer-role");
  if (role === "RECEIPT") {
    receiptIndex = i;
    break;
  }
}
if (receiptIndex === -1) {
  await page.locator('[data-testid="add-receipt-printer"]').click();
  await page.waitForTimeout(600);
  receiptIndex = (await rows.count()) - 1;
}
const receiptRow = rows.nth(receiptIndex);
await receiptRow.locator('select[id^="transport-"]').selectOption("SYSTEM");
await page.waitForTimeout(700);
await shot(page, "02b-usb-transport-chosen");

const picker = receiptRow.locator('[data-testid="system-printer-picker"]');
evidence.pickerTag = await picker.evaluate((el) => el.tagName);
evidence.pickerOptions = await picker.evaluate((el) =>
  Array.from(el.options)
    .filter((o) => !o.disabled)
    .map((o) => ({ value: o.value, label: o.textContent.trim() })),
);
console.log("  picker is a", evidence.pickerTag);
console.log("  options:", JSON.stringify(evidence.pickerOptions, null, 2));

const usb = evidence.pickerOptions.find((o) => /USB|POS80/i.test(o.value + o.label));
if (!usb) throw new Error("no USB printer in the agent's discovered list — nothing to choose");
await picker.selectOption(usb.value);
await page.waitForTimeout(400);
evidence.chosenUsbPrinter = usb.value;
await shot(page, "02c-usb-printer-chosen");

// ── 3. A network printer, by host and port, bound to GRILL ───────────────────────────────────
// Any printer already bound to GRILL is removed first, so the ticket cannot land somewhere else
// and make this proof about the wrong device.
for (let i = (await rows.count()) - 1; i >= 0; i -= 1) {
  const row = rows.nth(i);
  if ((await row.getAttribute("data-printer-role")) !== "KITCHEN") continue;
  const station = await row.locator('input[id^="station-"]').inputValue();
  if (station.toUpperCase() === "GRILL") {
    console.log("  removing an existing GRILL printer:", await row.getAttribute("data-printer-id"));
    await row.getByRole("button", { name: /Remove/i }).click();
    await page.waitForTimeout(300);
  }
}

await page.locator('[data-testid="add-kitchen-printer"]').click();
await page.waitForTimeout(600);
const kitchenIndex = (await rows.count()) - 1;
const kitchenRow = rows.nth(kitchenIndex);
await kitchenRow.locator('input[id^="name-"]').fill(`grill-${GRILL_PORT}`);
await kitchenRow.locator('input[id^="station-"]').fill("GRILL");
await kitchenRow.locator('select[id^="transport-"]').selectOption("TCP");
await page.waitForTimeout(300);
await kitchenRow.locator('input[id^="host-"]').fill("127.0.0.1");
await kitchenRow.locator('input[id^="port-"]').fill(String(GRILL_PORT));
await page.waitForTimeout(400);
await shot(page, "02d-grill-network-printer");

// ── 4. Inline validation, on the way past — type a bad port and watch the screen object ──────
await kitchenRow.locator('input[id^="port-"]').fill("99999");
await page.waitForTimeout(500);
evidence.badPort = await page.evaluate(() => {
  const errors = Array.from(document.querySelectorAll('[role="alert"]'))
    .map((n) => (n.textContent || "").trim())
    .filter((t) => /port/i.test(t));
  const save = document.querySelector('[data-testid="save-printers"]');
  return { errors, saveDisabled: save ? save.disabled : null };
});
console.log("  bad port →", JSON.stringify(evidence.badPort));
await shot(page, "02e-invalid-port-blocked");
await kitchenRow.locator('input[id^="port-"]').fill(String(GRILL_PORT));
await page.waitForTimeout(500);

// ── 5. Save ──────────────────────────────────────────────────────────────────────────────────
await page.locator('[data-testid="save-printers"]').click();
await page.waitForTimeout(4000);
await shot(page, "02f-saved");

// ── 6. Read it back over HTTP, on the owner's own bearer ─────────────────────────────────────
const branchId = await branchOf(page);
evidence.branchId = branchId;
const config = await apiGet(page, `/api/v1/branches/${branchId}/receipt-config`);
if (config.status !== 200) {
  throw new Error(`receipt-config read failed ${config.status}: ${JSON.stringify(config.body).slice(0, 300)}`);
}
evidence.storedPrinters = (config.body?.data?.config?.printers ?? []).map((p) => ({
  id: p.id,
  role: p.role,
  stationCode: p.stationCode,
  transport: p.transport,
  host: p.host,
  port: p.port,
  systemPrinterName: p.systemPrinterName,
}));
console.log("  stored:", JSON.stringify(evidence.storedPrinters, null, 2));

const agentsApi = await apiGet(page, `/api/v1/pos/print-agents?branchId=${branchId}`);
if (agentsApi.status !== 200) {
  throw new Error(`print-agents read failed ${agentsApi.status}`);
}
evidence.agentsWithDevices = (agentsApi.body?.data ?? [])
  .filter((a) => Array.isArray(a.devices) && a.devices.length > 0)
  .map((a) => ({ label: a.label, devices: a.devices.map((d) => d.name), reportedAt: a.devicesReportedAt }));
console.log("  agents reporting devices:", JSON.stringify(evidence.agentsWithDevices, null, 2));

writeFileSync(`${OUT}/02-owner-configures.json`, JSON.stringify(evidence, null, 2));
await browser.close();
