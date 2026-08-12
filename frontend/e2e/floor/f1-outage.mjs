/*
 * F1 OUTAGE — the row must SAY it cannot read the figure, not quietly disappear.
 *
 * An error state that looks like an empty state is the exact trap this register was written
 * about, so the failure path is driven for real: the reconciliation call is failed at the
 * network layer while everything else on the page keeps working.
 */
import { PEOPLE, newBrowser, newPage, login, go, log } from "../shift/lib.mjs";

const OUT = "../.planning/audits/floor/F1";
const browser = await newBrowser();
const page = await newPage(browser);
await login(page, PEOPLE.cashier);

await page.route("**/api/v1/pos/tills/*/reconciliation", (route) =>
  route.fulfill({ status: 503, contentType: "application/json", body: '{"title":"SERVICE_UNAVAILABLE"}' }),
);

await go(page, "/app/pos", { waitMs: 9000 });
await page.locator("[data-testid=close-till-button]").click();
await page.waitForTimeout(3500);

const whileRetrying = await page.evaluate(
  () => document.querySelector("[data-testid=close-till-expected]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
);
log("  outage · expected row while React Query is still retrying:", JSON.stringify(whileRetrying));

// React Query retries with backoff (~7s) before it gives up. The row must not sit on
// "Working it out…" forever — once the read has actually failed it has to SAY so.
await page.waitForTimeout(15000);

const probe = await page.evaluate(() => {
  const p = document.querySelector("[data-testid=close-till-panel]");
  const exp = document.querySelector("[data-testid=close-till-expected]");
  return {
    panelText: p ? p.innerText.replace(/\s+/g, " ").trim() : null,
    expectedRowPresent: !!exp,
    expectedRowText: exp ? exp.innerText.replace(/\s+/g, " ").trim() : null,
    retryPresent: !!document.querySelector("[data-testid=close-till-expected-retry]"),
  };
});
log("  outage · close panel:", JSON.stringify(probe, null, 1));
await page.screenshot({ path: `${OUT}/28-outage-expected-unavailable.png` });

await page.locator("[data-testid=close-till-panel] input[type=number]").first().fill("6482.60");
await page.waitForTimeout(1200);
const variance = await page.evaluate(() => {
  const v = document.querySelector("[data-testid=close-till-variance]");
  return v ? { text: v.innerText.replace(/\s+/g, " ").trim(), color: getComputedStyle(v).color } : null;
});
log("  outage · variance line:", JSON.stringify(variance));
await page.screenshot({ path: `${OUT}/29-outage-variance-message.png` });

await browser.close();
