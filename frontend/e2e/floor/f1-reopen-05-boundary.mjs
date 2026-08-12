/*
 * F1 RE-OPEN — the boundaries around the figure the panel now shows.
 *
 * The fix is frontend-only, so nothing should have moved here — which is exactly why it is worth
 * measuring rather than assuming. Three questions:
 *   1. can a CASHIER read a COLLEAGUE's drawer reconciliation? (the endpoint is gated on
 *      `pos.till.open`, which every cashier holds)
 *   2. can a user of ANOTHER TENANT read this tenant's till?
 *   3. does the cashier's own POS screen ever render someone else's drawer?
 */
import { PEOPLE, newBrowser, newPage, go, apiGet, tokenOf, log } from "../shift/lib.mjs";
import { loginTenant as login } from "./f1-reopen-lib.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = "../.planning/audits/floor/F1-reopen";
mkdirSync(OUT, { recursive: true });
const M = JSON.parse(readFileSync(`${OUT}/money.json`, "utf8"));
const st = JSON.parse(readFileSync(resolve(process.cwd(), "../.planning/audits/shift/_state.json"), "utf8"));
const R = {};

const browser = await newBrowser();

// The drawer the OTHER cashier (cashier@terrace.local) is holding — 109 orders, Rs 40k+.
const other = await newPage(browser);
await login(other, PEOPLE.cashier);
const otok = await tokenOf(other);
const oclaims = JSON.parse(Buffer.from(otok.split(".")[1], "base64").toString("utf8"));
const otills = await apiGet(other, `/api/v1/pos/tills?cashierId=${oclaims.sub}&status=OPEN`, otok);
const otherTill = (otills.body?.data ?? [])[0];
log("  cashier@terrace.local holds till", otherTill?.id);
R.otherTillId = otherTill?.id ?? null;

// 1. the shift cashier reads the OTHER cashier's drawer
const me = await newPage(browser);
await login(me, { ...st.newCashier, password: st.newCashier.newPassword });
const mtok = await tokenOf(me);
if (otherTill) {
  const peek = await apiGet(me, `/api/v1/pos/tills/${otherTill.id}/reconciliation`, mtok);
  const b = peek.body?.data ?? peek.body;
  log("  cashier → COLLEAGUE's drawer reconciliation:", peek.status,
      peek.status === 200 ? `liveExpected=${b.liveExpectedCashPaisa} orders=${b.orderCount}` : JSON.stringify(b).slice(0, 200));
  R.colleagueRecon = { status: peek.status, liveExpected: peek.status === 200 ? b.liveExpectedCashPaisa : null };
}

// 2. another tenant
let cross = null;
for (const who of [
  { slug: "control-bistro-isolation-test-tenant", email: "cashier@control.local", password: "Control#Cashier1" },
  { slug: "control-bistro-isolation-test-tenant", email: "manager@control.local", password: "Control#Manager1" },
]) {
  try {
    const p = await newPage(browser);
    await login(p, who);
    const t = await tokenOf(p);
    const r = await apiGet(p, `/api/v1/pos/tills/${M.tillId}/reconciliation`, t);
    cross = { who: who.email, status: r.status, body: JSON.stringify(r.body).slice(0, 220) };
    log("  OTHER TENANT", who.email, "→", r.status, cross.body);
    break;
  } catch (e) {
    log("  (could not sign in as", who.email + ":", e.message.slice(0, 90) + ")");
  }
}
R.crossTenant = cross;

// 3. what the cashier's own POS screen renders
await go(me, "/app/pos", { waitMs: 9000 });
R.ownScreen = await me.evaluate((otherId) => ({
  mentionsOtherTill: document.body.innerHTML.includes(otherId ?? "@@none@@"),
  barText: document.querySelector("[data-testid=close-till-button]")?.closest("div")?.innerText.replace(/\s+/g, " ").trim()
    ?? document.querySelector("[data-testid=open-till-button]")?.closest("div")?.innerText.replace(/\s+/g, " ").trim()
    ?? null,
}), otherTill?.id);
log("  own POS screen:", JSON.stringify(R.ownScreen));
await me.screenshot({ path: `${OUT}/r01-own-pos.png` });

writeFileSync(`${OUT}/boundary.json`, JSON.stringify(R, null, 1));
console.log("\n" + JSON.stringify(R, null, 1));
await browser.close();
