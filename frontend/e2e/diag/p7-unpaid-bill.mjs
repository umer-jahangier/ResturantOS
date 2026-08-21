/* PROBE 7 — can a cashier present the bill BEFORE payment (table service's commonest print)? */
import { chromium } from "@playwright/test";
import { login, shot, watchAuth, instrumentPrint, BASE } from "./printlib.mjs";

const UNPAID = process.argv[2] ?? "6831edd9-8129-418c-87d2-9746fe3452c8"; // ORD-...0023, unpaid

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await instrumentPrint(ctx);
const page = await ctx.newPage();
watchAuth(page, "[cashier]");
if (!(await login(page, "cashier"))) { console.log("ABORT"); await browser.close(); process.exit(1); }

// 1. The charge screen for an UNPAID order — is there any way to print?
await page.goto(`${BASE}/app/pos/orders/${UNPAID}/charge`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
const body = await page.locator("body").innerText();
console.log("=== UNPAID order, charge screen ===");
console.log("paid state:", JSON.stringify(body.split("\n").filter((l) => /Unpaid|Paid|Remaining/i.test(l)).slice(0, 4)));
console.log("'Print bill' button:", await page.locator('[data-testid="print-bill-button"]').count());
const anyPrintBtn = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => /print|bill/i.test(b.textContent)).map((b) => b.textContent.trim()));
console.log("any print-ish button anywhere on the screen:", JSON.stringify(anyPrintBtn));
await shot(page, "p7-unpaid-charge");

// 2. Force the route directly — is the capability merely unlinked, or absent?
await page.goto(`${BASE}/app/pos/orders/${UNPAID}/receipt`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);
const rb = await page.locator("body").innerText();
console.log("\n=== receipt route forced by URL on an UNPAID order ===");
console.log("url:", page.url());
console.log("alerts:", await page.locator('[role="alert"]').count());
console.log("window.print calls:", await page.evaluate(() => window.__printCalls));
console.log(rb.slice(0, 900));
await shot(page, "p7-unpaid-receipt-forced");
await browser.close();
