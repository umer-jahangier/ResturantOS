/*
 * PROBE O — with the Drinks category routed to BAR (done over the API, because no screen can do
 * it), fire ONE mixed check through the real till and see whether the drink reaches the bar.
 *
 * This is the question that decides effort: if the split works the moment routing data exists,
 * the whole defect is a missing admin screen. If it still does not split, the gap is deeper.
 */
import { launch, newPage, login, probe, shot, BASE, BRANCH, GW } from "./skpx-lib.mjs";

async function boardOf(page, code, token) {
  await probe(page, `/app/kitchen/${code}`, { wait: 6500 });
  return page.evaluate(() => ({
    head: document.querySelector("h1")?.innerText.trim(),
    count: document.querySelector('[data-testid="kds-ticket-count"]')?.innerText.trim(),
    conn: document.querySelector('[data-testid="kds-connection"]')?.innerText.trim(),
    cards: [...document.querySelectorAll('[data-testid="kds-ticket-card"]')].map((c) => c.innerText.replace(/\s+/g, " ").slice(0, 160)),
  }));
}

async function main() {
  const browser = await launch();

  // fire a mixed check through the till
  const { page: pos } = await newPage(browser);
  if (!(await login(pos, "manager"))) process.exit(1);
  await pos.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await pos.waitForTimeout(6500);
  for (const n of ["Chicken Karahi", "Pinacolada"]) {
    const t = pos.locator(`[data-testid="menu-grid"] button:has-text("${n}")`).first();
    if (await t.count()) { await t.click(); await pos.waitForTimeout(900); console.log(`  rang ${n}`); }
    else console.log(`  !! tile ${n} not found`);
  }
  await shot(pos, "skpx-o1-mixed-cart");
  await pos.locator('[data-testid="send-to-kitchen-button"]').first().click();
  await pos.waitForTimeout(8000);
  console.log("  fired a Chicken Karahi (Mains) + Pinacolada (Drinks) check");
  await shot(pos, "skpx-o2-after-fire");

  // read both boards as a persona that can see every station
  const { page } = await newPage(browser);
  let TOKEN = null;
  page.on("request", (r) => { const a = r.headers()["authorization"]; if (a?.startsWith("Bearer ") && !TOKEN) TOKEN = a.slice(7); });
  if (!(await login(page, "kitchen"))) process.exit(1);

  for (const code of ["DEFAULT", "BAR", "GRILL"]) {
    const b = await boardOf(page, code, TOKEN);
    console.log(`\n=== /app/kitchen/${code} -> h1="${b.head}" count="${b.count}" conn="${b.conn}" cards=${b.cards.length}`);
    b.cards.slice(0, 4).forEach((c, i) => console.log(`    #${i + 1} ${c}`));
    console.log(`    contains "Pinacolada": ${b.cards.some((c) => /Pinacolada/.test(c))}`);
    console.log(`    contains "Chicken Karahi": ${b.cards.some((c) => /Chicken Karahi/.test(c))}`);
    await shot(page, `skpx-o3-board-${code}`);
  }

  // the station picker — did BAR appear now that a ticket routed to it?
  await probe(page, "/app/kitchen", { wait: 6500 });
  const idx = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  console.log(`\n=== /app/kitchen index after routing: ${idx.slice(idx.indexOf("Kitchen — Stations"), idx.indexOf("Kitchen — Stations") + 400)}`);
  await probe(page, "/app/kitchen/DEFAULT", { wait: 6000 });
  const picker = await page.evaluate(() => {
    const s = document.querySelector('[data-testid="kds-station-switcher"]');
    return s ? [...s.querySelectorAll("option")].map((o) => o.value) : null;
  });
  console.log(`  station switcher now offers: ${JSON.stringify(picker)}`);
  await shot(page, "skpx-o4-station-switcher-after");

  // ground truth from the API
  const api = await page.evaluate(async ([gw, br, tok]) => {
    const r = await fetch(`${gw}/api/v1/kitchen/kds/tickets?branchId=${br}&size=200`, { headers: { Authorization: `Bearer ${tok}` } });
    const j = await r.json();
    const rows = Array.isArray(j) ? j : (j.content ?? j.data ?? []);
    return rows.slice(-6).map((t) => `${t.orderNo} station=${t.stationCode} items=${(t.items || []).map((i) => i.menuItemName ?? i.name).join("+")}`);
  }, [GW, BRANCH, TOKEN]);
  console.log(`\n  newest tickets per the API:`);
  api.forEach((a) => console.log(`    ${a}`));

  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
