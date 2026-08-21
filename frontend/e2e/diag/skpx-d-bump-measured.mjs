/*
 * PROBE D — bump / recall, measured against the TICKET STATUS, not the card count.
 *
 * Fixes the two instrumentation faults in probe C: the board's columns carry
 * data-testid="kds-column-{KEY}" (not <section>), and the access token lives in memory, not
 * localStorage — so it is lifted off a real outbound request instead.
 */
import { launch, newPage, login, probe, shot, BRANCH, GW } from "./skpx-lib.mjs";

const PERSONA = process.argv[2] ?? "kitchen";
const STATION = process.argv[3] ?? "DEFAULT";

async function board(page, tag) {
  const r = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('[data-testid^="kds-column-"]')]
      .filter((n) => /^kds-column-[A-Z_]+$/.test(n.getAttribute("data-testid")));
    return {
      cardCount: document.querySelectorAll('[data-testid="kds-ticket-card"]').length,
      countLabel: document.querySelector('[data-testid="kds-ticket-count"]')?.innerText.trim() ?? null,
      pageInd: document.querySelector('[data-testid="kds-page-indicator"]')?.innerText.trim() ?? null,
      conn: document.querySelector('[data-testid="kds-connection"]')?.getAttribute("data-connected"),
      hint: (document.body.innerText.match(/F bump|R recall/g) ?? []).join(","),
      bumpError: document.querySelector('[data-testid="kds-bump-error"]')?.innerText.trim() ?? null,
      columns: cols.map((c) => {
        const key = c.getAttribute("data-testid").replace("kds-column-", "");
        const frags = [...c.querySelectorAll('[data-testid^="kds-fragment-"]')].map((f) => {
          const id = f.getAttribute("data-testid").replace(`kds-fragment-${key}-`, "");
          const t = f.innerText.replace(/\s+/g, " ");
          const ord = (t.match(/ORD-[\d-]+/) ?? ["?"])[0];
          const pos = (t.match(/^(\d)\s/) ?? [, ""])[1];
          return { id, ord, pos, items: (t.match(/\d+×\s[A-Za-z ]+/g) ?? []).join("|") };
        });
        return { key, n: frags.length, frags };
      }),
    };
  });
  console.log(`  [${tag}] cards=${r.cardCount} count="${r.countLabel}" page="${r.pageInd}" connected=${r.conn} hint="${r.hint}" bumpError=${JSON.stringify(r.bumpError)}`);
  r.columns.forEach((c) => console.log(`      ${c.key.padEnd(12)} n=${c.n}  ${c.frags.slice(0, 5).map((f) => `${f.pos ? "[" + f.pos + "]" : ""}${f.ord}(${f.items})`).join("  ")}`));
  return r;
}

async function main() {
  const browser = await launch();
  const { page } = await newPage(browser);

  // lift a live bearer token off an outbound request
  let TOKEN = null;
  page.on("request", (req) => {
    const a = req.headers()["authorization"];
    if (a && a.startsWith("Bearer ") && !TOKEN) TOKEN = a.slice(7);
  });

  if (!(await login(page, PERSONA))) process.exit(1);
  const b0 = await probe(page, `/app/kitchen/${STATION}`, { who: PERSONA, wait: 6500 });
  console.log(`\n=== /app/kitchen/${STATION} as ${PERSONA} heads=${JSON.stringify(b0.heads)} denied=${b0.denied}`);
  console.log("  token captured:", !!TOKEN);

  const apiTickets = async () => {
    const r = await page.evaluate(async ([gw, br, tok]) => {
      const res = await fetch(`${gw}/api/v1/kitchen/kds/tickets?branchId=${br}`, { headers: { Authorization: `Bearer ${tok}` } });
      if (!res.ok) return { status: res.status, err: (await res.text()).slice(0, 200) };
      const j = await res.json();
      const rows = Array.isArray(j) ? j : (j.content ?? j.data ?? []);
      return { status: res.status, rows: rows.map((t) => ({ id: t.id, ord: t.orderNo, st: t.status, station: t.stationCode, items: (t.items || []).map((i) => `${i.menuItemName ?? i.name}=${i.status}`) })) };
    }, [GW, BRANCH, TOKEN]);
    return r;
  };

  const start = await board(page, "START");
  await shot(page, `skpx-d1-start`);
  const api0 = await apiTickets();
  console.log(`  API tickets: status=${api0.status} n=${api0.rows?.length}`);

  // The fragment carrying position marker "1" is what F will act on.
  const all = start.columns.flatMap((c) => c.frags.map((f) => ({ ...f, col: c.key })));
  const t1 = all.find((f) => f.pos === "1") ?? all[0];
  console.log(`\n  >> target = ${t1?.ord} id=${t1?.id} column=${t1?.col} items="${t1?.items}"`);
  const st0 = api0.rows?.find((r) => r.id === t1?.id);
  console.log(`  >> API status BEFORE: ${JSON.stringify(st0)}`);

  await page.locator("body").click({ position: { x: 3, y: 3 } }).catch(() => { });
  await page.waitForTimeout(400);
  await page.keyboard.press("1");
  await page.waitForTimeout(700);

  for (const n of [1, 2, 3, 4]) {
    console.log(`\n=== F press #${n} ===`);
    await page.keyboard.press("f");
    await page.waitForTimeout(4000);
    const b = await board(page, `AFTER-F${n}`);
    const api = await apiTickets();
    const st = api.rows?.find((r) => r.id === t1?.id);
    console.log(`  >> API status of ${t1?.ord}: ${JSON.stringify(st)}`);
    await shot(page, `skpx-d2-after-f${n}`);
    if (!st) { console.log("  >> ticket has LEFT the open-ticket list (completed)"); break; }
    // keep acting on the same ticket
    const stillThere = b.columns.flatMap((c) => c.frags).find((f) => f.id === t1?.id);
    if (stillThere) {
      const pos = stillThere.pos;
      if (pos) { await page.keyboard.press(pos); await page.waitForTimeout(600); }
    } else {
      console.log("  >> ticket no longer rendered on this page of the board");
      break;
    }
  }

  console.log(`\n=== R (recall) inside the 60s window ===`);
  await page.keyboard.press("r");
  await page.waitForTimeout(4500);
  await board(page, "AFTER-R");
  const apiR = await apiTickets();
  console.log(`  >> API status after recall: ${JSON.stringify(apiR.rows?.find((r) => r.id === t1?.id))}`);
  await shot(page, `skpx-d3-after-recall`);

  console.log(`\n=== reload — persistence ===`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  await board(page, "AFTER-RELOAD");
  const apiF = await apiTickets();
  console.log(`  >> API status after reload: ${JSON.stringify(apiF.rows?.find((r) => r.id === t1?.id))}`);
  await shot(page, `skpx-d4-after-reload`);

  // Also try the per-item CLICK affordance, which is the mouse path a cook would use.
  console.log(`\n=== per-item click affordance (column-move-*) ===`);
  const moveBtns = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="column-move-"]')].map((b) => ({
      testid: b.getAttribute("data-testid"), label: (b.innerText || b.getAttribute("aria-label") || "").trim().replace(/\s+/g, " "),
    })));
  console.log(`  move buttons on screen: ${moveBtns.length}`, JSON.stringify(moveBtns.slice(0, 4)));
  if (moveBtns.length) {
    const before = await apiTickets();
    await page.locator(`[data-testid="${moveBtns[0].testid}"]`).first().click();
    await page.waitForTimeout(4000);
    const after = await apiTickets();
    const changed = JSON.stringify(before.rows) !== JSON.stringify(after.rows);
    console.log(`  >> clicking "${moveBtns[0].label}" changed ticket state: ${changed}`);
    await board(page, "AFTER-CLICK-MOVE");
    await shot(page, `skpx-d5-after-click-move`);
  }

  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
