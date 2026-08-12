/* F17 — re-shoot the cleared screen after the item-count parity fix. */
import { newBrowser, newPage, login, go, PEOPLE, log } from "../shift/lib.mjs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F17");
const browser = await newBrowser();
const page = await newPage(browser);
await login(page, PEOPLE.kitchen);

for (const station of ["GRILL", "DEFAULT"]) {
  const trouble = await go(page, `/app/kitchen/${station}/cleared`, { waitMs: 6000 });
  if (trouble.bad.length) throw new Error(`${station}: ${trouble.bad.join(",")}`);
  const probe = await page.evaluate(() => ({
    count: document.querySelector('[data-testid="kds-cleared-count"]')?.innerText,
    rows: document.querySelectorAll('[data-testid="kds-cleared-row"]').length,
    firstRow: document.querySelector('[data-testid="kds-cleared-row"]')?.innerText,
  }));
  log(`  ${station}:`, JSON.stringify(probe));
  await page.screenshot({ path: `${OUT}/13-cleared-list-${station}.png` });
}
await browser.close();
