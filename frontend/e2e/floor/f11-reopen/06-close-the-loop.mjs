/*
 * F11 RE-OPEN, step 6 — finish the shift on the drawer the manager handed over.
 *
 * The earlier refusal was mine, not the product's: the check was paid but never closed, and
 * closeTill (unchanged by F11) refuses while a check is still SENT_TO_KDS. Close the check the
 * way the cashier does, then cash the drawer up and let the manager review it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { BASE, PEOPLE, newBrowser, newPage, login, go, shot, apiGet, tokenOf, tillStrip, OUT, log } from "./lib.mjs";

const j = JSON.parse(readFileSync(`${OUT}/journal.json`, "utf8"));
const out = { ...j };
const note = (k, v) => {
  out[k] = v;
  log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
};

const browser = await newBrowser();
const cash = await newPage(browser);
await cash.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await cash.waitForTimeout(1500);
const slug = cash.locator('input[name="tenantSlug"], input#tenantSlug');
if (await slug.count()) await slug.first().fill("floating-terrace");
await cash.locator('input[name="email"], input#email').first().fill(j.newCashier.email);
await cash.locator('input[name="password"], input#password').first().fill(j.newCashierPassword);
await cash.locator('button[type="submit"]').first().click();
await cash.waitForTimeout(6000);
const tok = await tokenOf(cash);

// ── close the check ──────────────────────────────────────────────────────────
await go(cash, `/app/pos/orders/${j.orderId}/charge`, { waitMs: 7000 });
await cash.locator("[data-testid=close-order-button]").click();
await cash.waitForTimeout(6000);
await shot(cash, "50-order-closed");
const ord = await apiGet(cash, `/api/v1/pos/orders/${j.orderId}`, tok);
note("orderStatusAfterClose", ord.body?.data?.status ?? null);

// ── cash up ──────────────────────────────────────────────────────────────────
await go(cash, "/app/pos", { waitMs: 8000 });
note("stripBeforeCashUp", await tillStrip(cash));
await cash.locator("[data-testid=close-till-button]").click();
await cash.waitForTimeout(3000);
const expected = (await cash.locator("[data-testid=close-till-expected]").first().innerText())
  .replace(/\s+/g, " ")
  .trim();
note("expectedCashOnScreen", expected);
await cash.locator("input[type=number]").last().fill(expected.replace(/[^0-9.]/g, ""));
await cash.waitForTimeout(900);
note(
  "varianceOnScreen",
  await cash.evaluate(
    () => document.querySelector("[data-testid=close-till-variance]")?.innerText.trim() ?? null,
  ),
);
await shot(cash, "51-close-till-panel");
await cash.locator("[data-testid=close-till-confirm-button]").click();
await cash.waitForTimeout(8000);
await shot(cash, "52-after-cash-up");
note(
  "closeTillErrorOnScreen",
  await cash.evaluate(
    () => document.querySelector("[data-testid=close-till-error]")?.innerText.trim() ?? null,
  ),
);
note("stripAfterCashUp", await tillStrip(cash));
const closed = await apiGet(cash, `/api/v1/pos/tills/${j.tillId}`, tok);
note("closedTillRow", JSON.stringify(closed.body?.data ?? closed.body).slice(0, 450));

// ── the manager reviews the drawer they handed over ──────────────────────────
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
await go(mgr, "/app/pos/tills", { waitMs: 7000 });
await shot(mgr, "53-manager-till-review-closed");
note(
  "tillReviewRowForThatDrawer",
  await mgr.evaluate((id) => {
    const rows = Array.from(document.querySelectorAll("tbody tr"));
    const hit = rows.find((r) => r.innerText.includes(id.slice(0, 8)));
    return hit ? hit.innerText.replace(/\s+/g, " ").trim() : null;
  }, j.cashierUserId),
);

writeFileSync(`${OUT}/journal.json`, JSON.stringify(out, null, 2));
log("\nstep 6 done");
await browser.close();
