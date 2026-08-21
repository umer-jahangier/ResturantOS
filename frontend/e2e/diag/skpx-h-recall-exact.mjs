/*
 * PROBE H — RECALL on its one legal path.
 *
 * recallLast() needs `lastBumped`, which ONLY an F press that produced >=1 item move sets.
 * The server only allows a recall from a fully-READY ticket. So the single sequence that can
 * ever work is: get every item to PREPARING (by click), then press F once (PREPARING -> READY,
 * which both makes it fully READY and sets lastBumped), then press R inside 60s.
 * Anything else is a silent no-op, which is what the previous run hit.
 */
import { launch, newPage, login, probe, shot, BRANCH, GW } from "./skpx-lib.mjs";

async function tickets(page, token) {
  return page.evaluate(async ([gw, br, tok]) => {
    const res = await fetch(`${gw}/api/v1/kitchen/kds/tickets?branchId=${br}&size=200&page=0`, { headers: { Authorization: `Bearer ${tok}` } });
    const j = await res.json();
    const rows = Array.isArray(j) ? j : (j.content ?? j.data ?? []);
    return rows.map((t) => ({ id: t.id, ord: t.orderNo, st: t.status, items: (t.items || []).map((i) => ({ id: i.id, name: i.menuItemName ?? i.name, st: i.status })) }));
  }, [GW, BRANCH, token]);
}
const moveBtns = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid^="column-move-"]')]
  .map((b) => ({ itemId: b.getAttribute("data-testid").replace("column-move-", ""), label: b.innerText.trim().replace(/\s+/g, " ") })));

async function findFragment(page, ticketId) {
  for (let i = 0; i < 6; i++) { await page.keyboard.press("PageUp"); await page.waitForTimeout(300); }
  for (let g = 0; g < 6; g++) {
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
    }, ticketId);
    if (r) return r;
    await page.keyboard.press("PageDown"); await page.waitForTimeout(1300);
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

  const all = await tickets(page, TOKEN);
  const t = all.find((x) => x.items.length === 1 && ["PENDING", "ACCEPTED", "PREPARING"].includes(x.items[0].st));
  console.log(`\n  target ${t?.ord} item=${t?.items[0].name}=${t?.items[0].st}`);
  const itemId = t.items[0].id;

  // click forward until the item is PREPARING (NOT ready)
  for (let i = 0; i < 4; i++) {
    const cur = (await tickets(page, TOKEN)).find((x) => x.id === t.id);
    if (cur.items[0].st === "PREPARING") break;
    await findFragment(page, t.id);
    const btns = await moveBtns(page);
    const b = btns.find((x) => x.itemId === itemId);
    if (!b) { console.log("  no move button visible"); break; }
    console.log(`  click "${b.label}"`);
    await page.locator(`[data-testid="column-move-${itemId}"]`).first().click();
    await page.waitForTimeout(4200);
  }
  const atPrep = (await tickets(page, TOKEN)).find((x) => x.id === t.id);
  console.log(`  now: ticket=${atPrep.st} item=${atPrep.items[0].st}`);
  await shot(page, "skpx-h1-at-preparing");

  // F once: PREPARING -> READY, sets lastBumped
  const loc = await findFragment(page, t.id);
  console.log(`\n  fragment before F: ${JSON.stringify(loc)}`);
  if (!loc?.pos) {
    console.log("  !! no position number — F cannot be aimed here by keyboard (this is itself the finding)");
    await browser.close(); return;
  }
  await page.locator("body").click({ position: { x: 3, y: 3 } }).catch(() => { });
  await page.keyboard.press(loc.pos); await page.waitForTimeout(700);
  await page.keyboard.press("f"); await page.waitForTimeout(5000);
  const afterF = (await tickets(page, TOKEN)).find((x) => x.id === t.id);
  console.log(`  after F: ticket=${afterF?.st} item=${afterF?.items[0]?.st}`);
  await shot(page, "skpx-h2-after-f-to-ready");

  // R inside the 60s window
  console.log(`\n=== R (recall) immediately after ===`);
  await page.keyboard.press("r"); await page.waitForTimeout(5500);
  const afterR = (await tickets(page, TOKEN)).find((x) => x.id === t.id);
  const err = await page.evaluate(() => document.querySelector('[data-testid="kds-bump-error"]')?.innerText.trim() ?? null);
  console.log(`  after R: ticket=${afterR?.st} item=${afterR?.items[0]?.st}`);
  console.log(`  on-screen error: ${JSON.stringify(err)}`);
  console.log(`  >>> RECALL SUCCEEDED: ${afterR?.st !== "READY"}`);
  await shot(page, "skpx-h3-after-recall");

  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
