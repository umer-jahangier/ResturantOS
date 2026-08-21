/*
 * PROBE E — a CONTROLLED bump measurement on a ticket this script creates itself.
 *
 * Prior attempts were invalid for two separate instrumentation reasons, both recorded here so
 * the result is trustworthy:
 *   - MANAGER lacks `pos.kds.update`, so F was a silent no-op (wrong persona).
 *   - GET /kitchen/kds/tickets is PAGE-based and returns 20 rows while the board holds 33
 *     fragments, so "not found in the API list" did NOT mean "completed" (wrong window).
 * This run pages the API fully (size=200) and follows one ticket by id.
 *
 * Ladder under test: PENDING -> ACCEPTED -> PREPARING -> READY, columns NEW/STARTED/PREPARING/READY.
 */
import { launch, newPage, login, probe, shot, BASE, BRANCH, GW } from "./skpx-lib.mjs";

const FIRE_AS = "manager";     // holds pos.order.send_to_kds
const BUMP_AS = process.argv[2] ?? "kitchen"; // holds pos.kds.update

async function boardRead(page, tag) {
  const r = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('[data-testid^="kds-column-"]')]
      .filter((n) => /^kds-column-[A-Z_]+$/.test(n.getAttribute("data-testid")));
    return {
      count: document.querySelector('[data-testid="kds-ticket-count"]')?.innerText.trim(),
      pageInd: document.querySelector('[data-testid="kds-page-indicator"]')?.innerText.trim() ?? "1 / 1",
      conn: document.querySelector('[data-testid="kds-connection"]')?.getAttribute("data-connected"),
      bumpError: document.querySelector('[data-testid="kds-bump-error"]')?.innerText.trim() ?? null,
      columns: cols.map((c) => {
        const key = c.getAttribute("data-testid").replace("kds-column-", "");
        return {
          key,
          ids: [...c.querySelectorAll('[data-testid^="kds-fragment-"]')].map((f) =>
            f.getAttribute("data-testid").replace(`kds-fragment-${key}-`, "")),
          ords: [...c.querySelectorAll('[data-testid^="kds-fragment-"]')].map((f) =>
            (f.innerText.match(/ORD-[\d-]+/) ?? ["?"])[0]),
          poss: [...c.querySelectorAll('[data-testid^="kds-fragment-"]')].map((f) =>
            (f.innerText.replace(/\s+/g, " ").match(/^(\d)\s/) ?? [, ""])[1]),
        };
      }),
    };
  });
  console.log(`  [${tag}] count="${r.count}" page="${r.pageInd}" connected=${r.conn} bumpError=${JSON.stringify(r.bumpError)}`);
  r.columns.forEach((c) => console.log(`      ${c.key.padEnd(10)} n=${c.ids.length}  ${c.ords.slice(0, 8).map((o, i) => `${c.poss[i] ? "[" + c.poss[i] + "]" : ""}${o}`).join(" ")}`));
  return r;
}

/** Full, unpaginated ticket fetch — the fault that invalidated the previous run. */
async function allTickets(page, token) {
  return page.evaluate(async ([gw, br, tok]) => {
    const res = await fetch(`${gw}/api/v1/kitchen/kds/tickets?branchId=${br}&size=200&page=0`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    if (!res.ok) return { status: res.status, err: (await res.text()).slice(0, 200) };
    const j = await res.json();
    const rows = Array.isArray(j) ? j : (j.content ?? j.data ?? []);
    return {
      status: res.status, n: rows.length, totalElements: j.totalElements,
      rows: rows.map((t) => ({ id: t.id, ord: t.orderNo, st: t.status, station: t.stationCode, items: (t.items || []).map((i) => `${i.menuItemName ?? i.name}=${i.status}`) })),
    };
  }, [GW, BRANCH, token]);
}

async function main() {
  const browser = await launch();

  // ---------- 1. fire a fresh order through the real till ----------
  const { page: pos } = await newPage(browser);
  if (!(await login(pos, FIRE_AS))) process.exit(1);
  await pos.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await pos.waitForTimeout(6500);
  for (const name of ["Seekh Kebab"]) {
    const tile = pos.locator(`[data-testid="menu-grid"] button:has-text("${name}")`).first();
    if (await tile.count()) { await tile.click(); await pos.waitForTimeout(900); console.log(`  rang ${name}`); }
  }
  await pos.locator('[data-testid="send-to-kitchen-button"]').first().click();
  await pos.waitForTimeout(6000);
  console.log("  fired an order through /app/pos");
  await shot(pos, "skpx-e0-fired");

  // ---------- 2. open the board as the persona that can bump ----------
  const { page } = await newPage(browser);
  let TOKEN = null;
  page.on("request", (r) => { const a = r.headers()["authorization"]; if (a?.startsWith("Bearer ") && !TOKEN) TOKEN = a.slice(7); });
  if (!(await login(page, BUMP_AS))) process.exit(1);
  await probe(page, "/app/kitchen/DEFAULT", { who: BUMP_AS, wait: 7000 });

  const api0 = await allTickets(page, TOKEN);
  console.log(`\n  API full fetch: status=${api0.status} n=${api0.n} totalElements=${api0.totalElements}`);
  // newest PENDING ticket = the one just fired
  const mine = api0.rows.filter((r) => r.items.some((i) => /Seekh Kebab/.test(i))).slice(-1)[0]
    ?? api0.rows.filter((r) => r.st === "PENDING").slice(-1)[0];
  console.log(`  >> tracking ticket ${mine?.ord} id=${mine?.id} status=${mine?.st} items=${JSON.stringify(mine?.items)}`);

  const b0 = await boardRead(page, "START");
  await shot(page, "skpx-e1-start");
  const where0 = b0.columns.find((c) => c.ids.includes(mine.id));
  const pos0 = where0 ? where0.poss[where0.ids.indexOf(mine.id)] : null;
  console.log(`  >> on the board it sits in column=${where0?.key} at position marker "${pos0}"`);

  if (!pos0) {
    console.log("  !! the tracked ticket is not on page 1 — pressing PageDown until it is");
    for (let i = 0; i < 3 && !pos0; i++) { await page.keyboard.press("PageDown"); await page.waitForTimeout(1200); }
  }

  // ---------- 3. focus it and bump ONCE ----------
  await page.locator("body").click({ position: { x: 3, y: 3 } }).catch(() => { });
  await page.waitForTimeout(400);
  if (pos0) { await page.keyboard.press(pos0); await page.waitForTimeout(800); }
  await shot(page, "skpx-e2-focused");

  console.log("\n=== F (bump) once ===");
  await page.keyboard.press("f");
  await page.waitForTimeout(6000);   // well past BUMP_COLLAPSE_MS = 400
  const b1 = await boardRead(page, "AFTER-F");
  await shot(page, "skpx-e3-after-f");
  const api1 = await allTickets(page, TOKEN);
  const after = api1.rows.find((r) => r.id === mine.id);
  console.log(`  >> API status of ${mine.ord} AFTER bump: ${JSON.stringify(after)}`);
  const where1 = b1.columns.find((c) => c.ids.includes(mine.id));
  console.log(`  >> board column AFTER bump: ${where1?.key ?? "NOT ON THE BOARD"}`);
  console.log(`  >> EXPECTED: status PENDING->ACCEPTED, column NEW->STARTED`);

  // ---------- 4. recall inside the window ----------
  console.log("\n=== R (recall) ===");
  await page.keyboard.press("r");
  await page.waitForTimeout(5000);
  const b2 = await boardRead(page, "AFTER-R");
  const api2 = await allTickets(page, TOKEN);
  console.log(`  >> API status after recall: ${JSON.stringify(api2.rows.find((r) => r.id === mine.id))}`);
  console.log(`  >> board column after recall: ${b2.columns.find((c) => c.ids.includes(mine.id))?.key ?? "NOT ON THE BOARD"}`);
  await shot(page, "skpx-e4-after-recall");

  // ---------- 5. bump all the way to READY, then confirm it leaves ----------
  console.log("\n=== bump to the end of the ladder ===");
  for (let i = 1; i <= 4; i++) {
    const b = await boardRead(page, `LOOP-${i}-pre`);
    const w = b.columns.find((c) => c.ids.includes(mine.id));
    if (!w) { console.log(`  >> ticket no longer on the board at step ${i}`); break; }
    const p = w.poss[w.ids.indexOf(mine.id)];
    if (p) { await page.keyboard.press(p); await page.waitForTimeout(700); }
    await page.keyboard.press("f");
    await page.waitForTimeout(5000);
    const a = await allTickets(page, TOKEN);
    console.log(`  step ${i}: API -> ${JSON.stringify(a.rows.find((r) => r.id === mine.id))}`);
  }
  await boardRead(page, "END");
  await shot(page, "skpx-e5-end");

  // ---------- 6. reload: does the final state persist ----------
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  const b3 = await boardRead(page, "AFTER-RELOAD");
  const api3 = await allTickets(page, TOKEN);
  console.log(`  >> FINAL API status: ${JSON.stringify(api3.rows.find((r) => r.id === mine.id))}`);
  console.log(`  >> FINAL board column: ${b3.columns.find((c) => c.ids.includes(mine.id))?.key ?? "NOT ON THE BOARD"}`);
  await shot(page, "skpx-e6-final");

  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
