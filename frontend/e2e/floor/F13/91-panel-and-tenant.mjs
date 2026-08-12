/*
 * F13 RE-OPEN, part 2 — the two loose ends from 90-reopen.mjs.
 *
 *   A. the POS terminal's ORDER PANEL (order-panel.tsx), the second caller of
 *      SettlementActions. `/app/pos/orders/{id}` is a 404 route, so the panel is reached the way
 *      a cashier reaches it: recall the fired check on the terminal.
 *   B. cross-tenant, asked correctly. My first probe sent no branchId and got a 400, which proves
 *      nothing either way. Ask with the OTHER tenant's own branch, and with Floating Terrace's.
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, apiGet, tokenOf, branchOf, log,
} from "./lib.mjs";
import { readFileSync } from "node:fs";

const st = JSON.parse(readFileSync(
  "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/F13/_reopen.json", "utf8"));
const PART = st.notes.cashierPartial; // part-paid, still SENT_TO_KDS — the live one
const FULL = st.notes.cashierFullPaid;

const browser = await newBrowser();
const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);
const ctok = await tokenOf(cash);
const branch = await branchOf(cash, ctok);

log("\n=== A. the terminal's order panel, on the part-paid live check", PART.orderNo, "===");
await go(cash, "/app/pos", { waitMs: 9000 });
// Recall the fired check onto the terminal the way the cashier does.
const recalled = await cash.evaluate((no) => {
  const btns = Array.from(document.querySelectorAll("button"));
  const hit = btns.find((b) => (b.innerText || "").includes(no));
  if (hit) { hit.click(); return "clicked-a-button-naming-it"; }
  return null;
}, PART.orderNo);
log("  recall attempt:", recalled);
await cash.waitForTimeout(5000);
await shot(cash, "91a-terminal-after-recall");
const panel = await cash.evaluate(() => ({
  notice: document.querySelector("[data-testid=void-blocked-paid-notice]")?.textContent?.trim() ?? null,
  refund: !!document.querySelector('[aria-label="Refund order"]'),
  voidBtn: !!document.querySelector('[aria-label="Void order"]'),
  panelText: (document.querySelector("[data-testid=order-panel]")?.innerText
    || document.body.innerText).replace(/\s+/g, " ").slice(0, 400),
}));
log("  panel:", JSON.stringify(panel).slice(0, 500));

log("\n=== B. cross-tenant, asked properly ===");
const ctrl = await newPage(browser);
await login(ctrl, { slug: "control-bistro-isolation-test-tenant", email: "cashier@control.local", password: "Control#Cashier1" });
const xtok = await tokenOf(ctrl);
const xbranch = await branchOf(ctrl, xtok);
log("  control branch:", xbranch, " terrace branch:", branch);
for (const [label, path] of [
  ["order by id, own branch param", `/api/v1/pos/orders/${FULL.orderNo ? "" : ""}`],
]) { void label; void path; }
const byOwnBranch = await apiGet(ctrl, `/api/v1/pos/orders?branchId=${xbranch}&size=50`, xtok);
const rows = byOwnBranch.body?.data ?? [];
log("  control cashier's own order list:", byOwnBranch.status, "rows:", rows.length,
  "any Terrace order numbers?", rows.some((r) => r.orderNo === FULL.orderNo || r.orderNo === PART.orderNo));
const byTerraceBranch = await apiGet(ctrl, `/api/v1/pos/orders?branchId=${branch}&size=50`, xtok);
log("  control cashier asking for the TERRACE branch:", byTerraceBranch.status,
  JSON.stringify(byTerraceBranch.body).slice(0, 200));

await browser.close();
