// ATTACK 9: the other agent said the PO detail page "works ONLY by pasting a UUID".
// The invoices list renders a PO column. If that column links, there is a DESKTOP click path.
import { chromium, newCtx, login, probe, shot, assertSession, BASE } from "./lib.mjs";

const persona = process.argv[2] ?? "manager";

async function main() {
  const browser = await chromium.launch();
  const { page } = await newCtx(browser, { width: 1440, height: 950 });
  if (!(await login(page, persona))) { console.log("LOGIN FAILED"); process.exit(1); }

  // ── VENDORS (never reported on by the other agent) ───────────────────────
  const v = await probe(page, "/app/purchasing/vendors");
  await assertSession(page, "vendors");
  const vd = await page.evaluate(() => {
    const t = document.querySelector("table");
    return {
      headers: t ? [...t.querySelectorAll("th")].map((x) => x.innerText.trim()) : [],
      rows: t ? t.querySelectorAll("tbody tr").length : 0,
      firstRow: t?.querySelector("tbody tr")?.innerText.replace(/\n/g, " | "),
      buttons: [...document.querySelectorAll("button")].map((b) => b.innerText.trim()).filter((x) => x && !/Collapse|Search|Floating|^F$/.test(x)).slice(0, 12),
      rowClickable: (() => { const r = t?.querySelector("tbody tr"); return r ? { onclick: !!r.onclick, cursor: getComputedStyle(r).cursor, links: r.querySelectorAll("a").length } : null; })(),
    };
  });
  console.log("\n=== /app/purchasing/vendors ===");
  console.log("  h:", v.h1.join(" | "), "| flag:", v.is404 ? "404" : v.denied ? "DENIED" : "ok");
  console.log("  cols:", JSON.stringify(vd.headers), `(${vd.rows} rows)`);
  console.log("  row1:", vd.firstRow);
  console.log("  buttons:", JSON.stringify(vd.buttons));
  console.log("  row clickable:", JSON.stringify(vd.rowClickable));
  await shot(page, "vendors-desktop");

  // ── INVOICES: does the PO column link to PO detail on DESKTOP? ───────────
  const i = await probe(page, "/app/purchasing/invoices");
  await assertSession(page, "invoices");
  const id = await page.evaluate(() => {
    const t = document.querySelector("table");
    const poLinks = [...document.querySelectorAll('a[href*="/purchase-orders/"]')]
      .map((a) => ({ href: a.getAttribute("href"), text: a.innerText.trim(), visible: !!(a.offsetParent || a.getClientRects().length) }));
    const invLinks = [...document.querySelectorAll('a[href*="/invoices/"]')]
      .map((a) => ({ href: a.getAttribute("href"), text: a.innerText.trim(), visible: !!(a.offsetParent || a.getClientRects().length) }));
    return { headers: t ? [...t.querySelectorAll("th")].map((x) => x.innerText.trim()) : [], rows: t ? t.querySelectorAll("tbody tr").length : 0,
      poLinks: poLinks.slice(0, 4), poLinkCount: poLinks.length, visiblePoLinks: poLinks.filter((l) => l.visible).length,
      invLinks: invLinks.slice(0, 3), row1: t?.querySelector("tbody tr")?.innerText.replace(/\n/g, " | ") };
  });
  console.log("\n=== /app/purchasing/invoices (DESKTOP) ===");
  console.log("  cols:", JSON.stringify(id.headers), `(${id.rows} rows)`);
  console.log("  row1:", id.row1);
  console.log("  PO links:", id.poLinkCount, "visible:", id.visiblePoLinks, JSON.stringify(id.poLinks));
  console.log("  invoice links:", JSON.stringify(id.invLinks));
  await shot(page, "invoices-desktop");

  if (id.visiblePoLinks > 0) {
    console.log("\n>>> CLICKING a PO link from the invoices list on DESKTOP");
    await page.locator('a[href*="/purchase-orders/"]').first().click();
    await page.waitForTimeout(5000);
    await assertSession(page, "po-from-invoice");
    const btns = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.innerText.trim()).filter((x) => x && !/Collapse|Search|Floating|^F$/.test(x)));
    console.log("  url:", page.url());
    console.log("  reached PO detail:", /purchase-orders\/[0-9a-f-]{36}/.test(page.url()));
    console.log("  buttons:", JSON.stringify(btns));
    console.log("  head:", (await page.locator("body").innerText()).split("Analytics")[1]?.slice(0, 200).replace(/\n+/g, " | "));
    await shot(page, "po-detail-from-invoice-desktop");
  }

  await browser.close();
}
main();
