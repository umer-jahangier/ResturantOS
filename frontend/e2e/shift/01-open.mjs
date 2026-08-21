/*
 * SHIFT STEP 1 — OPEN.
 *
 * The owner signs in and looks at the business. The manager opens the till with a
 * counted float, exactly as a duty manager does at 11:00 before the doors open.
 *
 *   node e2e/shift/01-open.mjs
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, finding, apiGet, log } from "./lib.mjs";

const browser = await newBrowser();

// ── 1a. OWNER signs in ────────────────────────────────────────────────────────
log("\n=== 1a. OWNER opens the business ===");
const owner = await newPage(browser);
const t0 = Date.now();
await login(owner, PEOPLE.owner);
log(`  login took ${Date.now() - t0}ms (incl. TOTP)`);
let tr = await go(owner, "/app/dashboard", { waitMs: 5000 });
log("  dashboard trouble:", JSON.stringify(tr));
await shot(owner, "01a-owner-dashboard");
const dash = await owner.evaluate(() => ({
  h1: document.querySelector("h1")?.textContent?.trim() ?? null,
  branchLabel:
    Array.from(document.querySelectorAll("button,[role=combobox]"))
      .map((n) => (n.textContent || "").trim())
      .find((t) => /Terrace|Rooftop|HQ|Branch/i.test(t)) ?? null,
  tiles: Array.from(document.querySelectorAll("[data-testid^=figure-tile], .rounded-lg"))
    .slice(0, 12)
    .map((n) => (n.textContent || "").trim().replace(/\s+/g, " ").slice(0, 70)),
  charts: document.querySelectorAll("[data-testid=trend-chart], svg.recharts-surface").length,
  navHrefs: Array.from(document.querySelectorAll("nav a")).map((a) => a.getAttribute("href")),
}));
log("  owner dashboard:", JSON.stringify(dash, null, 1));
saveState({ ownerNav: dash.navHrefs });

// ── 1b. MANAGER opens the till ────────────────────────────────────────────────
log("\n=== 1b. MANAGER opens the till with a float ===");
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
tr = await go(mgr, "/app/pos", { waitMs: 6000 });
log("  /app/pos trouble:", JSON.stringify(tr));
await shot(mgr, "01b-manager-pos-before-till");

const tillState = await mgr.evaluate(() => {
  const t = document.body.innerText;
  return {
    hasOpenTillButton: !!document.querySelector('[data-testid=open-till-button]'),
    hasCloseTillButton: !!document.querySelector('[data-testid=close-till-button]'),
    strip: /No active till|Till OPEN|Till status unavailable/.exec(t)?.[0] ?? null,
  };
});
log("  till strip:", JSON.stringify(tillState));

if (tillState.hasCloseTillButton) {
  finding({
    id: "PRE",
    sev: "info",
    what: "manager already had an OPEN till from an earlier run — closing it first",
  });
  // leave it; the brief wants an open till anyway
} else if (tillState.hasOpenTillButton) {
  await mgr.locator("[data-testid=open-till-button]").click();
  await mgr.waitForTimeout(800);
  await shot(mgr, "01c-open-till-panel");
  const panelCopy = await mgr.evaluate(() => {
    const p = document.querySelector("[data-testid=open-till-panel]");
    if (!p) return null;
    const input = p.querySelector("input");
    return {
      text: p.innerText.replace(/\s+/g, " ").trim(),
      inputType: input?.type,
      inputPlaceholder: input?.placeholder,
      inputLabel: input?.closest("label")?.innerText?.split("\n")[0]?.trim(),
    };
  });
  log("  open-till panel:", JSON.stringify(panelCopy, null, 1));
  // Count Rs 5,000.00 into the drawer.
  await mgr.locator("[data-testid=open-till-panel] input").first().fill("5000");
  await shot(mgr, "01d-float-typed");
  await mgr.locator("[data-testid=open-till-confirm-button]").click();
  await mgr.waitForTimeout(3500);
  await shot(mgr, "01e-till-open");
}

const afterOpen = await mgr.evaluate(() => ({
  strip: document.querySelector("[data-testid=close-till-button]")
    ? document
        .querySelector("[data-testid=close-till-button]")
        .parentElement.innerText.replace(/\s+/g, " ")
        .trim()
    : null,
  err: document.querySelector("[data-testid=open-till-error]")?.textContent?.trim() ?? null,
}));
log("  after open:", JSON.stringify(afterOpen));

// Whose till is it? The register's own answer matters for the rest of the day.
const mgrTill = await apiGet(mgr, "/api/v1/pos/tills/active");
log("  GET /pos/tills/active (manager):", JSON.stringify(mgrTill).slice(0, 500));

// ── 1c. does the CASHIER see the manager's till? ──────────────────────────────
log("\n=== 1c. the cashier arrives — does the manager's drawer reach them? ===");
const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);
tr = await go(cash, "/app/pos", { waitMs: 6000 });
log("  cashier /app/pos trouble:", JSON.stringify(tr));
await shot(cash, "01f-cashier-pos-till-strip");
const cashierTill = await cash.evaluate(() => {
  const t = document.body.innerText;
  return {
    strip: /No active till|Till OPEN|Till status unavailable/.exec(t)?.[0] ?? null,
    hasOpenTillButton: !!document.querySelector("[data-testid=open-till-button]"),
  };
});
log("  cashier till strip:", JSON.stringify(cashierTill));
const cashActive = await apiGet(cash, "/api/v1/pos/tills/active");
log("  GET /pos/tills/active (cashier):", JSON.stringify(cashActive).slice(0, 400));

if (cashierTill.strip === "No active till") {
  finding({
    id: "SHIFT-01",
    sev: "S1",
    what:
      "The manager opened the till with a counted float and the cashier's terminal still reads 'No active till'. " +
      "The drawer is bound to the user who opened it (TillSessionRepository.findByCashierIdAndStatus), not to the " +
      "branch or the terminal, so the duty manager cannot issue a float for the shift.",
    evidence: { managerTill: mgrTill.body, cashierTill: cashActive.body },
  });
  // The day has to continue, so the cashier opens their own drawer.
  log("  → cashier opens their own drawer to continue the day");
  await cash.locator("[data-testid=open-till-button]").click();
  await cash.waitForTimeout(700);
  await cash.locator("[data-testid=open-till-panel] input").first().fill("5000");
  await cash.locator("[data-testid=open-till-confirm-button]").click();
  await cash.waitForTimeout(3500);
  await shot(cash, "01g-cashier-own-till-open");
}

const cashTill2 = await apiGet(cash, "/api/v1/pos/tills/active");
log("  cashier till after self-open:", JSON.stringify(cashTill2).slice(0, 400));
saveState({
  managerTill: mgrTill.body ?? null,
  cashierTill: cashTill2.body ?? null,
  openedAt: new Date().toISOString(),
});

await browser.close();
log("\nstep 1 done");
