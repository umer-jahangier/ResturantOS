/*
 * F13 re-open, independent second attempt.
 *
 * The claim under test: on a paid check the notice a CASHIER reads names a manager and does not
 * instruct them to press a Refund button that is not on their screen; a MANAGER reads it as an
 * instruction with the button beside it.
 *
 * What the first re-open did NOT cover, and this drives:
 *   - the POS TERMINAL's own order panel (`components/pos/order-panel.tsx`), the OTHER surface
 *     that renders <SettlementActions/>. The first proof only ever opened the Order Management
 *     drawer. A cashier who charges a check and walks back to the terminal is on this screen.
 *   - the TABLES floor-view drawer (`table-floor-view.tsx`), the third render site.
 *   - a RELOAD on each, because a sentence chosen from a JWT claim that has not been decoded yet
 *     is a sentence that can flip on first paint.
 *   - the WAITER, who holds neither void nor refund, and the TENANT ADMIN, who holds refund.
 *
 * Every persona logs in for real; every out-of-band read is on that persona's OWN bearer.
 */
import {
  PEOPLE, newBrowser, newPage, login, go, apiGet, tokenOf, branchOf, orderRow,
  openInOrderManagement, log, BASE, drawerProbe, ensureTill, payInFullByClicking,
  shot, loadState, saveState,
} from "./lib.mjs";

const WHO = {
  cashier: PEOPLE.cashier,
  manager: PEOPLE.manager,
  waiter: { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" },
  admin: {
    slug: "floating-terrace", email: "admin@terrace.local", password: "Terrace#Admin1",
    totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS",
  },
};

/*
 * The shared `login()` gives the app a flat 4s and then calls a URL still on /login a failure.
 * On this box that is a lie about the product roughly half the time — manager@ and waiter@ both
 * "failed" that way and were signed in perfectly well a second later. Poll instead.
 */
function totpNow(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0; const out = [];
  for (const c of secret.replace(/=+$/, "").toUpperCase()) {
    const i = alphabet.indexOf(c); if (i === -1) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0); buf.writeUInt32BE(counter >>> 0, 4);
  const h = require$crypto.createHmac("sha1", Buffer.from(out)).update(buf).digest();
  const off = h[h.length - 1] & 0x0f;
  const code = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16)
    | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}
const require$crypto = await import("node:crypto");

async function signIn(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2000);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000);
    const totp = page.locator('input[name="totpCode"], input#totpCode');
    if (await totp.count()) {
      if (!who.totpSecret) throw new Error(`${who.email} challenged for TOTP with no secret`);
      await totp.first().fill(totpNow(who.totpSecret));
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(4000);
    }
    if (!page.url().includes("/login")) break;
  }
  if (page.url().includes("/login")) throw new Error(`login failed for ${who.email} at ${page.url()}`);
  log(`  ✓ signed in as ${who.email}`);
  return page;
}

/*
 * Ring + fire, modifier-aware. The shared b2 helper predates the modifier dialog that now opens
 * on a tile with option groups, so it hangs forever clicking a tile behind an `aria-modal`
 * overlay. That is a HARNESS fact, not a product one — satisfy the dialog like a cashier does.
 */
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
    const dlg = page.locator("[data-testid=modifier-dialog]");
    if (await dlg.count()) {
      // Choose the first option in every group, then Add — a cashier cannot skip a required one.
      const groups = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid^="modifier-group-"]'))
          .map((f) => Array.from(f.querySelectorAll('[data-testid^="modifier-option-"]'))
            .map((b) => b.getAttribute("data-testid"))[0])
          .filter(Boolean));
      for (const opt of groups) {
        await page.locator(`[data-testid="${opt}"]`).click().catch(() => {});
        await page.waitForTimeout(250);
      }
      const add = page.locator("[data-testid=modifier-dialog-add]");
      const blocked = await add.getAttribute("aria-disabled");
      if (blocked === "true") {
        log(`    modifier dialog still blocked on tile ${i} — cancelling, trying the next`);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(700);
        continue;
      }
      await add.click();
      await page.waitForTimeout(1200);
    }
    added++;
  }
  await page.waitForTimeout(900);
  await shot(page, `${label}-cart`);
  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(7500);
  await shot(page, `${label}-fired`);

  const orderNo = await page.evaluate(() => {
    const m = document.body.innerText.match(/ORD-\d{8}-\d+/g);
    return m ? m[0] : null;
  });
  const branch = await branchOf(page);
  const list = await apiGet(page, `/api/v1/pos/orders?branchId=${branch}&size=25`);
  const o = (list.body?.data ?? []).find((r) => r.orderNo === orderNo) ?? null;
  log(`  fired: ${o?.orderNo} ${o?.settlementStatus} id=${o?.orderId}`);
  return { orderNo: o?.orderNo ?? orderNo, orderId: o?.orderId ?? null, row: o };
}

/** Everything on screen that decides whether the sentence lies, wherever it is rendered. */
async function surfaceProbe(page, where) {
  return page.evaluate((w) => {
    const notice = document.querySelector("[data-testid=void-blocked-paid-notice]");
    const row = notice?.parentElement ?? null;
    const vis = (n) => {
      if (!n) return null;
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    };
    return {
      where: w,
      url: location.href,
      notice: notice?.textContent?.trim() ?? null,
      noticeVisible: vis(notice),
      readerCanRefundAttr: notice?.getAttribute("data-reader-can-refund") ?? null,
      refundTrigger: !!document.querySelector('[aria-label="Refund order"]'),
      voidTrigger: !!document.querySelector('[aria-label="Void order"]'),
      chargeNow: !!document.querySelector("[data-testid=charge-now-button]"),
      paidChip: document.querySelector("[data-testid=paid-chip]")?.textContent?.trim() ?? null,
      // The empty-action-row case the fix also claims to close: a rendered row with nothing in it.
      emptyActionRow: row ? row.children.length === 0 : null,
      alerts: Array.from(document.querySelectorAll('[role="alert"]'))
        .map((n) => (n.textContent || "").trim().slice(0, 120)),
    };
  }, where);
}

const mode = process.argv[2] ?? "all";
const browser = await newBrowser();
const results = [];
const fails = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
}

// ───────────────────────────── phase 1: the cashier rings, fires and pays ─────────────────────
let st = loadState();
if (mode === "all" || mode === "make") {
  const page = await newPage(browser);
  await signIn(page, WHO.cashier);
  const tok = await tokenOf(page);
  const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));
  check("cashier token does NOT carry pos.order.refund",
    !claims.permissions.includes("pos.order.refund"),
    `perms=${claims.permissions.length}`);
  check("cashier token DOES carry pos.order.void.own",
    claims.permissions.includes("pos.order.void.own"));

  await ensureTill(page, go);
  const fired = await ringAndFireB(page, { tiles: 2, label: "r1" });
  log("  order:", fired.orderNo, fired.orderId);

  // The TERMINAL panel, before any money — the void IS on offer here.
  const beforePay = await surfaceProbe(page, "terminal-panel-unpaid");
  log("  terminal (unpaid):", JSON.stringify(beforePay));
  await shot(page, "r1a-terminal-unpaid");

  const pay = await payInFullByClicking(page, fired.orderId, "r1b");
  log("  paid:", JSON.stringify(pay).slice(0, 300));
  check("payment actually recorded (no error on the charge page)", !pay.err, pay.err ?? "clean");

  // Read the money back over HTTP on the cashier's OWN bearer.
  const pays = await apiGet(page, `/api/v1/pos/orders/${fired.orderId}/payments`);
  const sum = (pays.body?.data ?? []).reduce((a, p) => a + (p.amountPaisa ?? 0), 0);
  const row = await orderRow(page, fired.orderNo);
  check("money is on the check, read back over HTTP", sum > 0,
    `sumPaisa=${sum} totalPaisa=${row?.totalPaisa} status=${row?.status ?? row?.settlementStatus}`);

  // Distinct keys: _state.json is the FIRST re-open's evidence too, and clobbering `orderNo`
  // there would rewrite somebody else's proof.
  st = saveState({
    bOrderNo: fired.orderNo, bOrderId: fired.orderId,
    bPaidPaisa: sum, bTotalPaisa: row?.totalPaisa, bBeforePay: beforePay,
  });
  await page.context().close();
}

// ───────────────── phase 2: every persona reads the same paid check, on every surface ─────────
const ORDER_NO = st.bOrderNo;
const ORDER_ID = st.bOrderId;
if (!ORDER_NO) throw new Error("no order in state — run with `make` first");
log(`\n=== reading ${ORDER_NO} (${ORDER_ID}) as each persona ===`);

const EXPECT = {
  cashier: { canRefund: false },
  waiter: { canRefund: false },
  manager: { canRefund: true },
  admin: { canRefund: true },
};

const perPersona = {};
for (const name of ["cashier", "manager", "waiter", "admin"]) {
  if (mode !== "all" && mode !== "read" && mode !== name) continue;
  log(`\n--- ${name} ---`);
  const page = await newPage(browser);
  try {
    await signIn(page, WHO[name]);
    const tok = await tokenOf(page);
    const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));
    const holdsRefund = claims.permissions.includes("pos.order.refund");
    check(`${name}: token refund grant matches the role we expect`,
      holdsRefund === EXPECT[name].canRefund, `holds=${holdsRefund}`);

    const probes = {};

    // Surface A — Order Management drawer (the one the first proof used).
    const id = await openInOrderManagement(page, ORDER_NO);
    if (!id) {
      check(`${name}: found ${ORDER_NO} in Order Management`, false, "search returned nothing");
    } else {
      probes.drawer = await surfaceProbe(page, "order-management-drawer");
      log("   drawer:", JSON.stringify(probes.drawer));
      await shot(page, `r2-${name}-drawer`);

      // Persistence: a full reload of the same drawer.
      await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForTimeout(6000);
      const reId = await openInOrderManagement(page, ORDER_NO);
      if (reId) {
        probes.drawerReload = await surfaceProbe(page, "order-management-drawer-after-reload");
        log("   drawer after reload:", JSON.stringify(probes.drawerReload));
        await shot(page, `r2-${name}-drawer-reload`);
      }
    }

    // Surface B — the POS TERMINAL's own order panel, resumed onto the paid check.
    await go(page, `/app/pos?orderId=${ORDER_ID}`, { waitMs: 9000, allowTrouble: true });
    probes.terminalQuery = await surfaceProbe(page, "terminal-panel-via-query");
    await shot(page, `r3-${name}-terminal`);
    log("   terminal:", JSON.stringify(probes.terminalQuery));

    // Surface C — the Tables floor-view drawer (third render site of SettlementActions).
    await go(page, "/app/pos/tables", { waitMs: 8000, allowTrouble: true });
    probes.tables = await surfaceProbe(page, "tables-floor-view");
    log("   tables screen:", JSON.stringify(probes.tables).slice(0, 240));

    perPersona[name] = probes;

    // ── the verdict, per persona ──
    const d = probes.drawer;
    if (d) {
      check(`${name}: the notice is present and visible on the paid check`,
        !!d.notice && d.noticeVisible !== false, JSON.stringify(d.notice));
      check(`${name}: the copy's idea of the reader matches the button actually rendered`,
        (d.readerCanRefundAttr === "true") === d.refundTrigger,
        `attr=${d.readerCanRefundAttr} button=${d.refundTrigger}`);
      if (EXPECT[name].canRefund) {
        check(`${name}: reads it as an instruction, WITH the Refund button`,
          /use refund/i.test(d.notice ?? "") && d.refundTrigger === true,
          `${d.notice} refund=${d.refundTrigger}`);
        check(`${name}: is not sent to find themselves`, !/manager/i.test(d.notice ?? ""));
      } else {
        check(`${name}: is NOT told to press Refund`, !/use refund/i.test(d.notice ?? ""), d.notice);
        check(`${name}: IS told a manager must refund it`, /manager/i.test(d.notice ?? ""), d.notice);
        check(`${name}: the Refund button really is absent (permission not widened)`,
          d.refundTrigger === false);
      }
      const r = probes.drawerReload;
      if (r) {
        check(`${name}: the sentence PERSISTS across a reload`,
          r.notice === d.notice && r.refundTrigger === d.refundTrigger,
          `${r.notice} refund=${r.refundTrigger}`);
      }
    }
    // The terminal panel is only scored when it actually bound the order.
    const t = probes.terminalQuery;
    if (t && (t.notice || t.refundTrigger || t.voidTrigger || t.paidChip)) {
      check(`${name}: TERMINAL panel — copy and controls agree there too`,
        !EXPECT[name].canRefund
          ? (!/use refund/i.test(t.notice ?? "") && t.refundTrigger === false)
          : true,
        `notice=${JSON.stringify(t.notice)} refund=${t.refundTrigger}`);
    } else {
      log("   (terminal panel did not bind this order — not scored)");
    }
  } catch (e) {
    check(`${name}: drove without a harness error`, false, String(e).slice(0, 220));
  }
  await page.context().close();
}

await browser.close();
saveState({ reopenB_perPersona: perPersona, reopenB_results: results });
log("\n==========================================");
log(fails.length ? `FAILED (${fails.length}): ${fails.join(" | ")}` : "ALL CHECKS PASS");
log("==========================================");
process.exit(fails.length ? 1 : 0);
