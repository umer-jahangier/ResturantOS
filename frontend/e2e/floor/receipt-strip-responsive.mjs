/*
 * The "Bill issued …" strip at 390 / 768 / 1440, in both themes.
 *
 * Asserts COMPUTED style, never the class list — `cn()`/tailwind-merge has silently dropped
 * utilities in this codebase before, so a class in the source is not a class in the DOM.
 *
 * Usage: node e2e/floor/receipt-strip-responsive.mjs <orderId>
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const ORDER_ID = process.argv[2];
if (!ORDER_ID) throw new Error("pass an order id that has been settled");

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F7");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
const email = page.locator("input#email, input[name=email]").first();
const pw = page.locator("input#password, input[name=password]").first();
await email.click();
await email.fill("cashier@terrace.local");
await pw.click();
await pw.fill("Terrace#Cashier1");
await page.waitForTimeout(500);
if ((await email.inputValue()) !== "cashier@terrace.local") throw new Error("login form did not hold the email");
await page.locator("button[type=submit]").first().click();
await page.waitForTimeout(7000);
if (page.url().includes("/login")) throw new Error("login failed — still at " + page.url());

const rows = [];
for (const theme of ["light", "dark"]) {
  for (const [label, w, h] of [
    ["390", 390, 844],
    ["768", 768, 1024],
    ["1440", 1440, 950],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`${BASE}/app/pos/orders/${ORDER_ID}/charge`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    await page.evaluate((t) => {
      document.documentElement.classList.toggle("dark", t === "dark");
      document.documentElement.style.colorScheme = t;
    }, theme);
    await page.waitForTimeout(600);

    const probe = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="bill-issued-strip"]');
      if (!el) return { present: false };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const body = document.body;
      return {
        present: true,
        text: el.innerText.replace(/\s+/g, " ").trim(),
        color: cs.color,
        background: cs.backgroundColor,
        borderColor: cs.borderTopColor,
        fontSize: cs.fontSize,
        width: Math.round(r.width),
        right: Math.round(r.right),
        overflowsViewport: r.right > window.innerWidth + 1 || r.left < -1,
        bodyScrollsX: body.scrollWidth > window.innerWidth + 1,
      };
    });
    rows.push({ theme, width: label, ...probe });
    await page.screenshot({ path: `${OUT}/strip-${theme}-${label}.png` });
    console.log(theme, label, JSON.stringify(probe));
  }
}
await browser.close();
console.log("\nsummary:");
for (const r of rows) {
  console.log(
    `${r.theme.padEnd(5)} ${String(r.width).padEnd(5)} present=${r.present} overflow=${r.overflowsViewport} bodyScrollsX=${r.bodyScrollsX} color=${r.color} bg=${r.background}`,
  );
}
