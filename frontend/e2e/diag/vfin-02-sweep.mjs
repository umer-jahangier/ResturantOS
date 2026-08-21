/* VERIFY #2: sweep every finance + report + dashboard screen as OWNER, scanning for
   exports and for any profit/margin/balance-sheet figure. DIAGNOSTIC ONLY. */
import { chromium } from "@playwright/test";
import { PERSONAS, login, visit, shot, save, scanExports } from "./vfin-lib.mjs";

const log = [];
const P = (s) => { console.log(s); log.push(s); };

const ROUTES = [
  "/app/dashboard",
  "/app/finance", "/app/finance/takings", "/app/finance/transactions", "/app/finance/accounts",
  "/app/finance/journal-entries", "/app/finance/gl", "/app/finance/periods", "/app/finance/expenses",
  "/app/finance/ap-aging", "/app/finance/ar-aging", "/app/finance/house-accounts", "/app/finance/guide",
  "/app/reports",
  "/app/reports/sales-by-day", "/app/reports/sales-by-item", "/app/reports/sales-by-hour",
  "/app/reports/sales-by-order-type", "/app/reports/discount-summary", "/app/reports/till-sessions",
  "/app/reports/purchases-by-po", "/app/reports/fbr",
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await ctx.newPage();

const persona = process.argv[2] || "owner";
const ok = await login(page, PERSONAS[persona]);
P(`### persona=${persona} login=${ok} url=${page.url()}`);
if (!ok) { await browser.close(); process.exit(1); }

const MONEY_WORDS = /profit|margin|net income|gross|cogs|cost of goods|food cost|balance sheet|assets|liabilities|equity|retained/i;

for (const route of ROUTES) {
  const r = await visit(page, route, { tries: 3, settle: 4000 });
  if (r.sessionLost) { P(`\n## ${route} :: SESSION LOST — re-login`); await login(page, PERSONAS[persona]); const r2 = await visit(page, route); Object.assign(r, r2); }
  const ex = r.sessionLost ? [] : await scanExports(page);
  const money = (r.body || "").match(MONEY_WORDS);
  P(`\n## ${route}`);
  P(`   url=${r.url} denied=${r.denied} errored=${r.errored} attempts=${r.attempt}`);
  P(`   EXPORT AFFORDANCES: ${ex.length === 0 ? "NONE" : JSON.stringify(ex)}`);
  P(`   profit/margin/BS words: ${money ? money[0] : "none"}`);
  if (r.denied || r.errored) P(`   BODY(600): ${(r.body || "").slice(0, 600).replace(/\n/g, " | ")}`);
  else P(`   BODY(1200): ${(r.body || "").slice(0, 1200).replace(/\n/g, " | ")}`);
  await shot(page, `${persona}${route.replace(/\//g, "_")}`);
}

save(`sweep-${persona}.txt`, log.join("\n"));
await browser.close();
