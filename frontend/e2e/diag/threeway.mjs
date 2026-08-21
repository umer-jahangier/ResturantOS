// ATTACK 11: "the three-way match declares invoices payable while matching them against a blank
// PO and a zero GRN". Is that the ENGINE, or stale seed rows with no receipt? Read several
// invoices, including ones whose PO I have just genuinely received against.
import { chromium, newCtx, login, probe, shot, assertSession, BASE } from "./lib.mjs";

const persona = process.argv[2] ?? "manager";

async function main() {
  const browser = await chromium.launch();
  const { page } = await newCtx(browser, { width: 1440, height: 950 });
  if (!(await login(page, persona))) { console.log("LOGIN FAILED"); process.exit(1); }

  await probe(page, "/app/purchasing/invoices");
  await assertSession(page, "invoices");
  const list = await page.evaluate(() => [...document.querySelectorAll("table tbody tr")].map((r) => {
    const c = [...r.querySelectorAll("td")].map((x) => x.innerText.trim());
    const a = r.querySelector('a[href*="/invoices/"]');
    return { cells: c, href: a?.getAttribute("href") };
  }));
  console.log(`\n=== ${list.length} invoices ===`);
  const byStatus = {};
  for (const r of list) { const s = r.cells[5] || "?"; (byStatus[s] ||= []).push(r); }
  console.log("  statuses:", Object.fromEntries(Object.entries(byStatus).map(([k, v]) => [k, v.length])));

  // one of each status, plus the invoice on the PO I partially received
  const picks = Object.values(byStatus).map((v) => v[0]);
  for (const p of picks) {
    if (!p.href) continue;
    await page.goto(`${BASE}${p.href}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    await assertSession(page, p.href);
    const d = await page.evaluate(() => {
      const t = document.body.innerText;
      const tables = [...document.querySelectorAll("table")].map((tb) => ({
        head: [...tb.querySelectorAll("th")].map((x) => x.innerText.trim()),
        rows: [...tb.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((x) => x.innerText.trim())),
      }));
      return { body: t.split("Analytics")[1]?.slice(0, 1100).replace(/\n+/g, " | "), tables,
        buttons: [...document.querySelectorAll("button")].map((b) => b.innerText.trim()).filter((x) => x && !/Collapse|Search|Floating|^F$/.test(x)) };
    });
    console.log(`\n--- ${p.cells[0]} (${p.cells[5]}) ${p.href} ---`);
    console.log("  body:", d.body?.slice(0, 800));
    for (const tb of d.tables) console.log("  TABLE", JSON.stringify(tb.head), "=>", JSON.stringify(tb.rows).slice(0, 500));
    console.log("  buttons:", JSON.stringify(d.buttons));
    await shot(page, `invoice-${p.cells[5]}-${p.cells[0].slice(0, 18)}`);
  }
  await browser.close();
}
main();
