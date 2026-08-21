/*
 * PROBE F — two things:
 *  (1) WHERE does a bumped ticket go? `allFragments` is built column-by-column
 *      (all NEW, then all STARTED, then PREPARING, then READY) and only THEN sliced into
 *      pages of 16. So a ticket bumped out of NEW is pushed behind every remaining NEW
 *      fragment — onto a later page. Walk every page and find it.
 *  (2) RECALL from a genuinely READY ticket, which is the only state it is legal from.
 */
import { launch, newPage, login, probe, shot, BASE, BRANCH, GW } from "./skpx-lib.mjs";

const BUMP_AS = "kitchen";

async function readPageOfBoard(page) {
  return page.evaluate(() => {
    const cols = [...document.querySelectorAll('[data-testid^="kds-column-"]')]
      .filter((n) => /^kds-column-[A-Z_]+$/.test(n.getAttribute("data-testid")));
    return {
      count: document.querySelector('[data-testid="kds-ticket-count"]')?.innerText.trim(),
      pageInd: document.querySelector('[data-testid="kds-page-indicator"]')?.innerText.trim() ?? "1 / 1",
      bumpError: document.querySelector('[data-testid="kds-bump-error"]')?.innerText.trim() ?? null,
      columns: cols.map((c) => {
        const key = c.getAttribute("data-testid").replace("kds-column-", "");
        const frs = [...c.querySelectorAll('[data-testid^="kds-fragment-"]')];
        return {
          key,
          rows: frs.map((f) => ({
            id: f.getAttribute("data-testid").replace(`kds-fragment-${key}-`, ""),
            ord: (f.innerText.match(/ORD-[\d-]+/) ?? ["?"])[0],
            pos: (f.innerText.replace(/\s+/g, " ").match(/^(\d)\s/) ?? [, ""])[1],
          })),
        };
      }),
    };
  });
}

async function walkAllPages(page, label) {
  console.log(`\n=== walking every page of the board (${label}) ===`);
  // rewind to page 1
  for (let i = 0; i < 6; i++) { await page.keyboard.press("PageUp"); await page.waitForTimeout(500); }
  const seen = [];
  let guard = 0;
  while (guard++ < 8) {
    const b = await readPageOfBoard(page);
    const [cur, total] = b.pageInd.split("/").map((s) => Number(s.trim()));
    console.log(`  page ${b.pageInd}  count="${b.count}"`);
    b.columns.forEach((c) => {
      if (c.rows.length) console.log(`      ${c.key.padEnd(10)} n=${c.rows.length}  ${c.rows.map((r) => `${r.pos ? "[" + r.pos + "]" : ""}${r.ord}`).join(" ")}`);
      else console.log(`      ${c.key.padEnd(10)} n=0`);
    });
    seen.push({ pageInd: b.pageInd, columns: b.columns });
    if (cur >= total) break;
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(1500);
  }
  return seen;
}

async function allTickets(page, token) {
  return page.evaluate(async ([gw, br, tok]) => {
    const res = await fetch(`${gw}/api/v1/kitchen/kds/tickets?branchId=${br}&size=200&page=0`, { headers: { Authorization: `Bearer ${tok}` } });
    const j = await res.json();
    const rows = Array.isArray(j) ? j : (j.content ?? j.data ?? []);
    return rows.map((t) => ({ id: t.id, ord: t.orderNo, st: t.status, items: (t.items || []).map((i) => `${i.menuItemName ?? i.name}=${i.status}`) }));
  }, [GW, BRANCH, token]);
}

async function main() {
  const browser = await launch();
  const { page } = await newPage(browser);
  let TOKEN = null;
  page.on("request", (r) => { const a = r.headers()["authorization"]; if (a?.startsWith("Bearer ") && !TOKEN) TOKEN = a.slice(7); });
  if (!(await login(page, BUMP_AS))) process.exit(1);
  await probe(page, "/app/kitchen/DEFAULT", { who: BUMP_AS, wait: 7000 });

  const api = await allTickets(page, TOKEN);
  const cooking = api.filter((t) => t.st === "COOKING" || t.items.some((i) => /=ACCEPTED|=PREPARING/.test(i)));
  console.log(`\n  API says ${api.length} tickets; ${cooking.length} are past PENDING:`);
  cooking.forEach((t) => console.log(`      ${t.ord} status=${t.st} items=${JSON.stringify(t.items)}`));

  await page.locator("body").click({ position: { x: 3, y: 3 } }).catch(() => { });
  await page.waitForTimeout(400);
  const pages = await walkAllPages(page, "looking for the bumped ticket");
  await shot(page, "skpx-f1-last-page");

  for (const t of cooking) {
    let found = null;
    pages.forEach((p) => p.columns.forEach((c) => { if (c.rows.some((r) => r.id === t.id)) found = `${p.pageInd} / column ${c.key}`; }));
    console.log(`  >> ${t.ord} (${t.st}) is rendered at: ${found ?? "NOWHERE ON THE BOARD"}`);
  }

  // ---- how many NEW fragments are there, and does page 1 ever show a STARTED one? ----
  const p1 = pages[0];
  console.log(`\n  >> page 1 columns: ${p1.columns.map((c) => `${c.key}=${c.rows.length}`).join(" ")}`);
  console.log(`  >> a cook looking at page 1 sees the Started/Preparing/Ready columns EMPTY: ${p1.columns.filter((c) => c.key !== "NEW").every((c) => c.rows.length === 0)}`);

  // ---- drive one ticket all the way to READY, then recall it ----
  console.log(`\n=== drive a ticket to READY, then recall ===`);
  for (let i = 0; i < 6; i++) { await page.keyboard.press("PageUp"); await page.waitForTimeout(400); }
  const b = await readPageOfBoard(page);
  const target = b.columns.find((c) => c.key === "NEW")?.rows[0];
  console.log(`  target: ${target?.ord} id=${target?.id}`);
  for (let step = 1; step <= 4; step++) {
    // find it wherever it now is, across pages
    let located = null;
    for (let i = 0; i < 6; i++) { await page.keyboard.press("PageUp"); await page.waitForTimeout(350); }
    for (let g = 0; g < 8 && !located; g++) {
      const cur = await readPageOfBoard(page);
      for (const c of cur.columns) {
        const row = c.rows.find((r) => r.id === target.id);
        if (row) { located = { col: c.key, pos: row.pos, pageInd: cur.pageInd }; break; }
      }
      if (located) break;
      const [ci, ti] = cur.pageInd.split("/").map((s) => Number(s.trim()));
      if (ci >= ti) break;
      await page.keyboard.press("PageDown"); await page.waitForTimeout(1200);
    }
    console.log(`  step ${step}: ticket is at ${JSON.stringify(located)}`);
    if (!located) break;
    if (!located.pos) { console.log("  !! it has no position number on this page — cannot be selected by keyboard"); break; }
    await page.keyboard.press(located.pos); await page.waitForTimeout(700);
    await page.keyboard.press("f"); await page.waitForTimeout(5000);
    const now = (await allTickets(page, TOKEN)).find((t) => t.id === target.id);
    console.log(`     after F: ${JSON.stringify(now)}`);
    if (now && now.items.every((i) => /=READY/.test(i))) { console.log("     -> fully READY"); break; }
  }

  console.log(`\n=== R (recall) from READY ===`);
  await page.keyboard.press("r");
  await page.waitForTimeout(5000);
  const afterRecall = (await allTickets(page, TOKEN)).find((t) => t.id === target.id);
  const err = await page.evaluate(() => document.querySelector('[data-testid="kds-bump-error"]')?.innerText.trim() ?? null);
  console.log(`  API after recall: ${JSON.stringify(afterRecall)}`);
  console.log(`  on-screen error: ${JSON.stringify(err)}`);
  await shot(page, "skpx-f2-after-recall-from-ready");

  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
