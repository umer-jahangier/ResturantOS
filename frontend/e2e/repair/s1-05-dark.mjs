/*
 * S1-05 — the same tender row in the dark theme, plus a computed-style read.
 *
 * A class named in the .tsx is not a class in the document (tailwind-merge has silently dropped
 * utilities in this tree before), so the contrast claim is checked against getComputedStyle, not
 * against className.
 *
 *   node e2e/repair/s1-05-dark.mjs
 */
import { chromium } from "@playwright/test";
import { login, ensureTillOpen, ringBill, chargeNow, shot, shotDir, SHOTS } from "./s1-05-lib.mjs";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const page = await ctx.newPage();

shotDir();
await login(page);
const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
if (!isDark) throw new Error("the dark theme did not apply — this screenshot would be a lie");

await ensureTillOpen(page);
await ringBill(page);
await chargeNow(page);

await page.getByTestId("fill-full-amount-button").click();
await page.getByLabel("Tendered (Rs)").first().fill("4000");
await page.waitForTimeout(600);

const style = await page.evaluate(() => {
  const read = (sel) => {
    const n = document.querySelector(sel);
    if (!n) return null;
    const cs = getComputedStyle(n);
    return { color: cs.color, background: cs.backgroundColor, textAlign: cs.textAlign, font: cs.fontFamily };
  };
  const amount = document.querySelector('input[aria-label="Amount (Rs)"]');
  return {
    changeDue: read('[data-testid="change-due-value"] span'),
    amountInput: amount ? { textAlign: getComputedStyle(amount).textAlign, inputMode: amount.getAttribute("inputmode") } : null,
    changePaisa: document.querySelector('[data-testid="change-due-value"]')?.getAttribute("data-paisa"),
  };
});
console.log("  computed style:", JSON.stringify(style, null, 2));
await shot(page, "after-07-dark-theme", { fullPage: true });
console.log("  evidence ->", SHOTS);
await browser.close();
