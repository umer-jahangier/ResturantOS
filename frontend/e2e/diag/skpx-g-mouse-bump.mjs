/*
 * PROBE G — the MOUSE path. The keyboard path cannot advance a ticket past "Started"
 * (started fragments land on a later page and get no position number there), so before
 * condemning bump this checks the per-item click affordance `column-move-{itemId}`,
 * which is what a cook with a touchscreen would actually use. Drives one ticket
 * NEW -> Started -> Preparing -> Ready, then tests RECALL from a genuinely READY ticket.
 */
import { launch, newPage, login, probe, shot, BRANCH, GW } from "./skpx-lib.mjs";

async function allTickets(page, token) {
  return page.evaluate(async ([gw, br, tok]) => {
    const res = await fetch(`${gw}/api/v1/kitchen/kds/tickets?branchId=${br}&size=200&page=0`, { headers: { Authorization: `Bearer ${tok}` } });
    const j = await res.json();
    const rows = Array.isArray(j) ? j : (j.content ?? j.data ?? []);
    return rows.map((t) => ({ id: t.id, ord: t.orderNo, st: t.status, items: (t.items || []).map((i) => ({ id: i.id, name: i.menuItemName ?? i.name, st: i.status })) }));
  }, [GW, BRANCH, token]);
}

async function moveButtons(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-testid^="column-move-"]')].map((b) => ({
    itemId: b.getAttribute("data-testid").replace("column-move-", ""),
    label: (b.innerText || b.getAttribute("aria-label") || "").trim().replace(/\s+/g, " "),
    visible: b.getBoundingClientRect().width > 0,
  })));
}

async function gotoPageWith(page, itemId, maxPages = 6) {
  for (let i = 0; i < 6; i++) { await page.keyboard.press("PageUp"); await page.waitForTimeout(350); }
  for (let g = 0; g < maxPages; g++) {
    const btns = await moveButtons(page);
    if (btns.some((b) => b.itemId === itemId)) {
      const ind = await page.evaluate(() => document.querySelector('[data-testid="kds-page-indicator"]')?.innerText.trim() ?? "1 / 1");
      return ind;
    }
    await page.keyboard.press("PageDown"); await page.waitForTimeout(1400);
  }
  return null;
}

async function main() {
  const browser = await launch();
  const { page } = await newPage(browser);
  let TOKEN = null;
  page.on("request", (r) => { const a = r.headers()["authorization"]; if (a?.startsWith("Bearer ") && !TOKEN) TOKEN = a.slice(7); });
  if (!(await login(page, "kitchen"))) process.exit(1);
  await probe(page, "/app/kitchen/DEFAULT", { who: "kitchen", wait: 7000 });

  const api0 = await allTickets(page, TOKEN);
  // a ticket already ACCEPTED (started) with exactly one item is the cleanest to drive
  const target = api0.find((t) => t.items.length === 1 && t.items[0].st === "ACCEPTED")
    ?? api0.find((t) => t.items.length === 1 && t.items[0].st === "PENDING");
  console.log(`\n  target: ${target?.ord} status=${target?.st} item=${target?.items[0].name}=${target?.items[0].st} itemId=${target?.items[0].id}`);
  if (!target) { console.log("  no suitable ticket"); await browser.close(); return; }

  const itemId = target.items[0].id;
  for (let step = 1; step <= 5; step++) {
    const onPage = await gotoPageWith(page, itemId);
    if (!onPage) { console.log(`  step ${step}: no move button for this item on any page — it is at the end of the ladder or off the board`); break; }
    const btns = await moveButtons(page);
    const b = btns.find((x) => x.itemId === itemId);
    console.log(`  step ${step}: page ${onPage}, button "${b.label}" visible=${b.visible}`);
    await page.locator(`[data-testid="column-move-${itemId}"]`).first().click();
    await page.waitForTimeout(4500);
    const now = (await allTickets(page, TOKEN)).find((t) => t.id === target.id);
    console.log(`     -> API: ticket=${now?.st} item=${now?.items[0]?.st}`);
    await shot(page, `skpx-g-step${step}`);
    if (!now || now.items[0]?.st === "READY") { console.log("     -> reached READY"); break; }
  }

  const ready = (await allTickets(page, TOKEN)).find((t) => t.id === target.id);
  console.log(`\n  final state of ${target.ord}: ${JSON.stringify(ready)}`);

  // RECALL — the click path has no recall button, so this is the keyboard R, which
  // requires `lastBumped` to have been set by an F press in this session.
  console.log(`\n=== recall after a click-driven bump (R relies on lastBumped, which only F sets) ===`);
  await page.locator("body").click({ position: { x: 3, y: 3 } }).catch(() => { });
  await page.keyboard.press("r");
  await page.waitForTimeout(4000);
  console.log("  on-screen:", JSON.stringify(await page.evaluate(() => document.querySelector('[data-testid="kds-bump-error"]')?.innerText.trim() ?? null)));

  // Now do it properly: F-bump a READY ticket's fragment then R.
  if (ready && ready.items[0]?.st === "READY") {
    console.log(`\n=== F then R on the READY ticket ===`);
    for (let i = 0; i < 6; i++) { await page.keyboard.press("PageUp"); await page.waitForTimeout(350); }
    let loc = null;
    for (let g = 0; g < 6 && !loc; g++) {
      const r = await page.evaluate((tid) => {
        const cols = [...document.querySelectorAll('[data-testid^="kds-column-"]')].filter((n) => /^kds-column-[A-Z_]+$/.test(n.getAttribute("data-testid")));
        for (const c of cols) {
          const key = c.getAttribute("data-testid").replace("kds-column-", "");
          for (const f of c.querySelectorAll('[data-testid^="kds-fragment-"]')) {
            if (f.getAttribute("data-testid") === `kds-fragment-${key}-${tid}`) {
              return { col: key, pos: (f.innerText.replace(/\s+/g, " ").match(/^(\d)\s/) ?? [, ""])[1], page: document.querySelector('[data-testid="kds-page-indicator"]')?.innerText.trim() };
            }
          }
        }
        return null;
      }, target.id);
      if (r) { loc = r; break; }
      await page.keyboard.press("PageDown"); await page.waitForTimeout(1300);
    }
    console.log(`  READY ticket rendered at: ${JSON.stringify(loc)}`);
    if (loc?.pos) {
      await page.keyboard.press(loc.pos); await page.waitForTimeout(600);
      await page.keyboard.press("f"); await page.waitForTimeout(4000);
      console.log(`  after F on a READY fragment: ${JSON.stringify((await allTickets(page, TOKEN)).find((t) => t.id === target.id))}`);
      await page.keyboard.press("r"); await page.waitForTimeout(4500);
      const rec = (await allTickets(page, TOKEN)).find((t) => t.id === target.id);
      console.log(`  after R: ${JSON.stringify(rec)}`);
      console.log(`  on-screen: ${JSON.stringify(await page.evaluate(() => document.querySelector('[data-testid="kds-bump-error"]')?.innerText.trim() ?? null))}`);
      await shot(page, "skpx-g-recall-from-ready");
    } else {
      console.log("  !! the READY fragment has no position number, so F cannot be aimed at it by keyboard");
    }
  }

  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
