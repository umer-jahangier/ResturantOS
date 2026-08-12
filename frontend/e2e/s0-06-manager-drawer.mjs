// S0-06, manager half: the SAME closed order, re-opened by the persona who holds
// `pos.order.refund` — the cashier's JWT does not carry it, so "Refund order IS offered"
// can only honestly be asserted here.
//
//   node e2e/s0-06-manager-drawer.mjs <orderId> <outSubdir>
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ORDER_ID = process.argv[2];
const OUT = resolve(process.cwd(), "../.planning/audits/repair/S0-06", process.argv[3] ?? "manager");
const BASE = "http://localhost:3000";
const MANAGER = {
  slug: "floating-terrace",
  email: "manager@terrace.local",
  password: "Terrace#Manager1",
};

mkdirSync(OUT, { recursive: true });
const log = [];
const say = (...p) => {
  console.log(p.join(" "));
  log.push(p.join(" "));
};

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.on("response", async (r) => {
    if (r.url().includes("/auth/login") || r.url().includes("/api/auth/")) {
      let body = "";
      try { body = (await r.text()).slice(0, 400); } catch { body = "<unreadable>"; }
      say(`  ${r.status()} ${r.request().method()} ${r.url()} :: ${body}`);
    }
  });
  page.on("console", (m) => { if (m.type() === "error") say("  [console.error]", m.text().slice(0, 200)); });
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) say("  [nav]", f.url()); });
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await slug.count()) await slug.first().fill(MANAGER.slug);
    await page.locator('input[name="email"], input#email').first().fill(MANAGER.email);
    await page.locator('input[name="password"], input#password').first().fill(MANAGER.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(12000);
    say("after submit ->", page.url());
    if (page.url().includes("/login")) {
      const body = await page.locator("body").innerText();
      say("LOGIN PAGE TEXT:", body.replace(/\n+/g, " | ").slice(0, 700));
      await page.screenshot({ path: `${OUT}/login-failed.png`, fullPage: true });
      throw new Error("manager login did not leave /login");
    }

    await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    await page.getByRole("button", { name: "Order Management", exact: true }).first().click();
    await page.waitForTimeout(2500);
    const closed = page.locator('[data-testid="status-filter-CLOSED"]');
    if (await closed.count()) {
      await closed.first().click();
      await page.waitForTimeout(2500);
    }
    await page.screenshot({ path: `${OUT}/10-manager-order-management.png`, fullPage: true });

    const row = page.locator(`[data-testid="open-order-${ORDER_ID}"]`).first();
    await row.waitFor({ timeout: 20000 });
    await row.click();
    await page.waitForTimeout(3000);

    const text = (await page.locator('[role="dialog"]').first().innerText().catch(() => ""))
      .replace(/\n+/g, " | ");
    const voidBtn = await page.getByRole("button", { name: /^Void order$/i }).count();
    const refundBtn = await page.getByRole("button", { name: /^Refund order$/i }).count();
    const chargeBtn = await page.locator('[data-testid="charge-now-button"]').count();
    const paidChip = await page.locator('[data-testid="paid-chip"]').count();
    say("--- drawer as manager ---");
    say(text.slice(0, 900));
    say(`VERDICT(manager): voidOrder=${voidBtn} refundOrder=${refundBtn} chargeNow=${chargeBtn} paidChip=${paidChip}`);
    await page.screenshot({ path: `${OUT}/11-manager-drawer.png`, fullPage: true });
  } catch (e) {
    say("FAILED:", e.message);
    await page.screenshot({ path: `${OUT}/99-manager-failure.png`, fullPage: true }).catch(() => {});
  } finally {
    writeFileSync(`${OUT}/manager-transcript.txt`, log.join("\n"));
    await browser.close();
  }
}
main();
