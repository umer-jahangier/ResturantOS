// S0-05 browser proof — order search must reach the SERVER, across every status.
//
//   node e2e/diag/s0-05-proof.mjs after
//
// Everything below is done as manager@terrace.local by clicking the real app:
//   1. ring an order and Send to Kitchen  -> note its number -> VOID it from the drawer
//   2. ring a second order, attach a CRM customer by phone, Send to Kitchen
//   3. with the Active chip untouched, search the VOIDED number, a CLOSED number and the
//      customer's phone, recording every /api/v1/pos/orders request that leaves the browser
//
// A render with no `?q=` on the wire is a fail here, not a pass.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const LABEL = process.argv[2] ?? "after";
const OUT = resolve(process.cwd(), "../.planning/audits/repair/S0-05", LABEL);
const BASE = "http://localhost:3000";

const MANAGER = { email: "manager@terrace.local", password: "Terrace#Manager1" };
const CUSTOMER_PHONE = "03009824573";

const log = [];
function say(...a) {
  const line = a.join(" ");
  console.log(line);
  log.push(line);
}

async function shot(page, name) {
  const file = `${OUT}/${name}.png`;
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: false });
  say("  shot ->", `${name}.png`);
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.locator('input[name="email"]').first().fill(MANAGER.email);
  await page.locator('input[name="password"]').first().fill(MANAGER.password);
  await page.getByTestId("login-submit").click();
  await page.waitForTimeout(5000);
  if (page.url().includes("/login")) throw new Error("login failed");
  say("signed in as manager");
}

async function openOrdersTab(page) {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "Order Management" }).click();
  await page.waitForTimeout(2500);
}

async function openTerminalTab(page) {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "POS Terminal" }).click();
  await page.waitForTimeout(2500);
}

async function rows(page) {
  return page.$$eval("table tbody tr", (trs) =>
    trs.map((tr) =>
      Array.from(tr.querySelectorAll("td"))
        .map((td) => td.innerText.replace(/\s+/g, " ").trim())
        .join(" | "),
    ),
  );
}

/** Rings one menu item and fires it. Returns the new order number. */
async function ringAndSend(page, { withCustomerPhone } = {}) {
  await openTerminalTab(page);

  if (withCustomerPhone) {
    await page.getByRole("button", { name: "Add customer" }).click();
    await page.waitForTimeout(600);
    await page.getByLabel("Search for a customer").fill(withCustomerPhone);
    await page.waitForTimeout(2500);
    const result = page.locator("ul li button").first();
    await result.click();
    await page.waitForTimeout(800);
    say(`  attached customer ${withCustomerPhone}`);
  }

  await page.getByTestId("menu-item-first").click();
  await page.waitForTimeout(1200);

  // The order NUMBER is minted server-side at send-to-kds, so read it off that response
  // rather than guessing it from the DOM.
  const fired = page.waitForResponse(
    (r) => r.url().includes("/send-to-kds") && r.request().method() === "POST",
    { timeout: 30000 },
  );
  await page.getByRole("button", { name: /Send to Kitchen/i }).click();
  let created = null;
  try {
    const body = await (await fired).json();
    created = body?.data?.orderNo ?? null;
  } catch (e) {
    say("  ! could not read send-to-kds response:", String(e).slice(0, 120));
  }
  await page.waitForTimeout(3000);
  say(`  fired order -> ${created ?? "(number not observed)"}`);
  return created;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();

  const netlog = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("/api/v1/pos/orders")) netlog.push(u.replace("http://localhost:8080", ""));
  });
  page.on("pageerror", (e) => say("  ! page error:", String(e).slice(0, 160)));

  await login(page);

  // A previous run may already have created the fixture (the frontend dev server hot-reloads
  // while ten agents edit it, so the setup half is worth being able to skip).
  const preset = JSON.parse(process.env.S0_05_FIXTURE ?? "{}");
  if (preset.voidedNo) {
    say(`reusing fixture voided=${preset.voidedNo} closed=${preset.closedNo}`);
    return await proveSearch(page, netlog, preset.voidedNo, preset.closedNo, null, ctx, browser);
  }

  // ── 1. Ring an order, then VOID it from the Order Management drawer ─────────
  say("STEP 1 — ring an order and void it");
  const toVoid = await ringAndSend(page);
  await openOrdersTab(page);
  await page.waitForTimeout(1500);

  let voidedNo = toVoid;
  if (toVoid) {
    // The row action's accessible name is "Open order ORD-…", not "Open".
    const row = page.locator("table tbody tr", { hasText: toVoid });
    await row.getByRole("button", { name: new RegExp(`Open order ${toVoid}`) }).click();
    await page.waitForTimeout(2500);
    await shot(page, "10-drawer-before-void");
    await page.getByLabel("Void order").click();
    await page.waitForTimeout(1200);
    await page.getByPlaceholder("e.g. Customer left without ordering").fill("S0-05 proof void");
    await page.getByRole("button", { name: /Confirm Void/i }).click();
    await page.waitForTimeout(4000);
    await shot(page, "11-after-void");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
  }
  say(`  voided order = ${voidedNo}`);

  // ── 2. Ring a second order with a CRM customer attached ────────────────────
  say("STEP 2 — ring an order with a customer attached");
  const withCustomer = await ringAndSend(page, { withCustomerPhone: CUSTOMER_PHONE });
  say(`  customer order = ${withCustomer}`);

  // ── 3. A CLOSED order to search for. Closing through the settlement screen is
  //       S0-06's surface; here we take the newest already-CLOSED check from the
  //       Closed chip, which is a real row a manager can point at.
  say("STEP 3 — pick a CLOSED order from the Closed chip");
  await openOrdersTab(page);
  await page.getByTestId("status-filter-CLOSED").click();
  await page.waitForTimeout(3000);
  const closedRows = await rows(page);
  const closedNo = (closedRows.join(" ").match(/ORD-\d{8}-\d{4}/) ?? [null])[0];
  say(`  closed order = ${closedNo}`);
  await shot(page, "20-closed-chip");

  return await proveSearch(page, netlog, voidedNo, closedNo, withCustomer, ctx, browser);
}

async function proveSearch(page, netlog, voidedNo, closedNo, withCustomer, ctx, browser) {
  await openOrdersTab(page);
  // Back to the Active chip. Every search below happens with THIS chip selected.
  await page.getByTestId("status-filter-ALL").click();
  await page.waitForTimeout(2500);
  await shot(page, "21-active-chip-baseline");
  say(`  Active chip rows: ${(await rows(page)).length}`);

  const search = page.getByTestId("order-management-search");
  const results = {};

  async function probe(term, name, expectBadge) {
    netlog.length = 0;
    await search.fill("");
    await page.waitForTimeout(600);
    await search.fill(term);
    await page.waitForTimeout(3500);
    const r = await rows(page);
    const alerts = await page.locator('[role="alert"]').count();
    const chip = await page
      .getByTestId("status-filter-ALL")
      .evaluate((el) => el.className.includes("bg-primary"));
    const badge = expectBadge ? await page.getByLabel(expectBadge).count() : 0;
    const serverHits = netlog.filter((u) => u.includes("q="));
    say(
      `search "${term}" -> rows=${r.length} activeChipStillSelected=${chip} roleAlert=${alerts} ` +
        `${expectBadge ? `${expectBadge}Badge=${badge} ` : ""}` +
        `posOrdersRequests=${netlog.length} withQ=${serverHits.length}`,
    );
    for (const line of r.slice(0, 4)) say(`     ${line}`);
    for (const u of serverHits.slice(0, 4)) say(`     NET ${u}`);
    await shot(page, name);
    return { term, rows: r, badge, chipStillActive: chip, alerts, serverHits };
  }

  // The FULL order number, exactly as a manager reads it off the check.
  if (voidedNo) results.voided = await probe(voidedNo, "30-search-voided", "Voided");
  if (closedNo) results.closed = await probe(closedNo, "31-search-closed", "Closed");
  // ...and the tail alone, which is what most people actually type.
  if (voidedNo) results.voidedTail = await probe(voidedNo.slice(-4), "34-search-voided-tail", "Voided");
  results.phone = await probe(CUSTOMER_PHONE, "32-search-phone");
  results.miss = await probe("zzz-no-such-order", "33-search-no-match");

  writeFileSync(
    `${OUT}/RESULT.json`,
    JSON.stringify({ voidedNo, closedNo, withCustomer, results }, null, 2),
  );
  writeFileSync(`${OUT}/RUN-LOG.txt`, log.join("\n") + "\n");
  say("evidence ->", OUT);

  await ctx.close();
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  writeFileSync(`${OUT}/RUN-LOG.txt`, log.join("\n") + "\nFAILED: " + String(e) + "\n");
  process.exit(1);
});
