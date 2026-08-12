/* B1 — reproduce/verify the trading-day cut in the browser, as the manager. */
import { PEOPLE, newBrowser, newPage, login, go, log } from "../shift/lib.mjs";
import { mkdirSync } from "node:fs";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/B1";
mkdirSync(OUT, { recursive: true });
const tag = process.argv[2] || "before";

const browser = await newBrowser();
const p = await newPage(browser);
await login(p, PEOPLE.manager);

log(
  `NOW utc=${new Date().toISOString()} karachi=${new Date().toLocaleString("en-GB", { timeZone: "Asia/Karachi" })}`,
);

const tr = await go(p, "/app/finance/takings", { waitMs: 7000 });
log("takings trouble:", JSON.stringify(tr));
await p.screenshot({ path: `${OUT}/${tag}-01-takings-default.png`, fullPage: false });
const probe = await p.evaluate(() => {
  const t = document.body.innerText;
  const dateInput = document.querySelector("input[type=date]");
  return {
    url: location.href,
    dateInputValue: dateInput ? dateInput.value : null,
    heading: document.querySelector("h1")?.textContent?.trim() ?? null,
    zeroOrders: /0 orders closed on this trading day/i.test(t),
    firstLines: t
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 45),
  };
});
log("takings default probe:", JSON.stringify(probe, null, 1));
await browser.close();
