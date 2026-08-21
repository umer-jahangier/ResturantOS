/*
 * F11 RE-OPEN, step 5 — the cash-up of the handed-over drawer refused. What did it say?
 */
import { readFileSync, writeFileSync } from "node:fs";
import { BASE, newBrowser, newPage, go, shot, apiGet, apiSend, tokenOf, tillStrip, OUT, log } from "./lib.mjs";

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
const slugField = cash.locator('input[name="tenantSlug"], input#tenantSlug');
if (await slugField.count()) await slugField.first().fill("floating-terrace");
await cash.locator('input[name="email"], input#email').first().fill(j.newCashier.email);
await cash.locator('input[name="password"], input#password').first().fill(j.newCashierPassword);
await cash.locator('button[type="submit"]').first().click();
await cash.waitForTimeout(6000);
const tok = await tokenOf(cash);

await go(cash, "/app/pos", { waitMs: 8000 });
note("strip", await tillStrip(cash));
await cash.locator("[data-testid=close-till-button]").click();
await cash.waitForTimeout(2500);
const expected = (await cash.locator("[data-testid=close-till-expected]").first().innerText())
  .replace(/\s+/g, " ")
  .trim();
note("expectedCash", expected);
await cash.locator("input[type=number]").last().fill(expected.replace(/[^0-9.]/g, ""));
await cash.waitForTimeout(800);
await cash.locator("[data-testid=close-till-confirm-button]").click();
await cash.waitForTimeout(7000);
await shot(cash, "40-cashup-refused");
note(
  "closeTillErrorOnScreen",
  await cash.evaluate(
    () => document.querySelector("[data-testid=close-till-error]")?.innerText.trim() ?? null,
  ),
);
note("panelStillOpen", (await cash.locator("[data-testid=close-till-panel]").count()) > 0);

// The server's own words, on the cashier's own bearer.
const raw = await apiSend(
  cash,
  "POST",
  `/api/v1/pos/tills/${j.tillId}/close`,
  { declaredClosingPaisa: 549900 },
  tok,
);
note("closeOverHttp", { status: raw.status, title: raw.body?.title ?? null, detail: raw.body?.detail ?? null });

// What is on that drawer?
const recon = await apiGet(cash, `/api/v1/pos/tills/${j.tillId}/reconciliation`, tok);
const d = recon.body?.data ?? {};
note("reconOrderCount", d.orderCount ?? null);
note(
  "reconOrders",
  JSON.stringify((d.orders ?? []).map((o) => ({ no: o.orderNumber, status: o.status }))).slice(0, 400),
);

writeFileSync(`${OUT}/journal.json`, JSON.stringify(out, null, 2));
log("\nstep 5 done");
await browser.close();
