/*
 * SHIFT STEP 3e — the cashier's Void button refused. What exactly refused it?
 *
 * The button rendered (so the client-side PermissionGuard passed), the reason was typed, and
 * "Confirm Void" answered "You don't have permission to void this order." This reproduces the
 * call with the cashier's own live bearer and prints the status, the body and the JWT's
 * permission list, so the refusal can be attributed rather than guessed at.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, apiGet, apiSend, tokenOf, log, BASE } from "./lib.mjs";

const st = loadState();
const NEW = st.newCashier;
const browser = await newBrowser();

const cash = await newPage(browser);
await cash.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await cash.waitForTimeout(1400);
const slug = cash.locator('input[name="tenantSlug"], input#tenantSlug');
if (await slug.count()) await slug.first().fill(NEW.slug);
await cash.locator('input[name="email"], input#email').first().fill(NEW.email);
await cash.locator('input[name="password"], input#password').first().fill(NEW.newPassword);
await cash.locator('button[type="submit"]').first().click();
await cash.waitForTimeout(5000);
await go(cash, "/app/pos", { waitMs: 6000 });

const tok = await tokenOf(cash);
const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));
log("  cashier JWT sub:", claims.sub, "branch:", claims.branch_id ?? claims.branchId);
const perms = claims.permissions ?? claims.authorities ?? claims.scope ?? claims.perms;
log("  permission count:", Array.isArray(perms) ? perms.length : typeof perms);
log("  void-ish permissions:", JSON.stringify((Array.isArray(perms) ? perms : String(perms).split(" ")).filter((p) => /void|discount|refund|order/.test(p))));
saveState({ cashierClaims: { sub: claims.sub, perms } });

const r = await apiSend(cash, "POST", `/api/v1/pos/orders/${st.order3Id}/void`, {
  reason: "shift walkthrough — cashier voiding their own unpaid check",
}, tok);
log("\n  POST /void (cashier, own unpaid order) →", r.status);
log("  body:", JSON.stringify(r.body));
saveState({ voidOwnDirect: r });

// Who does the server think rang it?
const list = await apiGet(cash, `/api/v1/pos/orders?branchId=${claims.branch_id ?? claims.branchId}&size=50`, tok);
const rows = list.body?.data ?? [];
const mine = rows.find((o) => o.orderNo === st.order3No);
log("  order 3 as the list sees it:", JSON.stringify(mine));
saveState({ order3Row: mine });

await browser.close();
