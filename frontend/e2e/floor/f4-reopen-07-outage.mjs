/*
 * F4 RE-OPEN, part 6 — the GA-001 trap.
 *
 * An audit log that renders "0 events" when audit-service is unreachable is the product asserting
 * that nothing happened. The claim is that every read goes through QueryBoundary. Here the read is
 * actually broken at the network, and the screen is read back.
 */
import { launch, ctx, signIn, shot, readAudit, record, log, PEOPLE, BASE } from "./f4-reopen-lib.mjs";

const browser = await launch();
const page = await ctx(browser, { tz: "America/New_York" });
await signIn(page, PEOPLE.owner);

// Break only the audit read — everything else in the shell keeps working, which is the realistic
// shape of one service being down.
await page.route("**/api/v1/audit/events**", (route) =>
  route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "audit-service is down" } }) }));

await page.goto(`${BASE}/app/settings/audit`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(12_000);

const s = await readAudit(page);
const body = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
record("O_outage", {
  h1: s.h1,
  summary: s.summary,
  rowCount: s.rowCount,
  saysCouldNotLoad: /Couldn.t load|unavailable|could not|went wrong|try again/i.test(body),
  saysNothingRecorded: /Nothing has been recorded yet|Nothing matches these filters/i.test(body),
  saysZeroEvents: /\b0 events\b/.test(body),
  alerts: await page.evaluate(() => Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.replace(/\s+/g, " ").trim().slice(0, 300))),
});
await shot(page, "r50-audit-outage");

// And recovery: unblock, retry, and the log must come back rather than stay stuck.
await page.unroute("**/api/v1/audit/events**");
const retry = page.getByRole("button", { name: /try again|retry|reload/i });
if (await retry.count()) await retry.first().click();
else await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(11_000);
const back = await readAudit(page);
record("O_recovered", { h1: back.h1, summary: back.summary, rowCount: back.rowCount });
await shot(page, "r51-audit-recovered");

await browser.close();
log("\ndone — part 6");
