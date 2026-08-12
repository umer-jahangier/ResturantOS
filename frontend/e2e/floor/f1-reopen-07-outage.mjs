/*
 * F1 RE-OPEN — the trap the brief names first: "an error state looks exactly like an empty state".
 *
 * The whole finding was a MISSING row reading as "there is no such number". So the replacement row
 * has to survive its own read failing. This kills the reconciliation call at the network layer and
 * reads what the cashier is told — then lets it recover and presses Try again.
 */
import { newBrowser, newPage, go, log } from "../shift/lib.mjs";
import { loginTenant as login } from "./f1-reopen-lib.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = "../.planning/audits/floor/F1-reopen";
mkdirSync(OUT, { recursive: true });
const st = JSON.parse(readFileSync(resolve(process.cwd(), "../.planning/audits/shift/_state.json"), "utf8"));
const CASHIER = { ...st.newCashier, password: st.newCashier.newPassword };
const R = {};

const browser = await newBrowser();
const cash = await newPage(browser);
await login(cash, CASHIER);

// the shift cashier's drawer was closed by part 2 — open a fresh one so there is something to read
await go(cash, "/app/pos", { waitMs: 9000 });
if (await cash.locator("[data-testid=open-till-button]").count()) {
  await cash.locator("[data-testid=open-till-button]").click();
  await cash.waitForTimeout(1200);
  await cash.locator("[data-testid=open-till-panel] input[type=number]").fill("2750.25");
  await cash.locator("[data-testid=open-till-confirm-button]").click();
  await cash.waitForTimeout(9000);
  await go(cash, "/app/pos", { waitMs: 8000 });
}

let killRecon = true;
await cash.route("**/api/v1/pos/tills/*/reconciliation", async (route) => {
  if (killRecon) {
    await route.fulfill({ status: 503, contentType: "application/json",
      body: JSON.stringify({ title: "SERVICE_UNAVAILABLE", status: 503, detail: "down" }) });
  } else {
    await route.continue();
  }
});

await cash.reload({ waitUntil: "domcontentloaded" });
await cash.waitForTimeout(14000);
await cash.locator("[data-testid=close-till-button]").click();
await cash.waitForTimeout(3000);

const read = () => cash.evaluate(() => {
  const panel = document.querySelector("[data-testid=close-till-panel]");
  const exp = document.querySelector("[data-testid=close-till-expected]");
  const v = document.querySelector("[data-testid=close-till-variance]");
  return {
    rowPresent: !!exp,
    expectedText: exp ? exp.innerText.replace(/\s+/g, " ").trim() : null,
    hasRetry: !!document.querySelector("[data-testid=close-till-expected-retry]"),
    varianceText: v ? v.innerText.replace(/\s+/g, " ").trim() : null,
    panelText: panel ? panel.innerText.replace(/\s+/g, " ").trim() : null,
  };
});

log("\n=== reconciliation dead (503) ===");
R.outage = await read();
log(JSON.stringify(R.outage, null, 1));
await cash.screenshot({ path: `${OUT}/o01-outage-expected.png` });

// type a count anyway — the variance line must SAY it cannot be checked, not vanish
await cash.locator("[data-testid=close-till-panel] input[type=number]").first().fill("2600.00");
await cash.waitForTimeout(1500);
R.outageTyped = await read();
log("  after typing a count:", JSON.stringify(R.outageTyped, null, 1));
await cash.screenshot({ path: `${OUT}/o02-outage-variance.png` });

// and the submit button, with an unreadable expected
R.outageSubmit = await cash.evaluate(
  () => document.querySelector("[data-testid=close-till-confirm-button]")?.disabled ?? null);
log("  submit disabled while expected is unreadable:", R.outageSubmit);

log("\n=== the service comes back and the cashier presses Try again ===");
killRecon = false;
if (R.outage.hasRetry) {
  await cash.locator("[data-testid=close-till-expected-retry]").click();
  await cash.waitForTimeout(6000);
}
R.recovered = await read();
log(JSON.stringify(R.recovered, null, 1));
await cash.screenshot({ path: `${OUT}/o03-recovered.png` });

writeFileSync(`${OUT}/outage.json`, JSON.stringify(R, null, 1));
console.log("\n" + JSON.stringify(R, null, 1));
await browser.close();
