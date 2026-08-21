/* One route, one dialog, one session — keeps well under the gateway auth rate limiter. */
import { launch, login, visit, OUT } from "./onboarding-lib.mjs";

const ROUTE = process.argv[2];
const OPENER = new RegExp(process.argv[3], "i");
const NAME = process.argv[4];
const PERSONA = process.argv[5] ?? "owner";

const { browser, page } = await launch();
try {
  await login(page, PERSONA);
  const r = await visit(page, ROUTE, `${NAME}-page`, { chars: 900 });
  if (/Sign in to RestaurantOS/.test(r.text)) throw new Error("session died");
  const btn = page.getByRole("button", { name: OPENER });
  if (!(await btn.count())) { console.log("NO OPENER BUTTON"); }
  else {
    await btn.first().click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/${NAME}-dialog.png`, fullPage: true });
    const d = page.locator('[role="dialog"]').last();
    if (await d.count()) {
      console.log("BOX:", JSON.stringify(await d.boundingBox()));
      console.log("LABELS:", JSON.stringify(await d.locator("label").allInnerTexts()));
      const sels = await d.locator("select").evaluateAll((els) =>
        els.map((e) => ({ id: e.id, options: [...e.options].map((o) => o.textContent) })),
      );
      console.log("SELECTS:", JSON.stringify(sels).slice(0, 900));
      console.log("TEXT:", (await d.innerText()).replace(/\s+/g, " ").slice(0, 1400));
    } else console.log("NO DIALOG");
  }
} catch (e) {
  console.error("FAILED:", e.message);
  await page.screenshot({ path: `${OUT}/${NAME}-FAIL.png`, fullPage: true });
} finally {
  await browser.close();
}
