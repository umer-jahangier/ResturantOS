/*
 * SHIFT STEP 5b — the manager reads the variance, the owner checks the money.
 *
 *  a. Manager -> /app/pos/tills: find today's closed till, read expected/declared/variance.
 *  b. Owner   -> /app/finance/takings: does today's total match what was actually taken?
 *  c. Owner   -> a transaction -> its journal entry -> do debits equal credits?
 *
 * My shift, to the paisa:
 *   float 5,000.00 | CASH 1,682.60 | CARD 1,972.00 | declared 6,682.60 | variance 0.00
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, finding, apiGet, tokenOf, log, BASE, money } from "./lib.mjs";

const st = loadState();
const browser = await newBrowser();

// ── manager: till review ──────────────────────────────────────────────────────
log("\n=== 5a. the manager reviews the closed drawer ===");
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
let tr = await go(mgr, "/app/pos/tills", { waitMs: 7000 });
log("  /app/pos/tills:", JSON.stringify(tr));
await shot(mgr, "05g-till-review");
const tills = await mgr.evaluate(() => {
  const t = document.body.innerText;
  const table = document.querySelector("[data-testid=till-review-history]");
  return {
    heading: document.querySelector("h1")?.textContent?.trim() ?? null,
    pageInfo: document.querySelector("[data-testid=till-review-page-info]")?.textContent?.trim() ?? null,
    headers: table ? Array.from(table.querySelectorAll("th")).map((n) => n.textContent.trim()) : null,
    rows: table
      ? Array.from(table.querySelectorAll("tbody tr")).slice(0, 8).map((r) => Array.from(r.querySelectorAll("td")).map((c) => c.innerText.replace(/\s+/g, " ").trim()))
      : null,
    firstScreen: t.replace(/\s+/g, " ").slice(0, 900),
  };
});
log("  till review:", JSON.stringify(tills, null, 1));
saveState({ tillReview: tills });

// the variance panel for MY till
const mtok = await tokenOf(mgr);
const tillList = await apiGet(mgr, `/api/v1/pos/tills?branchId=${st.cashierClaims ? "" : ""}&size=10`, mtok);
log("  GET /pos/tills:", JSON.stringify(tillList.body).slice(0, 900));
saveState({ tillListApi: tillList.body });

// ── owner: takings ────────────────────────────────────────────────────────────
log("\n=== 5b. the owner opens Finance -> Takings ===");
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
tr = await go(owner, "/app/finance/takings", { waitMs: 8000 });
log("  /app/finance/takings:", JSON.stringify(tr));
await shot(owner, "05h-takings");
const takings = await owner.evaluate(() => {
  const t = document.body.innerText;
  return {
    date: document.querySelector("[data-testid=takings-date]")?.value ?? document.querySelector("[data-testid=takings-date]")?.textContent?.trim() ?? null,
    tiles: Array.from(document.querySelectorAll('[data-testid^="figure-tile-"]')).map((n) => ({
      id: n.getAttribute("data-testid"),
      text: n.innerText.replace(/\s+/g, " ").trim(),
    })),
    unclosedCash: document.querySelector("[data-testid=unclosed-cash-amount]")?.textContent?.trim() ?? null,
    unclosedTotal: document.querySelector("[data-testid=unclosed-total-amount]")?.textContent?.trim() ?? null,
    unclosedNone: document.querySelector("[data-testid=unclosed-none]")?.textContent?.trim() ?? null,
    residual: document.querySelector("[data-testid=residual-unknowns]")?.innerText?.replace(/\s+/g, " ").trim() ?? null,
    full: t.replace(/\s+/g, " ").slice(0, 2200),
  };
});
log("  takings:", JSON.stringify(takings, null, 1));
saveState({ takings });

// ── owner: transactions -> journal entry ──────────────────────────────────────
log("\n=== 5c. a transaction, drilled through to its journal entry ===");
tr = await go(owner, "/app/finance/transactions", { waitMs: 8000 });
log("  /app/finance/transactions:", JSON.stringify(tr));
await shot(owner, "05i-transactions");
const txns = await owner.evaluate(() => {
  const rows = Array.from(document.querySelectorAll("tbody tr")).slice(0, 10);
  return {
    headers: Array.from(document.querySelectorAll("thead th")).map((n) => n.textContent.trim()),
    rows: rows.map((r) => Array.from(r.querySelectorAll("td")).map((c) => c.innerText.replace(/\s+/g, " ").trim())),
    links: Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href")).filter((h) => h?.includes("journal")).slice(0, 6),
    body: document.body.innerText.replace(/\s+/g, " ").slice(0, 1200),
  };
});
log("  transactions:", JSON.stringify(txns, null, 1));
saveState({ transactions: txns });

await browser.close();
log("\nstep 5b done");
