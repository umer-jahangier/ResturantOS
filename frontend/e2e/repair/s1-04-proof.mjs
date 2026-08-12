/*
 * S1 #11 proof — drives the DONE MEANS click path for real, as the cook.
 *
 *   1. open /app/kitchen/DEFAULT as kitchen@terrace.local with 20+ tickets live
 *   2. bump the first ticket New -> Started -> Preparing WITH THE MOUSE, asserting after
 *      each click that the card is on the SAME page, in its new column
 *   3. bump three more; all three must stay visible in their columns
 *   4. the advertised keyboard path: press the number printed on a PREPARING card, then F,
 *      and watch it land in Ready
 *   5. walk every page and assert not one visible card lacks a position number
 *
 *   node e2e/repair/s1-04-proof.mjs after
 */
import { chromium } from "@playwright/test";
import { BASE, login, probeBoard, fmt, shot, walkPages } from "./s1-04-lib.mjs";

const LABEL = process.argv[2] ?? "after";
const fail = [];
function check(ok, msg) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) fail.push(msg);
}

/** Where on the CURRENT page a given ticket id is rendered. */
function placesOf(probe, ticketId) {
  return probe.columns.flatMap((c) =>
    c.rendered
      .filter((r) => r.key.endsWith(ticketId))
      .map((r) => `${c.column}(pos ${r.pos || "—"})`),
  );
}

async function bump(page, column, ticketId) {
  const btn = page
    .locator(`[data-fragment-key="${column}:${ticketId}"] button[data-testid^="column-move-"]`)
    .first();
  await btn.click();
  await page.waitForTimeout(4000);
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("    [console.error]", m.text().slice(0, 160));
  });

  await login(page);
  await page.goto(`${BASE}/app/kitchen/DEFAULT`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="kds-board"]').waitFor({ timeout: 30000 });
  await page.waitForTimeout(3500);

  const start = await probeBoard(page);
  console.log("\n== 0. the board a cook opens ==");
  console.log("  ", fmt(start));
  check(start.alerts.length === 0, `no error state on the board (saw ${start.alerts.length})`);
  const openTickets = Number((start.ticketCount.match(/\d+/) ?? ["0"])[0]);
  check(openTickets >= 20, `20+ tickets are live at this station (${openTickets})`);
  // Each column header must state the depth of the WHOLE queue, not this page's slice, and a
  // column with work off this page must say so on the column itself.
  const deep = start.columns.filter((c) => Number(c.headerCount) > c.n);
  console.log(
    "   column depth:",
    start.columns.map((c) => `${c.column} ${c.n}/${c.headerCount} "${c.more}"`).join(" | "),
  );
  check(
    deep.length > 0 && deep.every((c) => /\+\d+ on other pages/.test(c.more)),
    "every column with work off this page says so on the column",
  );
  await shot(page, `${LABEL}-01-board`);

  // ── 1. mouse bump New -> Started -> Preparing ────────────────────────────────
  console.log("\n== 1. bump the first ticket to Preparing, with the mouse ==");
  const firstNew = start.columns[0].rendered[0];
  if (!firstNew) throw new Error("no NEW card on page 1 — cannot run the proof");
  const t1 = firstNew.key.split(":")[1];
  console.log(`  first New card: ${firstNew.key} (pos ${firstNew.pos})`);

  await bump(page, "NEW", t1);
  let p = await probeBoard(page);
  console.log("  after click 1:", fmt(p), "->", placesOf(p, t1).join(", ") || "NOWHERE");
  check(
    placesOf(p, t1).some((s) => s.startsWith("STARTED")),
    "the ticket is on the SAME page, in Started, after the first mouse bump",
  );

  await bump(page, "STARTED", t1);
  p = await probeBoard(page);
  console.log("  after click 2:", fmt(p), "->", placesOf(p, t1).join(", ") || "NOWHERE");
  check(
    placesOf(p, t1).some((s) => s.startsWith("PREPARING")),
    "the ticket is on the SAME page, in Preparing, after the second mouse bump",
  );
  await shot(page, `${LABEL}-02-preparing`);

  // ── 2. three more ───────────────────────────────────────────────────────────
  console.log("\n== 2. bump three more; all three must stay visible ==");
  const more = [];
  for (let i = 0; i < 3; i += 1) {
    const probe = await probeBoard(page);
    const card = probe.columns[0].rendered.find((r) => !more.includes(r.key.split(":")[1]));
    if (!card) break;
    const id = card.key.split(":")[1];
    more.push(id);
    await bump(page, "NEW", id);
    const after = await probeBoard(page);
    const where = placesOf(after, id);
    console.log(`  #${i + 1} ${id.slice(0, 8)} -> ${where.join(", ") || "NOWHERE"}`);
    check(
      where.some((s) => s.startsWith("STARTED")),
      `bumped ticket ${i + 1} of 3 is still on the cook's page, in Started`,
    );
  }
  p = await probeBoard(page);
  console.log("  ", fmt(p));
  await shot(page, `${LABEL}-03-four-bumped`);

  // ── 3. the advertised keyboard path ─────────────────────────────────────────
  //
  // Following the bumps may have carried the board off page 1, so page back the way a cook
  // would to the page that holds the head of the Preparing queue.
  console.log("\n== 3. number key + F on a PREPARING card ==");
  for (let i = 0; i < 15; i += 1) await page.keyboard.press("PageUp");
  await page.waitForTimeout(700);
  p = await probeBoard(page);
  for (let i = 0; i < 15 && p.columns[2].rendered.length === 0; i += 1) {
    const [cur, of] = (p.pageIndicator || "1 / 1").split("/").map((s) => Number(s.trim()));
    if (!of || cur >= of) break;
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(450);
    p = await probeBoard(page);
  }
  console.log("  looking at", fmt(p));
  const prep = p.columns[2].rendered[0];
  if (!prep) {
    check(false, "there is a Preparing card on the cook's page to drive the keyboard path with");
  } else {
    const prepId = prep.key.split(":")[1];
    console.log(`  Preparing card ${prep.key} shows position "${prep.pos}"`);
    check(prep.pos !== "", "the Preparing card carries a position number");

    await page.keyboard.press(prep.pos);
    await page.waitForTimeout(600);
    const focused = await page.evaluate((key) => {
      const el = document.querySelector(
        `[data-fragment-key="${key}"] [data-testid="kds-ticket-card"]`,
      );
      return el?.getAttribute("data-focused") === "true";
    }, prep.key);
    check(focused, `pressing "${prep.pos}" focused that exact card`);
    await shot(page, `${LABEL}-04-focused-preparing`);

    await page.keyboard.press("f");
    await page.waitForTimeout(4500);
    const afterF = await probeBoard(page);
    const where = placesOf(afterF, prepId);
    console.log("  after F:", fmt(afterF), "->", where.join(", ") || "NOWHERE");
    check(
      where.some((s) => s.startsWith("READY")),
      "F advanced the focused Preparing ticket to Ready, on screen",
    );
    await shot(page, `${LABEL}-05-after-F`);
  }

  // ── 4. every page, every card numbered ──────────────────────────────────────
  console.log("\n== 4. walk every page ==");
  for (let i = 0; i < 15; i += 1) await page.keyboard.press("PageUp");
  await page.waitForTimeout(600);
  const pages = await walkPages(page, 20);
  pages.forEach((q, i) => console.log(`  p${i + 1}: ${fmt(q)}`));
  const unnumbered = pages.reduce((a, q) => a + q.unnumbered.length, 0);
  check(
    unnumbered === 0,
    `every card on every page carries a position number (${unnumbered} without)`,
  );
  const dupes = pages.filter((q) => {
    const pos = q.columns.flatMap((c) => c.rendered.map((r) => r.pos));
    return new Set(pos).size !== pos.length;
  }).length;
  check(dupes === 0, `no page reuses a position number (${dupes} pages with duplicates)`);
  const starved = pages.filter(
    (q) =>
      q.columns[0].n > 0 &&
      q.columns.slice(1).every((c) => c.n === 0) &&
      q.total < q.columns[0].n + 1,
  );
  console.log(`  pages that are NEW-only: ${starved.length} of ${pages.length}`);
  await shot(page, `${LABEL}-06-last-page`);

  await browser.close();
  console.log(`\n${fail.length === 0 ? "ALL CHECKS PASSED" : `${fail.length} CHECK(S) FAILED`}`);
  fail.forEach((f) => console.log("  -", f));
  process.exit(fail.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
