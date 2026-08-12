/*
 * S1 step 4 — the three boards, as the kitchen persona (unrestricted scope).
 *
 * The check rung in step 3 must appear on BAR (the drink), GRILL (the kebab) and DEFAULT (the
 * curry) — and must NOT appear on PANTRY1, which is where the kebab used to go.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, apiGet, log } from "./lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);

async function boardProbe(page, orderNo) {
  return page.evaluate((ord) => {
    const cards = Array.from(document.querySelectorAll('[data-testid="kds-ticket-card"]'));
    const mine = cards.filter((c) => (c.innerText || "").includes(ord));
    return {
      h1: document.querySelector("h1")?.textContent?.trim() ?? null,
      cardCount: cards.length,
      mineCount: mine.length,
      mineText: mine.map((c) => (c.innerText || "").replace(/\s+/g, " ").trim().slice(0, 260)),
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
        (n.textContent || "").trim().slice(0, 200),
      ),
      noStations: !!document.querySelector('[data-testid="kds-no-stations"]'),
      bodyHasOrder: (document.body.innerText || "").includes(ord),
    };
  }, orderNo);
}

try {
  await login(page, PEOPLE.kitchen);

  // Find the check rung in step 3 from the server, on this persona's own bearer.
  const list = await apiGet(page, "/api/v1/kitchen/kds/tickets?branchId=");
  log("  (probe shape)", list.status);

  const st = loadState();
  const orderNo = process.env.ORDER_NO || st.ring?.orderNo || "ORD-20260812-0261";
  log("  looking for", orderNo);

  const results = {};
  for (const code of ["BAR", "GRILL", "DEFAULT", "PANTRY1"]) {
    const t = await go(page, `/app/kitchen/${code}`, { waitMs: 6000 });
    if (t.bad.length) log(`  ! ${code} trouble:`, JSON.stringify(t));
    const p = await boardProbe(page, orderNo);
    results[code] = { trouble: t, ...p };
    log(`  ${code}:`, JSON.stringify(p));
    await shot(page, `04-${code.toLowerCase()}-board`);
  }

  saveState({ boards: { orderNo, results } });
} catch (e) {
  console.error("FAILED:", e.message);
  await shot(page, "04z-failure");
  process.exitCode = 1;
} finally {
  await browser.close();
}
