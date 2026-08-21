/*
 * F11 RE-OPEN, step 1 — the handover itself, driven as the two people who do it.
 *
 *  a. cashier@terrace.local signs in. If they are holding a drawer from an earlier run they
 *     cash it up THROUGH THE UI, so the starting state is the walkthrough §0 state:
 *     "No active till".
 *  b. manager@terrace.local signs in in a separate context, goes to Till Review, and opens a
 *     Rs 5,000.00 float for that named cashier.
 *  c. the cashier RELOADS and reads their own strip.
 */
import { writeFileSync } from "node:fs";
import {
  PEOPLE,
  newBrowser,
  newPage,
  login,
  go,
  shot,
  apiGet,
  tokenOf,
  claims,
  tillStrip,
  toastText,
  OUT,
  log,
} from "./lib.mjs";

const j = {};
const note = (k, v) => {
  j[k] = v;
  log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
};

const browser = await newBrowser();

// ── a. the cashier, and a clean drawer ───────────────────────────────────────
log("\n=== a. cashier@terrace.local — starting state ===");
const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);
const cashTok = await tokenOf(cash);
const cashClaims = claims(cashTok);
note("cashierUserId", cashClaims?.sub ?? cashClaims?.userId ?? null);
note("cashierBranchId", cashClaims?.branchId ?? null);
note("cashierPerms", (cashClaims?.permissions ?? []).filter((p) => p.startsWith("pos.till")));

let t = await go(cash, "/app/pos", { waitMs: 8000 });
note("cashierPosTrouble", t);
note("cashierStripAtStart", await tillStrip(cash));
await shot(cash, "01-cashier-start");

if (await cash.locator("[data-testid=close-till-button]").count()) {
  log("  … cashier is holding a drawer from an earlier run — cashing it up through the UI");
  await cash.locator("[data-testid=close-till-button]").click();
  await cash.waitForTimeout(2500);
  const expected = await cash
    .locator("[data-testid=close-till-expected]")
    .first()
    .innerText()
    .catch(() => "");
  note("preRunExpectedCash", expected.replace(/\s+/g, " ").trim());
  const num = expected.replace(/[^0-9.]/g, "");
  await cash.locator('input[type=number]').last().fill(num || "0");
  await cash.waitForTimeout(700);
  await cash.locator("[data-testid=close-till-confirm-button]").click();
  await cash.waitForTimeout(6000);
  await shot(cash, "02-cashier-after-cashup");
}
await go(cash, "/app/pos", { waitMs: 8000 });
note("cashierStripBeforeHandover", await tillStrip(cash));
await shot(cash, "03-cashier-no-active-till");

// The server's own answer, on the cashier's OWN bearer.
const before = await apiGet(
  cash,
  `/api/v1/pos/tills?cashierId=${j.cashierUserId}&status=OPEN`,
  cashTok,
);
note("cashierOpenTillsBefore", JSON.stringify(before.body?.data ?? before.body).slice(0, 300));

// ── b. the manager hands a drawer over ───────────────────────────────────────
log("\n=== b. manager@terrace.local — Till Review → Open a drawer ===");
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
const mgrTok = await tokenOf(mgr);
const mgrClaims = claims(mgrTok);
note("managerUserId", mgrClaims?.sub ?? mgrClaims?.userId ?? null);
note("managerBranchId", mgrClaims?.branchId ?? null);
note("managerHasOpenOther", (mgrClaims?.permissions ?? []).includes("pos.till.open.other"));

t = await go(mgr, "/app/pos/tills", { waitMs: 7000 });
note("managerTillReviewTrouble", t);
await shot(mgr, "04-manager-till-review");
note("openDrawerButtonCount", await mgr.locator("[data-testid=open-drawer-for-cashier-button]").count());

if ((await mgr.locator("[data-testid=open-drawer-for-cashier-button]").count()) === 0) {
  writeFileSync(`${OUT}/journal.json`, JSON.stringify(j, null, 2));
  throw new Error("STOP: no 'Open a drawer' control on Till Review for the manager");
}

// What the picker is really backed by, on the manager's own bearer.
const roster = await apiGet(
  mgr,
  `/api/v1/pos/tills/cashiers?branchId=${j.managerBranchId}`,
  mgrTok,
);
note("rosterStatus", roster.status);
note("roster", JSON.stringify(roster.body?.data ?? roster.body).slice(0, 900));

await mgr.locator("[data-testid=open-drawer-for-cashier-button]").click();
await mgr.waitForTimeout(2500);
await shot(mgr, "05-open-drawer-panel");

// Read the picker the way the manager reads it: the visible option labels.
const options = await mgr.evaluate(() => {
  const sel = document.querySelector("[data-testid=open-drawer-cashier-select]");
  if (!sel) return null;
  const native = sel.tagName === "SELECT" ? sel : sel.querySelector("select");
  if (native) return Array.from(native.options).map((o) => `${o.text}`);
  return { html: sel.outerHTML.slice(0, 1200) };
});
note("pickerOptions", options);

writeFileSync(`${OUT}/journal.json`, JSON.stringify(j, null, 2));
log("\nstep 1a/1b captured — pausing before the selection so the picker shape is known");
await browser.close();
