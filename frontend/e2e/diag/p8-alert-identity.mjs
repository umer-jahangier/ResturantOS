/* PROBE 8 — what IS the [role=alert] present on every page? Error, or benign chrome? */
import { chromium } from "@playwright/test";
import { login, BASE } from "./printlib.mjs";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
if (!(await login(page, "cashier"))) { console.log("ABORT"); await browser.close(); process.exit(1); }

for (const route of ["/app/dashboard", "/app/pos", "/app/pos/orders/6831edd9-8129-418c-87d2-9746fe3452c8/receipt"]) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const alerts = await page.evaluate(() =>
    [...document.querySelectorAll('[role="alert"]')].map((a) => ({
      text: (a.textContent || "").trim().slice(0, 160),
      cls: (a.className || "").toString().slice(0, 100),
      hidden: a.offsetParent === null,
      tag: a.tagName,
    })));
  console.log(`\n${route}`);
  console.log(JSON.stringify(alerts, null, 1));
  await page.waitForTimeout(2000);
}
await browser.close();
