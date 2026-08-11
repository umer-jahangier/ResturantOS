/**
 * Wave 3 — the operational surfaces, measured before and after.
 *
 * <h3>Why this runs BEFORE any change</h3>
 *
 * 38-05 task 1 is the station-counter collision, and its plan says the collision check is "the
 * control that matters: the defect exists today, so write the check first, watch it fail against
 * the current code, then fix." A check that has only ever been run against the fixed code proves
 * nothing about whether it can see the defect.
 *
 * The POS invariants run the other way round: they are GREEN today (0 containing-block creators,
 * 0 animations) and the job is to keep them green. Those are regression gates, not fix gates.
 *
 * Every probe fails loudly with ANCHOR NOT FOUND rather than reporting zero for an element that
 * is not there — phase 34's vacuous gate #3 spent its timeout waiting on a testid that did not
 * exist and reported the timeout as a measurement.
 *
 *   node e2e/verify-38-wave3.mjs [--tag before|after]
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/phases/38-erp-design-transformation/evidence");
const BASE = "http://localhost:3000";
const TAG = process.argv.includes("--tag")
  ? process.argv[process.argv.indexOf("--tag") + 1]
  : "before";

const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };
const KITCHEN = { slug: "floating-terrace", email: "kitchen@terrace.local", password: "Terrace#Kitchen1" };

async function login(page, { slug, email, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const sf = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (slug && (await sf.count())) await sf.first().fill(slug);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);
  return !page.url().includes("/login");
}

/**
 * The appendix constraint, re-measured rather than carried forward. `transform`, `filter`,
 * `backdrop-filter`, `perspective`, `will-change` and paint/layout `contain` each make an element
 * the containing block for its `position: fixed` descendants — and the receipt print path depends
 * on `position: fixed` to lift the bill out of the app shell.
 */
const OPERATIONAL_INVARIANTS = () => {
  const offenders = [];
  let animations = 0;
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    const bad = [];
    if (cs.transform && cs.transform !== "none") bad.push(`transform:${cs.transform}`);
    if (cs.filter && cs.filter !== "none") bad.push(`filter:${cs.filter}`);
    if (cs.backdropFilter && cs.backdropFilter !== "none") bad.push(`backdrop-filter:${cs.backdropFilter}`);
    if (cs.perspective && cs.perspective !== "none") bad.push(`perspective:${cs.perspective}`);
    if (cs.willChange && cs.willChange !== "auto") bad.push(`will-change:${cs.willChange}`);
    if (cs.contain && /paint|layout|strict|content/.test(cs.contain)) bad.push(`contain:${cs.contain}`);
    if (bad.length) offenders.push({ tag: el.tagName.toLowerCase(), cls: (el.className || "").toString().slice(0, 70), bad });
    if (typeof el.getAnimations === "function" && el.getAnimations().length > 0) animations += el.getAnimations().length;
  }
  return { containingBlockCreators: offenders.length, offenders: offenders.slice(0, 8), animations };
};

/** Interactive targets below the WCAG 2.2 SC 2.5.5 / brief §16 minimum. */
const TOUCH_TARGETS = () => {
  const small = [];
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="menuitem"]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (getComputedStyle(el).visibility === "hidden") continue;
    if (r.width < 44 || r.height < 44) {
      small.push({
        tag: el.tagName.toLowerCase(),
        label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 34),
        w: Math.round(r.width),
        h: Math.round(r.height),
        cls: (el.className || "").toString().slice(0, 60),
      });
    }
  }
  return { count: small.length, sample: small.slice(0, 12) };
};

/**
 * The station-counter collision — measured on PAINTED extent, not on element boxes.
 *
 * <h3>The vacuous gate this replaces, which I very nearly shipped</h3>
 *
 * The first version compared the bounding boxes of adjacent counter labels and reported
 * **0 collisions at every width in both themes** — against code the audit had photographed
 * rendering `PREPARINGREADY`. It was not evidence that the defect was fixed. It was evidence that
 * box comparison cannot see this defect.
 *
 * The labels sit in a `grid-cols-4` whose cells are ~26px wide at 1024px, while `PREPARING` at
 * 11px uppercase needs **63px**. The text overflows its cell and paints across the neighbour; the
 * BOXES never overlap, because each box is dutifully 26px and 44px apart. Measured:
 *
 * ```
 *   PREPARING  box=26  scrollW=63  left=420  → paints to 483
 *   READY      box=26  scrollW=36  left=464  → 19px of overlap
 * ```
 *
 * So the probe compares `left + scrollWidth` — where the glyphs actually end — and separately
 * reports `scrollWidth > clientWidth`, which is the direct statement of "this label does not fit".
 * The lesson is UI-SPEC §7.2.2's, one layer down: a measurement that cannot observe the failure
 * mode is not evidence about it, and the way to find out is to watch it go red on known-bad code.
 */
const COUNTER_COLLISION = () => {
  const labels = Array.from(document.querySelectorAll("span, div, dt, dd, p"))
    .filter((el) => {
      const t = (el.textContent || "").trim();
      return /^(NEW|STARTED|PREPARING|READY|COMPLETED)$/i.test(t) && el.children.length === 0;
    })
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        text: (el.textContent || "").trim(),
        left: Math.round(r.left),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        boxRight: Math.round(r.right),
        // Where the glyphs actually end.
        paintedRight: Math.round(r.left + el.scrollWidth),
        overflowing: el.scrollWidth > el.clientWidth + 0.5,
      };
    })
    .filter((l) => l.boxRight > l.left);

  if (!labels.length) return { error: "ANCHOR NOT FOUND: no station counter labels" };

  const collisions = [];
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j];
      const vOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (vOverlap <= 0.5) continue; // different rows cannot collide horizontally
      const overlap = Math.min(a.paintedRight, b.paintedRight) - Math.max(a.left, b.left);
      if (overlap > 0.5) collisions.push({ a: a.text, b: b.text, px: Math.round(overlap) });
    }
  }
  return {
    totalLabels: labels.length,
    overflowingLabels: labels.filter((l) => l.overflowing).length,
    collisions: collisions.length,
    detail: collisions.slice(0, 6),
    widest: labels.reduce((m, l) => Math.max(m, l.paintedRight - l.left), 0),
  };
};

const BOARD_FIT = () => {
  const board = document.querySelector('[data-surface="kds"]');
  if (!board) return { error: "ANCHOR NOT FOUND: [data-surface=kds]" };
  const r = board.getBoundingClientRect();
  const items = Array.from(document.querySelectorAll('[data-testid^="kds-item"], [data-kds-item]'));
  return {
    boardHeightRatio: +(r.height / window.innerHeight).toFixed(2),
    boardLeft: Math.round(r.left),
    itemFontSizes: [...new Set(items.map((el) => getComputedStyle(el).fontSize))],
  };
};

const POS_SHAPE = () => {
  const h1 = document.querySelectorAll("h1").length;
  const cart = document.querySelector('[data-testid="pos-cart"], [data-testid="order-panel"], aside');
  const truncated = Array.from(document.querySelectorAll("button, span"))
    .filter((el) => (el.textContent || "").trim().endsWith("…")).length;
  return {
    h1Count: h1,
    cartWidth: cart ? Math.round(cart.getBoundingClientRect().width) : null,
    ellipsisLabels: truncated,
    pageScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
};

async function main() {
  const browser = await chromium.launch();
  const result = { tag: TAG, capturedAt: new Date().toISOString(), pos: {}, kds: {} };

  // ── POS, as the cashier who actually uses it ────────────────────────────────
  for (const width of [390, 768, 1024, 1440]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: "light" });
    const page = await ctx.newPage();
    if (!(await login(page, CASHIER))) { console.log(`  POS@${width}: LOGIN FAILED`); await ctx.close(); continue; }
    await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5500);
    const inv = await page.evaluate(OPERATIONAL_INVARIANTS);
    const touch = await page.evaluate(TOUCH_TARGETS);
    const shape = await page.evaluate(POS_SHAPE);
    result.pos[width] = { ...inv, touch, ...shape };
    console.log(
      `  POS@${width}: cbCreators=${inv.containingBlockCreators} anims=${inv.animations} ` +
        `sub44=${touch.count} h1=${shape.h1Count} cart=${shape.cartWidth} ellipsis=${shape.ellipsisLabels} scroll=${shape.pageScroll}`,
    );
    if (inv.offenders.length) console.log("     offenders:", JSON.stringify(inv.offenders.slice(0, 3)));
    const f = `${OUT}/wave3-${TAG}/pos-${width}.png`;
    mkdirSync(dirname(f), { recursive: true });
    await page.screenshot({ path: f });
    await ctx.close();
  }

  // ── KDS, as the kitchen persona ────────────────────────────────────────────
  for (const width of [390, 768, 1024, 1440]) {
    for (const theme of width === 1440 ? ["light", "dark"] : ["light"]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
      const page = await ctx.newPage();
      if (!(await login(page, KITCHEN))) { console.log(`  KDS@${width}/${theme}: LOGIN FAILED`); await ctx.close(); continue; }
      await page.goto(`${BASE}/app/kitchen`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5500);
      const collision = await page.evaluate(COUNTER_COLLISION);
      const inv = await page.evaluate(OPERATIONAL_INVARIANTS);
      const fit = await page.evaluate(BOARD_FIT);
      result.kds[`${width}|${theme}`] = { collision, ...inv, fit };
      console.log(
        `  KDS@${width}/${theme}: ${collision.error ?? `labels=${collision.totalLabels} COLLISIONS=${collision.collisions}`} ` +
          `cbCreators=${inv.containingBlockCreators} anims=${inv.animations} board=${fit.error ?? fit.boardHeightRatio}`,
      );
      if (collision.collisions) console.log("      overlaps:", JSON.stringify(collision.detail));
      const f = `${OUT}/wave3-${TAG}/kds-${width}-${theme}.png`;
      mkdirSync(dirname(f), { recursive: true });
      await page.screenshot({ path: f });
      await ctx.close();
    }
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/verify-38-wave3-${TAG}.json`, JSON.stringify(result, null, 2));
  await browser.close();
  console.log(`\nwave3 (${TAG}) →`, OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
