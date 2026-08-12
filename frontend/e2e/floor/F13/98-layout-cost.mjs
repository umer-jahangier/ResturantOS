/*
 * F13 re-open, part 3 — what the longer sentence COSTS on the narrow screen.
 *
 * The fix replaced "Paid — void unavailable. Use Refund." (36 chars) with
 * "Paid — void unavailable. A manager must refund this check." (58) and rendered it as a
 * flex SIBLING of the CHARGE NOW button inside `settlement-actions.tsx`'s
 * `<div className="flex items-center gap-2">`. In the Order Management drawer that row is
 * ~1350px wide and nothing moves. In the POS TERMINAL's order panel — the cashier's main
 * screen, ~300px — the two share the row.
 *
 * Measured, not eyeballed: the button's laid-out rect and whether its own label overflows its
 * box, with the SHIPPED sentence and then with the pre-fix sentence swapped into the same node
 * in the same layout. Same engine, same container, one variable.
 */
import { createHmac } from "node:crypto";
import {
  PEOPLE, newBrowser, newPage, go, tokenOf, openInOrderManagement, log, BASE, shot, loadState,
} from "./lib.mjs";

const OLD_COPY = "Paid — void unavailable. Use Refund.";

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

/** Geometry of the settlement row, with whatever sentence is currently in the notice node. */
const MEASURE = () => {
  const btn = document.querySelector("[data-testid=charge-now-button]");
  const notice = document.querySelector("[data-testid=void-blocked-paid-notice]");
  const row = notice?.parentElement ?? btn?.parentElement ?? null;
  const rect = (n) => { if (!n) return null; const r = n.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x) }; };
  return {
    copy: notice?.textContent?.trim() ?? null,
    rowW: row ? Math.round(row.getBoundingClientRect().width) : null,
    button: rect(btn),
    // Does the label fit inside its own box? scrollWidth > clientWidth means the printed words
    // are wider than the box that is meant to contain them.
    buttonLabelOverflowsPx: btn ? btn.scrollWidth - btn.clientWidth : null,
    buttonFont: btn ? getComputedStyle(btn).fontSize : null,
    notice: rect(notice),
    noticeLines: notice ? Math.round(notice.getBoundingClientRect().height /
      parseFloat(getComputedStyle(notice).lineHeight || "16")) : null,
    // 44px is the smallest reliable touch target; this is a TILL button pressed with a thumb.
    buttonMeetsTouchTarget: btn ? btn.getBoundingClientRect().width >= 44 : null,
  };
};

const st = loadState();
const ORDER_NO = process.env.F13_ORDER_NO || st.bOrderNo;
const browser = await newBrowser();
const page = await newPage(browser);
await signIn(page, PEOPLE.cashier);

const id = await openInOrderManagement(page, ORDER_NO);
if (!id) throw new Error("order not found");
const fullMenu = page.getByRole("button", { name: /full menu/i });
await fullMenu.first().click();
await page.waitForTimeout(9000);

const out = {};
for (const [label, size] of [["1440", { width: 1440, height: 950 }],
                             ["1024", { width: 1024, height: 900 }],
                             ["768", { width: 768, height: 900 }]]) {
  await page.setViewportSize(size);
  await page.waitForTimeout(1500);
  const shipped = await page.evaluate(MEASURE);
  // Same node, same row, pre-fix sentence — the ONLY variable is the string.
  await page.evaluate((old) => {
    const n = document.querySelector("[data-testid=void-blocked-paid-notice]");
    if (n) n.textContent = old;
  }, OLD_COPY);
  await page.waitForTimeout(600);
  const before = await page.evaluate(MEASURE);
  await shot(page, `r5-terminal-${label}-oldcopy`);
  // Put the real sentence back and screenshot the truth.
  await page.evaluate((neu) => {
    const n = document.querySelector("[data-testid=void-blocked-paid-notice]");
    if (n) n.textContent = neu;
  }, "Paid — void unavailable. A manager must refund this check.");
  await page.waitForTimeout(600);
  await shot(page, `r5-terminal-${label}-shipped`);
  out[label] = { shipped, preFixCopy: before };
  log(`\n=== viewport ${label} ===`);
  log("  shipped :", JSON.stringify(shipped));
  log("  pre-fix :", JSON.stringify(before));
}

await browser.close();
console.log("\nRESULT " + JSON.stringify(out, null, 2));
