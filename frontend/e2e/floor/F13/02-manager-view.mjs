/*
 * F13 STEP 2 — the MANAGER's drawer on the very same check the cashier just paid.
 * Split out of step 1 because the Next dev server intermittently drops one navigation
 * (ERR_EMPTY_RESPONSE) while it recompiles, and a dropped nav must not be read as a finding.
 */
import {
  PEOPLE, newBrowser, newPage, login, shot, saveState, loadState, tokenOf,
  openInOrderManagement, log, drawerProbe,
} from "./lib.mjs";

const st = loadState();
const orderNo = process.argv[2] ?? st.orderNo;
if (!orderNo) throw new Error("no orderNo — run 01-repro.mjs first");
log("  order under test:", orderNo);

const browser = await newBrowser();
const mgr = await newPage(browser);
for (let attempt = 1; attempt <= 3; attempt++) {
  try { await login(mgr, PEOPLE.manager); break; }
  catch (e) { log(`  login attempt ${attempt} failed: ${e.message.slice(0, 120)}`); await mgr.waitForTimeout(4000); if (attempt === 3) throw e; }
}
const mtok = await tokenOf(mgr);
const mclaims = JSON.parse(Buffer.from(mtok.split(".")[1], "base64").toString("utf8"));
log("  manager holds pos.order.refund?", mclaims.permissions.includes("pos.order.refund"));

const id = await openInOrderManagement(mgr, orderNo);
log("  drawer id:", id);
await shot(mgr, "02a-manager-paid-drawer");
const managerView = await drawerProbe(mgr);
log("  MANAGER sees:", JSON.stringify(managerView, null, 1));
saveState({ managerHasRefund: mclaims.permissions.includes("pos.order.refund"), managerView });

log("\n--- VERDICT INPUTS ---");
log("  manager notice :", JSON.stringify(managerView.notice));
log("  manager refund button on screen:", managerView.refundTrigger);
await browser.close();
log("\nF13 step 2 done");
