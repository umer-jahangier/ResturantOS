/* DAY 2 — 6b: the audit log, on the screen, filtered to the void; and what it does NOT
 * hold. Plus the takings till list and the tender split. */
import { newBrowser, newPage, go, shot, saveState, loadState, finding, apiGet, log, PEOPLE, login } from "./lib.mjs";

const S = loadState();
const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);

await go(owner, "/app/settings/audit", { waitMs: 7000 });
await owner.locator("#audit-action").selectOption({ label: "Order voided" });
await owner.waitForTimeout(4000);
await shot(owner, "06e-audit-order-voided");
const rows = await owner.evaluate(() =>
  Array.from(document.querySelectorAll("tr")).slice(0, 7).map((r) => r.innerText.replace(/\s*\n\s*/g, " | ").trim()),
);
log("=== AUDIT: Order voided ===");
rows.forEach((r) => log("  ", r));
const total = await owner.evaluate(() => {
  const t = (document.body.innerText || "").replace(/\s+/g, " ");
  return /([\d,]+) events?/.exec(t)?.[0] ?? null;
});
log("  stated total:", total);

// my own void — is it there, with my cashier's name?
const mine = await owner.evaluate((no) => {
  const t = document.body.innerText || "";
  const i = t.indexOf(no);
  return i >= 0 ? t.slice(Math.max(0, i - 200), i + 240).replace(/\s+/g, " ") : null;
}, S.order3?.no ?? "");
log("  my void row:", mine);

// is a DISCOUNT auditable at all?
const actions = await owner.evaluate(() =>
  Array.from(document.querySelectorAll("#audit-action option")).map((o) => o.textContent.trim()),
);
const discountish = actions.filter((a) => /discount|comp|price|override/i.test(a));
log("  actions mentioning a discount:", JSON.stringify(discountish), "of", actions.length, "actions");
if (!discountish.length) {
  finding({ id: "D2-AUDIT-DISCOUNT", sev: "high", what: "no discount action exists in the audit vocabulary" });
}

// ── takings: the tender split and the till list ──────────────────────────────
await go(owner, "/app/finance/takings?date=2026-08-12", { waitMs: 7000 });
const takings = await owner.evaluate(() => {
  const t = (document.body.innerText || "").replace(/\s+/g, " ");
  const i = t.indexOf("How the money came in");
  const j = t.indexOf("What each till counted");
  return {
    tenders: i >= 0 ? t.slice(i, i + 600) : null,
    tills: j >= 0 ? t.slice(j, j + 900) : null,
    all: t.slice(t.indexOf("The day's money"), t.indexOf("The day's money") + 2200),
  };
});
log("\n=== TAKINGS 2026-08-12 detail ===");
log("  TENDERS:", takings.tenders);
log("  TILLS  :", takings.tills);
await shot(owner, "06f-takings-detail");

// my till, named?
const myTill = await owner.evaluate((name) => {
  const t = document.body.innerText || "";
  const i = t.indexOf(name);
  return i >= 0 ? t.slice(Math.max(0, i - 120), i + 320).replace(/\s+/g, " ") : null;
}, S.newCashier.fullName);
log("  MY TILL ROW:", myTill);
saveState({ auditVoidRows: rows, auditActions: actions, takingsDetail: takings, myTillRow: myTill });
await browser.close();
