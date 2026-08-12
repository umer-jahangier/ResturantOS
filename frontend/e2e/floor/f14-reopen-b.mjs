/*
 * F14 RE-OPEN (independent, second attempt) —
 *   "The Void trigger's visible text and its accessible name disagree" (walkthrough §3 #17)
 *
 * The prior agent returned NOT_A_DEFECT for Void/Refund and fixed CHARGE NOW instead.
 * This run does NOT trust that. It measures the accessible name out of Chromium's own AX tree
 * over CDP (Accessibility.getPartialAXTree, with name sources), and then goes further than the
 * previous run in three ways:
 *
 *   1. It does not merely OPEN the panel by name — it COMPLETES a void and a refund, driving
 *      every click through `getByRole('button', { name: <the printed word> })`. A name that
 *      finds the control but cannot finish the job is not a working control.
 *   2. It RELOADS and re-reads the order over HTTP after each, so persistence is proved on the
 *      server row, not on an optimistic cache.
 *   3. It probes BOTH surfaces the settlement row is rendered on (terminal order panel and the
 *      Order Management drawer), plus a sweep of every button on screen for other
 *      label-in-name disagreements.
 *
 *   node e2e/floor/f14-reopen-b.mjs <label>
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const LABEL = process.argv[2] ?? "reopenB";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F14/reopen-b");
const BASE = "http://localhost:3000";

const MANAGER = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };
const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };

mkdirSync(OUT, { recursive: true });
const R = { label: LABEL, at: new Date().toISOString(), surfaces: {}, actions: {}, sweeps: {} };
let step = 0;

let BRANCH_ID = null;
let BEARER = null;
function watchSession(page) {
  page.on("request", (req) => {
    const m = req.url().match(/[?&]branchId=([0-9a-f-]{36})/i);
    if (m) BRANCH_ID = m[1];
    if (req.url().startsWith("http://localhost:8080/")) {
      const auth = req.headers()["authorization"];
      if (auth && auth.startsWith("Bearer ")) BEARER = auth;
    }
  });
}

async function shot(page, name) {
  step += 1;
  const file = `${LABEL}-${String(step).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: false });
  console.log("    shot:", file);
  return file;
}

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);
  if (page.url().includes("/login")) throw new Error(`login failed for ${who.email}`);
}

/** An error state and an empty state are the same picture. Name which one this is. */
async function health(page) {
  return page.evaluate(() => ({
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => (n.textContent || "").trim()).filter(Boolean),
    badCopy: /Couldn.t load|SERVICE_UNAVAILABLE|Access denied|unavailable right now/i.test(document.body.innerText),
  }));
}

/* ── measurement ─────────────────────────────────────────────────────────── */

const VISIBLE_TEXT_FN = `(el) => {
  const out = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const p = n.parentElement;
    if (!p) continue;
    const cs = getComputedStyle(p);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = p.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue;
    if (/rect\\(0px,\\s*0px,\\s*0px,\\s*0px\\)/.test(cs.clip)) continue;
    out.push(n.textContent);
  }
  return out.join('').replace(/\\s+/g, ' ').trim();
}`;

async function measureButtons(page, client) {
  const { root } = await client.send("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeIds } = await client.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: "button" });
  const dom = await page.evaluate(
    ([fnSrc]) => {
      const visible = eval(fnSrc);
      return Array.from(document.querySelectorAll("button")).map((b) => {
        const r = b.getBoundingClientRect();
        return {
          visibleText: visible(b),
          ariaLabel: b.getAttribute("aria-label"),
          testid: b.getAttribute("data-testid"),
          onScreen: r.width > 0 && r.height > 0,
        };
      });
    },
    [VISIBLE_TEXT_FN],
  );
  const out = [];
  for (let i = 0; i < nodeIds.length; i += 1) {
    const nodeId = nodeIds[i];
    if (!nodeId) continue;
    let ax = null;
    try {
      const { nodes } = await client.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
      ax = nodes.find((n) => n.role?.value === "button") ?? nodes[0] ?? null;
    } catch {
      ax = null;
    }
    const sources = ax?.name?.sources ?? [];
    out.push({
      ...dom[i],
      accName: ax?.name?.value ?? null,
      nameFrom: sources.find((s) => !s.superseded && s.value?.value)?.type ?? null,
      nameSources: sources
        .filter((s) => s.value?.value !== undefined && s.value.value !== "")
        .map((s) => `${s.type}${s.attribute ? `[${s.attribute}]` : ""}=${JSON.stringify(s.value.value)}${s.superseded ? " (superseded)" : ""}`),
    });
  }
  return out;
}

function verdictFor(row) {
  if (!row) return null;
  const acc = (row.accName ?? "").trim();
  const vis = (row.visibleText ?? "").trim();
  return {
    visibleText: vis,
    accName: acc,
    nameFrom: row.nameFrom,
    nameSources: row.nameSources,
    ariaLabel: row.ariaLabel,
    contains: !!vis && acc.toLowerCase().includes(vis.toLowerCase()),
    startsWith: !!vis && acc.toLowerCase().startsWith(vis.toLowerCase()),
  };
}

function pick(buttons, word) {
  const re = new RegExp(word, "i");
  return (
    buttons.find(
      (b) => b.onScreen && (b.accName ?? "").trim() !== "" && (re.test(b.visibleText ?? "") || re.test(b.accName ?? "")),
    ) ?? null
  );
}

/** Every on-screen button whose announced name does not contain what is printed on it. */
function labelInNameViolations(buttons) {
  return buttons
    .filter((b) => b.onScreen && (b.visibleText ?? "").trim() && (b.accName ?? "").trim())
    .filter((b) => !b.accName.toLowerCase().includes(b.visibleText.toLowerCase()))
    .map((b) => ({ visibleText: b.visibleText, accName: b.accName, nameFrom: b.nameFrom, testid: b.testid }));
}

async function roleQueries(page, word, visibleText) {
  return {
    doneMeansRegex: await page.getByRole("button", { name: new RegExp(word, "i") }).count(),
    byPrintedWordSubstring: await page.getByRole("button", { name: visibleText }).count(),
    byPrintedWordExact: await page.getByRole("button", { name: visibleText, exact: true }).count(),
    anchoredRegex: await page.getByRole("button", { name: new RegExp(`^${visibleText}$`, "i") }).count(),
  };
}

/* ── driving ─────────────────────────────────────────────────────────────── */

/**
 * Some menu items now open a modifier picker with a REQUIRED group. Satisfy it by clicking
 * options until "Add to order" is actually enabled, then commit. Nothing here is F14's subject —
 * it is just how a cart gets an item today.
 */
async function satisfyModifierDialog(page) {
  const add = page.getByRole("button", { name: /add to order/i }).first();
  if ((await add.count()) === 0) return false;
  const opts = page.locator('[role="dialog"] button, [data-testid*="modifier"] button');
  const n = await opts.count();
  for (let j = 0; j < n; j += 1) {
    if (await add.isEnabled().catch(() => false)) break;
    const t = ((await opts.nth(j).innerText().catch(() => "")) || "").trim();
    if (/^(cancel|close|add to order)$/i.test(t) || !t) continue;
    await opts.nth(j).click().catch(() => {});
    await page.waitForTimeout(350);
  }
  await add.click();
  await page.waitForTimeout(900);
  return true;
}

async function ringAndFire(page) {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const h = await health(page);
  if (h.alerts.length || h.badCopy) {
    console.log("    terminal came up in an error state, retrying:", JSON.stringify(h));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    const h2 = await health(page);
    if (h2.alerts.length || h2.badCopy) throw new Error(`POS terminal error state: ${JSON.stringify(h2)}`);
  }
  const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 25000 });
  await tiles.nth(0).click();
  await page.waitForTimeout(900);
  await satisfyModifierDialog(page);
  await page.waitForTimeout(600);
  await page.locator('[data-testid="send-to-kitchen-button"]').click();
  await page.waitForTimeout(4500);
  const orderNo = await page.evaluate(() => {
    const m = document.body.innerText.match(/ORD-\d{8}-\d+/);
    return m ? m[0] : null;
  });
  if (!orderNo) throw new Error("no order number after Send to Kitchen");
  return orderNo;
}

async function openOrdersTab(page) {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2800);
  await page.getByRole("button", { name: "Order Management", exact: true }).click();
  await page.waitForTimeout(2800);
}

async function openDrawer(page, orderNo) {
  await openOrdersTab(page);
  const h = await health(page);
  if (h.badCopy || h.alerts.length) {
    console.log("    RETRY — order management in an error state:", JSON.stringify(h));
    await page.locator('[data-testid="order-management-refresh"]').click().catch(() => {});
    await page.waitForTimeout(3500);
  }
  const search = page.locator('[data-testid="order-management-search"]');
  if (await search.count()) {
    await search.first().fill(orderNo);
    await page.waitForTimeout(2800);
  }
  const row = page.locator(`tr:has-text("${orderNo}")`).first();
  await row.waitFor({ timeout: 25000 });
  const openBtn = row.locator('[data-testid^="open-order-"]');
  const orderId = (await openBtn.getAttribute("data-testid")).replace("open-order-", "");
  await openBtn.click();
  await page.waitForTimeout(2500);
  return orderId;
}

async function fetchOrder(page, orderId) {
  return page.evaluate(
    async ([id, branch, bearer]) => {
      const r = await fetch(`http://localhost:8080/api/v1/pos/orders/${id}?branchId=${branch}`, {
        credentials: "include",
        headers: { Authorization: bearer },
      });
      const j = await r.json();
      return { httpStatus: r.status, status: j?.data?.status, totalPaisa: j?.data?.totalPaisa, orderNumber: j?.data?.orderNumber };
    },
    [orderId, BRANCH_ID, BEARER],
  );
}

async function chargeCashInFull(page, orderId) {
  await page.goto(`${BASE}/app/pos/orders/${orderId}/charge`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3200);
  const h = await health(page);
  if (h.badCopy) throw new Error(`charge page error state: ${JSON.stringify(h)}`);
  const amountField = page.locator('input[aria-label="Amount (Rs)"]').first();
  await amountField.waitFor({ timeout: 15000 });
  const prefilled = await amountField.inputValue();
  if (!prefilled || Number(prefilled) <= 0) {
    const o = await fetchOrder(page, orderId);
    const paisa = o.totalPaisa;
    await amountField.fill(`${Math.floor(paisa / 100)}.${String(paisa % 100).padStart(2, "0")}`);
  }
  await page.locator('[data-testid="record-payment-button"], button:has-text("Record Payment")').first().click();
  await page.waitForTimeout(4500);
}

/** Probe one surface: measure, record the trigger, record every other label/name disagreement. */
async function probeSurface(page, client, key, word) {
  const buttons = await measureButtons(page, client);
  const row = pick(buttons, word);
  const v = verdictFor(row);
  const surface = {
    health: await health(page),
    trigger: v,
    onScreenButtons: buttons.filter((b) => b.onScreen).length,
    otherViolations: labelInNameViolations(buttons),
  };
  if (v) surface.trigger.roleQueries = await roleQueries(page, word, v.visibleText);
  R.surfaces[key] = surface;
  console.log(`  [${key}] ${word}:`, JSON.stringify(v && { visibleText: v.visibleText, accName: v.accName, contains: v.contains, startsWith: v.startsWith, nameFrom: v.nameFrom, roleQueries: v.roleQueries }));
  return { buttons, row };
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("    ! page error:", String(e).slice(0, 160)));
  watchSession(page);
  const client = await ctx.newCDPSession(page);
  await client.send("Accessibility.enable");
  await client.send("DOM.enable");

  await login(page, MANAGER);
  console.log("signed in as", MANAGER.email);

  /* ── A. terminal order panel — the settlement row's OTHER rendering site ── */
  console.log("\n[A] ring + fire, probe the trigger in the TERMINAL order panel");
  const orderNoA = await ringAndFire(page);
  console.log("    order:", orderNoA);
  R.orderNoA = orderNoA;
  await page.waitForTimeout(1200);
  await probeSurface(page, client, "A_terminal_panel", "void");
  R.shots = [await shot(page, "A-terminal-panel")];

  /* ── B. the drawer, and VOID IT by the printed word ─────────────────────── */
  console.log("\n[B] Order Management -> Open -> probe, then COMPLETE a void driven by the printed word");
  const orderIdA = await openDrawer(page, orderNoA);
  R.orderIdA = orderIdA;
  await probeSurface(page, client, "B_drawer_voidable", "void");
  R.shots.push(await shot(page, "B-drawer-voidable"));

  const beforeVoid = await fetchOrder(page, orderIdA);
  R.actions.void = { serverBefore: beforeVoid };

  // Drive it the way an assistive-tech user reaches it: by the word printed on the glass.
  const drawer = page.locator('[role="dialog"], [data-testid="order-detail-drawer"]').first();
  const scope = (await drawer.count()) ? drawer : page;
  const voidByPrintedWord = scope.getByRole("button", { name: "Void" });
  R.actions.void.triggersFoundByPrintedWord = await voidByPrintedWord.count();
  await voidByPrintedWord.first().click();
  await page.waitForTimeout(1200);
  R.actions.void.panelOpened = await page.locator('[data-testid="void-refund-panel"]').count();
  R.shots.push(await shot(page, "C-void-panel-by-printed-word"));

  // Fill the reason and confirm — again by the printed words, never a testid.
  const reason = page.locator('[data-testid="void-refund-panel"] textarea').first();
  await reason.fill("F14 re-open: driven by the printed label only");
  await page.waitForTimeout(300);
  const confirmVoid = page.getByRole("button", { name: /confirm void/i }).first();
  R.actions.void.confirmFoundByPrintedWord = await page.getByRole("button", { name: "Confirm Void" }).count();
  await confirmVoid.click();
  await page.waitForTimeout(5000);
  R.shots.push(await shot(page, "D-after-confirm-void"));
  R.actions.void.serverAfter = await fetchOrder(page, orderIdA);
  console.log("    void: server says", JSON.stringify(R.actions.void.serverAfter));

  // PERSIST: full reload, read the row back from the list.
  await openOrdersTab(page);
  const searchBox = page.locator('[data-testid="order-management-search"]');
  if (await searchBox.count()) {
    await searchBox.first().fill(orderNoA);
    await page.waitForTimeout(2800);
  }
  R.actions.void.rowTextAfterReload = await page
    .locator(`tr:has-text("${orderNoA}")`)
    .first()
    .innerText()
    .catch(() => null);
  R.actions.void.serverAfterReload = await fetchOrder(page, orderIdA);
  R.shots.push(await shot(page, "E-after-reload"));
  console.log("    void persisted:", JSON.stringify(R.actions.void.serverAfterReload), "| row:", JSON.stringify(R.actions.void.rowTextAfterReload));

  /* ── C. refund path — pay, then REFUND by the printed word ──────────────── */
  console.log("\n[C] a second order, paid in full, then COMPLETE a refund driven by the printed word");
  const orderNoB = await ringAndFire(page);
  R.orderNoB = orderNoB;
  const orderIdB = await openDrawer(page, orderNoB);
  R.orderIdB = orderIdB;
  await chargeCashInFull(page, orderIdB);
  R.actions.refund = { serverAfterPayment: await fetchOrder(page, orderIdB) };
  console.log("    paid:", JSON.stringify(R.actions.refund.serverAfterPayment));
  await openDrawer(page, orderNoB);
  await probeSurface(page, client, "F_drawer_refundable", "refund");
  R.shots.push(await shot(page, "F-drawer-refundable"));

  const drawer2 = page.locator('[role="dialog"], [data-testid="order-detail-drawer"]').first();
  const scope2 = (await drawer2.count()) ? drawer2 : page;
  const refundByPrintedWord = scope2.getByRole("button", { name: "Refund" });
  R.actions.refund.triggersFoundByPrintedWord = await refundByPrintedWord.count();
  await refundByPrintedWord.first().click();
  await page.waitForTimeout(1200);
  R.actions.refund.panelOpened = await page.locator('[data-testid="void-refund-panel"]').count();
  R.shots.push(await shot(page, "G-refund-panel-by-printed-word"));

  const reason2 = page.locator('[data-testid="void-refund-panel"] textarea').first();
  await reason2.fill("F14 re-open: refund driven by the printed label only");
  await page.waitForTimeout(300);
  R.actions.refund.confirmFoundByPrintedWord = await page.getByRole("button", { name: "Confirm Refund" }).count();
  await page.getByRole("button", { name: /confirm refund/i }).first().click();
  await page.waitForTimeout(5500);
  R.shots.push(await shot(page, "H-after-confirm-refund"));
  R.actions.refund.serverAfter = await fetchOrder(page, orderIdB);

  await openOrdersTab(page);
  const searchBox2 = page.locator('[data-testid="order-management-search"]');
  if (await searchBox2.count()) {
    await searchBox2.first().fill(orderNoB);
    await page.waitForTimeout(2800);
  }
  R.actions.refund.rowTextAfterReload = await page
    .locator(`tr:has-text("${orderNoB}")`)
    .first()
    .innerText()
    .catch(() => null);
  R.actions.refund.serverAfterReload = await fetchOrder(page, orderIdB);
  R.shots.push(await shot(page, "I-refund-after-reload"));
  console.log("    refund persisted:", JSON.stringify(R.actions.refund.serverAfterReload));

  /* ── D. the settled state: is the paid chip / CHARGE NOW row still sane ── */
  console.log("\n[D] CHARGE NOW, on an unsettled check, after the fix");
  const orderNoC = await ringAndFire(page);
  R.orderNoC = orderNoC;
  const orderIdC = await openDrawer(page, orderNoC);
  R.orderIdC = orderIdC;
  const { row: chargeRow } = await probeSurface(page, client, "J_drawer_charge", "charge");
  R.surfaces.J_drawer_charge.chargeTestid = chargeRow?.testid ?? null;
  R.shots.push(await shot(page, "J-drawer-charge"));

  // And prove the name actuates: click CHARGE NOW by its printed words only.
  const chargeByWords = page.getByRole("button", { name: "CHARGE NOW" }).first();
  R.actions.charge = { foundByPrintedWord: await page.getByRole("button", { name: "CHARGE NOW" }).count() };
  await chargeByWords.click();
  await page.waitForTimeout(3500);
  R.actions.charge.landedOnChargePage = page.url().includes("/charge");
  R.actions.charge.url = page.url();
  R.shots.push(await shot(page, "K-charge-page-by-name"));
  console.log("    charge by printed words ->", JSON.stringify(R.actions.charge));

  await ctx.close();

  /* ── E. wrong persona: the cashier ─────────────────────────────────────── */
  console.log("\n[E] the same drawer as the CASHIER — no permission may have widened");
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page2 = await ctx2.newPage();
  watchSession(page2);
  const client2 = await ctx2.newCDPSession(page2);
  await client2.send("Accessibility.enable");
  await client2.send("DOM.enable");
  await login(page2, CASHIER);
  const cashierOrderNo = await ringAndFire(page2);
  R.cashierOrderNo = cashierOrderNo;
  await openDrawer(page2, cashierOrderNo);
  const cashierButtons = await measureButtons(page2, client2);
  R.sweeps.cashierDrawer = {
    health: await health(page2),
    void: verdictFor(pick(cashierButtons, "void")),
    charge: verdictFor(pick(cashierButtons, "charge")),
    refund: verdictFor(pick(cashierButtons, "refund")),
    violations: labelInNameViolations(cashierButtons),
  };
  step += 0;
  await page2.screenshot({ path: `${OUT}/${LABEL}-90-cashier-drawer.png` });
  console.log("    cashier drawer:", JSON.stringify(R.sweeps.cashierDrawer.void));

  writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify(R, null, 2));
  console.log("\nwritten:", `${OUT}/${LABEL}.json`);
  await browser.close();
}

main().catch(async (e) => {
  console.error("\nFAILED:", e.message);
  writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify({ error: e.message, ...R }, null, 2));
  process.exit(1);
});
