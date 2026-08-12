// Reproduction for S0-09: "Full Menu" from a parked order silently abandons that order.
// node repro-s0-09.mjs   (run from frontend/)
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

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log("  shot:", name);
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const slugField = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slugField.count()) await slugField.first().fill(CRED.slug);
  await page.locator('input[name="email"], input#email').first().fill(CRED.email);
  await page.locator('input[name="password"], input#password').first().fill(CRED.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/app\//, { timeout: 25000 });
  console.log("  logged in ->", page.url());
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  ! pageerror:", String(e).slice(0, 200)));
page.on("console", (m) => {
  if (m.type() === "error") console.log("  ! console:", m.text().slice(0, 200));
});

try {
  await login(page);
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // Error-state check
  const alerts = await page.locator('[role="alert"]').allTextContents();
  if (alerts.length) console.log("  [role=alert] present:", JSON.stringify(alerts).slice(0, 300));

  // Till
  const noTill = page.getByText("No active till");
  if (await noTill.isVisible({ timeout: 2500 }).catch(() => false)) {
    console.log("  opening till...");
    await page.getByTestId("open-till-button").click();
    await page.getByPlaceholder("e.g. 5000.00").fill("5000");
    await page.getByTestId("open-till-confirm-button").click();
    await page.waitForTimeout(4000);
  }
  console.log("  till bar:", (await page.locator("body").innerText()).split("\n")[0]);

  await page.getByRole("button", { name: "POS Terminal", exact: true }).click();
  await page.waitForTimeout(2000);
  await shot(page, "01-terminal-initial");

  // Pick a table via the combobox so the order is DINE_IN with a table.
  const menuItems = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  const n = await menuItems.count();
  console.log("  menu items:", n);
  if (n < 3) throw new Error(`need >=3 menu items, have ${n}`);

  const names = [];
  for (const i of [0, 1]) {
    const label = (await menuItems.nth(i).locator("span").first().textContent())?.trim();
    names.push(label);
    await menuItems.nth(i).click();
    await page.waitForTimeout(400);
  }
  console.log("  rang:", names.join(" | "));
  await shot(page, "02-cart-two-items");

  const totalBefore = await page
    .locator("text=Total (est.)")
    .first()
    .locator("xpath=..")
    .innerText()
    .catch(() => "?");
  console.log("  cart total block:", totalBefore.replace(/\n/g, " "));

  // Save as Draft — capture the create response so we know the real id/orderNo
  const createRespP = page.waitForResponse(
    (r) => /\/pos\/orders$/.test(r.url().split("?")[0]) && r.request().method() === "POST",
    { timeout: 20000 },
  );
  await page.getByTestId("save-draft-button").click();
  const createResp = await createRespP.catch(() => null);
  const createBody = createResp ? await createResp.json().catch(() => null) : null;
  console.log("  create response:", JSON.stringify(createBody?.data ?? createBody).slice(0, 400));
  await page.waitForTimeout(3500);
  const toast = await page
    .locator("[data-sonner-toast]")
    .first()
    .innerText()
    .catch(() => "");
  console.log("  toast:", toast.replace(/\n/g, " "));
  await shot(page, "03-after-save-draft");

  const orderId = createBody?.data?.id;
  let orderNo = createBody?.data?.orderNo ?? null;
  console.log("  ORDER ID:", orderId, " ORDER NO (create resp):", orderNo);
  if (!orderNo && orderId) {
    const r = await page.request.get(`${BASE}/api/v1/pos/orders/${orderId}`).catch(() => null);
    console.log("  refetch status:", r?.status());
  }

  // Order Management -> open that order
  await page.getByRole("button", { name: "Order Management", exact: true }).click();
  await page.waitForTimeout(3000);
  await shot(page, "04-order-management");
  if (!orderNo) {
    // Read the order number off the list row for this order id.
    const rowTexts = await page.locator("table tbody tr").allInnerTexts().catch(() => []);
    console.log("  rows:", JSON.stringify(rowTexts.slice(0, 5)));
    const openNames = await page
      .getByRole("button", { name: /^Open order / })
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))
      .catch(() => []);
    console.log("  open buttons:", JSON.stringify(openNames.slice(0, 8)));
    orderNo = (openNames[0] ?? "").replace("Open order ", "") || null;
  }
  console.log("  RESOLVED ORDER NO:", orderNo);
  const openBtn = page.getByRole("button", { name: `Open order ${orderNo}` });
  await openBtn.waitFor({ state: "visible", timeout: 20000 });
  await openBtn.click();
  const drawer = page.getByTestId("order-table-detail-drawer");
  await drawer.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(1500);
  console.log("  drawer text:", (await drawer.innerText()).replace(/\n/g, " | ").slice(0, 600));
  await shot(page, "05-drawer-open");

  // Full Menu
  await drawer.getByRole("button", { name: /Full Menu/ }).click();
  await page.waitForTimeout(3000);
  await shot(page, "06-after-full-menu");

  const bodyText = await page.locator("body").innerText();
  console.log("  --- AFTER FULL MENU ---");
  console.log("  contains order no?", bodyText.includes(orderNo));
  console.log("  contains 'Add items to start an order'?", bodyText.includes("Add items to start an order"));
  console.log(
    "  right panel:",
    (await page.locator(".w-80").first().innerText().catch(() => "?")).replace(/\n/g, " | ").slice(0, 500),
  );
} catch (e) {
  console.log("  FAILED:", String(e).slice(0, 400));
  await shot(page, "99-failure");
} finally {
  await browser.close();
}
