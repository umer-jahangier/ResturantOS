// S0-09 browser proof — drive the DONE MEANS click path as the cashier persona.
// node e2e/diag/prove-s0-09.mjs   (run from frontend/)
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

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  log("shot:", name);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => log("! pageerror:", String(e).slice(0, 200)));
page.on("console", (m) => {
  if (m.type() === "error") log("! console:", m.text().slice(0, 200));
});

// Record every POST to /pos/orders (creates) so a second order number cannot hide.
const createCalls = [];
const sendCalls = [];
page.on("response", async (r) => {
  const u = new URL(r.url()).pathname;
  if (r.request().method() !== "POST") return;
  if (/\/api\/v1\/pos\/orders$/.test(u)) {
    createCalls.push({ status: r.status(), body: await r.json().catch(() => null) });
  }
  if (/\/send-to-kds$/.test(u)) {
    sendCalls.push({ url: u, status: r.status(), body: await r.json().catch(() => null) });
  }
});

let failed = null;
let boundTable = null;
try {
  // ── sign in as the cashier ──────────────────────────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const slugField = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slugField.count()) await slugField.first().fill(CRED.slug);
  await page.locator('input[name="email"], input#email').first().fill(CRED.email);
  await page.locator('input[name="password"], input#password').first().fill(CRED.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/app\//, { timeout: 25000 });
  log("signed in as", CRED.email, "->", page.url());

  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const alerts = (await page.locator('[role="alert"]').allTextContents()).filter((t) => t.trim());
  if (alerts.length) log("[role=alert] on load:", JSON.stringify(alerts).slice(0, 300));

  const noTill = page.getByText("No active till");
  if (await noTill.isVisible({ timeout: 2500 }).catch(() => false)) {
    await page.getByTestId("open-till-button").click();
    await page.getByPlaceholder("e.g. 5000.00").fill("5000");
    await page.getByTestId("open-till-confirm-button").click();
    await page.waitForTimeout(4000);
    log("opened a till");
  }

  // ── ring two items against a table, then Send to Kitchen ────────────────────
  await page.getByRole("button", { name: "POS Terminal", exact: true }).click();
  await page.waitForTimeout(2000);

  // Bind a real table so this is a dine-in check, as DONE MEANS asks.
  const tableCombo = page.getByTestId("table-select-trigger");
  if (await tableCombo.isVisible({ timeout: 4000 }).catch(() => false)) {
    await tableCombo.click();
    await page.waitForTimeout(900);
    // Occupied tables are rendered aria-disabled — pick a genuinely free one.
    const opt = page
      .locator('[data-testid^="table-option-"]:not([aria-disabled="true"])')
      .first();
    if (await opt.isVisible({ timeout: 3000 }).catch(() => false)) {
      boundTable = (await opt.textContent())?.trim();
      log("binding table:", boundTable);
      await opt.click();
      await page.waitForTimeout(800);
    } else {
      await page.keyboard.press("Escape");
      log("no selectable table in the picker — continuing as a tableless check");
    }
  } else {
    log("table picker not visible");
  }

  const menuItems = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  const n = await menuItems.count();
  if (n < 3) throw new Error(`need >= 3 menu items, have ${n}`);
  const rung = [];
  for (const i of [0, 1]) {
    rung.push((await menuItems.nth(i).locator("span").first().textContent())?.trim());
    await menuItems.nth(i).click();
    await page.waitForTimeout(400);
  }
  log("rang two items:", rung.join(" | "));
  await shot(page, "P1-cart-two-items");

  await page.getByTestId("send-to-kitchen-button").click();
  await page.waitForTimeout(6000);
  await shot(page, "P2-sent-to-kitchen");

  const orderNo = (
    await page.locator(".w-80 span.font-semibold.text-sm").first().textContent().catch(() => null)
  )?.trim();
  log("ORDER NUMBER on the terminal after Send to Kitchen:", orderNo);
  if (!orderNo || orderNo === "New Order") throw new Error(`no real order number (got ${orderNo})`);

  const panelAfterSend = (await page.locator(".w-80").first().innerText()).replace(/\n/g, " | ");
  log("panel after send:", panelAfterSend.slice(0, 400));

  // ── park it: Clear / New Order, exactly as a cashier moving to the next guest ─
  await page.getByTestId("clear-new-order-button").click();
  await page.waitForTimeout(1500);
  await shot(page, "P3-parked-fresh-terminal");
  log(
    "terminal after parking:",
    (await page.locator(".w-80").first().innerText()).replace(/\n/g, " | ").slice(0, 200),
  );

  // ── recall it from Order Management, then click Full Menu → ─────────────────
  await page.getByRole("button", { name: "Order Management", exact: true }).click();
  await page.waitForTimeout(3000);
  const openBtn = page.getByRole("button", { name: `Open order ${orderNo}` });
  await openBtn.waitFor({ state: "visible", timeout: 20000 });
  await openBtn.click();
  const drawer = page.getByTestId("order-table-detail-drawer");
  await drawer.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(1500);
  log("drawer:", (await drawer.innerText()).replace(/\n/g, " | ").slice(0, 400));
  await shot(page, "P4-drawer-for-parked-order");

  await drawer.getByTestId("drawer-full-menu").click();
  await page.waitForTimeout(4000);
  await shot(page, "P5-terminal-resumed");

  // ── ASSERT: the terminal opened ON that order ───────────────────────────────
  const panel = await page.locator(".w-80").first().innerText();
  const panelFlat = panel.replace(/\n/g, " | ");
  log("RESUMED panel:", panelFlat.slice(0, 500));
  const checks = {
    "same order number": panel.includes(orderNo),
    "line 1 present": panel.includes(rung[0]),
    "line 2 present": panel.includes(rung[1]),
    "no empty-cart lie": !panel.includes("Add items to start an order"),
  };
  log("CHECKS:", JSON.stringify(checks));
  for (const [k, v] of Object.entries(checks)) if (!v) throw new Error(`resume check failed: ${k}`);

  const totalAfterResume = panelFlat.match(/Total \| (Rs [\d,]+\.\d\d)/)?.[1];
  log("running total on resume:", totalAfterResume);

  // ── add a THIRD item and fire it ────────────────────────────────────────────
  const thirdName = (await menuItems.nth(2).locator("span").first().textContent())?.trim();
  log("adding third item:", thirdName);
  const addResp = page.waitForResponse(
    (r) => /\/items$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
    { timeout: 20000 },
  );
  await menuItems.nth(2).click();
  const added = await addResp.catch(() => null);
  log("append POST:", added ? `${added.status()} ${new URL(added.url()).pathname}` : "NONE");
  await page.waitForTimeout(2500);
  await shot(page, "P6-third-item-appended");

  const panel2 = (await page.locator(".w-80").first().innerText()).replace(/\n/g, " | ");
  log("panel with third item:", panel2.slice(0, 500));

  const sendNew = page.getByTestId("send-to-kitchen-button");
  const ctaText = (await sendNew.textContent())?.trim();
  log("CTA now reads:", ctaText);
  await sendNew.click();
  await page.waitForTimeout(5000);
  await shot(page, "P7-revision-fired");

  const panel3 = (await page.locator(".w-80").first().innerText()).replace(/\n/g, " | ");
  log("panel after firing:", panel3.slice(0, 500));

  // ── ASSERT: one order, and only the new line went out as the new revision ───
  log("createCalls (POST /pos/orders):", createCalls.length);
  const lastSend = sendCalls[sendCalls.length - 1];
  const items = lastSend?.body?.data?.items ?? [];
  const byRev = items.map((i) => `${i.itemNameSnapshot}@rev${i.revisionNo}`);
  log("send-to-kds items:", JSON.stringify(byRev));
  const rev1 = items.filter((i) => i.revisionNo === 1);
  const rev2 = items.filter((i) => i.revisionNo > 1);
  log(`rev1 lines=${rev1.length}  newRev lines=${rev2.length}`);

  const finalOrderNo = (
    await page.locator(".w-80 span.font-semibold.text-sm").first().textContent().catch(() => null)
  )?.trim();
  log("FINAL order number:", finalOrderNo, "(unchanged:", finalOrderNo === orderNo, ")");

  if (createCalls.length !== 1)
    throw new Error(`expected exactly ONE order creation for this party, saw ${createCalls.length}`);
  if (finalOrderNo !== orderNo) throw new Error("order number changed — a second check was issued");
  if (rev1.length !== 2) throw new Error(`expected the 2 original lines to stay at rev 1, got ${rev1.length}`);
  if (rev2.length !== 1) throw new Error(`expected exactly the new line to fire as a new revision, got ${rev2.length}`);

  log("PROOF PASSED");
} catch (e) {
  failed = String(e);
  log("PROOF FAILED:", failed.slice(0, 500));
  await shot(page, "P99-failure");
} finally {
  await browser.close();
  if (failed) process.exitCode = 1;
}
