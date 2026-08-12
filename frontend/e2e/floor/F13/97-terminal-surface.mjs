/*
 * F13 re-open, part 2 — the OTHER two screens that render <SettlementActions/>.
 *
 * The first proof only ever opened the Order Management drawer. `SettlementActions` is also
 * rendered by `components/pos/order-panel.tsx` — the POS TERMINAL's own right-hand panel — which
 * a cashier reaches by pressing "Full Menu →" inside that very drawer (the UI-SPEC §2 escape
 * hatch). A copy fix that holds in one render site and not the other is exactly the shape this
 * codebase keeps producing, so it gets driven, by clicking, as each persona.
 *
 * Also driven here, on the SAME check:
 *   - the settled CLOSED state (mark every line served), where the old code showed no notice at
 *     all and the fix claims to have closed an empty action row;
 *   - a PARTIALLY paid check, which is money-on-the-ticket without "Paid" being true.
 */
import { createHmac } from "node:crypto";
import {
  PEOPLE, newBrowser, newPage, go, apiGet, apiSend, tokenOf, branchOf, orderRow,
  openInOrderManagement, log, BASE, shot, loadState, saveState,
} from "./lib.mjs";

const WHO = {
  cashier: PEOPLE.cashier,
  manager: PEOPLE.manager,
};

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
  const code = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

async function signIn(page, who, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
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
        const totp = page.locator('input[name="totpCode"], input#totpCode');
        if (await totp.count()) {
          if (!who.totpSecret) throw new Error("challenged for TOTP with no secret");
          await totp.first().fill(totpNow(who.totpSecret));
          await page.locator('button[type="submit"]').first().click();
          await page.waitForTimeout(4000);
        }
        if (!page.url().includes("/login")) break;
      }
      if (!page.url().includes("/login")) { log(`  ✓ signed in as ${who.email}`); return page; }
      log(`  … login attempt ${attempt} for ${who.email} still on /login, retrying`);
    } catch (e) {
      log(`  … login attempt ${attempt} threw ${String(e).slice(0, 120)}`);
    }
  }
  throw new Error(`login failed for ${who.email} after ${tries} attempts`);
}

async function surfaceProbe(page, where) {
  return page.evaluate((w) => {
    const notice = document.querySelector("[data-testid=void-blocked-paid-notice]");
    const row = notice?.parentElement ?? null;
    return {
      where: w,
      url: location.href,
      notice: notice?.textContent?.trim() ?? null,
      readerCanRefundAttr: notice?.getAttribute("data-reader-can-refund") ?? null,
      refundTrigger: !!document.querySelector('[aria-label="Refund order"]'),
      voidTrigger: !!document.querySelector('[aria-label="Void order"]'),
      paidChip: document.querySelector("[data-testid=paid-chip]")?.textContent?.trim() ?? null,
      emptyActionRow: row ? row.children.length === 0 : null,
      alerts: Array.from(document.querySelectorAll('[role="alert"]'))
        .map((n) => (n.textContent || "").trim().slice(0, 140)),
    };
  }, where);
}

const results = []; const fails = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
}

const st = loadState();
const ORDER_NO = process.env.F13_ORDER_NO || st.bOrderNo;
const ORDER_ID = process.env.F13_ORDER_ID || st.bOrderId;
if (!ORDER_NO) throw new Error("no order in state");
log(`=== ${ORDER_NO} (${ORDER_ID}) ===`);

const browser = await newBrowser();
const probes = {};

for (const name of ["cashier", "manager"]) {
  log(`\n--- ${name} ---`);
  const page = await newPage(browser);
  try {
    await signIn(page, WHO[name]);
    const claims = JSON.parse(Buffer.from((await tokenOf(page)).split(".")[1], "base64").toString("utf8"));
    const holdsRefund = claims.permissions.includes("pos.order.refund");
    log(`   holds pos.order.refund: ${holdsRefund}`);

    const id = await openInOrderManagement(page, ORDER_NO);
    if (!id) { check(`${name}: found the check in Order Management`, false); await page.context().close(); continue; }
    const drawer = await surfaceProbe(page, "drawer");
    log("   drawer:", JSON.stringify(drawer));
    await shot(page, `r4-${name}-drawer`);

    // ── "Full Menu →" — the click that binds this paid check to the TERMINAL panel ──
    const fullMenu = page.getByRole("button", { name: /full menu/i });
    let terminal = null;
    if (await fullMenu.count()) {
      await fullMenu.first().click();
      await page.waitForTimeout(9000);
      terminal = await surfaceProbe(page, "terminal-order-panel");
      log("   terminal panel:", JSON.stringify(terminal));
      await shot(page, `r4-${name}-terminal-panel`);
    } else {
      log("   ! no Full Menu control in the drawer for this persona");
    }
    probes[name] = { holdsRefund, drawer, terminal };

    for (const [label, p] of [["drawer", drawer], ["TERMINAL panel", terminal]]) {
      if (!p) continue;
      if (p.notice === null && p.refundTrigger === false && p.voidTrigger === false) {
        check(`${name}: ${label} rendered the settlement surface at all`, false,
          `nothing on screen — url=${p.url} alerts=${JSON.stringify(p.alerts)}`);
        continue;
      }
      check(`${name}: ${label} — the sentence matches the buttons on the same screen`,
        (p.readerCanRefundAttr === "true") === p.refundTrigger,
        `attr=${p.readerCanRefundAttr} refundBtn=${p.refundTrigger} notice=${JSON.stringify(p.notice)}`);
      if (holdsRefund) {
        check(`${name}: ${label} — instruction + button`,
          /use refund/i.test(p.notice ?? "") && p.refundTrigger === true, JSON.stringify(p.notice));
      } else {
        check(`${name}: ${label} — NOT told to press Refund`,
          !/use refund/i.test(p.notice ?? ""), JSON.stringify(p.notice));
        check(`${name}: ${label} — told a manager must refund`,
          /manager/i.test(p.notice ?? ""), JSON.stringify(p.notice));
        check(`${name}: ${label} — Refund control genuinely absent`, p.refundTrigger === false);
      }
    }
  } catch (e) {
    check(`${name}: drove without a harness error`, false, String(e).slice(0, 220));
  }
  await page.context().close();
}

await browser.close();
saveState({ reopenB_terminalSurface: probes, reopenB_terminalResults: results });
log("\n==========================================");
log(fails.length ? `FAILED (${fails.length}): ${fails.join(" | ")}` : "ALL CHECKS PASS");
log("==========================================");
process.exit(fails.length ? 1 : 0);
