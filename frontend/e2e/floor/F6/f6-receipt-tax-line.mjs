/*
 * F6 — "The guest's printed bill prints a raw enum: Tax (16.00%) [OTHER]".
 *
 * Drives the whole path a cashier drives: ring a check, fire it, take the cash, then open the
 * bill the guest is handed. Reads the TAX LINES off the rendered receipt — text as painted, not
 * props — and also captures the raw PrintDocument the server issued, so a disagreement between
 * the two is visible rather than inferred.
 *
 * Two checks, because the DONE bar names two shapes:
 *   A. MIXED   — Seekh Kebab (SR-STD-17 @ 17%) + Butter Naan (no code @ 16%) + Pinacolada (0%).
 *                Two tax buckets, one of them the OTHER residue bucket, plus a zero-rated line.
 *   B. SINGLE  — Seekh Kebab only. One bucket, carrying a real rate code.
 *
 * Usage:  node e2e/floor/F6/f6-receipt-tax-line.mjs <tag>      (run from frontend/)
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const API = "http://localhost:8080";
const TAG = process.argv[2] ?? "run";
const OUT = resolve(process.cwd(), `../.planning/audits/floor/F6`);
mkdirSync(OUT, { recursive: true });

const CASHIER = {
  slug: "floating-terrace",
  email: "cashier@terrace.local",
  password: "Terrace#Cashier1",
};

const log = (...a) => console.log(...a);
const journal = [];
function record(o) {
  journal.push(o);
  log("  »", JSON.stringify(o).slice(0, 400));
}

async function shot(page, name) {
  const p = `${OUT}/${TAG}-${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  log(`    shot: ${TAG}-${name}.png`);
  return p;
}

async function pageTrouble(page) {
  return page.evaluate(() => {
    const t = document.body.innerText || "";
    const alerts = Array.from(document.querySelectorAll('[role="alert"]'))
      .map((n) => (n.textContent || "").trim())
      .filter(Boolean);
    const bad = [];
    if (/Couldn.t load|Something went wrong|SERVICE_UNAVAILABLE|Failed to fetch/i.test(t))
      bad.push("load-failure text");
    if (/Access denied|You do not have permission/i.test(t)) bad.push("access-denied");
    return { bad, alerts, url: location.href };
  });
}

async function go(page, route, waitMs = 4000) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(waitMs);
  let t = await pageTrouble(page);
  if (t.bad.length) {
    log(`    ! ${route} showed ${t.bad.join(",")} — retrying once`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(waitMs + 2000);
    t = await pageTrouble(page);
  }
  return t;
}

async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(CASHIER.slug);
  await page.locator('input[name="email"], input#email').first().fill(CASHIER.email);
  await page.locator('input[name="password"], input#password').first().fill(CASHIER.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
  if (page.url().includes("/login")) throw new Error("cashier login failed");
  log(`  ✓ signed in as ${CASHIER.email}`);
}

/** Ring the named dishes onto a TAKEAWAY check and fire it. Returns the order number. */
async function ringAndFire(page, dishes, label) {
  log(`\n=== ${label}: ring ${dishes.join(" + ")} ===`);
  await go(page, "/app/pos", 8000);
  await page.locator("[data-testid=order-type-takeaway]").click();
  await page.waitForTimeout(800);

  const search = page.getByLabel("Search menu").first();
  for (const dish of dishes) {
    await search.fill(dish);
    await page.waitForTimeout(1200);
    const tile = page.locator('[data-testid="menu-grid"] button[aria-pressed]').first();
    await tile.waitFor({ timeout: 15000 });
    const tileName = await tile.innerText();
    if (!tileName.toLowerCase().includes(dish.toLowerCase().split(" ")[0])) {
      throw new Error(`search "${dish}" produced first tile "${tileName.replace(/\n/g, " ")}"`);
    }
    await tile.click();
    await page.waitForTimeout(500);
  }
  await search.fill("");
  await page.waitForTimeout(800);

  const cart = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      lines: Array.from(
        document.querySelectorAll('button[aria-label^="Decrease "][aria-label$=" quantity"]'),
      ).map((n) => n.getAttribute("aria-label").replace(/^Decrease | quantity$/g, "")),
      subtotal: /Subtotal\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
      tax: /Tax \(est\.\)\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
    };
  });
  record({ step: `${label}.cart`, cart });
  await shot(page, `${label}-01-cart`);

  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(7000);
  const after = await page.evaluate(() => ({
    nos: Array.from(
      new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0])),
    ),
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
  }));
  record({ step: `${label}.fired`, after });
  if (!after.nos.length) throw new Error("no order number after Send to kitchen");
  return after.nos[after.nos.length - 1];
}

async function findOrderId(page, no) {
  await go(page, "/app/pos", 8000);
  await page.getByText("Order Management", { exact: true }).click();
  await page.waitForTimeout(4500);
  await page.locator("[data-testid=order-management-search]").first().fill(no);
  await page.waitForTimeout(4500);
  return page.evaluate(
    () =>
      document
        .querySelector('[data-testid^="open-order-"]')
        ?.getAttribute("data-testid")
        ?.replace("open-order-", "") ?? null,
  );
}

async function settleCash(page, orderId, label) {
  log(`\n=== ${label}: take the cash ===`);
  await go(page, `/app/pos/orders/${orderId}/charge`, 6500);
  const fill = page.locator("[data-testid=fill-full-amount-button]");
  if (await fill.count()) {
    await fill.first().click();
    await page.waitForTimeout(800);
  }
  const tendered = page.locator('[aria-label="Tendered (Rs)"]').first();
  if (await tendered.count()) {
    await tendered.fill("3000");
    await page.waitForTimeout(900);
  }
  await shot(page, `${label}-02-charge`);
  await page.locator("[data-testid=record-payment-button]").click();
  await page.waitForTimeout(7000);
  const paid = await page.evaluate(() => ({
    err: document.querySelector("[data-testid=record-payment-error]")?.textContent?.trim() ?? null,
    paid: document.querySelector("[data-testid=paid-chip]")?.textContent?.trim() ?? null,
  }));
  record({ step: `${label}.paid`, paid });
  await shot(page, `${label}-03-after-payment`);
  return paid;
}

/**
 * The measurement. Reads every row of the rendered receipt whose label sits between the
 * "Service charge" row and the "Tax" total row — i.e. the per-rate breakdown — as PAINTED TEXT.
 */
async function readReceipt(page, orderId, label) {
  log(`\n=== ${label}: open the bill the guest is handed ===`);
  const trouble = await go(page, `/app/pos/orders/${orderId}/receipt`, 8000);
  record({ step: `${label}.receipt.trouble`, trouble });

  await page.locator("[data-testid=receipt-root]").waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);

  const measured = await page.evaluate(() => {
    const root = document.querySelector("[data-testid=receipt-root]");
    const rows = Array.from(root.querySelectorAll(".receipt-row")).map((r) => ({
      label: r.querySelector(".receipt-row-label")?.textContent?.trim() ?? "",
      amount: r.querySelector(".receipt-amount")?.textContent?.trim() ?? "",
    }));
    const iService = rows.findIndex((r) => /^Service charge$/i.test(r.label));
    const iTaxTotal = rows.findIndex((r, i) => i > iService && /^Tax$/i.test(r.label));
    const breakdown = iService >= 0 && iTaxTotal > iService ? rows.slice(iService + 1, iTaxTotal) : [];
    return {
      allRows: rows,
      breakdown,
      // The whole paper, so a bracketed code anywhere on it is caught, not only in the rows
      // this probe knows about.
      receiptText: root.innerText.replace(/ /g, " "),
    };
  });

  const bracketed = measured.receiptText.match(/\[[A-Z0-9][A-Z0-9_\-.]*\]/g) ?? [];
  record({
    step: `${label}.receipt`,
    breakdown: measured.breakdown,
    bracketedTokensOnPaper: bracketed,
  });

  // What the server actually issued, so the seam between server and renderer is measured.
  const issued = await page.evaluate(async (id) => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const j = await r.json().catch(() => null);
    const tok = j?.accessToken ?? j?.data?.accessToken ?? null;
    const p = await fetch(`http://localhost:8080/api/v1/pos/orders/${id}/print-jobs`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
        Authorization: `Bearer ${tok}`,
      },
      body: JSON.stringify({ kind: "RECEIPT" }),
    });
    const body = await p.json().catch(() => null);
    return { status: p.status, taxBreakdown: body?.data?.document?.taxBreakdown ?? null };
  }, orderId);
  record({ step: `${label}.server.taxBreakdown`, issued });

  await shot(page, `${label}-04-receipt`);
  const receiptEl = page.locator("[data-testid=receipt-root]");
  await receiptEl.screenshot({ path: `${OUT}/${TAG}-${label}-05-receipt-paper.png` });
  log(`    shot: ${TAG}-${label}-05-receipt-paper.png`);

  return { ...measured, issued };
}

// ── run ───────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on("console", (m) => {
  if (m.type() === "error") log("    console.error:", m.text().slice(0, 200));
});

try {
  await signIn(page);

  const results = {};
  for (const [label, dishes] of [
    ["A-mixed", ["Seekh Kebab", "Butter Naan", "Pinacolada"]],
    ["B-single", ["Seekh Kebab"]],
  ]) {
    const no = await ringAndFire(page, dishes, label);
    log(`  order = ${no}`);
    const orderId = await findOrderId(page, no);
    log(`  orderId = ${orderId}`);
    if (!orderId) throw new Error(`could not resolve an order id for ${no}`);
    await settleCash(page, orderId, label);
    results[label] = { no, orderId, ...(await readReceipt(page, orderId, label)) };
  }

  // ── verdict ────────────────────────────────────────────────────────────────
  log("\n================ VERDICT ================");
  let pass = true;
  for (const [label, r] of Object.entries(results)) {
    log(`\n${label}  (${r.no})`);
    for (const row of r.breakdown) log(`   TAX LINE:  "${row.label}"   ${row.amount}`);
    const bad = r.receiptText.match(/\[[A-Z0-9][A-Z0-9_\-.]*\]/g) ?? [];
    if (bad.length) {
      log(`   ✗ bracketed code(s) on the guest's paper: ${JSON.stringify(bad)}`);
      pass = false;
    } else {
      log("   ✓ no bracketed code anywhere on the paper");
    }
    for (const row of r.breakdown) {
      if (!/%/.test(row.label)) {
        log(`   ✗ tax line carries no percentage: "${row.label}"`);
        pass = false;
      }
      if (/^[A-Z0-9][A-Z0-9_\-.]{2,}\s*\(/.test(row.label)) {
        log(`   ✗ tax line leads with a raw code rather than a phrase: "${row.label}"`);
        pass = false;
      }
    }
  }
  log(`\n${pass ? "PASS" : "FAIL"}`);
  writeFileSync(`${OUT}/${TAG}-journal.json`, JSON.stringify({ results, journal }, null, 2));
  log(`journal: ${OUT}/${TAG}-journal.json`);
} finally {
  await browser.close();
}
