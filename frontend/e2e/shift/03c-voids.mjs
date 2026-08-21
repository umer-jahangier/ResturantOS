/*
 * SHIFT STEP 3c — the two voids, and a discount driven at the API since no screen offers one.
 *
 *  - order 3: rung, fired, UNPAID -> void it from the screen a cashier/manager actually has.
 *  - order 1: PAID -> try to void. Refused or reversed; read the payment rows either way.
 *  - discount: POST with a VALID body as cashier and as manager, to learn whether the
 *    missing screen is the only thing missing.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, finding, apiGet, apiSend, log, BASE } from "./lib.mjs";

const st = loadState();
const NEW = st.newCashier;
const browser = await newBrowser();

async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(NEW.slug);
  await page.locator('input[name="email"], input#email').first().fill(NEW.email);
  await page.locator('input[name="password"], input#password').first().fill(NEW.newPassword);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  log("  ✓", NEW.email);
}
async function openOrderMgmt(page) {
  await go(page, "/app/pos", { waitMs: 7000 });
  await page.getByText("Order Management", { exact: true }).click();
  await page.waitForTimeout(4000);
}
async function search(page, no) {
  await page.locator("[data-testid=order-management-search]").first().fill(no);
  await page.waitForTimeout(4000);
  return page.evaluate((n) => {
    const t = document.body.innerText;
    const i = t.indexOf(n);
    const btn = document.querySelector('[data-testid^="open-order-"]');
    return {
      row: i >= 0 ? t.slice(Math.max(0, i - 30), i + 260).replace(/\s+/g, " ") : null,
      orderId: btn?.getAttribute("data-testid")?.replace("open-order-", "") ?? null,
    };
  }, no);
}

const cash = await newPage(browser);
await signIn(cash);

// ── ring a third check to void ────────────────────────────────────────────────
log("\n=== order 3: rung and fired, left unpaid ===");
await go(cash, "/app/pos", { waitMs: 7000 });
const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().waitFor({ timeout: 20000 });
await tiles.nth(5).click();
await cash.waitForTimeout(300);
await tiles.nth(6).click();
await cash.waitForTimeout(700);
await cash.locator("[data-testid=send-to-kitchen-button]").click();
await cash.waitForTimeout(6500);
const nos = await cash.evaluate(() =>
  Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0]))),
);
const order3No = nos.find((n) => n !== st.order1No && n !== st.order2No) ?? nos[0];
log("  order 3 =", order3No);
saveState({ order3No });
await shot(cash, "03g-order3-fired");

// ── void the UNPAID check ─────────────────────────────────────────────────────
log("\n=== 3d. void the UNPAID check ===");
await openOrderMgmt(cash);
const f3 = await search(cash, order3No);
log("  order 3 row:", JSON.stringify(f3));
saveState({ order3Id: f3.orderId });
await cash.locator(`[data-testid="open-order-${f3.orderId}"]`).click();
await cash.waitForTimeout(3500);
const drawer3 = await cash.evaluate(() => {
  const d = document.querySelector("[data-testid=order-table-detail-drawer]");
  return d ? { buttons: Array.from(d.querySelectorAll("button")).map((b) => b.textContent.trim()), text: d.innerText.replace(/\s+/g, " ").slice(0, 400) } : null;
});
log("  drawer actions:", JSON.stringify(drawer3?.buttons));
await shot(cash, "03h-order3-drawer");

const voidBtn = cash.getByRole("button", { name: /^Void$/i });
log("  Void button count:", await voidBtn.count());
if (await voidBtn.count()) {
  await voidBtn.first().click();
  await cash.waitForTimeout(2000);
  await shot(cash, "03i-void-panel");
  const panel = await cash.evaluate(() => {
    const p = document.querySelector("[data-testid=void-refund-panel]");
    return p
      ? {
          text: p.innerText.replace(/\s+/g, " ").trim().slice(0, 700),
          inputs: Array.from(p.querySelectorAll("input,textarea,select")).map((n) => n.getAttribute("aria-label") || n.getAttribute("placeholder") || n.name || n.tagName),
          buttons: Array.from(p.querySelectorAll("button")).map((b) => b.textContent.trim()),
        }
      : null;
  });
  log("  void panel:", JSON.stringify(panel, null, 1));
  saveState({ voidPanelUnpaid: panel });
  // give a reason and confirm
  const reason = cash.locator("[data-testid=void-refund-panel] textarea, [data-testid=void-refund-panel] input[type=text]");
  if (await reason.count()) {
    await reason.first().fill("Guest walked out before service — shift walkthrough");
    await cash.waitForTimeout(400);
  }
  await shot(cash, "03j-void-reason-typed");
  const confirm = cash.locator("[data-testid=void-refund-panel] button").filter({ hasText: /void/i });
  log("  confirm candidates:", await confirm.count());
  if (await confirm.count()) {
    await confirm.last().click();
    await cash.waitForTimeout(5000);
  }
  await shot(cash, "03k-after-void");
  const res = await cash.evaluate(() => ({
    err: document.querySelector("[data-testid=void-error]")?.textContent?.trim() ?? null,
    toasts: Array.from(document.querySelectorAll("[data-sonner-toast]")).map((n) => n.innerText.trim()),
    body: document.body.innerText.replace(/\s+/g, " ").slice(0, 400),
  }));
  log("  after void:", JSON.stringify(res, null, 1));
  saveState({ voidUnpaidResult: res });
}
const o3 = await apiGet(cash, `/api/v1/pos/orders/${f3.orderId}?branchId=${st.branchId ?? ""}`);
log("  order 3 after void (api):", JSON.stringify(o3.body).slice(0, 400));

// ── try to void the PAID check ────────────────────────────────────────────────
log("\n=== 3e. try to void the PAID check ===");
await openOrderMgmt(cash);
const f1 = await search(cash, st.order1No);
log("  order 1 row now:", JSON.stringify(f1));
await cash.locator(`[data-testid="open-order-${f1.orderId}"]`).click();
await cash.waitForTimeout(3500);
const drawer1 = await cash.evaluate(() => {
  const d = document.querySelector("[data-testid=order-table-detail-drawer]");
  return d ? { buttons: Array.from(d.querySelectorAll("button")).map((b) => b.textContent.trim()), text: d.innerText.replace(/\s+/g, " ").slice(0, 600) } : null;
});
log("  paid-order drawer:", JSON.stringify(drawer1, null, 1));
await shot(cash, "03l-paid-order-drawer");
saveState({ paidOrderDrawer: drawer1 });

// the API, with the cashier's own live bearer
const voidApi = await apiSend(cash, "POST", `/api/v1/pos/orders/${f1.orderId}/void`, {
  reason: "shift walkthrough — direct void on a paid check",
});
log("  POST /void as cashier on a PAID check →", voidApi.status, JSON.stringify(voidApi.body).slice(0, 300));
saveState({ voidPaidApiCashier: { status: voidApi.status, body: voidApi.body } });

// and as the MANAGER, who does hold pos.void
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
await go(mgr, "/app/pos", { waitMs: 6000 });
const voidApiMgr = await apiSend(mgr, "POST", `/api/v1/pos/orders/${f1.orderId}/void`, {
  reason: "shift walkthrough — manager void on a paid check",
});
log("  POST /void as manager on a PAID check →", voidApiMgr.status, JSON.stringify(voidApiMgr.body).slice(0, 300));
saveState({ voidPaidApiManager: { status: voidApiMgr.status, body: voidApiMgr.body } });

const payAfter = await apiGet(cash, `/api/v1/pos/orders/${f1.orderId}/payments`);
log("  payments on the paid check AFTER the void attempts:", JSON.stringify(payAfter.body).slice(0, 700));
saveState({ order1PaymentsAfterVoid: payAfter.body });

// ── discount with a VALID body ────────────────────────────────────────────────
log("\n=== 3c(bis). discount over the API with a valid body ===");
for (const [who, page] of [["cashier", cash], ["manager", mgr]]) {
  for (const scope of ["ORDER", "LINE"]) {
    const r = await apiSend(page, "POST", `/api/v1/pos/orders/${st.order3Id ?? f3.orderId}/discounts`, {
      scope,
      type: "PERCENT",
      value: 10,
    });
    log(`  ${who} scope=${scope} →`, r.status, JSON.stringify(r.body).slice(0, 220));
    saveState({ [`discount_${who}_${scope}`]: { status: r.status, body: r.body } });
  }
}

await browser.close();
log("\nstep 3c done");
