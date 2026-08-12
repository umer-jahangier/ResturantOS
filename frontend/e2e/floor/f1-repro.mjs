/*
 * F1 REPRO — the cashier counts the drawer blind.
 *
 * Signs in as the cashier who already holds an OPEN till that has taken cash, presses
 * Close Till, and measures the panel BEFORE typing anything: does it name an expected
 * cash figure, and does the variance preview appear once a count is typed?
 *
 * Nothing is submitted — this is a read-only reproduction.
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, tokenOf, log, money } from "../shift/lib.mjs";

const OUT = "../.planning/audits/floor/F1";
const browser = await newBrowser();
const page = await newPage(browser);
await login(page, PEOPLE.cashier);
await go(page, "/app/pos", { waitMs: 7000 });

const tok = await tokenOf(page);
const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));

const strip = await page.evaluate(() => {
  const b = document.querySelector("[data-testid=close-till-button]");
  return b ? b.closest("div").innerText.replace(/\s+/g, " ").trim() : null;
});
log("  green strip:", strip);
await page.screenshot({ path: `${OUT}/01-repro-strip.png` });

const tills = await apiGet(page, `/api/v1/pos/tills?cashierId=${claims.sub}&status=OPEN`, tok);
const till = (tills.body?.data ?? [])[0];
const recon = await apiGet(page, `/api/v1/pos/tills/${till.id}/reconciliation`, tok);
const rb = recon.body?.data ?? recon.body;
log("  server truth: expectedClosingPaisa =", till.expectedClosingPaisa,
    " liveExpectedCashPaisa =", rb.liveExpectedCashPaisa, `(${money(rb.liveExpectedCashPaisa)})`);

await page.locator("[data-testid=close-till-button]").click();
await page.waitForTimeout(2000);

const before = await page.evaluate(() => {
  const p = document.querySelector("[data-testid=close-till-panel]");
  if (!p) return null;
  const t = p.innerText.replace(/\s+/g, " ").trim();
  return {
    text: t,
    hasOpeningFloat: /Opening float/.test(t),
    hasExpected: /Expected cash/.test(t),
    expectedValue: /Expected cash:?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
  };
});
log("  close panel BEFORE typing:", JSON.stringify(before, null, 1));
await page.screenshot({ path: `${OUT}/02-repro-close-panel.png` });

// Type a count Rs 200 short of the live expected figure.
const shortBy = 20000;
const declared = ((rb.liveExpectedCashPaisa - shortBy) / 100).toFixed(2);
log("  typing declared count:", declared);
await page.locator("[data-testid=close-till-panel] input[type=number]").first().fill(declared);
await page.waitForTimeout(1200);

const after = await page.evaluate(() => {
  const p = document.querySelector("[data-testid=close-till-panel]");
  if (!p) return null;
  const t = p.innerText.replace(/\s+/g, " ").trim();
  const el = p.querySelector("[data-testid=close-till-variance]");
  return {
    text: t,
    hasVariance: /Variance/.test(t),
    varianceText: /Variance:?\s*([^ ]+ [\d,]+\.\d\d[a-z ]*)/i.exec(t)?.[1] ?? null,
    varianceColor: el ? getComputedStyle(el).color : null,
  };
});
log("  close panel AFTER typing:", JSON.stringify(after, null, 1));
await page.screenshot({ path: `${OUT}/03-repro-after-typing.png` });

log("\n  VERDICT:",
  before?.hasExpected ? "expected cash IS shown" : "NO expected cash on the close panel",
  "|",
  after?.hasVariance ? "variance IS previewed" : "NO variance preview");

await browser.close();
