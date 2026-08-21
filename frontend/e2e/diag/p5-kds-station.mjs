/* PROBE 5 — inside a station board: is there a control that reaches SERVED (the receipt trigger)? */
import { chromium } from "@playwright/test";
import { login, shot, watchAuth, BASE } from "./printlib.mjs";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
watchAuth(page, "[kitchen]");
if (!(await login(page, "kitchen"))) { console.log("ABORT"); await browser.close(); process.exit(1); }

await page.goto(`${BASE}/app/kitchen/DEFAULT`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
const body = await page.locator("body").innerText();
console.log("=== /app/kitchen/DEFAULT ===");
console.log("refusal?", /Access denied|do not have permission/i.test(body));
console.log("alerts:", await page.locator('[role="alert"]').count());
console.log(body.slice(0, 2000));
await shot(page, "p5-kds-station");

const btns = await page.evaluate(() => [...new Set([...document.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean))]);
console.log("\nDISTINCT buttons:", JSON.stringify(btns.slice(0, 40), null, 1));
console.log("\nserve-ish?", btns.filter((b) => /serv|ready|bump|done|complete|deliver|pick ?up/i.test(b)));

// Look for our paid order on the board
console.log("\nORD-20260812-0021 on this board?", /0021/.test(body));
await browser.close();
