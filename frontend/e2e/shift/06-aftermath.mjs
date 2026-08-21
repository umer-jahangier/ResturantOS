/*
 * SHIFT STEP 6 — AFTERMATH.
 *
 *  a. Journal Entries: can a row be opened at all? What date does a new entry default to?
 *  b. The order list: does every check of the day appear with the right TYPE and STATUS?
 *  c. The audit log: is the void recorded, with an actor? Is the discount? Where does an
 *     owner even read it?
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, apiGet, tokenOf, log, BASE } from "./lib.mjs";

const st = loadState();
const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);

// ── 6a. journal entries navigation + new-entry defaults ───────────────────────
log("\n=== 6a. journal entries ===");
await go(owner, "/app/finance/journal-entries", { waitMs: 8000 });
const firstRow = owner.locator("tbody tr").first();
await firstRow.focus().catch(() => {});
await firstRow.click();
await owner.waitForTimeout(2500);
log("  after clicking a JE row, url =", owner.url());
await firstRow.press("Enter").catch(() => {});
await owner.waitForTimeout(3500);
log("  after pressing Enter on a JE row, url =", owner.url());
await shot(owner, "06a-je-row-open");
const jeOpened = await owner.evaluate(() => ({
  url: location.href,
  heading: document.querySelector("h1")?.textContent?.trim() ?? null,
  body: document.body.innerText.replace(/\s+/g, " ").slice(0, 900),
}));
log("  landed:", JSON.stringify({ url: jeOpened.url, heading: jeOpened.heading }));
saveState({ jeRowOpen: jeOpened });

await go(owner, "/app/finance/journal-entries/new", { waitMs: 7000 });
await shot(owner, "06b-new-journal-entry");
const newJe = await owner.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g, " ");
  return {
    selected: /Selected:\s*([\d-]+)/.exec(t)?.[1] ?? null,
    calendarMonth: /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/.exec(t)?.[0] ?? null,
    amountLabels: Array.from(document.querySelectorAll("th,label")).map((n) => n.textContent.trim()).filter((x) => /debit|credit/i.test(x)),
    totals: /Total DR:\s*([^ ]+)\s*Total CR:\s*([^ ]+)/.exec(t)?.slice(1) ?? null,
  };
});
log("  new JE form:", JSON.stringify(newJe));
saveState({ newJeForm: newJe });

// ── 6b. the order list, every check of the day ────────────────────────────────
log("\n=== 6b. the order list ===");
const tok = await tokenOf(owner);
await go(owner, "/app/pos", { waitMs: 8000 });
await owner.getByText("Order Management", { exact: true }).click();
await owner.waitForTimeout(4500);
// see the whole branch, not just my own
const allToggle = owner.locator("[data-testid=toggle-all-branch]");
if (await allToggle.count()) {
  await allToggle.click();
  await owner.waitForTimeout(3500);
}
const chips = await owner.evaluate(() =>
  Array.from(document.querySelectorAll('[data-testid^="status-filter-"]')).map((n) => ({ id: n.getAttribute("data-testid"), t: n.textContent.trim() })),
);
log("  chips:", JSON.stringify(chips));

const wanted = [st.order1No, st.order2No, st.order3No, "ORD-20260812-0167", "ORD-20260812-0168", "ORD-20260812-0169"];
const seen = {};
for (const c of chips) {
  await owner.locator(`[data-testid="${c.id}"]`).click();
  await owner.waitForTimeout(3500);
  const hits = await owner.evaluate((list) => {
    const t = document.body.innerText;
    const out = {};
    for (const n of list) {
      const i = t.indexOf(n);
      out[n] = i >= 0 ? t.slice(i, i + 150).replace(/\s+/g, " ") : null;
    }
    return { rows: /(\d+) rows?/.exec(t)?.[1] ?? null, out };
  }, wanted);
  seen[c.t] = hits;
  log(`  [${c.t}] rows=${hits.rows}`);
  for (const [n, v] of Object.entries(hits.out)) if (v) log(`      ${n} → ${v.slice(0, 110)}`);
  await shot(owner, `06c-chip-${c.t.replace(/\s+/g, "-").toLowerCase()}`);
}
saveState({ orderListByChip: seen });

// what the server says each of them IS
const truth = {};
for (const n of wanted) {
  const s = await apiGet(owner, `/api/v1/pos/orders/search?q=${n}`, tok);
  truth[n] = JSON.stringify(s.body).slice(0, 400);
}
log("\n  server truth per order:", JSON.stringify(truth, null, 1));
saveState({ orderTruth: truth });

// ── 6c. the audit log ─────────────────────────────────────────────────────────
log("\n=== 6c. where does an owner read the audit log? ===");
const routes = ["/app/audit", "/app/settings/audit", "/app/reports/audit", "/app/admin/audit", "/app/settings/security"];
const auditRoutes = {};
for (const r of routes) {
  const t = await go(owner, r, { waitMs: 4000, allowTrouble: true });
  auditRoutes[r] = t.bad.length ? t.bad.join(",") : "reachable";
  log(`  ${r}: ${auditRoutes[r]}`);
}
saveState({ auditRoutes });
const navHas = await owner.evaluate(() =>
  Array.from(document.querySelectorAll("nav a")).map((a) => ({ t: a.textContent.trim(), h: a.getAttribute("href") })).filter((x) => /audit|log|activity|history|security/i.test(x.t)),
);
log("  nav entries mentioning audit/log/activity:", JSON.stringify(navHas));

const auditApi = await apiGet(owner, `/api/v1/audit/events?size=20`, tok);
log("  GET /api/v1/audit/events →", auditApi.status);
log("  ", JSON.stringify(auditApi.body).slice(0, 1200));
saveState({ auditApi: { status: auditApi.status, body: auditApi.body } });

await browser.close();
log("\nstep 6 done");
