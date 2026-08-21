/* PROBE 4 — can a real user drive an order to SERVED in the browser, so the receipt dispatches? */
import { chromium } from "@playwright/test";
import { login, shot, watchAuth, BASE } from "./printlib.mjs";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
watchAuth(page, "[kitchen]");
if (!(await login(page, "kitchen"))) { console.log("ABORT login"); await browser.close(); process.exit(1); }
console.log("signed in as KITCHEN:", page.url());

await page.goto(`${BASE}/app/kitchen`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);
let body = await page.locator("body").innerText();
console.log("=== /app/kitchen ===");
console.log("refusal?", /Access denied|do not have permission/i.test(body));
console.log("alerts:", await page.locator('[role="alert"]').count());
console.log(body.slice(0, 1500));
await shot(page, "p4-kds");

const btns = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean));
console.log("\nbuttons on KDS:", JSON.stringify([...new Set(btns)].slice(0, 30)));
console.log("any 'Serve' control?", btns.some((b) => /serv/i.test(b)));
console.log("any 'Ready' control?", btns.some((b) => /ready/i.test(b)));
console.log("any 'Bump' control?", btns.some((b) => /bump/i.test(b)));

// Station-scoped board?
const links = await page.evaluate(() => [...document.querySelectorAll("a")].map((a) => `${a.textContent.trim()}->${a.getAttribute("href")}`).filter((x) => /kitchen/i.test(x)));
console.log("station links:", JSON.stringify(links.slice(0, 12)));
await browser.close();
