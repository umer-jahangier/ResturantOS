// S0-09 second proof — the FLOOR VIEW route. The drawer's "Full Menu →" was never
// wired on this tab at all (TableFloorView did not forward onFullMenu), so tapping it
// on an occupied table did literally nothing. Waiter taps the occupied table, opens the
// drawer, clicks Full Menu → and must land on that table's live order.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/repair/S0-09";
const BASE = "http://localhost:3000";
const CRED = {
  slug: "floating-terrace",
  email: "cashier@terrace.local",
  password: "Terrace#Cashier1",
};

mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("  ", ...a);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => log("! pageerror:", String(e).slice(0, 250)));
page.on("console", (m) => { if (m.type() === "error") log("! console:", m.text().slice(0, 250)); });
page.on("response", async (r) => {
  const u = new URL(r.url()).pathname;
  if (u.includes("active-order")) log("  net:", r.status(), u.slice(-60));
});

const shot = async (n) => {
  await page.screenshot({ path: `${OUT}/${n}.png` });
  log("shot:", n);
};

let failed = null;
try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(CRED.slug);
  await page.locator('input[name="email"], input#email').first().fill(CRED.email);
  await page.locator('input[name="password"], input#password').first().fill(CRED.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/app\//, { timeout: 25000 });

  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "Floor View", exact: true }).click();
  await page.waitForTimeout(3000);
  await shot("F1-floor-view");

  const alerts = (await page.locator('[role="alert"]').allTextContents()).filter((t) => t.trim());
  if (alerts.length) log("[role=alert]:", JSON.stringify(alerts).slice(0, 300));

  // An OCCUPIED tile opens the shared drawer (an AVAILABLE one jumps to a fresh cart).
  const occupiedTiles = page.locator("button").filter({ hasText: /Occupied/ });
  const tileCount = await occupiedTiles.count();
  log("occupied tiles on the floor:", tileCount);
  if (tileCount === 0) throw new Error("no OCCUPIED table on the floor to recall");

  const drawer = page.getByTestId("order-table-detail-drawer");
  let orderNo = null;
  let drawerText = "";
  for (let i = 0; i < tileCount; i++) {
    const tile = occupiedTiles.nth(i);
    log("tapping occupied tile:", (await tile.innerText()).replace(/\n/g, " "));
    await tile.click();
    await drawer.waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(5000);
    drawerText = (await drawer.innerText()).replace(/\n/g, " | ");
    orderNo = drawerText.match(/ORD-[\d-]+/)?.[0] ?? null;
    log("  drawer:", drawerText.slice(0, 300));
    if (orderNo) break;
    // This table is flagged OCCUPIED with no active order — a stale occupancy row, not
    // this gap. Close and try the next one.
    log("  (no order on this table — stale OCCUPIED flag, trying the next tile)");
    await page.getByRole("button", { name: "Close order details" }).click();
    await page.waitForTimeout(1200);
  }
  log("order on this table:", orderNo);
  if (!orderNo) throw new Error("no occupied table on this floor had a resolvable active order");
  await shot("F2-floor-drawer");

  await drawer.getByTestId("drawer-full-menu").click();
  await page.waitForTimeout(4000);
  await shot("F3-floor-resumed-terminal");

  const panel = await page.locator(".w-80").first().innerText();
  log("terminal panel:", panel.replace(/\n/g, " | ").slice(0, 400));
  const onTerminalTab = await page
    .getByRole("button", { name: "POS Terminal", exact: true })
    .evaluate((el) => el.className.includes("border-primary"));
  log("switched to Terminal tab:", onTerminalTab);
  log("shows that order number:", panel.includes(orderNo));
  log("no empty-cart lie:", !panel.includes("Add items to start an order"));

  if (!onTerminalTab) throw new Error("Full Menu did not switch to the Terminal tab");
  if (!panel.includes(orderNo)) throw new Error(`terminal did not resume ${orderNo}`);
  if (panel.includes("Add items to start an order"))
    throw new Error("terminal showed the empty-cart state for a live table");
  log("FLOOR PROOF PASSED");
} catch (e) {
  failed = String(e);
  log("FLOOR PROOF FAILED:", failed.slice(0, 400));
  await shot("F99-failure");
} finally {
  await browser.close();
  if (failed) process.exitCode = 1;
}
