/* What does the cashier actually see on /app/pos right now? */
import { newBrowser, newPage, login, PEOPLE } from "../shift/lib.mjs";
import { go, shot } from "./f3-lib.mjs";

const browser = await newBrowser();
const p = await newPage(browser);
await login(p, PEOPLE.cashier);
const t = await go(p, "/app/pos", { waitMs: 12000 });
console.log("trouble:", JSON.stringify(t));
await shot(p, "20-pos-state");
console.log(
  await p.evaluate(() => ({
    url: location.href,
    text: document.body.innerText.replace(/\s+/g, " ").slice(0, 900),
    orderTypeRadios: Array.from(document.querySelectorAll("[role=radio]")).map((b) => ({
      id: b.getAttribute("data-testid"),
      t: b.textContent.trim(),
    })),
    testids: Array.from(document.querySelectorAll("[data-testid]"))
      .map((n) => n.getAttribute("data-testid"))
      .filter((x) => /order-type|menu-grid|send-to|table-select|till/.test(x))
      .slice(0, 20),
  })),
);
console.log("console errors:", p.__console.slice(0, 5));
await browser.close();
