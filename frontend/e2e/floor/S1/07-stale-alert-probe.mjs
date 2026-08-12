/*
 * S1 step 7 — attribute the one alert that appeared on the bartender's board.
 *
 * "Couldn't check for old tickets · Retry" showed up on 05e. It is NOT part of this item, but a
 * red chip on a board this item is closing has to be explained rather than waved past. This reads
 * the request behind it and prints its status.
 */
import { PEOPLE, newBrowser, newPage, login, go, log } from "./lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);

try {
  await login(page, PEOPLE.kitchen);
  page.__requests.length = 0;
  await go(page, "/app/kitchen/BAR", { waitMs: 8000, allowTrouble: true });
  const stale = page.__requests.filter((r) => /stale/.test(r.u));
  log("  stale-ticket requests:", JSON.stringify(stale, null, 1));
  const alerts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
      (n.textContent || "").trim().slice(0, 160),
    ),
  );
  log("  alerts on the board:", JSON.stringify(alerts));
  const direct = await page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/kitchen/kds/tickets/stale?branchId=x", {
      credentials: "include",
    });
    return { status: r.status, text: (await r.text()).slice(0, 200) };
  });
  log("  direct probe of /kitchen/kds/tickets/stale:", JSON.stringify(direct));
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
