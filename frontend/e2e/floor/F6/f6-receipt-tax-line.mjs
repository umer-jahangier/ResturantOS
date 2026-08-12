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
/** Optional scenario filter — "A" or "B" — so one check can be re-proved without re-ringing both. */
const ONLY = process.argv[3] ?? null;
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
  // Polled, and the page's own message is quoted on failure. A 6 s sleep reported "login failed"
  // on a machine where the gateway answered 200 to the same credentials a second later.
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline && page.url().includes("/login")) {
    await page.waitForTimeout(1500);
  }
  if (page.url().includes("/login")) {
    const said = await page.evaluate(() => ({
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim().slice(0, 200)),
      text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 400),
    }));
    throw new Error(`cashier login failed — the page said ${JSON.stringify(said)}`);
  }
  log(`  ✓ signed in as ${CASHIER.email}`);
}

/**
 * A cashier cannot ring anything on a closed till, and the terminal says so rather than showing
 * the menu. Another agent's close-till harness shuts this one mid-run, so counting a float and
 * opening the drawer is part of the journey here — exactly as it is at 11 a.m.
 */
async function ensureTillOpen(page) {
  if (!(await page.locator("[data-testid=pos-till-closed-notice]").count())) return;
  log("  · the till is closed — counting the float and opening it");
  await page.locator("[data-testid=open-till-button]").first().click();
  await page.locator("[data-testid=open-till-panel]").waitFor({ timeout: 15000 });
  await page.locator('[data-testid=open-till-panel] input[type=number]').first().fill("5000");
  await page.locator("[data-testid=open-till-confirm-button]").click();
  await page.waitForTimeout(5000);
  const err = await page.evaluate(
    () => document.querySelector("[data-testid=open-till-error]")?.textContent?.trim() ?? null,
  );
  if (err) throw new Error(`could not open the till: ${err}`);
  await page.waitForTimeout(2000);
}

/** Ring the named dishes onto a TAKEAWAY check and fire it. Returns the order number. */
async function ringAndFire(page, dishes, label) {
  log(`\n=== ${label}: ring ${dishes.join(" + ")} ===`);
  // Waited for, not slept at: the terminal's first paint is behind a menu fetch, and a fixed
  // 8 s wait timed this out twice on a machine with ten agents on it.
  await go(page, "/app/pos", 8000);
  await ensureTillOpen(page);
  const takeaway = page.locator("[data-testid=order-type-takeaway]");
  const ready = await takeaway
    .waitFor({ timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  if (!ready) {
    // Never report "the control is missing" from a timeout alone — say what the screen showed.
    await shot(page, `${label}-00-terminal-not-ready`);
    const seen = await page.evaluate(() => ({
      url: location.href,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim().slice(0, 200)),
      testids: Array.from(document.querySelectorAll("[data-testid]")).map((n) => n.getAttribute("data-testid")).slice(0, 25),
      text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 500),
    }));
    record({ step: `${label}.terminal-not-ready`, seen });
    throw new Error(`${label}: the POS terminal never offered a TAKEAWAY control — ${JSON.stringify(seen).slice(0, 500)}`);
  }
  await takeaway.click();
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

/**
 * Order Management, searched for one order number.
 *
 * <p>Polled rather than slept: this list is fetched, and a fixed wait scored a slow read as "the
 * order does not exist" once already. If it truly never arrives the page's own error state is
 * reported, so an outage cannot be mistaken for a missing row.
 */
async function findOrderId(page, no) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await go(page, "/app/pos", 8000);
    await page.getByText("Order Management", { exact: true }).click();
    await page.waitForTimeout(4000);
    await page.locator("[data-testid=order-management-search]").first().fill(no);

    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      // The button in the row that carries THIS order number. Taking the first open-order button
      // on the page reads the unfiltered list while the search is still in flight, and that
      // silently returned a stranger's order — a receipt for the wrong check would have been
      // scored as proof.
      const id = await page.evaluate((wanted) => {
        for (const btn of document.querySelectorAll('[data-testid^="open-order-"]')) {
          const row = btn.closest("tr") ?? btn.closest("[role=row]") ?? btn.parentElement;
          if (row && (row.textContent ?? "").includes(wanted)) {
            return btn.getAttribute("data-testid").replace("open-order-", "");
          }
        }
        return null;
      }, no);
      if (id) return id;
      await page.waitForTimeout(1000);
    }
    const trouble = await pageTrouble(page);
    log(`    ! ${no} not listed on attempt ${attempt}: ${JSON.stringify(trouble)}`);
  }
  return null;
}

/**
 * Take the cash. Retried, because a service restarting elsewhere on this machine returns 503 and
 * the screen says "Failed to record payment" — which is an OUTAGE, not a settlement that refused.
 * Reporting a receipt for a check that was never paid would not answer what was asked.
 */
async function settleCash(page, orderId, label) {
  log(`\n=== ${label}: take the cash ===`);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
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
    if (attempt === 1) await shot(page, `${label}-02-charge`);
    // Already settled? A 503 can land on the RESPONSE of a payment the server already wrote, so
    // "the screen said it failed" is not the same as "the money was not taken". The button goes
    // away, or goes disabled, once there is no balance left — either way, do not pay twice.
    const settledAlready = await page.evaluate(() => {
      const b = document.querySelector("[data-testid=record-payment-button]");
      const rows = document.querySelectorAll("[data-testid=payment-history-rows] > *").length;
      return { absent: !b, disabled: !!b?.disabled, rows };
    });
    if (settledAlready.absent || (settledAlready.disabled && settledAlready.rows > 0)) {
      record({ step: `${label}.paid`, alreadySettled: settledAlready });
      await shot(page, `${label}-03-after-payment`);
      return { settled: true, ...settledAlready };
    }
    const button = page.locator("[data-testid=record-payment-button]");
    if (settledAlready.disabled) {
      log("    ! Record Payment is disabled with no tender rows — waiting for the form to arm");
      await page.waitForTimeout(4000);
      continue;
    }
    await button.click();
    await page.waitForTimeout(7000);
    const outcome = await page.evaluate(() => ({
      err: document.querySelector("[data-testid=record-payment-error]")?.textContent?.trim() ?? null,
      paid: document.querySelector("[data-testid=paid-chip]")?.textContent?.trim() ?? null,
      rows: Array.from(document.querySelectorAll("[data-testid=payment-history-rows] > *")).map((n) =>
        n.innerText.replace(/\s+/g, " ").trim(),
      ),
      recordStillOffered: !!document.querySelector("[data-testid=record-payment-button]"),
    }));
    record({ step: `${label}.paid`, attempt, outcome });
    if (!outcome.err && outcome.rows.length > 0) {
      await shot(page, `${label}-03-after-payment`);
      return { settled: true, ...outcome };
    }
    log(`    ! payment attempt ${attempt} did not settle — retrying`);
    await page.waitForTimeout(6000);
  }
  await shot(page, `${label}-03-after-payment`);
  throw new Error(`${label}: could not settle order ${orderId} — the stack refused four times`);
}

/**
 * The measurement. Reads every row of the rendered receipt whose label sits between the
 * "Service charge" row and the "Tax" total row — i.e. the per-rate breakdown — as PAINTED TEXT.
 */
async function readReceipt(page, orderId, label) {
  log(`\n=== ${label}: open the bill the guest is handed ===`);
  // Retried on the page's own alert. "The printable bill is unavailable right now" is an error
  // state, and an error state photographs exactly like a page with no tax line on it.
  let trouble = null;
  let rendered = false;
  for (let attempt = 1; attempt <= 4 && !rendered; attempt += 1) {
    trouble = await go(page, `/app/pos/orders/${orderId}/receipt`, 8000);
    rendered = await page
      .locator("[data-testid=receipt-root]")
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    if (!rendered) {
      log(`    ! the bill did not render on attempt ${attempt}: ${JSON.stringify(trouble)}`);
      await page.waitForTimeout(6000);
    }
  }
  record({ step: `${label}.receipt.trouble`, trouble, rendered });
  if (!rendered) throw new Error(`${label}: the receipt page never rendered a bill`);
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

  // What the SERVER issued, taken off the page's own print-jobs response rather than a probe of
  // my own — same request, same bearer, same document the screen is rendering. This is the seam:
  // the label must already be a phrase before it reaches any renderer.
  const issued = page.__issued ?? null;
  page.__issued = null;
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
// The document the SERVER issued, captured off the screen's own request.
page.on("response", async (r) => {
  if (!/\/print-jobs$/.test(new URL(r.url()).pathname) || r.request().method() !== "POST") return;
  try {
    const body = await r.json();
    const breakdown = body?.data?.document?.taxBreakdown;
    if (breakdown) page.__issued = { status: r.status(), taxBreakdown: breakdown };
  } catch {
    /* a non-JSON body is an outage, and the alert probe already reports those */
  }
});

try {
  await signIn(page);

  const results = {};
  const scenarios = [
    ["A-mixed", ["Seekh Kebab", "Butter Naan", "Pinacolada"]],
    ["B-single", ["Seekh Kebab"]],
  ].filter(([label]) => !ONLY || label.startsWith(ONLY));

  for (const [label, dishes] of scenarios) {
    // Re-rung on interference. Nine other agents drive this same tenant, and one of them voided
    // a check out from under this run between firing it and tendering it — the charge page then
    // reads `Voided` with a Rs 0.00 balance and no payment can be taken. That is somebody else's
    // harness, not a defect in the bill, so ring a fresh check rather than reporting a failure.
    let lastError = null;
    for (let ring = 1; ring <= 3; ring += 1) {
      try {
        const no = await ringAndFire(page, dishes, label);
        log(`  order = ${no}`);
        const orderId = await findOrderId(page, no);
        log(`  orderId = ${orderId}`);
        if (!orderId) throw new Error(`could not resolve an order id for ${no}`);
        await settleCash(page, orderId, label);
        results[label] = { no, orderId, ...(await readReceipt(page, orderId, label)) };
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        log(`    ! ${label} ring ${ring} did not complete: ${e.message.slice(0, 200)}`);
        // A restart elsewhere on this machine invalidates the session mid-journey. Sign in again
        // rather than reporting the till as unreachable.
        if (page.url().includes("/login")) {
          log("    · session expired — signing in again");
          await signIn(page);
        }
        await page.waitForTimeout(5000);
      }
    }
    if (lastError) throw lastError;
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
