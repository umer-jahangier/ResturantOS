// ATTACK 1: "the PO detail page is unreachable — dropEmptyColumns deletes the only link".
// The list ALSO passes a `card` renderer to DataGrid, and DataGrid renders cards below `md`
// WITHOUT passing them through dropEmptyColumns. So the link may survive on a phone.
import { chromium, newCtx, login, probe, shot, assertSession, BASE } from "./lib.mjs";

const persona = process.argv[2] ?? "manager";

async function inspectList(page, label) {
  const r = await probe(page, "/app/purchasing/purchase-orders");
  await assertSession(page, `po-list ${label}`);
  const dom = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href*="/purchasing/purchase-orders/"]')].map((a) => ({
      href: a.getAttribute("href"), text: a.innerText.trim(),
      visible: !!(a.offsetParent || a.getClientRects().length),
    }));
    const table = document.querySelector("table");
    const headers = table ? [...table.querySelectorAll("th")].map((t) => t.innerText.trim()) : [];
    const cards = document.querySelector('[data-testid="data-grid-cards"]');
    const rowCount = table ? table.querySelectorAll("tbody tr").length : 0;
    return {
      headers, rowCount,
      tableVisible: table ? !!(table.offsetParent || table.getClientRects().length) : false,
      cardsPresent: !!cards,
      cardsVisible: cards ? !!(cards.offsetParent || cards.getClientRects().length) : false,
      cardCount: cards ? cards.querySelectorAll("li").length : 0,
      detailLinks: links,
    };
  });
  console.log(`\n--- PO LIST @ ${label} (${persona}) ---`);
  console.log("  h:", r.h1.join(" | "), "| 404:", r.is404, "| denied:", r.denied);
  console.log("  headers:", JSON.stringify(dom.headers));
  console.log("  table rows:", dom.rowCount, "tableVisible:", dom.tableVisible);
  console.log("  cards present:", dom.cardsPresent, "visible:", dom.cardsVisible, "count:", dom.cardCount);
  console.log("  detail links:", dom.detailLinks.length, JSON.stringify(dom.detailLinks.slice(0, 3)));
  await shot(page, `po-list-${persona}-${label}`);
  return dom;
}

async function main() {
  const browser = await chromium.launch();

  // ── Desktop ──────────────────────────────────────────────────────────────
  const d = await newCtx(browser, { width: 1440, height: 900 });
  if (!(await login(d.page, persona))) { console.log("LOGIN FAILED"); process.exit(1); }
  const desk = await inspectList(d.page, "desktop-1440");

  // ── Phone: 390x844, the viewport a manager actually approves from ────────
  const m = await newCtx(browser, { width: 390, height: 844 });
  if (!(await login(m.page, persona))) { console.log("LOGIN FAILED (mobile)"); process.exit(1); }
  const mob = await inspectList(m.page, "mobile-390");

  // ── Can a user CLICK through on the phone? ───────────────────────────────
  if (mob.detailLinks.some((l) => l.visible)) {
    console.log("\n>>> CLICKING the first visible card link on the phone");
    const before = m.page.url();
    await m.page.locator('a[href*="/purchasing/purchase-orders/"]').first().click();
    await m.page.waitForTimeout(5000);
    await assertSession(m.page, "po-detail-after-click");
    const after = m.page.url();
    const body = await m.page.locator("body").innerText();
    const btns = await m.page.evaluate(() =>
      [...document.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean));
    console.log("  nav:", before, "->", after);
    console.log("  reached detail:", /purchase-orders\/[0-9a-f-]{36}/.test(after));
    console.log("  buttons:", JSON.stringify(btns));
    console.log("  body head:", body.slice(0, 700).replace(/\n+/g, " | "));
    await shot(m.page, `po-detail-via-card-${persona}`);
  } else {
    console.log("\n>>> no visible detail link on the phone either");
  }

  await browser.close();
}
main();
