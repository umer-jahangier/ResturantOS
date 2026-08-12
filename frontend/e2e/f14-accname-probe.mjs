/*
 * F14 — "The Void trigger's visible text and its accessible name disagree"
 *   (FULL-SHIFT-WALKTHROUGH §3 #17)
 *
 * MEASURES THE SEAM. Not the attribute, not the class list: the accessible name that Chromium
 * itself computes, lifted straight out of the browser's accessibility tree over CDP
 * (`Accessibility.getPartialAXTree`, which also reports WHICH source won the name), set beside
 * the text a sighted operator actually sees on the glass (rendered text nodes, with
 * visually-clipped `sr-only` nodes excluded — `innerText` would happily include those and lie).
 *
 * Path driven as the branch manager, who holds void AND refund:
 *   1. /app/pos -> ring one item -> Send to Kitchen        (unpaid, SENT_TO_KDS)
 *   2. Order Management -> Open -> probe the action row    (Void + CHARGE NOW live here)
 *   3. CHARGE NOW -> CASH in full -> reopen                (paid)
 *   4. probe the action row again                          (Refund lives here)
 *
 * For each trigger it reports:
 *   accName        - Chromium's computed accessible name
 *   nameFrom       - which AX name source produced it (attribute / contents)
 *   visibleText    - what a sighted user reads
 *   contains       - accName contains visibleText            (WCAG 2.5.3 Label in Name)
 *   startsWith     - accName starts with visibleText         (2.5.3 Understanding, speech input)
 *   byRoleLoose    - getByRole('button', {name: /void/i}) count
 *   byRoleVisible  - getByRole('button', {name: <visible text>}) count, Playwright default
 *
 *   node e2e/f14-accname-probe.mjs <label>
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const LABEL = process.argv[2] ?? "run";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F14");
const BASE = "http://localhost:3000";

const MANAGER = {
  slug: "floating-terrace",
  email: "manager@terrace.local",
  password: "Terrace#Manager1",
};

mkdirSync(OUT, { recursive: true });
const results = { label: LABEL, at: new Date().toISOString(), probes: {} };
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

/** An error state is indistinguishable from an empty one in a screenshot. Say which this is. */
async function pageHealth(page) {
  return page.evaluate(() => {
    const t = (n) => (n.textContent || "").trim();
    return {
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(t).filter(Boolean),
      couldntLoad: /Couldn.t load|SERVICE_UNAVAILABLE|Access denied/i.test(document.body.innerText),
    };
  });
}

/* ── the measurement ─────────────────────────────────────────────────────── */

/**
 * What a SIGHTED user reads off a button: rendered text nodes only. `sr-only` content is
 * clipped to a 1px box, so it is excluded here — using `innerText` instead would fold the
 * screen-reader-only words back in and make every comparison trivially true.
 */
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

/**
 * Every <button> on the page, each with the accessible name CHROMIUM computed for it and the
 * text a sighted user reads. Nothing here trusts a React prop or an attribute.
 */
async function measureButtons(page, client) {
  const { root } = await client.send("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeIds } = await client.send("DOM.querySelectorAll", {
    nodeId: root.nodeId,
    selector: "button",
  });

  // Visible text + attributes, read in the page in the same document order querySelectorAll uses.
  const dom = await page.evaluate(
    ([fnSrc]) => {
      const visible = eval(fnSrc);
      return Array.from(document.querySelectorAll("button")).map((b) => ({
        visibleText: visible(b),
        innerText: (b.innerText || "").replace(/\s+/g, " ").trim(),
        ariaLabel: b.getAttribute("aria-label"),
        testid: b.getAttribute("data-testid"),
        onScreen: b.getBoundingClientRect().width > 0 && b.getBoundingClientRect().height > 0,
      }));
    },
    [VISIBLE_TEXT_FN],
  );

  const out = [];
  for (let i = 0; i < nodeIds.length; i += 1) {
    const nodeId = nodeIds[i];
    if (!nodeId) continue;
    let ax = null;
    try {
      const { nodes } = await client.send("Accessibility.getPartialAXTree", {
        nodeId,
        fetchRelatives: false,
      });
      ax = nodes.find((n) => n.role?.value === "button") ?? nodes[0] ?? null;
    } catch {
      ax = null;
    }
    const nameSources = (ax?.name?.sources ?? [])
      .filter((s) => s.value?.value !== undefined && s.value.value !== "")
      .map((s) => `${s.type}${s.attribute ? `[${s.attribute}]` : ""}=${JSON.stringify(s.value.value)}${s.superseded ? " (superseded)" : ""}`);
    out.push({
      ...dom[i],
      accName: ax?.name?.value ?? null,
      // The first non-superseded source is the one that actually produced the name.
      nameFrom:
        (ax?.name?.sources ?? []).find((s) => !s.superseded && s.value?.value)?.type ?? null,
      nameSources,
    });
  }
  return out;
}

/**
 * Every button that could plausibly be the trigger, so the pick is visible in the record rather
 * than hidden inside a `.find()`. Background content behind the open drawer is inert — Chromium
 * reports NO accessible name for it — which is exactly how the real trigger is told apart from
 * the like-worded status-filter chips ("Voided", "Refunded") sitting under the overlay.
 */
function candidates(buttons, word) {
  const re = new RegExp(word, "i");
  return buttons.filter(
    (b) =>
      re.test(b.visibleText ?? "") || re.test(b.ariaLabel ?? "") || re.test(b.accName ?? ""),
  );
}

function pickTrigger(buttons, word) {
  const all = candidates(buttons, word);
  // The live control: on screen, and reachable by the accessibility tree (non-empty name).
  return all.find((b) => b.onScreen && (b.accName ?? "").trim() !== "") ?? null;
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

/** Playwright's own role queries, run for real — this is the "any test looking for it" claim. */
async function roleQueries(page, word, visibleText) {
  return {
    byRoleLoose: await page.getByRole("button", { name: new RegExp(word, "i") }).count(),
    byRoleVisible: await page.getByRole("button", { name: visibleText }).count(),
    byRoleVisibleExact: await page
      .getByRole("button", { name: visibleText, exact: true })
      .count(),
    byRoleAnchoredRegex: await page
      .getByRole("button", { name: new RegExp(`^${visibleText}$`, "i") })
      .count(),
  };
}

/* ── driving ─────────────────────────────────────────────────────────────── */

async function openOrdersTab(page) {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Order Management", exact: true }).click();
  await page.waitForTimeout(2500);
}

async function ringAndFire(page) {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 20000 });
  await tiles.nth(0).click();
  await page.waitForTimeout(400);
  await page.locator('[data-testid="send-to-kitchen-button"]').click();
  await page.waitForTimeout(4000);
  const orderNo = await page.evaluate(() => {
    const m = document.body.innerText.match(/ORD-\d{8}-\d+/);
    return m ? m[0] : null;
  });
  if (!orderNo) throw new Error("no order number visible after Send to Kitchen");
  return orderNo;
}

async function openFromOrderManagement(page, orderNo) {
  await openOrdersTab(page);
  const health = await pageHealth(page);
  if (health.couldntLoad || health.alerts.length) {
    console.log("    RETRY — order management came up in an error state:", JSON.stringify(health));
    await page.locator('[data-testid="order-management-refresh"]').click().catch(() => {});
    await page.waitForTimeout(3000);
  }
  const search = page.locator('[data-testid="order-management-search"]');
  if (await search.count()) {
    await search.first().fill(orderNo);
    await page.waitForTimeout(2500);
  }
  const row = page.locator(`tr:has-text("${orderNo}")`).first();
  await row.waitFor({ timeout: 20000 });
  const openBtn = row.locator('[data-testid^="open-order-"]');
  const orderId = (await openBtn.getAttribute("data-testid")).replace("open-order-", "");
  await openBtn.click();
  await page.waitForTimeout(2500);
  return orderId;
}

async function chargeCashInFull(page, orderId) {
  await page.goto(`${BASE}/app/pos/orders/${orderId}/charge`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const health = await pageHealth(page);
  if (health.couldntLoad) throw new Error(`charge page in error state: ${JSON.stringify(health)}`);
  const amountField = page.locator('input[aria-label="Amount (Rs)"]').first();
  await amountField.waitFor({ timeout: 15000 });
  const prefilled = await amountField.inputValue();
  if (!prefilled || Number(prefilled) <= 0) {
    const order = await page.evaluate(
      async ([id, branch, bearer]) => {
        const r = await fetch(`http://localhost:8080/api/v1/pos/orders/${id}?branchId=${branch}`, {
          credentials: "include",
          headers: { Authorization: bearer },
        });
        return (await r.json())?.data;
      },
      [orderId, BRANCH_ID, BEARER],
    );
    const paisa = order.totalPaisa;
    await amountField.fill(`${Math.floor(paisa / 100)}.${String(paisa % 100).padStart(2, "0")}`);
  }
  await page
    .locator('[data-testid="record-payment-button"], button:has-text("Record Payment")')
    .first()
    .click();
  await page.waitForTimeout(4000);
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
  console.log("  signed in as", MANAGER.email);

  // ── 1. an UNPAID, fired order — this is the voidable check ────────────────
  console.log("\n[1] ring one item, Send to Kitchen -> a voidable (unpaid, SENT_TO_KDS) check");
  const orderNo = await ringAndFire(page);
  console.log("    order:", orderNo);
  const orderId = await openFromOrderManagement(page, orderNo);
  console.log("    orderId:", orderId);
  await page.waitForTimeout(1500);
  results.orderNo = orderNo;
  results.orderId = orderId;
  results.shots = [];
  results.shots.push(await shot(page, "voidable-check-drawer"));

  const health1 = await pageHealth(page);
  results.healthOnVoidable = health1;
  console.log("    page health:", JSON.stringify(health1));

  let buttons = await measureButtons(page, client);
  results.voidCandidates = candidates(buttons, "void");
  results.chargeCandidates = candidates(buttons, "charge");
  const voidRow = pickTrigger(buttons, "void");
  const chargeRow = buttons.find((b) => b.testid === "charge-now-button" && b.onScreen);

  results.probes.void = verdictFor(voidRow);
  results.probes.charge = verdictFor(chargeRow);
  if (voidRow) {
    results.probes.void.roleQueries = await roleQueries(page, "void", voidRow.visibleText);
  }
  if (chargeRow) {
    results.probes.charge.roleQueries = await roleQueries(
      page,
      "charge",
      chargeRow.visibleText,
    );
  }
  console.log("\n  VOID   :", JSON.stringify(results.probes.void, null, 2));
  console.log("\n  CHARGE :", JSON.stringify(results.probes.charge, null, 2));

  // ── 2. pay it in full, then reopen — this is the refundable check ─────────
  console.log("\n[2] CHARGE NOW -> CASH in full -> reopen -> the Refund trigger");
  await chargeCashInFull(page, orderId);
  await openFromOrderManagement(page, orderNo);
  await page.waitForTimeout(2000);
  results.shots.push(await shot(page, "refundable-check-drawer"));

  const health2 = await pageHealth(page);
  results.healthOnRefundable = health2;
  console.log("    page health:", JSON.stringify(health2));

  buttons = await measureButtons(page, client);
  results.refundCandidates = candidates(buttons, "refund");
  const refundRow = pickTrigger(buttons, "refund");
  results.probes.refund = verdictFor(refundRow);
  if (refundRow) {
    results.probes.refund.roleQueries = await roleQueries(page, "refund", refundRow.visibleText);
  }
  console.log("\n  REFUND :", JSON.stringify(results.probes.refund, null, 2));

  // Open the refund panel so the screenshot shows the trigger did what its name says.
  const refundBtn = page.getByRole("button", { name: /refund/i }).first();
  if (await refundBtn.count()) {
    await refundBtn.click();
    await page.waitForTimeout(1200);
    results.refundPanelOpened = await page.locator('[data-testid="void-refund-panel"]').count();
    results.shots.push(await shot(page, "refund-panel-opened-by-name"));
  }

  writeFileSync(`${OUT}/${LABEL}-accname.json`, JSON.stringify(results, null, 2));
  console.log("\nwritten:", `${OUT}/${LABEL}-accname.json`);
  await browser.close();
}

main().catch(async (e) => {
  console.error("\nFAILED:", e.message);
  writeFileSync(`${OUT}/${LABEL}-accname.json`, JSON.stringify({ error: e.message, ...results }, null, 2));
  process.exit(1);
});
