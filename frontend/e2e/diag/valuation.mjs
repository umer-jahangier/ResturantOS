// ATTACK 13: the headline "Total stock value" on /app/inventory/stock. Sum the STOCK VALUE
// column the screen itself renders and compare it with the total the screen prints. Both numbers
// come from the same page in the same instant, so no timing excuse survives.
import { chromium, newCtx, login, probe, shot, assertSession } from "./lib.mjs";

const persona = process.argv[2] ?? "manager";

async function main() {
  const browser = await chromium.launch();
  const { page } = await newCtx(browser, { width: 1440, height: 950 });
  if (!(await login(page, persona))) { console.log("LOGIN FAILED"); process.exit(1); }
  await probe(page, "/app/inventory/stock");
  await assertSession(page, "stock");

  const r = await page.evaluate(() => {
    const money = (s) => Number(String(s).replace(/[^0-9.-]/g, "")) * (String(s).includes("-") ? 1 : 1);
    const rows = [...document.querySelectorAll("table tbody tr")].map((tr) => {
      const c = [...tr.querySelectorAll("td")].map((x) => x.innerText.trim());
      return { name: c[0].split("\n")[0], onHand: c[2], avgCost: c[4], value: c[5], status: c[7] };
    });
    const totalText = (document.body.innerText.match(/Total stock value:\s*([^\n]*)/) || [])[1];
    const sum = rows.reduce((a, x) => a + money(x.value), 0);
    const pager = document.body.innerText.match(/(\d+)\s*[–-]\s*(\d+)\s+of\s+(\d+)/);
    return { rowCount: rows.length, rows, totalText, summedFromColumn: sum, pager: pager ? pager[0] : null,
      pagerButtons: [...document.querySelectorAll("button")].map((b) => b.innerText.trim()).filter((t) => /next|previous|page/i.test(t)) };
  });

  console.log("\n=== /app/inventory/stock valuation ===");
  console.log("  rows rendered:", r.rowCount, "| pager:", r.pager, JSON.stringify(r.pagerButtons));
  console.log("  TOTAL printed by the page :", r.totalText);
  console.log("  SUM of the STOCK VALUE col:", `Rs ${r.summedFromColumn.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  console.log("  agree:", Math.abs(r.summedFromColumn - Number(String(r.totalText).replace(/[^0-9.-]/g, ""))) < 1);
  console.log("\n  rows:");
  for (const x of r.rows) console.log(`    ${x.name.padEnd(34)} ${x.onHand.padStart(12)}  avg ${x.avgCost.padStart(12)}  value ${x.value.padStart(18)}  ${x.status}`);
  await shot(page, "valuation-evidence");
  await browser.close();
}
main();
