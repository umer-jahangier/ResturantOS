/*
 * SHIFT STEP 5d — a transaction, its journal entry, and do the debits equal the credits?
 *
 * The Transactions row expands in place ("Open"/"Hide") rather than navigating, so this
 * reads the expanded region itself, follows whatever it links to, and sums the journal
 * lines off the rendered page.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, apiGet, tokenOf, log, BASE } from "./lib.mjs";

const st = loadState();
const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
await go(owner, "/app/finance/transactions", { waitMs: 8000 });

const row = owner.locator("tbody tr", { hasText: st.order1No }).first();
log("  rows matching", st.order1No, ":", await owner.locator("tbody tr", { hasText: st.order1No }).count());
await row.getByRole("button", { name: /Open|Hide/ }).click();
await owner.waitForTimeout(6000);
await shot(owner, "05l-transaction-expanded");

const expanded = await owner.evaluate((no) => {
  const rows = Array.from(document.querySelectorAll("tbody tr"));
  const i = rows.findIndex((r) => r.innerText.includes(no) && /Payment/.test(r.innerText));
  const detail = rows[i + 1];
  return {
    idx: i,
    detailText: detail ? detail.innerText.replace(/\s+/g, " ").trim().slice(0, 1400) : null,
    links: detail ? Array.from(detail.querySelectorAll("a")).map((a) => ({ t: a.textContent.trim(), h: a.getAttribute("href") })) : [],
  };
}, st.order1No);
log("  expanded detail:", JSON.stringify(expanded, null, 1));
saveState({ txnExpanded: expanded });

// follow the journal-entry link
const jeLink = (expanded.links ?? []).find((l) => /journal/i.test(l.h ?? "") || /entry|ledger|journal/i.test(l.t));
log("  journal link:", JSON.stringify(jeLink));
if (jeLink?.h) {
  await go(owner, jeLink.h, { waitMs: 8000 });
  await shot(owner, "05m-journal-entry");
  const je = await owner.evaluate(() => {
    const tbl = document.querySelector("table");
    const rows = tbl ? Array.from(tbl.querySelectorAll("tbody tr")).map((r) => Array.from(r.querySelectorAll("td")).map((c) => c.innerText.replace(/\s+/g, " ").trim())) : [];
    const nums = (s) => Number((s ?? "").replace(/[^\d.-]/g, "")) || 0;
    const dr = rows.reduce((a, r) => a + nums(r[r.length - 2]), 0);
    const cr = rows.reduce((a, r) => a + nums(r[r.length - 1]), 0);
    return {
      url: location.href,
      heading: document.querySelector("h1")?.textContent?.trim() ?? null,
      headers: tbl ? Array.from(tbl.querySelectorAll("th")).map((n) => n.textContent.trim()) : [],
      rows,
      sumSecondLast: dr,
      sumLast: cr,
      body: document.body.innerText.replace(/\s+/g, " ").slice(0, 1600),
    };
  });
  log("  journal entry:", JSON.stringify(je, null, 1));
  saveState({ journalEntry: je });
}

// and the journal-entries list, in case the drill-through is elsewhere
await go(owner, "/app/finance/journal-entries", { waitMs: 8000 });
await shot(owner, "05n-journal-entries-list");
const jes = await owner.evaluate(() => {
  const tbl = document.querySelector("table");
  return {
    headers: tbl ? Array.from(tbl.querySelectorAll("th")).map((n) => n.textContent.trim()) : [],
    rows: tbl ? Array.from(tbl.querySelectorAll("tbody tr")).slice(0, 8).map((r) => Array.from(r.querySelectorAll("td")).map((c) => c.innerText.replace(/\s+/g, " ").trim())) : [],
    links: Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href")).filter((h) => h?.includes("journal-entries/")).slice(0, 6),
    body: document.body.innerText.replace(/\s+/g, " ").slice(0, 1000),
  };
});
log("\n  journal entries list:", JSON.stringify(jes, null, 1));
saveState({ journalList: jes });

if (jes.links.length) {
  await go(owner, jes.links[0], { waitMs: 8000 });
  await shot(owner, "05o-journal-entry-detail");
  const detail = await owner.evaluate(() => {
    const tbl = document.querySelector("table");
    const rows = tbl ? Array.from(tbl.querySelectorAll("tbody tr")).map((r) => Array.from(r.querySelectorAll("td")).map((c) => c.innerText.replace(/\s+/g, " ").trim())) : [];
    return {
      url: location.href,
      heading: document.querySelector("h1")?.textContent?.trim() ?? null,
      headers: tbl ? Array.from(tbl.querySelectorAll("th")).map((n) => n.textContent.trim()) : [],
      rows,
      body: document.body.innerText.replace(/\s+/g, " ").slice(0, 1600),
    };
  });
  log("\n  first journal entry detail:", JSON.stringify(detail, null, 1));
  saveState({ journalDetail: detail });
}

await browser.close();
log("\nstep 5d done");
