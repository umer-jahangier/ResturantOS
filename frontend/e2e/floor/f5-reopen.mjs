/*
 * F5 RE-OPEN ATTEMPT — independent drive, written from scratch against the DONE MEANS.
 *
 * Not a re-run of the author's harness. This one:
 *   1. drives /app/finance/takings as OWNER and reads every tile out of the rendered DOM
 *   2. reloads and re-reads (persistence)
 *   3. cross-checks the rendered figures against the raw API body
 *   4. sweeps EVERY day in the last 30 that has trading, not just one convenient one
 *   5. re-reads as MANAGER, ACCOUNTANT and CASHIER (permission-widening check)
 *   6. checks the branch-scoped read (?branchId=) as well as the tenant-wide one
 *   7. reads the owner DASHBOARD "Net sales" tile — the adjacent screen
 */
import { newBrowser, newPage, login, PEOPLE, apiGet, tokenOf, money, BASE } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F5/reopen");
mkdirSync(OUT, { recursive: true });

const IDS = [
  "figure-tile-gross-sales",
  "figure-tile-discounts",
  "figure-tile-comps",
  "figure-tile-net-sales",
  "figure-tile-tax",
  "figure-tile-service-charge",
  "figure-tile-total-billed",
];

const problems = [];
const notes = [];
function check(ok, what) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) problems.push(what);
}
function note(s) {
  console.log(`  ..    ${s}`);
  notes.push(s);
}

/** Read the tiles off the RENDERED page — text only, never props. */
async function readTiles(page) {
  return page.evaluate((ids) => {
    const out = {};
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) { out[id] = null; continue; }
      const lines = (el.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean);
      const text = el.innerText || "";
      const m = text.match(/Rs\s*([\d,]+\.\d{2})/);
      out[id] = {
        label: lines[0] ?? "",
        amountText: m ? `Rs ${m[1]}` : null,
        paisa: m ? Math.round(Number(m[1].replace(/,/g, "")) * 100) : null,
        caption: lines.slice(2).join(" "),
        raw: text.replace(/\n/g, " | "),
      };
    }
    const ident = document.querySelector('[data-testid="takings-identity"]');
    out.__identity = ident ? ident.textContent.trim() : null;
    out.__alerts = Array.from(document.querySelectorAll('[role="alert"]'))
      .map((n) => (n.textContent || "").trim()).filter(Boolean);
    out.__bodyHasError = /Couldn.t load|Something went wrong|Access denied/i.test(document.body.innerText || "");
    return out;
  }, IDS);
}

function assertTiles(t, tag) {
  const g = t["figure-tile-gross-sales"]?.paisa;
  const d = t["figure-tile-discounts"]?.paisa;
  const n = t["figure-tile-net-sales"]?.paisa;
  const x = t["figure-tile-tax"]?.paisa;
  const s = t["figure-tile-service-charge"]?.paisa;
  const b = t["figure-tile-total-billed"]?.paisa;
  if ([g, d, n, x, s, b].some((v) => v == null)) {
    check(false, `${tag}: a required tile did not render a money figure ` +
      JSON.stringify({ g, d, n, x, s, b }));
    return null;
  }
  check(n <= g, `${tag}: net (${money(n)}) <= gross (${money(g)})`);
  check(n === g - d, `${tag}: net == gross - discounts (${money(g)} - ${money(d)} = ${money(g - d)}, tile says ${money(n)})`);
  check(n !== g - d + x || x === 0, `${tag}: tax is NOT inside net`);
  check(b === n + x + s, `${tag}: total billed == net + tax + service (${money(n + x + s)} vs ${money(b)})`);
  check(/net/i.test(t["figure-tile-net-sales"].label), `${tag}: the net tile is labelled "${t["figure-tile-net-sales"].label}"`);
  return { g, d, n, x, s, b };
}

(async () => {
  const browser = await newBrowser();
  const page = await newPage(browser);
  await login(page, PEOPLE.owner);
  const bearer = await tokenOf(page);
  if (!bearer) throw new Error("no bearer");

  // ── 1. sweep every trading day in the last 30 via the API, so I pick days the AUTHOR did not
  console.log("\n[1] sweeping 30 days for trading days with BOTH a discount and tax");
  const days = [];
  for (let back = 0; back < 30; back++) {
    const d = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
    const r = await apiGet(page, `/api/v1/pos/takings/daily?date=${d}`, bearer);
    if (r.status !== 200) { note(`  ${d}: HTTP ${r.status}`); continue; }
    const t = r.body?.data ?? r.body;
    if (!t) continue;
    if ((t.grossSalesPaisa ?? 0) > 0) {
      days.push({ d, t });
      console.log(`    ${d}  gross=${money(t.grossSalesPaisa)} disc=${money(t.discountsPaisa)} net=${money(t.netSalesPaisa)} tax=${money(t.taxPaisa)} svc=${money(t.serviceChargePaisa)} billed=${money(t.totalBilledPaisa ?? -1)}`);
    }
  }
  check(days.length > 0, `found ${days.length} trading day(s) in the last 30`);

  // Server-side invariant on EVERY trading day, not just the chosen one.
  console.log("\n[2] server invariants on every trading day found");
  for (const { d, t } of days) {
    check(t.totalBilledPaisa !== undefined && t.totalBilledPaisa !== null,
      `${d}: server states totalBilledPaisa`);
    check(t.netSalesPaisa <= t.grossSalesPaisa, `${d}: net <= gross`);
    check(t.netSalesPaisa === t.grossSalesPaisa - t.discountsPaisa, `${d}: net == gross - discounts`);
    check(t.totalBilledPaisa === t.netSalesPaisa + t.taxPaisa + t.serviceChargePaisa,
      `${d}: billed == net + tax + service`);
  }

  const rich = days.find((x) => x.t.discountsPaisa > 0 && x.t.taxPaisa > 0)
            ?? days.find((x) => x.t.taxPaisa > 0)
            ?? days[0];
  if (!rich) { console.log("NO TRADING DAY — cannot score"); process.exit(2); }
  const DATE = rich.d;
  console.log(`\n  chosen day: ${DATE} (discounts ${money(rich.t.discountsPaisa)}, tax ${money(rich.t.taxPaisa)})`);
  if (rich.t.discountsPaisa === 0) note(`chosen day has NO discount — gross and net collapse; weaker evidence`);
  if (rich.t.taxPaisa === 0) note(`chosen day has NO tax — the whole defect shape is unobservable`);

  // ── 3. drive the screen
  console.log(`\n[3] OWNER drives /app/finance/takings?date=${DATE} in a real browser`);
  await page.goto(`${BASE}/app/finance/takings?date=${DATE}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  let tiles = await readTiles(page);
  check(!tiles.__bodyHasError, "no error/access-denied text on the page");
  check(tiles.__alerts.length === 0, `no [role=alert] (${JSON.stringify(tiles.__alerts)})`);
  await page.screenshot({ path: `${OUT}/01-owner-takings.png` });
  const first = assertTiles(tiles, "first load");
  console.log(`  identity line: ${JSON.stringify(tiles.__identity)}`);
  check(!!tiles.__identity && /net sales/i.test(tiles.__identity), "identity sentence is printed");
  for (const id of IDS) {
    if (tiles[id]) console.log(`    ${tiles[id].label.padEnd(16)} ${String(tiles[id].amountText).padStart(14)}  — ${tiles[id].caption.slice(0, 110)}`);
  }

  // ── 4. reload: persistence
  console.log("\n[4] RELOAD — does it persist?");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  const tiles2 = await readTiles(page);
  const second = assertTiles(tiles2, "after reload");
  if (first && second) {
    check(JSON.stringify(first) === JSON.stringify(second),
      `figures identical across reload (${JSON.stringify(first)} vs ${JSON.stringify(second)})`);
  }
  await page.screenshot({ path: `${OUT}/02-owner-after-reload.png` });

  // ── 5. screen vs server, paisa for paisa
  console.log("\n[5] rendered figures vs the raw server body");
  const api = (await apiGet(page, `/api/v1/pos/takings/daily?date=${DATE}`, bearer)).body?.data;
  if (first && api) {
    check(first.g === api.grossSalesPaisa, `gross: screen ${first.g} == server ${api.grossSalesPaisa}`);
    check(first.n === api.netSalesPaisa, `net: screen ${first.n} == server ${api.netSalesPaisa}`);
    check(first.x === api.taxPaisa, `tax: screen ${first.x} == server ${api.taxPaisa}`);
    check(first.b === api.totalBilledPaisa, `billed: screen ${first.b} == server ${api.totalBilledPaisa}`);
  }

  // ── 6. reconciliation against the tender split (the caption's own claim)
  console.log("\n[6] does total billed actually reconcile against what came in?");
  if (api) {
    const tender = (api.byTender ?? []).reduce((s, l) => s + l.amountPaisa, 0);
    const unclosed = api.unclosed?.totalPaisa ?? 0;
    console.log(`    tender total ${money(tender)}, unclosed ${money(unclosed)}, closed-basis billed ${money(api.totalBilledPaisa)}`);
    note(`tender(${money(tender)}) − unclosed(${money(unclosed)}) = ${money(tender - unclosed)} vs billed ${money(api.totalBilledPaisa)}`);
  }

  // ── 7. branch-scoped read
  console.log("\n[7] branch-scoped read (?branchId=) — same invariants?");
  const branches = await apiGet(page, `/api/v1/user/branches?size=50`, bearer);
  const bl = branches.body?.data?.content ?? branches.body?.data?.data ?? branches.body?.data ?? [];
  const ids = (Array.isArray(bl) ? bl : []).map((b) => b.id).filter(Boolean);
  console.log(`    ${ids.length} branch id(s)`);
  for (const bid of ids) {
    const r = await apiGet(page, `/api/v1/pos/takings/daily?date=${DATE}&branchId=${bid}`, bearer);
    if (r.status !== 200) { note(`branch ${bid}: HTTP ${r.status}`); continue; }
    const t = r.body?.data;
    check(t.netSalesPaisa <= t.grossSalesPaisa, `branch ${bid.slice(0, 8)}: net <= gross`);
    check(t.netSalesPaisa === t.grossSalesPaisa - t.discountsPaisa, `branch ${bid.slice(0, 8)}: net == gross - disc`);
    check(t.totalBilledPaisa === t.netSalesPaisa + t.taxPaisa + t.serviceChargePaisa,
      `branch ${bid.slice(0, 8)}: billed == net + tax + svc`);
  }

  // ── 8. adjacent screen: the OWNER DASHBOARD "Net sales" tile
  console.log("\n[8] ADJACENT: owner dashboard 'Net sales' tile");
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const dash = await page.evaluate(() => {
    const out = { tiles: [], body: (document.body.innerText || "").slice(0, 400) };
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const txt = (el.innerText || "");
      if (/^Net sales/i.test(txt.trim()) && txt.length < 260 && el.children.length < 12) {
        out.tiles.push(txt.replace(/\n/g, " | "));
      }
    }
    out.tiles = Array.from(new Set(out.tiles)).slice(0, 4);
    return out;
  });
  console.log(`    dashboard net-sales tiles: ${JSON.stringify(dash.tiles, null, 1)}`);
  await page.screenshot({ path: `${OUT}/03-owner-dashboard.png` });

  writeFileSync(`${OUT}/owner.json`, JSON.stringify({ DATE, days: days.map((x) => x.d), first, second, api, dash, problems, notes }, null, 2));

  await page.context().close();

  // ── 9. other personas
  for (const [name, who] of [["manager", PEOPLE.manager], ["accountant", PEOPLE.accountant], ["cashier", PEOPLE.cashier]]) {
    console.log(`\n[9] persona: ${name}`);
    const p = await newPage(browser);
    try {
      await login(p, who);
      await p.goto(`${BASE}/app/finance/takings?date=${DATE}`, { waitUntil: "domcontentloaded" });
      await p.waitForTimeout(5000);
      const t = await readTiles(p);
      const denied = await p.evaluate(() => /Access denied|do not have permission|not authorised|not authorized/i.test(document.body.innerText || ""));
      const tok = await tokenOf(p);
      const r = tok ? await apiGet(p, `/api/v1/pos/takings/daily?date=${DATE}`, tok) : { status: "no-token" };
      console.log(`    API status ${r.status}; screen denied=${denied}; net tile=${t["figure-tile-net-sales"]?.amountText ?? "—"}`);
      await p.screenshot({ path: `${OUT}/09-${name}.png` });
      if (r.status === 200 && !denied && t["figure-tile-net-sales"]?.paisa != null) {
        assertTiles(t, `${name}`);
      }
      writeFileSync(`${OUT}/persona-${name}.json`, JSON.stringify({ apiStatus: r.status, denied, tiles: t }, null, 2));
    } catch (e) {
      console.log(`    ! ${name}: ${e.message}`);
      notes.push(`${name}: ${e.message}`);
    }
    await p.context().close();
  }

  await browser.close();
  console.log(`\n==== ${problems.length === 0 ? "ALL CHECKS PASSED" : problems.length + " FAILURES"} ====`);
  for (const p of problems) console.log(`  FAIL ${p}`);
  writeFileSync(`${OUT}/summary.json`, JSON.stringify({ problems, notes }, null, 2));
})().catch((e) => { console.error("HARNESS ERROR", e); process.exit(1); });
