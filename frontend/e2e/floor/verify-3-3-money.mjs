/*
 * The money invariant, re-proved on the checks THIS re-open drove.
 *
 * §3-3 moved the receipt dispatch onto the tender. The walkthrough's standing proof is that cash,
 * tendered and change agree to the paisa across the screen, the printed bill and `order_payments`.
 * A change that moves WHEN the bill is stamped must not move WHAT it says.
 *
 * Reads the bill for the over-tender check (D) and the split-tender check (B) as the cashier.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = "../.planning/audits/floor/F7-reopen";
const ORDERS = {
  D_overtender: "707e2eb1-da16-4078-859b-411c01620e50",
  B_split: "e7a82d02-ff24-491f-aacb-33fab31b570d",
  A_closed: "32ce7307-0f9c-4838-bdca-0b6cc5d447e9",
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
const out = {};

try {
  for (let a = 1; a <= 4; a++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await slug.count()) await slug.first().fill("floating-terrace");
    await page.locator('input[name="email"], input#email').first().fill("cashier@terrace.local");
    await page.locator('input[name="password"], input#password').first().fill("Terrace#Cashier1");
    await page.locator('button[type="submit"]').first().click();
    for (let w = 0; w < 12 && page.url().includes("/login"); w++) await page.waitForTimeout(2000);
    if (!page.url().includes("/login")) break;
  }
  if (page.url().includes("/login")) throw new Error("login failed");
  console.log("signed in");

  for (const [name, id] of Object.entries(ORDERS)) {
    await page.goto(`${BASE}/app/pos/orders/${id}/receipt`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6500);
    const bill = await page.evaluate(() => {
      const t = document.body.innerText;
      const grab = (re) => re.exec(t)?.[1] ?? null;
      return {
        reprint: /\*\*\* REPRINT #(\d+) \*\*\*/.exec(t)?.[1] ?? null,
        originallyIssued: /Originally issued\s*(\S+)/.exec(t)?.[1] ?? null,
        total: grab(/TOTAL\s*\n?\s*(Rs [\d,]+\.\d\d)/),
        cash: grab(/CASH\s*\n?\s*(Rs [\d,]+\.\d\d)/),
        tendered: grab(/Tendered\s*\n?\s*(Rs [\d,]+\.\d\d)/i),
        change: grab(/Change\s*\n?\s*(Rs [\d,]+\.\d\d)/i),
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
      };
    });
    out[name] = bill;
    console.log(name, JSON.stringify(bill));
    await page.screenshot({ path: `${OUT}/money-${name}.png` });
  }
} catch (e) {
  out.error = String(e);
  console.log("!!", e);
} finally {
  writeFileSync(`${OUT}/verify-3-3-money.json`, JSON.stringify(out, null, 2));
  await browser.close();
}
