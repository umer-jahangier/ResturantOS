/*
 * Stage 1 — system-wide consistency sweep.
 * 16 routes x 1 persona, measured at 1440. Records design-system conformance per route.
 */
import { chromium } from "@playwright/test";
import { login, settle, shot, saveJson, PROBE } from "./uiq-lib.mjs";

const ROUTES = [
  ["dashboard", "/app/dashboard", "owner"],
  ["pos", "/app/pos", "owner"],
  ["pos-tills", "/app/pos/tills", "owner"],
  ["kitchen", "/app/kitchen", "owner"],
  ["tables", "/app/tables", "owner"],
  ["menu-items", "/app/menu/items", "owner"],
  ["inventory", "/app/inventory", "owner"],
  ["inv-ingredients", "/app/inventory/ingredients", "owner"],
  ["inv-stock", "/app/inventory/stock", "owner"],
  ["inv-recipes", "/app/inventory/recipes", "owner"],
  ["purchasing", "/app/purchasing", "owner"],
  ["pur-vendors", "/app/purchasing/vendors", "owner"],
  ["pur-pos", "/app/purchasing/purchase-orders", "owner"],
  ["finance", "/app/finance", "owner"],
  ["fin-expenses", "/app/finance/expenses", "owner"],
  ["fin-je", "/app/finance/journal-entries", "owner"],
  ["hr-employees", "/app/hr/employees", "owner"],
  ["hr-attendance", "/app/hr/attendance", "owner"],
  ["reports", "/app/reports", "owner"],
  ["crm", "/app/crm", "owner"],
  ["users", "/app/users", "owner"],
  ["settings", "/app/settings", "owner"],
  ["stations", "/app/stations", "owner"],
  ["terminals", "/app/terminals", "owner"],
];

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });

  const auth = await login(page, "owner");
  if (!auth.ok) { console.log("LOGIN FAILED:", auth.why); process.exit(1); }
  console.log("signed in as owner");

  const results = [];
  for (const [name, route] of ROUTES) {
    const before = consoleErrors.length;
    const state = await settle(page, route, "owner");
    let probe = null;
    try { probe = await page.evaluate(PROBE); } catch (e) { probe = { probeError: String(e).slice(0, 120) }; }
    const file = await shot(page, `route-${name}`, "sweep");
    results.push({ name, route, state, probe, newConsoleErrors: consoleErrors.length - before });
    console.log(
      `  ${state.clean ? "OK  " : state.refused ? "DENY" : "FAIL"} ${name.padEnd(18)}` +
      ` attempts=${state.attempt} alerts=${state.alerts}` +
      ` h1=${probe?.h1Count} fonts=${probe?.distinctFontSizes}` +
      ` btnH=${JSON.stringify(probe?.buttons?.heights || {})}` +
      ` overflowX=${probe?.overflowX} rawSelect=${probe?.inputs?.rawSelects} unlabelled=${probe?.inputs?.unlabelled}`
    );
  }

  saveJson("sweep.json", { results, consoleErrors: consoleErrors.slice(0, 60) });
  await browser.close();
}
main();
