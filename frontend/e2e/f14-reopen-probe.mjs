/*
 * F14 RE-OPEN ATTEMPT — independent re-drive of "the Void trigger's visible text and its
 * accessible name disagree" (FULL-SHIFT-WALKTHROUGH §3 #17).
 *
 * Written from scratch by the verifying agent. It does NOT reuse the fixer's probe.
 *
 * What it adds over the fixer's run:
 *   A. Actuates the VOID trigger BY THE WORD PRINTED ON IT (they only did that for Refund).
 *   B. Probes the SECOND render site of the same component — the POS terminal order-panel
 *      footer (order-panel.tsx:485) — not just the order-management drawer.
 *   C. Probes the OPEN void panel (Confirm Void / Cancel) — the controls you reach AFTER the
 *      trigger, which nobody measured.
 *   D. Sweeps EVERY on-screen button on each surface for label-in-name violations, so an
 *      adjacent still-broken control cannot hide behind one fixed one.
 *   E. Reloads and re-measures (persistence).
 *   F. Re-runs as the CASHIER (wrong persona) to check no permission was widened.
 *
 * Measurement is Chromium's own AX tree over CDP (Accessibility.getPartialAXTree with
 * fetchRelatives:false), never the attribute and never the class list.
 *
 *   node e2e/f14-reopen-probe.mjs <label>
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const LABEL = process.argv[2] ?? "reopen";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F14/reopen");
const BASE = "http://localhost:3000";

const MANAGER = {
  slug: "floating-terrace",
  email: "manager@terrace.local",
  password: "Terrace#Manager1",
};
const CASHIER = {
  slug: "floating-terrace",
  email: "cashier@terrace.local",
  password: "Terrace#Cashier1",
};

mkdirSync(OUT, { recursive: true });
const R = { label: LABEL, at: new Date().toISOString(), surfaces: {}, notes: [] };
let step = 0;

async function shot(page, name) {
  step += 1;
  const file = `${LABEL}-${String(step).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}` });
  console.log("    shot:", file);
  return file;
}

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  if (page.url().includes("/login")) throw new Error(`login failed for ${who.email}`);
}

/** An error state and an empty state look identical in a screenshot. Name which one this is. */
async function health(page) {
  return page.evaluate(() => ({
    alerts: Array.from(document.querySelectorAll('[role="alert"]'))
      .map((n) => (n.textContent || "").trim())
      .filter(Boolean),
    badCopy:
      /Couldn.t load|SERVICE_UNAVAILABLE|Access denied|unavailable right now/i.test(
        document.body.innerText,
      ),
  }));
}

/* ── measurement ─────────────────────────────────────────────────────────── */

/**
 * What a SIGHTED user reads. Text nodes only, with visually-clipped (`sr-only`) parents
 * dropped — otherwise an sr-only span would make every comparison trivially true.
 */
const VISIBLE = `(el) => {
  const out = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const p = n.parentElement;
    if (!p) continue;
    const cs = getComputedStyle(p);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const r = p.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue;
    if (/rect\\(0px,\\s*0px,\\s*0px,\\s*0px\\)/.test(cs.clip)) continue;
    if (cs.position === 'absolute' && (parseFloat(cs.width) <= 1 || parseFloat(cs.height) <= 1)) continue;
    out.push(n.textContent);
  }
  return out.join('').replace(/\\s+/g, ' ').trim();
}`;

/** Every button on the page + the accessible name CHROMIUM computed for it. */
async function sweep(page, client) {
  const { root } = await client.send("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeIds } = await client.send("DOM.querySelectorAll", {
    nodeId: root.nodeId,
    selector: 'button, [role="button"], a[href]',
  });

  const dom = await page.evaluate(
    ([src]) => {
      const visible = eval(src);
      return Array.from(document.querySelectorAll('button, [role="button"], a[href]')).map((b) => {
        const r = b.getBoundingClientRect();
        return {
          tag: b.tagName.toLowerCase(),
          visibleText: visible(b),
          ariaLabel: b.getAttribute("aria-label"),
          ariaLabelledBy: b.getAttribute("aria-labelledby"),
          title: b.getAttribute("title"),
          testid: b.getAttribute("data-testid"),
          onScreen: r.width > 0 && r.height > 0,
          inViewport: r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0,
        };
      });
    },
    [VISIBLE],
  );

  const rows = [];
  for (let i = 0; i < nodeIds.length; i += 1) {
    const nodeId = nodeIds[i];
    if (!nodeId) continue;
    let ax = null;
    try {
      const { nodes } = await client.send("Accessibility.getPartialAXTree", {
        nodeId,
        fetchRelatives: false,
      });
      ax = nodes.find((n) => n.role?.value === "button" || n.role?.value === "link") ?? nodes[0] ?? null;
    } catch {
      ax = null;
    }
    const srcs = ax?.name?.sources ?? [];
    // Normalise to word sequences: a visible text built from block children joins without a
    // space ("VoidRs 5") while the AX name inserts one. Comparing raw strings would invent
    // violations that no user could perceive.
    const norm = (x) => (x ?? "").replace(/[\s\u00a0]+/g, " ").replace(/([a-z0-9])(Rs\b)/gi, "$1 $2").trim();
    const acc = norm(ax?.name?.value);
    const vis = norm(dom[i]?.visibleText);
    rows.push({
      ...dom[i],
      accName: acc || null,
      axRole: ax?.role?.value ?? null,
      ignored: ax?.ignored ?? null,
      nameFrom: srcs.find((s) => !s.superseded && s.value?.value)?.type ?? null,
      nameSources: srcs
        .filter((s) => s.value?.value !== undefined && s.value.value !== "")
        .map(
          (s) =>
            `${s.type}${s.attribute ? `[${s.attribute}]` : ""}=${JSON.stringify(s.value.value)}${s.superseded ? " (superseded)" : ""}`,
        ),
      contains: !!vis && !!acc && acc.toLowerCase().includes(vis.toLowerCase()),
      startsWith: !!vis && !!acc && acc.toLowerCase().startsWith(vis.toLowerCase()),
    });
  }
  return rows;
}

/** Controls with printed words whose announced name does not contain them. WCAG 2.5.3 failures. */
function violations(rows) {
  return rows
    .filter((b) => b.onScreen && (b.visibleText ?? "").trim() && (b.accName ?? "").trim())
    .filter((b) => !b.contains)
    .map((b) => ({
      visibleText: b.visibleText,
      accName: b.accName,
      nameFrom: b.nameFrom,
      testid: b.testid,
    }));
}

function pick(rows, word) {
  const re = new RegExp(word, "i");
  return (
    rows.find(
      (b) =>
        b.onScreen &&
        (b.accName ?? "").trim() &&
        (re.test(b.visibleText ?? "") || re.test(b.accName ?? "")),
    ) ?? null
  );
}

async function roleQueries(page, visibleText) {
  const esc = visibleText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    // the exact query named in the DONE MEANS
    doneMeansRegex: await page.getByRole("button", { name: new RegExp(esc, "i") }).count(),
    byVisibleTextSubstring: await page.getByRole("button", { name: visibleText }).count(),
    byVisibleTextExact: await page.getByRole("button", { name: visibleText, exact: true }).count(),
    anchoredRegex: await page.getByRole("button", { name: new RegExp(`^${esc}$`, "i") }).count(),
  };
}

/* ── driving ─────────────────────────────────────────────────────────────── */

async function ringAndFire(page) {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const h = await health(page);
  if (h.alerts.length || h.badCopy) {
    R.notes.push(`POS terminal came up in an ERROR state: ${JSON.stringify(h)} — retrying`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    const h2 = await health(page);
    if (h2.alerts.length || h2.badCopy)
      throw new Error(`POS terminal still in error state: ${JSON.stringify(h2)}`);
  }
  const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 25000 });
  await tiles.nth(0).click();
  await page.waitForTimeout(1200);

  // A modifier sheet may open (the Modifier work landed after the fixer's run). Satisfy every
  // "choose exactly 1" group, then commit — otherwise nothing lands in the cart at all.
  const addToOrder = page.locator('[data-testid="modifier-dialog-add"]');
  if (await addToOrder.count()) {
    R.notes.push("menu tile opened a modifier sheet — required option chosen before adding");
    // Satisfy the required "choose exactly 1" group by clicking a named option.
    const opts = page.locator('[data-testid^="modifier-option-"]');
    const count = await opts.count();
    for (let i = 0; i < count; i += 1) {
      const t = (await opts.nth(i).innerText()).trim();
      if (/^(Hot|Medium|Mild)$/i.test(t.split("\n")[0])) {
        await opts.nth(i).click();
        break;
      }
    }
    await page.waitForTimeout(600);
    await addToOrder.first().click();
    await page.waitForTimeout(2000);
  }

  await page.locator('[data-testid="send-to-kitchen-button"]').click();
  await page.waitForTimeout(5000);
  const orderNo = await page.evaluate(() => {
    const m = document.body.innerText.match(/ORD-\d{8}-\d+/);
    return m ? m[0] : null;
  });
  if (!orderNo) throw new Error("no order number after Send to Kitchen");
  return orderNo;
}

async function openFromOrderManagement(page, orderNo) {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "Order Management", exact: true }).click();
  await page.waitForTimeout(3000);
  const h = await health(page);
  if (h.alerts.length || h.badCopy) {
    R.notes.push(`Order Management in error state: ${JSON.stringify(h)} — refreshing`);
    await page
      .locator('[data-testid="order-management-refresh"]')
      .click()
      .catch(() => {});
    await page.waitForTimeout(3000);
  }
  const search = page.locator('[data-testid="order-management-search"]');
  if (await search.count()) {
    await search.first().fill(orderNo);
    await page.waitForTimeout(2500);
  }
  const row = page.locator(`tr:has-text("${orderNo}")`).first();
  await row.waitFor({ timeout: 25000 });
  const openBtn = row.locator('[data-testid^="open-order-"]');
  const orderId = (await openBtn.getAttribute("data-testid")).replace("open-order-", "");
  await openBtn.click();
  await page.waitForTimeout(3000);
  return orderId;
}

async function recordSurface(page, client, key, word) {
  const rows = await sweep(page, client);
  const target = pick(rows, word);
  const surface = {
    health: await health(page),
    trigger: target
      ? {
          visibleText: target.visibleText,
          accName: target.accName,
          nameFrom: target.nameFrom,
          nameSources: target.nameSources,
          ariaLabel: target.ariaLabel,
          contains: target.contains,
          startsWith: target.startsWith,
        }
      : null,
    labelInNameViolationsOnScreen: violations(rows),
    onScreenButtonCount: rows.filter((b) => b.onScreen).length,
  };
  if (target) surface.trigger.roleQueries = await roleQueries(page, target.visibleText);
  R.surfaces[key] = surface;
  console.log(`\n  [${key}] ${word}:`, JSON.stringify(surface.trigger, null, 2));
  console.log(
    `  [${key}] label-in-name violations on screen:`,
    JSON.stringify(surface.labelInNameViolationsOnScreen),
  );
  return { rows, target };
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("    ! page error:", String(e).slice(0, 200)));
  const client = await ctx.newCDPSession(page);
  await client.send("Accessibility.enable");
  await client.send("DOM.enable");

  /* ═══ MANAGER ═══════════════════════════════════════════════════════════ */
  await login(page, MANAGER);
  console.log("signed in as", MANAGER.email);

  console.log("\n[1] POS terminal: ring one item + Send to Kitchen");
  const orderNo = await ringAndFire(page);
  R.orderNo = orderNo;
  console.log("    order:", orderNo);

  // ── SURFACE A: the POS terminal order-panel footer (the OTHER render site) ──
  console.log("\n[A] order-panel footer, in the live terminal");
  R.shots = [];
  R.shots.push(await shot(page, "A-terminal-order-panel"));
  await recordSurface(page, client, "A_terminal_order_panel", "void");

  // ── SURFACE B: the order-management drawer (what the fixer measured) ──
  console.log("\n[B] Order Management -> Open -> drawer");
  const orderId = await openFromOrderManagement(page, orderNo);
  R.orderId = orderId;
  R.shots.push(await shot(page, "B-drawer-voidable"));
  const { target: voidRow } = await recordSurface(page, client, "B_drawer_voidable", "void");
  if (!voidRow) throw new Error("no Void trigger found on the voidable drawer");

  // ── C: ACTUATE VOID BY THE PRINTED WORD ────────────────────────────────
  console.log("\n[C] click the Void trigger by the words printed on it");
  // The query the DONE MEANS names: substring, case-insensitive — Playwright's default.
  const byPrinted = page.getByRole("button", { name: new RegExp(voidRow.visibleText, "i") });
  R.voidClick = {
    query: `getByRole('button', { name: /${voidRow.visibleText}/i })`,
    matches: await byPrinted.count(),
    exactMatches: await page
      .getByRole("button", { name: voidRow.visibleText, exact: true })
      .count(),
  };
  if (R.voidClick.matches === 1) {
    await byPrinted.click();
    await page.waitForTimeout(1500);
    R.voidClick.panelOpened = await page.locator('[data-testid="void-refund-panel"]').count();
    R.voidClick.confirmVoidVisible = await page
      .getByRole("button", { name: /confirm void/i })
      .count();
    R.shots.push(await shot(page, "C-void-panel-opened-by-printed-word"));

    // ── D: the OPEN panel's own controls ──
    console.log("\n[D] the open void panel's controls");
    const { rows: panelRows } = await recordSurface(page, client, "D_void_panel_open", "confirm");
    R.surfaces.D_void_panel_open.allPanelButtons = panelRows
      .filter((b) => b.onScreen && (b.visibleText ?? "").trim())
      .map((b) => ({ visibleText: b.visibleText, accName: b.accName, contains: b.contains }));
    // back out without voiding
    await page
      .getByRole("button", { name: /^cancel$/i })
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(1200);
  } else {
    R.voidClick.panelOpened = 0;
    R.notes.push(
      `Void could NOT be actuated by its printed word — exact-match count ${R.voidClick.matches}`,
    );
  }
  console.log("    voidClick:", JSON.stringify(R.voidClick));

  // ── E: reload, re-measure (persistence) ────────────────────────────────
  console.log("\n[E] reload and re-measure");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const reOrderId = await openFromOrderManagement(page, orderNo);
  R.reloadedOrderId = reOrderId;
  await recordSurface(page, client, "E_after_reload", "void");
  R.shots.push(await shot(page, "E-after-reload"));

  // ── F: pay in full -> Refund trigger ───────────────────────────────────
  console.log("\n[F] charge CASH in full, reopen, probe Refund");
  await page.goto(`${BASE}/app/pos/orders/${orderId}/charge`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const chargeHealth = await health(page);
  R.chargePageHealth = chargeHealth;
  const amount = page.locator('input[aria-label="Amount (Rs)"]').first();
  await amount.waitFor({ timeout: 20000 });
  const pre = await amount.inputValue();
  R.chargePrefill = pre;
  const fillFull = page.locator('[data-testid="fill-full-amount-button"]');
  if (await fillFull.count()) {
    await fillFull.first().click();
    await page.waitForTimeout(800);
    R.chargeAmountAfterFill = await amount.inputValue();
  }
  await page
    .locator('[data-testid="record-payment-button"], button:has-text("Record Payment")')
    .first()
    .click();
  await page.waitForTimeout(5000);
  R.shots.push(await shot(page, "F-after-payment"));

  await openFromOrderManagement(page, orderNo);
  R.shots.push(await shot(page, "F-drawer-refundable"));
  const { target: refundRow } = await recordSurface(page, client, "F_drawer_refundable", "refund");

  if (refundRow) {
    const rByPrinted = page.getByRole("button", { name: new RegExp(refundRow.visibleText, "i") });
    R.refundClick = {
      query: `getByRole('button', { name: /${refundRow.visibleText}/i })`,
      matches: await rByPrinted.count(),
      exactMatches: await page
        .getByRole("button", { name: refundRow.visibleText, exact: true })
        .count(),
    };
    if (R.refundClick.matches === 1) {
      await rByPrinted.click();
      await page.waitForTimeout(1500);
      R.refundClick.panelOpened = await page.locator('[data-testid="void-refund-panel"]').count();
      R.shots.push(await shot(page, "F-refund-panel-by-printed-word"));
    }
    console.log("    refundClick:", JSON.stringify(R.refundClick));
  }

  /* ═══ CASHIER — the wrong persona ═══════════════════════════════════════ */
  console.log("\n[G] same order as the CASHIER — was any permission widened?");
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page2 = await ctx2.newPage();
  const client2 = await ctx2.newCDPSession(page2);
  await client2.send("Accessibility.enable");
  await client2.send("DOM.enable");
  await login(page2, CASHIER);
  await openFromOrderManagement(page2, orderNo);
  await page2.waitForTimeout(1500);
  const cashierRows = await sweep(page2, client2);
  R.surfaces.G_cashier_refundable = {
    health: await health(page2),
    refundTriggerVisible: cashierRows.some(
      (b) => b.onScreen && /^refund$/i.test((b.visibleText ?? "").trim()),
    ),
    voidTriggerVisible: cashierRows.some(
      (b) => b.onScreen && /^void$/i.test((b.visibleText ?? "").trim()),
    ),
    chargeNowVisible: cashierRows.some((b) => b.onScreen && b.testid === "charge-now-button"),
    notice: await page2
      .locator('[data-testid="void-blocked-paid-notice"]')
      .first()
      .innerText()
      .catch(() => null),
    labelInNameViolationsOnScreen: violations(cashierRows),
  };
  const s2 = await page2.screenshot({ path: `${OUT}/${LABEL}-99-cashier-drawer.png` });
  void s2;
  R.shots.push(`${LABEL}-99-cashier-drawer.png`);
  console.log("    cashier:", JSON.stringify(R.surfaces.G_cashier_refundable, null, 2));

  writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify(R, null, 2));
  console.log("\nwritten:", `${OUT}/${LABEL}.json`);
  await browser.close();
}

main().catch(async (e) => {
  console.error("\nFAILED:", e.message);
  writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify({ error: e.message, ...R }, null, 2));
  process.exit(1);
});
