/*
 * F13-B — the void-409 refusal, re-driven per persona after the copy fix.
 *
 * The race, by clicking, no contrivance (this is 99-adjacent.mjs section B, split out and run
 * for BOTH personas on ONE order so the two sentences can be compared side by side):
 *
 *   1. the cashier rings and fires a takeaway check and opens it in Order Management —
 *      Void is genuinely on offer, because no money is on it yet;
 *   2. a manager, in a SEPARATE tab, opens the same still-unpaid check — Void on offer there too;
 *   3. the money lands elsewhere: a second manager context takes the full amount on the charge
 *      page (another till / the guest pays the manager — the ordinary two-person case);
 *   4. neither of the two waiting tabs is ever reloaded. Each presses the Void still on its
 *      screen. The server refuses with 409 and each drawer prints its refusal.
 *
 * What is being measured is the pairing, not the copy: the sentence each reader gets, against
 * whether `[aria-label="Refund order"]` exists anywhere on that same screen.
 */
import {
  PEOPLE, newBrowser, newPage, go, apiGet, branchOf, log, BASE,
  shot, saveState, openInOrderManagement, ensureTill, payInFullByClicking,
} from "./lib.mjs";

/*
 * lib.mjs's `login` gives the form a flat 4s and calls it failed — which it now routinely is,
 * because this is a Next dev server other sessions are editing and /login recompiles for longer
 * than that. Same polling shape as 99-adjacent.mjs: retry, and wait for the URL to leave /login
 * rather than for a fixed number of seconds. Neither persona has TOTP (scripts/CREDENTIALS.md).
 */
async function signIn(page, who, tries = 3) {
  for (let a = 1; a <= tries; a++) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForTimeout(2500);
      const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
      if (await slug.count()) await slug.first().fill(who.slug);
      await page.locator('input[name="email"], input#email').first().fill(who.email);
      await page.locator('input[name="password"], input#password').first().fill(who.password);
      await page.locator('button[type="submit"]').first().click();
      for (let i = 0; i < 25; i++) {
        await page.waitForTimeout(1000);
        if (!page.url().includes("/login")) break;
      }
      if (!page.url().includes("/login")) { log(`  ✓ ${who.email}`); return page; }
    } catch { /* retry */ }
  }
  throw new Error(`login failed for ${who.email}`);
}

async function probe(page, where) {
  return page.evaluate((w) => ({
    where: w,
    url: location.href,
    voidError: document.querySelector("[data-testid=void-error]")?.textContent?.trim() ?? null,
    notice: document.querySelector("[data-testid=void-blocked-paid-notice]")?.textContent?.trim() ?? null,
    refundTrigger: !!document.querySelector('[aria-label="Refund order"]'),
    voidTrigger: !!document.querySelector('[aria-label="Void order"]'),
    panelOpen: !!document.querySelector("[data-testid=void-refund-panel]"),
  }), where);
}

async function ringAndFire(page, label) {
  await go(page, "/app/pos", { waitMs: 9000 });
  await page.locator("[data-testid=order-type-takeaway]").waitFor({ timeout: 30000 });
  await page.locator("[data-testid=order-type-takeaway]").click();
  await page.waitForTimeout(700);
  const grid = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await grid.first().waitFor({ timeout: 30000 });
  let added = 0;
  for (let i = 0; i < 12 && added < 2; i++) {
    if (!(await grid.nth(i).count())) break;
    await grid.nth(i).click({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(900);
    if (await page.locator("[data-testid=modifier-dialog]").count()) {
      const opts = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid^="modifier-group-"]'))
          .map((f) => Array.from(f.querySelectorAll('[data-testid^="modifier-option-"]'))
            .map((b) => b.getAttribute("data-testid"))[0]).filter(Boolean));
      for (const o of opts) {
        await page.locator(`[data-testid="${o}"]`).click().catch(() => {});
        await page.waitForTimeout(250);
      }
      const add = page.locator("[data-testid=modifier-dialog-add]");
      if ((await add.getAttribute("aria-disabled")) === "true") {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(600);
        continue;
      }
      await add.click();
      await page.waitForTimeout(1200);
    }
    added++;
  }
  await page.waitForTimeout(800);
  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(7500);
  await shot(page, `${label}-fired`);
  const orderNo = await page.evaluate(() => (document.body.innerText.match(/ORD-\d{8}-\d+/g) || [null])[0]);
  const branch = await branchOf(page);
  const list = await apiGet(page, `/api/v1/pos/orders?branchId=${branch}&size=25`);
  const o = (list.body?.data ?? []).find((r) => r.orderNo === orderNo) ?? null;
  log(`  fired ${o?.orderNo} id=${o?.orderId}`);
  return { orderNo: o?.orderNo ?? orderNo, orderId: o?.orderId ?? null };
}

/** Press the Void that is still on this tab's screen, and read the refusal. */
async function pressVoid(page, who, label) {
  await page.locator('[aria-label="Void order"]').click();
  await page.waitForTimeout(1500);
  await page.locator("[data-testid=void-refund-panel] textarea").first().fill("Guest changed their mind");
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /confirm void/i }).click();
  await page.waitForTimeout(6000);
  const p = await probe(page, `${who}-after-409`);
  await shot(page, label);
  log(`  ${who} after pressing Void: ${JSON.stringify(p)}`);
  return p;
}

const results = []; const fails = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
}

const browser = await newBrowser();
const findings = {};

const cashier = await newPage(browser);       // rings it, then waits with a stale screen
const managerWait = await newPage(browser);   // watches the same unpaid check, stale screen
const managerPay = await newPage(browser);    // takes the money on the charge page

await signIn(cashier, PEOPLE.cashier);
await signIn(managerWait, PEOPLE.manager);
await signIn(managerPay, PEOPLE.manager);

// 1. the cashier rings and fires, on their own till.
await ensureTill(cashier, go);
const fired = await ringAndFire(cashier, "v1");
if (!fired.orderId) { log("could not fire an order"); process.exit(1); }
saveState({ v409OrderNo: fired.orderNo, v409OrderId: fired.orderId });

// 2. both waiting tabs open the still-unpaid check. Void is genuinely on offer on both.
const cashierId = await openInOrderManagement(cashier, fired.orderNo);
const beforeCashier = await probe(cashier, "cashier-unpaid");
await shot(cashier, "v2a-cashier-void-on-offer");
check("the cashier's drawer offers Void on the unpaid fired check",
  beforeCashier.voidTrigger === true, JSON.stringify(beforeCashier));

const managerId = await openInOrderManagement(managerWait, fired.orderNo);
const beforeManager = await probe(managerWait, "manager-unpaid");
await shot(managerWait, "v2b-manager-void-on-offer");
check("the manager's drawer offers Void on the same unpaid check",
  beforeManager.voidTrigger === true, JSON.stringify(beforeManager));
log(`  order rows: cashier=${cashierId} manager=${managerId}`);

// 3. the money lands somewhere else entirely.
const pay = await payInFullByClicking(managerPay, fired.orderId, "v3");
const pays = await apiGet(managerPay, `/api/v1/pos/orders/${fired.orderId}/payments`);
const sumPaisa = (pays.body?.data ?? []).reduce((a, p) => a + (p.amountPaisa ?? 0), 0);
check("money really is on the check now", sumPaisa > 0, `sumPaisa=${sumPaisa} ${JSON.stringify(pay.paid)}`);

// 4. neither waiting tab was reloaded. Each presses the Void still on its screen.
await cashier.waitForTimeout(2500);
const stillCashier = await probe(cashier, "cashier-unreloaded");
const stillManager = await probe(managerWait, "manager-unreloaded");
check("the cashier's un-reloaded tab still offers the stale Void", stillCashier.voidTrigger === true,
  JSON.stringify(stillCashier));
check("the manager's un-reloaded tab still offers the stale Void", stillManager.voidTrigger === true,
  JSON.stringify(stillManager));

if (stillCashier.voidTrigger) {
  const after = await pressVoid(cashier, "cashier", "v4a-cashier-void-409");
  findings.cashier409 = after;
  const err = after.voidError ?? "";
  check("CASHIER: the void was refused (the server protected the money)", /paid/i.test(err), err);
  check("CASHIER: is NOT told to press a Refund button that is not on the screen",
    !(/use refund/i.test(err) && after.refundTrigger === false),
    `err=${JSON.stringify(err)} refundButtonOnScreen=${after.refundTrigger}`);
  check("CASHIER: is told a manager must refund it", /manager/i.test(err), err);
  check("CASHIER: still learns the payment would survive a void",
    /payment in place/i.test(err), err);
} else {
  check("CASHIER: reached the 409 branch", false, "the drawer refetched before the click");
}

if (stillManager.voidTrigger) {
  const after = await pressVoid(managerWait, "manager", "v4b-manager-void-409");
  findings.manager409 = after;
  const err = after.voidError ?? "";
  check("MANAGER: the void was refused too", /paid/i.test(err), err);
  check("MANAGER: keeps the Use Refund instruction, which they can act on",
    /use refund/i.test(err), err);
  check("MANAGER: is not sent to find themselves", !/manager/i.test(err), err);
} else {
  check("MANAGER: reached the 409 branch", false, "the drawer refetched before the click");
}

// The permission itself must be untouched: whatever the copy says, the cashier still has no
// Refund control anywhere once the drawer does catch up.
await cashier.reload({ waitUntil: "domcontentloaded" });
await cashier.waitForTimeout(6000);
const reopened = await openInOrderManagement(cashier, fired.orderNo);
const reloaded = await probe(cashier, "cashier-reloaded");
await shot(cashier, "v5-cashier-after-reload");
log(`  reopened row ${reopened}: ${JSON.stringify(reloaded)}`);
findings.cashierReloaded = reloaded;
check("pos.order.refund was NOT widened — still no Refund control for the cashier",
  reloaded.refundTrigger === false, JSON.stringify(reloaded));

await browser.close();
saveState({ f13bVoid409: findings, f13bVoid409Results: results });
log("\n==========================================");
log(fails.length ? `FAILED (${fails.length}): ${fails.join(" | ")}` : "ALL CHECKS PASS");
log("==========================================");
process.exit(fails.length ? 1 : 0);
