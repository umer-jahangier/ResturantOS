/*
 * F13 re-open, part 4 — the adjacent paths.
 *
 * (A) The SETTLED check. The fix's second claim: on a CLOSED (paid AND served) check a cashier
 *     used to get an empty action row and now reads "Paid — a manager must refund this check."
 *     Driven by clicking Mark Served on every line until the header chip says Closed.
 *
 * (B) The VOID 409 ERROR STRING, 110 lines below the notice in the same file:
 *
 *       "This order has been paid — use Refund. A void would leave the payment in place."
 *
 *     That is the finding's own sentence — "the cashier is told to Use Refund" — rendered to a
 *     cashier who has no Refund button, and the fix did not touch it. Reachable without any
 *     contrivance: the cashier has the check open, the money lands (second till, the guest pays
 *     the manager, a queued tender), their drawer still offers Void because its payments query
 *     has not refetched, they press it, and the server refuses with 409. Driven here with two
 *     REAL browser contexts, cashier and manager, on one order.
 */
import { createHmac } from "node:crypto";
import {
  PEOPLE, newBrowser, newPage, go, apiGet, tokenOf, branchOf, orderRow,
  openInOrderManagement, log, BASE, shot, loadState, saveState, payInFullByClicking,
} from "./lib.mjs";

function totpNow(secret) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0; const out = [];
  for (const c of secret.replace(/=+$/, "").toUpperCase()) {
    const i = A.indexOf(c); if (i === -1) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0); buf.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", Buffer.from(out)).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const c = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(c % 1_000_000).padStart(6, "0");
}
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
        const t = page.locator('input[name="totpCode"], input#totpCode');
        if (await t.count()) {
          await t.first().fill(totpNow(who.totpSecret));
          await page.locator('button[type="submit"]').first().click();
          await page.waitForTimeout(4000);
        }
        if (!page.url().includes("/login")) break;
      }
      if (!page.url().includes("/login")) { log(`  ✓ ${who.email}`); return page; }
    } catch { /* retry */ }
  }
  throw new Error(`login failed for ${who.email}`);
}
async function probe(page, where) {
  return page.evaluate((w) => {
    const n = document.querySelector("[data-testid=void-blocked-paid-notice]");
    const row = n?.parentElement ?? null;
    return {
      where: w, url: location.href,
      notice: n?.textContent?.trim() ?? null,
      readerCanRefundAttr: n?.getAttribute("data-reader-can-refund") ?? null,
      refundTrigger: !!document.querySelector('[aria-label="Refund order"]'),
      voidTrigger: !!document.querySelector('[aria-label="Void order"]'),
      voidError: document.querySelector("[data-testid=void-error]")?.textContent?.trim() ?? null,
      paidChip: document.querySelector("[data-testid=paid-chip]")?.textContent?.trim() ?? null,
      emptyActionRow: row ? row.children.length === 0 : null,
      statusChip: (document.body.innerText.match(/\b(Closed|In Progress|Served|Voided|Refunded)\b/) || [null])[0],
    };
  }, where);
}
async function ringAndFireB(page, { tiles = 2, label = "x" } = {}) {
  await go(page, "/app/pos", { waitMs: 9000 });
  await page.locator("[data-testid=order-type-takeaway]").waitFor({ timeout: 30000 });
  await page.locator("[data-testid=order-type-takeaway]").click();
  await page.waitForTimeout(700);
  const grid = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await grid.first().waitFor({ timeout: 30000 });
  let added = 0;
  for (let i = 0; i < 12 && added < tiles; i++) {
    if (!(await grid.nth(i).count())) break;
    await grid.nth(i).click({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(900);
    if (await page.locator("[data-testid=modifier-dialog]").count()) {
      const opts = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid^="modifier-group-"]'))
          .map((f) => Array.from(f.querySelectorAll('[data-testid^="modifier-option-"]'))
            .map((b) => b.getAttribute("data-testid"))[0]).filter(Boolean));
      for (const o of opts) { await page.locator(`[data-testid="${o}"]`).click().catch(() => {}); await page.waitForTimeout(250); }
      const add = page.locator("[data-testid=modifier-dialog-add]");
      if ((await add.getAttribute("aria-disabled")) === "true") { await page.keyboard.press("Escape"); await page.waitForTimeout(600); continue; }
      await add.click(); await page.waitForTimeout(1200);
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

const results = []; const fails = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
}

const browser = await newBrowser();
const st = loadState();
const findings = {};

// ───────────────────────── (A) the SETTLED, CLOSED check ─────────────────────────
log("\n=== (A) the settled CLOSED check ===");
{
  const cashier = await newPage(browser);
  await signIn(cashier, PEOPLE.cashier);
  const ORDER_NO = st.bOrderNo;
  const id = await openInOrderManagement(cashier, ORDER_NO);
  if (!id) { check("A: found the paid check", false); }
  else {
    // Mark every line served — the click path that closes a paid ticket.
    for (let round = 0; round < 6; round++) {
      const btns = cashier.getByRole("button", { name: /^Mark Served$/i });
      const n = await btns.count();
      if (!n) break;
      await btns.first().click().catch(() => {});
      await cashier.waitForTimeout(3500);
    }
    await cashier.waitForTimeout(4000);
    const row = await orderRow(cashier, ORDER_NO);
    log("  server status now:", row?.status ?? row?.settlementStatus, JSON.stringify(row?.derivedStatus));
    const closed = await probe(cashier, "cashier-closed-drawer");
    log("  cashier, settled:", JSON.stringify(closed));
    await shot(cashier, "r6-cashier-settled-drawer");
    findings.settledCashier = { serverStatus: row?.status ?? row?.settlementStatus, probe: closed };

    const isClosed = (row?.status ?? row?.settlementStatus) === "CLOSED";
    check("A: the check really did settle to CLOSED by clicking", isClosed,
      `status=${row?.status ?? row?.settlementStatus}`);
    if (isClosed) {
      check("A: the cashier is NOT left with an empty action row",
        closed.notice !== null && closed.emptyActionRow === false, JSON.stringify(closed.notice));
      check("A: the cashier is told a manager must refund it",
        /manager/i.test(closed.notice ?? ""), JSON.stringify(closed.notice));
      check("A: the cashier is NOT told to press Refund",
        !/use refund/i.test(closed.notice ?? ""), JSON.stringify(closed.notice));
      check("A: no Refund button for the cashier (permission not widened)",
        closed.refundTrigger === false);
    }
  }
  await cashier.context().close();
}

// ───────── (B) the void-409 error string: the SAME defect, untouched by the fix ─────────
log("\n=== (B) the void 409 error string ===");
{
  const cashier = await newPage(browser);
  const manager = await newPage(browser);
  await signIn(cashier, PEOPLE.cashier);
  await signIn(manager, PEOPLE.manager);

  const fired = await ringAndFireB(cashier, { tiles: 2, label: "r7" });
  saveState({ bRaceOrderNo: fired.orderNo, bRaceOrderId: fired.orderId });

  // The cashier opens the check while it is still unpaid — Void is genuinely on offer.
  const id = await openInOrderManagement(cashier, fired.orderNo);
  const before = await probe(cashier, "cashier-unpaid-drawer");
  log("  cashier before the money lands:", JSON.stringify(before));
  await shot(cashier, "r7a-cashier-void-on-offer");
  check("B: the cashier's drawer offers Void on an unpaid fired check",
    before.voidTrigger === true, JSON.stringify(before));

  // The money lands somewhere else — the manager takes it on the charge page.
  const pay = await payInFullByClicking(manager, fired.orderId, "r7b");
  log("  manager took the money:", JSON.stringify(pay).slice(0, 200));
  const pays = await apiGet(manager, `/api/v1/pos/orders/${fired.orderId}/payments`);
  const sum = (pays.body?.data ?? []).reduce((a, p) => a + (p.amountPaisa ?? 0), 0);
  check("B: money really is on the check now", sum > 0, `sumPaisa=${sum}`);

  // The cashier's tab was never reloaded. They press the Void that is still on their screen.
  await cashier.waitForTimeout(2500);
  const stillThere = await probe(cashier, "cashier-drawer-after-payment-elsewhere");
  log("  cashier's screen, unreloaded:", JSON.stringify(stillThere));
  if (stillThere.voidTrigger) {
    await cashier.locator('[aria-label="Void order"]').click();
    await cashier.waitForTimeout(1500);
    await cashier.locator("[data-testid=void-refund-panel] textarea").first().fill("Guest changed their mind");
    await cashier.waitForTimeout(500);
    await cashier.getByRole("button", { name: /confirm void/i }).click();
    await cashier.waitForTimeout(6000);
    const after = await probe(cashier, "cashier-after-409");
    await shot(cashier, "r7c-cashier-void-409");
    log("  cashier after pressing Void:", JSON.stringify(after));
    findings.void409 = after;
    const err = after.voidError ?? "";
    check("B: the void was refused (the server protected the money)", /paid|refund/i.test(err), err);
    // THE POINT: does that refusal repeat the very sentence F13 was raised about?
    check("B: the 409 copy does NOT tell a cashier to press Refund they cannot see",
      !(/use refund/i.test(err) && after.refundTrigger === false),
      `err=${JSON.stringify(err)} refundButtonOnScreen=${after.refundTrigger}`);
  } else {
    log("  ! the cashier's drawer had already refetched — race not reproduced this run");
    findings.void409 = { note: "drawer refetched before the click; 409 path not reached", stillThere };
  }
  await cashier.context().close();
  await manager.context().close();
}

await browser.close();
saveState({ reopenB_adjacent: findings, reopenB_adjacentResults: results });
log("\n==========================================");
log(fails.length ? `FAILED (${fails.length}): ${fails.join(" | ")}` : "ALL CHECKS PASS");
log("==========================================");
process.exit(fails.length ? 1 : 0);
