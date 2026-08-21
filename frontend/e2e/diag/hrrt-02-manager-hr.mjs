import { P, login, newPage, shot, visit } from "./hrrt-lib.mjs";

const who = process.argv[2] ?? "manager";
const { browser, page } = await newPage();
try {
  await login(page, P[who]);
  for (const r of ["/app/hr/employees", "/app/hr/payroll", "/app/hr/settings/tax", "/app/hr/schedule", "/app/hr/attendance"]) {
    const s = await visit(page, r, { persona: P[who] });
    // strip the sidebar chrome by reading main only
    const main = await page.locator("main").innerText().catch(() => s.body);
    console.log(`\n=== ${who} ${r} url=${s.url}`);
    console.log(main.replace(/\n{2,}/g, "\n").slice(0, 1800));
    const buttons = await page.locator("main button").allInnerTexts().catch(() => []);
    console.log(`--- buttons: ${JSON.stringify(buttons.map((b) => b.trim()).filter(Boolean))}`);
    await shot(page, `${who}-${r.replace(/\//g, "_")}`);
  }
} finally {
  await browser.close();
}
