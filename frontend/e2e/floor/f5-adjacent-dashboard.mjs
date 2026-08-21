/*
 * F5 ADJACENT PATH — the owner DASHBOARD tile labelled "Net sales".
 *
 * The takings screen was fixed. This drives the screen an owner actually lands on and reads the
 * tile with the same word on it, then compares it against the report rows that feed it.
 */
import { newBrowser, newPage, login, PEOPLE, tokenOf, money, BASE } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F5/reopen");
mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await newBrowser();
  const page = await newPage(browser);
  await login(page, PEOPLE.owner);
  const bearer = await tokenOf(page);

  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);

  const tile = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="kpi-owner-net-sales"]')
      ?? Array.from(document.querySelectorAll("*")).find(
        (n) => /^NET SALES/i.test((n.innerText || "").trim()) && (n.innerText || "").length < 200 && n.children.length < 10);
    if (!el) return null;
    const txt = el.innerText || "";
    const m = txt.match(/Rs\s*([\d,]+(?:\.\d{2})?)/);
    return { text: txt.replace(/\n/g, " | "), amountText: m ? `Rs ${m[1]}` : null,
             paisa: m ? Math.round(Number(m[1].replace(/,/g, "")) * 100) : null };
  });
  console.log("DASHBOARD NET SALES TILE:", JSON.stringify(tile, null, 1));
  await page.screenshot({ path: `${OUT}/10-dashboard-net-sales.png` });

  // Read the trend table the chart exposes for screen readers — one row per day.
  const trend = await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll("table"))
      .map((n) => n.innerText).find((s) => /Net sales/i.test(s));
    return t ? t.replace(/\t/g, " | ").split("\n") : null;
  });
  console.log("TREND ROWS:", JSON.stringify(trend, null, 1));

  // The report that feeds it.
  const rep = await page.evaluate(async ({ tok }) => {
    const r = await fetch("http://localhost:8080/api/v1/reporting/reports/sales-by-day/run", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ from: "2026-07-14", to: "2026-08-12" }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { tok: bearer });

  console.log("\nsales-by-day rows (what the tile sums):");
  const rows = rep.body?.data?.rows ?? [];
  let sumTotal = 0, sumNet = 0;
  for (const r of rows) {
    const net = r.subtotal_paisa - r.discount_paisa;
    sumTotal += r.total_paisa; sumNet += net;
    console.log(`  ${String(r.business_date).slice(0, 10)}  subtotal=${money(r.subtotal_paisa)}  disc=${money(r.discount_paisa)}  tax=${money(r.tax_paisa)}  total=${money(r.total_paisa)}   TRUE net=${money(net)}`);
  }
  console.log(`\n  SUM(total_paisa) = ${money(sumTotal)}   <- what the tile labelled "Net sales" shows`);
  console.log(`  SUM(subtotal-disc) = ${money(sumNet)}   <- what net sales actually is`);
  console.log(`  over-statement = ${money(sumTotal - sumNet)} (the tax, and the service charge)`);

  writeFileSync(`${OUT}/dashboard.json`, JSON.stringify({ tile, trend, rows, sumTotal, sumNet }, null, 2));
  await browser.close();
})().catch((e) => { console.error("ERR", e); process.exit(1); });
