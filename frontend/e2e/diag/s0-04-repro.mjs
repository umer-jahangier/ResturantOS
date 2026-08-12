// S0-04 reproduction: a voided (or refunded) order appears in none of the order filters.
// Drives real Chromium as the branch manager: ring an order, void it, then interrogate
// every Order Management filter chip + the search box for it.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const REPO = "/Users/muhammadumer/Documents/Projects/ResturantOS";
const SHOTS = `${REPO}/.planning/audits/repair/S0-04`;
const BASE = "http://localhost:3000";
mkdirSync(SHOTS, { recursive: true });

const LABEL = process.argv[2] ?? "before";

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${LABEL}-${name}.png`, fullPage: false });
  console.log(`  shot: ${LABEL}-${name}.png`);
}

async function login(page, { email, password, tenant = "floating-terrace" }) {
  await page.goto(`${BASE}/login?tenant=${tenant}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/app\//, { timeout: 25000 });
  await page.waitForTimeout(1500);
  return page.url();
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const net = [];
page.on("response", (res) => {
  const u = res.url();
  if (/\/pos\/orders/.test(u)) net.push(`${res.request().method()} ${res.status()} ${u.replace("http://localhost:8080", "")}`);
});

try {
  console.log("== sign in as manager ==");
  console.log(" ", await login(page, { email: "manager@terrace.local", password: "Terrace#Manager1" }));

  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const body0 = await page.locator("body").innerText();
  console.log("  till closed notice:", /Your till is closed/i.test(body0));
  const alerts0 = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
  console.log("  alerts:", JSON.stringify(alerts0).slice(0, 300));
  await shot(page, "01-pos-terminal");

  if (/Your till is closed/i.test(body0)) {
    const openTill = page.getByRole("button", { name: /open till|open drawer/i }).first();
    if (await openTill.isVisible().catch(() => false)) {
      await openTill.click();
      await page.waitForTimeout(1200);
      const amt = page.locator('input[type="number"], input[inputmode="decimal"]').first();
      if (await amt.isVisible().catch(() => false)) await amt.fill("500000");
      const confirm = page.getByRole("button", { name: /open till|confirm/i }).last();
      await confirm.click();
      await page.waitForTimeout(3000);
      console.log("  opened a till");
    }
  }

  // --- ring an order ---
  console.log("\n== ring an order ==");
  const itemBtn = page.getByTestId("menu-grid").locator("button").first();
  const label = await itemBtn.innerText().catch(() => "(none)");
  console.log("  first menu tile:", JSON.stringify(label.replace(/\n+/g, " | ")));
  await itemBtn.click();
  await page.waitForTimeout(2000);
  await itemBtn.click();
  await page.waitForTimeout(2000);
  await shot(page, "02-cart");

  const send = page.getByRole("button", { name: /send to kitchen/i }).first();
  console.log("  Send to Kitchen visible:", await send.isVisible().catch(() => false));
  await send.click();
  await page.waitForTimeout(4000);
  await shot(page, "03-after-send");

  // --- find its order number from Order Management ---
  await page.getByRole("button", { name: "Order Management" }).click();
  await page.waitForTimeout(3500);
  await shot(page, "04-order-management");
  const rowsText = await page.locator("table tbody tr").allInnerTexts().catch(() => []);
  console.log("  rows in ALL:", rowsText.length);
  rowsText.slice(0, 5).forEach((r) => console.log("    ", r.replace(/\n+/g, " | ").slice(0, 160)));

  const orderNos = rowsText.map((t) => (t.match(/ORD-\d{8}-\d{4}/) ?? [])[0]).filter(Boolean);
  const targetNo = orderNos[0];
  console.log("  TARGET ORDER:", targetNo);
  if (!targetNo) throw new Error("no ORD- number found in the list");

  // --- open it and void it ---
  const row = page.locator("table tbody tr").filter({ hasText: targetNo }).first();
  await row.getByRole("button", { name: /^Open order|^Continue order/i }).click();
  await page.waitForTimeout(3000);
  await shot(page, "05-drawer");

  const voidTrigger = page.getByRole("button", { name: /void order/i }).first();
  console.log("  'Void order' trigger visible:", await voidTrigger.isVisible().catch(() => false));
  await voidTrigger.click();
  await page.waitForTimeout(1200);
  const reason = page.locator('textarea[placeholder*="Customer left"]').first();
  await reason.fill("S0-04 repro: guest walked out");
  await shot(page, "06-void-panel");
  const [voidResp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/void") && r.request().method() === "POST", { timeout: 20000 }).catch(() => null),
    page.getByRole("button", { name: /confirm void/i }).click(),
  ]);
  console.log("  POST /void ->", voidResp ? voidResp.status() : "(never observed)");
  await page.waitForTimeout(3500);
  await shot(page, "07-after-void");

  // close drawer
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);

  // --- interrogate every filter chip ---
  console.log("\n== does the voided order appear under any filter? ==");
  const chips = await page.locator("[data-testid^=status-filter-]").evaluateAll((els) =>
    els.map((e) => ({ id: e.getAttribute("data-testid"), label: e.textContent.trim() })),
  );
  console.log("  chips present:", JSON.stringify(chips.map((c) => c.label)));

  const found = {};
  for (const c of chips) {
    await page.locator(`[data-testid="${c.id}"]`).click();
    await page.waitForTimeout(2200);
    const txt = await page.locator("table tbody").innerText().catch(() => "");
    const empty = await page.locator("body").innerText();
    found[c.label] = txt.includes(targetNo);
    console.log(
      `  ${c.label.padEnd(20)} contains ${targetNo}: ${found[c.label]}   (rows=${(await page.locator("table tbody tr").count().catch(() => 0))}${/No active orders/i.test(empty) ? ", EMPTY-STATE" : ""})`,
    );
  }
  await shot(page, "08-filters-swept");

  // --- search ---
  await page.locator('[data-testid="status-filter-ALL"]').click();
  await page.waitForTimeout(1200);
  await page.getByTestId("order-management-search").fill(targetNo.slice(-4));
  await page.waitForTimeout(1800);
  const searchBody = await page.locator("body").innerText();
  console.log(`\n  search "${targetNo.slice(-4)}" -> contains order:`, searchBody.includes(targetNo), "| empty state:", /No active orders/i.test(searchBody));
  await shot(page, "09-search");

  console.log("\n== VERDICT ==");
  console.log("  order:", targetNo);
  console.log("  reachable under any chip:", Object.values(found).some(Boolean), JSON.stringify(found));
  console.log("\n  net (pos/orders):");
  net.slice(-14).forEach((n) => console.log("   ", n));
} catch (err) {
  console.error("FAILED:", err.message);
  await shot(page, "zz-failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
