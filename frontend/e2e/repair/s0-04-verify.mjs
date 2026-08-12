// S0-04 verification: a voided AND a refunded order must be reachable from Order Management,
// with a status badge, the total, the reason and who did it — and must survive a reload.
// Drives real Chromium as the branch manager, the persona named in DONE MEANS.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const REPO = "/Users/muhammadumer/Documents/Projects/ResturantOS";
const SHOTS = `${REPO}/.planning/audits/repair/S0-04`;
const BASE = "http://localhost:3000";
mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/after-${name}.png`, fullPage: false });
  console.log(`  shot: after-${name}.png`);
}

async function login(page) {
  await page.goto(`${BASE}/login?tenant=floating-terrace`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.getByLabel("Email").fill("manager@terrace.local");
  await page.getByLabel("Password").fill("Terrace#Manager1");
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/app\//, { timeout: 25000 });
  await page.waitForTimeout(1500);
}

async function openOrderManagement(page) {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: "Order Management" }).click();
  await page.waitForTimeout(3000);
}

/** Rings one item and fires it. Returns the new order number. */
async function ringAndFire(page) {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const before = await orderNumbersInList(page);
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.getByTestId("menu-grid").locator("button").first().click();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /send to kitchen/i }).first().click();
  await page.waitForTimeout(4000);
  await openOrderManagement(page);
  const after = await orderNumbersInList(page);
  const fresh = after.find((n) => !before.includes(n));
  return fresh ?? after[0];
}

async function orderNumbersInList(page) {
  await page.getByRole("button", { name: "Order Management" }).click().catch(() => {});
  await page.waitForTimeout(2500);
  const rows = await page.locator("table tbody tr").allInnerTexts().catch(() => []);
  return rows.map((t) => (t.match(/ORD-\d{8}-\d{4}/) ?? [])[0]).filter(Boolean);
}

async function openRow(page, orderNo) {
  const row = page.locator("table tbody tr").filter({ hasText: orderNo }).first();
  await row.getByRole("button", { name: /^(Open|Continue) order/i }).click();
  await page.waitForTimeout(3000);
}

async function clickChip(page, id) {
  await page.locator(`[data-testid="status-filter-${id}"]`).click();
  await page.waitForTimeout(2500);
}

async function rowText(page, orderNo) {
  const row = page.locator("table tbody tr").filter({ hasText: orderNo }).first();
  if (!(await row.count())) return null;
  return (await row.innerText()).replace(/\n+/g, " | ");
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1000 } });
const page = await ctx.newPage();
page.on("response", (r) => {
  const u = r.url();
  if (/\/pos\/orders/.test(u) && (r.request().method() !== "GET" || /status/.test(u)))
    console.log(`    NET ${r.request().method()} ${r.status()} ${u.replace("http://localhost:8080", "")}`);
});

try {
  console.log("== sign in as manager@terrace.local ==");
  await login(page);

  // ─────────────────────────── VOID ───────────────────────────
  console.log("\n== A. ring an order and VOID it ==");
  const voidNo = await ringAndFire(page);
  console.log("  voided-order-to-be:", voidNo);

  await openRow(page, voidNo);
  await page.getByRole("button", { name: /void order/i }).first().click();
  await page.waitForTimeout(1200);
  const VOID_REASON = "Guest walked out before service";
  await page.locator('textarea[placeholder*="Customer left"]').first().fill(VOID_REASON);
  const [voidResp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/void") && r.request().method() === "POST", { timeout: 20000 }).catch(() => null),
    page.getByRole("button", { name: /confirm void/i }).click(),
  ]);
  console.log("  POST /void ->", voidResp ? voidResp.status() : "(not observed)");
  check("void succeeded (HTTP 200)", voidResp?.status() === 200);
  await page.waitForTimeout(3000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);

  // ─────────────────── chips + scope statement ───────────────────
  console.log("\n== B. the chip row ==");
  const chips = await page.locator("[data-testid^=status-filter-]").allInnerTexts();
  console.log("  chips:", JSON.stringify(chips.map((c) => c.trim())));
  check("a Voided chip exists", (await page.locator('[data-testid="status-filter-VOIDED"]').count()) === 1);
  check("a Refunded chip exists", (await page.locator('[data-testid="status-filter-REFUNDED"]').count()) === 1);

  const allChipLabel = (await page.locator('[data-testid="status-filter-ALL"]').innerText()).trim();
  const note = (await page.getByTestId("order-scope-note").innerText()).trim();
  console.log("  default chip label:", JSON.stringify(allChipLabel));
  console.log("  scope note:", JSON.stringify(note));
  check(
    "the default chip states plainly it is active-only and points to Voided",
    /active/i.test(allChipLabel) && /active shows live orders only/i.test(note) && /voided/i.test(note),
  );
  await shot(page, "01-chips-and-scope-note");

  // ─────────────────── the Voided chip lists it ───────────────────
  console.log("\n== C. the Voided chip ==");
  await clickChip(page, "VOIDED");
  const voidedRow = await rowText(page, voidNo);
  console.log("  row:", voidedRow);
  check(`Voided chip lists ${voidNo}`, voidedRow !== null);
  check("row carries a VOIDED status badge", /Voided/.test(voidedRow ?? ""));
  check("row carries the total", /Rs\s?[\d,]+\.\d\d/.test(voidedRow ?? ""));
  check("row carries the void reason", (voidedRow ?? "").includes(VOID_REASON));
  check("row carries who voided it", /by Terrace Manager/.test(voidedRow ?? ""));
  await shot(page, "02-voided-chip-lists-the-order");

  // ─────────────────────────── REFUND ───────────────────────────
  console.log("\n== D. ring an order, PAY it, then REFUND it ==");
  const refundNo = await ringAndFire(page);
  console.log("  refunded-order-to-be:", refundNo);

  await openRow(page, refundNo);
  await page.getByRole("button", { name: /charge order/i }).first().click();
  await page.waitForURL(/\/charge/, { timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.getByTestId("fill-full-amount-button").first().click();
  await page.waitForTimeout(800);
  const [payResp] = await Promise.all([
    page.waitForResponse((r) => /\/payments/.test(r.url()) && r.request().method() === "POST", { timeout: 20000 }).catch(() => null),
    page.getByTestId("record-payment-button").click(),
  ]);
  console.log("  POST /payments ->", payResp ? payResp.status() : "(not observed)");
  await page.waitForTimeout(3000);
  await shot(page, "03-charged");

  await openOrderManagement(page);
  await openRow(page, refundNo);
  await page.getByRole("button", { name: /refund order/i }).first().click();
  await page.waitForTimeout(1200);
  const REFUND_REASON = "Dish sent back cold";
  const refundReason = page.locator("textarea").last();
  await refundReason.fill(REFUND_REASON);
  await shot(page, "04-refund-panel");
  const [refundResp] = await Promise.all([
    page.waitForResponse((r) => /\/refund/.test(r.url()) && r.request().method() === "POST", { timeout: 20000 }).catch(() => null),
    page.getByRole("button", { name: /confirm refund/i }).click(),
  ]);
  console.log("  POST /refund ->", refundResp ? refundResp.status() : "(not observed)");
  check("refund succeeded (HTTP 200)", refundResp?.status() === 200);
  await page.waitForTimeout(3000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);

  console.log("\n== E. the Refunded chip ==");
  await clickChip(page, "REFUNDED");
  const refundedRow = await rowText(page, refundNo);
  console.log("  row:", refundedRow);
  check(`Refunded chip lists ${refundNo}`, refundedRow !== null);
  check("row carries a REFUNDED status badge", /Refunded/.test(refundedRow ?? ""));
  check("row carries the refund reason", (refundedRow ?? "").includes(REFUND_REASON));
  check("row carries who refunded it", /by Terrace Manager/.test(refundedRow ?? ""));
  await shot(page, "05-refunded-chip-lists-the-order");

  // ─────────────────────────── RELOAD ───────────────────────────
  console.log("\n== F. survive a full page reload ==");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await page.getByRole("button", { name: "Order Management" }).click();
  await page.waitForTimeout(3000);
  await clickChip(page, "VOIDED");
  const voidedAfterReload = await rowText(page, voidNo);
  check(`after reload, Voided still lists ${voidNo}`, voidedAfterReload !== null);
  check("after reload the reason is still shown", (voidedAfterReload ?? "").includes(VOID_REASON));
  await shot(page, "06-voided-after-reload");

  await clickChip(page, "REFUNDED");
  const refundedAfterReload = await rowText(page, refundNo);
  check(`after reload, Refunded still lists ${refundNo}`, refundedAfterReload !== null);
  await shot(page, "07-refunded-after-reload");

  // Active must still be active-only, and say so.
  await clickChip(page, "ALL");
  const activeHasVoid = (await rowText(page, voidNo)) !== null;
  const noteAfter = (await page.getByTestId("order-scope-note").innerText()).trim();
  console.log("  Active contains the voided order:", activeHasVoid, "| note:", JSON.stringify(noteAfter));
  check(
    "Active is honestly labelled active-only and points at Voided",
    !activeHasVoid && /active shows live orders only/i.test(noteAfter) && /voided/i.test(noteAfter),
  );
  await shot(page, "08-active-chip-states-its-scope");

  console.log("\n== SUMMARY ==");
  const failed = results.filter((r) => !r.ok);
  console.log(`  ${results.length - failed.length}/${results.length} checks passed`);
  failed.forEach((f) => console.log("  FAILED:", f.name));
  console.log("  voided order:", voidNo, "| refunded order:", refundNo);
  if (failed.length) process.exitCode = 1;
} catch (err) {
  console.error("HARNESS ERROR:", err.message);
  await shot(page, "zz-failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
