/*
 * F11 step 1 — reproduce, in a browser, "the manager opens the float and the cashier's
 * terminal still says No active till".
 *
 * Two real browser contexts, two real logins, no injected tokens.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, apiGet, apiSend, money } from "./lib.mjs";

const run = async () => {
  const browser = await newBrowser();

  // ── manager ────────────────────────────────────────────────────────────────
  const mgr = await newPage(browser);
  await login(mgr, PEOPLE.manager);
  const me = await apiGet(mgr, "/api/v1/auth/me");
  console.log("manager /me:", JSON.stringify(me.body?.data ?? me.body).slice(0, 600));

  let t = await go(mgr, "/app/pos", { waitMs: 5000 });
  console.log("manager /app/pos trouble:", JSON.stringify(t));
  await shot(mgr, "01-manager-pos");

  const strip = await mgr.evaluate(() => {
    const bar =
      document.querySelector('[data-testid="open-till-panel"]') ??
      document.querySelector('[data-testid="open-till-button"]')?.closest("div") ??
      document.querySelector('[data-testid="close-till-button"]')?.closest("div");
    return {
      text: (bar?.innerText ?? "").slice(0, 400),
      hasOpenBtn: !!document.querySelector('[data-testid="open-till-button"]'),
      hasCloseBtn: !!document.querySelector('[data-testid="close-till-button"]'),
    };
  });
  console.log("manager till strip:", JSON.stringify(strip));

  // ── cashier ────────────────────────────────────────────────────────────────
  const cash = await newPage(browser);
  await login(cash, PEOPLE.cashier);
  const cme = await apiGet(cash, "/api/v1/auth/me");
  console.log("cashier /me:", JSON.stringify(cme.body?.data ?? cme.body).slice(0, 600));

  t = await go(cash, "/app/pos", { waitMs: 5000 });
  console.log("cashier /app/pos trouble:", JSON.stringify(t));
  await shot(cash, "02-cashier-pos-before");

  const cstrip = await cash.evaluate(() => {
    const el = document.querySelector('[data-testid="open-till-button"]')?.closest("div");
    return {
      text: (el?.innerText ?? document.body.innerText.slice(0, 200)).slice(0, 300),
      hasOpenBtn: !!document.querySelector('[data-testid="open-till-button"]'),
      hasCloseBtn: !!document.querySelector('[data-testid="close-till-button"]'),
    };
  });
  console.log("cashier till strip BEFORE:", JSON.stringify(cstrip));

  // ── manager opens a Rs 5,000 float, in the browser ─────────────────────────
  if (strip.hasOpenBtn) {
    await mgr.locator('[data-testid="open-till-button"]').click();
    await mgr.waitForTimeout(700);
    await mgr.locator('[data-testid="open-till-panel"] input[type="number"]').fill("5000");
    await shot(mgr, "03-manager-open-till-panel");
    await mgr.locator('[data-testid="open-till-confirm-button"]').click();
    await mgr.waitForTimeout(3500);
    await shot(mgr, "04-manager-after-open");
  } else {
    console.log("!! manager already has an OPEN till — no Open Till button");
    await shot(mgr, "03-manager-already-open");
  }

  const mgrAfter = await mgr.evaluate(() => document.body.innerText.slice(0, 300));
  console.log("manager bar after:", JSON.stringify(mgrAfter.split("\n").slice(0, 8)));

  // ── cashier reloads ────────────────────────────────────────────────────────
  await go(cash, "/app/pos", { waitMs: 5000 });
  await shot(cash, "05-cashier-pos-after-manager-opened");
  const cstrip2 = await cash.evaluate(() => {
    const el = document.querySelector('[data-testid="open-till-button"]')?.closest("div");
    return {
      text: (el?.innerText ?? "").slice(0, 300),
      hasOpenBtn: !!document.querySelector('[data-testid="open-till-button"]'),
      hasCloseBtn: !!document.querySelector('[data-testid="close-till-button"]'),
      body: document.body.innerText.slice(0, 200),
    };
  });
  console.log("cashier till strip AFTER:", JSON.stringify(cstrip2));

  // ── server truth ───────────────────────────────────────────────────────────
  const mgrId = me.body?.data?.userId ?? me.body?.data?.id;
  const cashId = cme.body?.data?.userId ?? cme.body?.data?.id;
  const branchId = me.body?.data?.branchId;
  console.log("mgrId", mgrId, "cashId", cashId, "branchId", branchId);

  const mgrTills = await apiGet(mgr, `/api/v1/pos/tills?cashierId=${mgrId}&status=OPEN`);
  const cashTills = await apiGet(cash, `/api/v1/pos/tills?cashierId=${cashId}&status=OPEN`);
  console.log("tills(cashierId=manager):", JSON.stringify(mgrTills.body).slice(0, 700));
  console.log("tills(cashierId=cashier):", JSON.stringify(cashTills.body).slice(0, 700));

  // Can the manager name a target cashier at all today?
  const probe = await apiSend(mgr, "POST", "/api/v1/pos/tills", {
    branchId,
    openingFloatPaisa: 500000,
    cashierId: cashId,
  });
  console.log("POST /tills with cashierId=<cashier> as manager:", probe.status, JSON.stringify(probe.body).slice(0, 500));

  await browser.close();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
