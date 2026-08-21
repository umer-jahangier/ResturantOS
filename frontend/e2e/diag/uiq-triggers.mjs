/* Dump the visible action buttons per route so the dialog probe can target real triggers. */
import { chromium } from "@playwright/test";
import { login, settle, saveJson } from "./uiq-lib.mjs";

const ROUTES = [
  "/app/tables", "/app/menu/items", "/app/inventory/ingredients", "/app/inventory/setup",
  "/app/inventory/stock", "/app/purchasing/vendors", "/app/purchasing/purchase-orders",
  "/app/finance/expenses", "/app/finance/house-accounts", "/app/hr/employees", "/app/users",
  "/app/stations", "/app/terminals", "/app/pos", "/app/finance/periods",
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const auth = await login(page, "owner");
if (!auth.ok) { console.log("LOGIN FAILED", auth.why); process.exit(1); }

const out = {};
for (const route of ROUTES) {
  const st = await settle(page, route, "owner");
  const btns = await page.evaluate(() =>
    [...document.querySelectorAll("button,a[href]")]
      .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map((b) => (b.textContent || "").trim().replace(/\s+/g, " "))
      .filter((t) => t && t.length < 40)
  );
  // drop the nav chrome, which is identical everywhere
  const NAV = new Set(["Dashboard","POS","Kitchen Display","Till Review","Inventory","Menu Items","Tables","Stations","POS Terminals","Guide","Takings","Purchasing","Customers","Reports","Realtime Dashboard","Ask (NLQ)","Collapse","Search… ⌘K","Users","Settings","Employees","Attendance","Payroll","Schedule","Finance","HR","Expenses","Journal Entries","Accounts"]);
  out[route] = { clean: st.clean, refused: st.refused, buttons: [...new Set(btns.filter((b) => !NAV.has(b)))] };
  console.log(`${st.clean ? "OK  " : "FAIL"} ${route}`);
  console.log("      ", JSON.stringify(out[route].buttons.slice(0, 22)));
}
saveJson("triggers.json", out);
await browser.close();
