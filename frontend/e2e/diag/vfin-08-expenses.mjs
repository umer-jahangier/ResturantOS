/* VERIFY #6: expenses filter is a <select> (default PENDING_APPROVAL). Does the approved
   expense show under "Approved"/"All statuses"? Also: GL screen shape. DIAGNOSTIC ONLY. */
import { chromium } from "@playwright/test";
import { PERSONAS, login, visit, shot, save, assertOn, scanExports } from "./vfin-lib.mjs";

const log = [];
const P = (s) => { console.log(s); log.push(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await ctx.newPage();
const ok = await login(page, PERSONAS.accountant);
P(`login=${ok}`);
if (!ok) { await browser.close(); process.exit(1); }

P("\n===== EXPENSES via the status <select> =====");
await visit(page, "/app/finance/expenses", { settle: 5000 });
await assertOn(page, "expenses");
const sel = page.locator('select[aria-label="Filter by status"]');
P(`select found: ${await sel.count()}`);
if (await sel.count()) {
  const opts = await sel.first().evaluate((s) => [...s.options].map((o) => ({ v: o.value, t: o.text })));
  P(`options: ${JSON.stringify(opts)}`);
  for (const o of opts) {
    await sel.first().selectOption(o.v);
    await sleep(3000);
    const b = await page.locator("body").innerText();
    const empty = b.includes("No expenses");
    const seg = b.slice(b.indexOf("Expenses"), b.indexOf("Expenses") + 500).replace(/\n/g, " | ");
    P(`  [${o.t || "(blank)"}] ${empty ? "EMPTY" : "HAS ROWS"} :: ${seg}`);
    await shot(page, `exp-${(o.v || "all").toLowerCase()}`);
  }
}

P("\n===== GENERAL LEDGER shape =====");
const r = await visit(page, "/app/finance/gl", { settle: 5000 });
if (r.sessionLost) { await login(page, PERSONAS.accountant); await visit(page, "/app/finance/gl", { settle: 5000 }); }
await assertOn(page, "gl");
const gb = await page.locator("body").innerText();
P(`exports: ${JSON.stringify(await scanExports(page))}`);
P(`GL body: ${gb.slice(gb.indexOf("General Ledger", gb.indexOf("Guide"))).slice(0, 1600).replace(/\n/g, " | ")}`);
await shot(page, "gl-shape");
// is there a totals row / does debit == credit (trial-balance property)?
const tbl = await page.evaluate(() => {
  const t = document.querySelector("table");
  if (!t) return null;
  return { headers: [...t.querySelectorAll("thead th")].map((h) => h.innerText.trim()), rows: [...t.querySelectorAll("tbody tr")].length, tfoot: !!t.querySelector("tfoot") };
});
P(`GL table: ${JSON.stringify(tbl)}`);

P("\n===== TAKINGS shape =====");
const r2 = await visit(page, "/app/finance/takings", { settle: 5000 });
if (!r2.sessionLost) {
  const tb = await page.locator("body").innerText();
  P(`Takings body: ${tb.slice(tb.indexOf("Takings", tb.indexOf("Guide"))).slice(0, 1200).replace(/\n/g, " | ")}`);
  await shot(page, "takings-shape");
}

save("expenses-gl.txt", log.join("\n"));
await browser.close();
