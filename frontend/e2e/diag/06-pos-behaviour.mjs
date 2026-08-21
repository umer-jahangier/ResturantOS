/* Does the POS behave any differently now a SELF_SERVE kiosk terminal exists? Plus the 429 hunt. */
import { launch, login, visit, OUT, BASE } from "./onboarding-lib.mjs";

const { browser, page } = await launch();
page.on("response", (r) => {
  if (r.status() === 429 || r.status() === 401 || r.status() === 403) {
    console.log(`   !! ${r.status()} ${r.url().replace("http://localhost:8080", "GW")}`);
  }
});
try {
  await login(page, process.argv[2] ?? "owner");
  const pos = await visit(page, "/app/pos", `pb-01-pos-${process.argv[2] ?? "owner"}`, { chars: 2000 });
  if (/Sign in to RestaurantOS/.test(pos.text)) throw new Error("session died before POS");
  const selects = await page.locator("select").evaluateAll((els) =>
    els.map((e) => ({ id: e.id, options: [...e.options].map((o) => o.textContent) })),
  );
  console.log("POS SELECTS:", JSON.stringify(selects).slice(0, 900));
  const btns = await page.locator("button").allInnerTexts();
  console.log("POS BUTTONS:", JSON.stringify(btns.slice(0, 40)));
  console.log("terminal picker present?", /terminal/i.test(btns.join(" ")));
  // localStorage / indexedDB terminal identity
  const ls = await page.evaluate(() => Object.keys(localStorage));
  console.log("localStorage keys:", JSON.stringify(ls));
} catch (e) {
  console.error("FAILED:", e.message);
  await page.screenshot({ path: `${OUT}/pb-FAIL.png`, fullPage: true });
} finally {
  await browser.close();
}
