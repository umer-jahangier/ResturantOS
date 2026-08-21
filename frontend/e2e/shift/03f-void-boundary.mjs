/*
 * SHIFT STEP 3f — where exactly does the cashier's Void stop working?
 *
 * pos.rego line 18 requires `input.resource.status == "OPEN"` for pos.order.void.own, while
 * the client renders the Void trigger for `OPEN || SENT_TO_KDS`. So:
 *
 *   - a check saved as a DRAFT (never fired) should void.
 *   - the same check once FIRED should 403 — which is the void a restaurant actually needs.
 *
 * And the check the cashier cannot void is the one that will block their till at close.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, apiGet, apiSend, tokenOf, log, BASE } from "./lib.mjs";

const st = loadState();
const NEW = st.newCashier;
const browser = await newBrowser();

async function signIn(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password ?? who.newPassword);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  log("  ✓", who.email);
}

const cash = await newPage(browser);
await signIn(cash, NEW);

// ── a DRAFT check the cashier never fired ─────────────────────────────────────
log("\n=== a check saved as a DRAFT — can the cashier void it? ===");
await go(cash, "/app/pos", { waitMs: 7000 });
const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().waitFor({ timeout: 20000 });
await tiles.nth(7).click();
await cash.waitForTimeout(600);
await cash.locator("[data-testid=save-draft-button]").click();
await cash.waitForTimeout(6000);
await shot(cash, "03r-draft-saved");
const draftNo = await cash.evaluate((known) => {
  const found = Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0])));
  return found.filter((f) => !known.includes(f));
}, [st.order1No, st.order2No, st.order3No]);
log("  draft order numbers on screen:", JSON.stringify(draftNo));

const tok = await tokenOf(cash);
const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));
const bid = claims.branch_id ?? claims.branchId;
const list = await apiGet(cash, `/api/v1/pos/orders?branchId=${bid}&size=60`, tok);
const rows = list.body?.data ?? [];
const drafts = rows.filter((o) => o.cashierId === claims.sub);
log("  my orders:", JSON.stringify(drafts.map((o) => ({ no: o.orderNo, s: o.settlementStatus, d: o.derivedStatus, p: o.paymentStatus }))));
saveState({ myOrdersMid: drafts.map((o) => ({ id: o.orderId, no: o.orderNo, s: o.settlementStatus, d: o.derivedStatus, p: o.paymentStatus })) });

const draft = drafts.find((o) => o.settlementStatus === "DRAFT" || o.derivedStatus === "DRAFT");
if (draft) {
  const r = await apiSend(cash, "POST", `/api/v1/pos/orders/${draft.orderId}/void`, { reason: "shift walkthrough — voiding an unfired draft" }, tok);
  log(`  POST /void on the DRAFT (${draft.orderNo}, status ${draft.settlementStatus}) →`, r.status, JSON.stringify(r.body).slice(0, 220));
  saveState({ voidDraft: { no: draft.orderNo, status: r.status, body: r.body } });
} else {
  log("  ! no DRAFT row found among my orders");
}

// ── the FIRED check again, to state the contrast on one run ───────────────────
const fired = drafts.find((o) => o.orderNo === st.order3No);
if (fired) {
  const r2 = await apiSend(cash, "POST", `/api/v1/pos/orders/${fired.orderId}/void`, { reason: "shift walkthrough — voiding a fired check" }, tok);
  log(`  POST /void on the FIRED check (${fired.orderNo}, status ${fired.settlementStatus}) →`, r2.status, JSON.stringify(r2.body).slice(0, 220));
  saveState({ voidFired: { no: fired.orderNo, status: r2.status, body: r2.body } });
}

// ── the manager, who holds void.any ───────────────────────────────────────────
log("\n=== the manager tries the same fired check ===");
const mgr = await newPage(browser);
await signIn(mgr, PEOPLE.manager);
await go(mgr, "/app/pos", { waitMs: 6000 });
const mtok = await tokenOf(mgr);
const mclaims = JSON.parse(Buffer.from(mtok.split(".")[1], "base64").toString("utf8"));
const mperms = mclaims.permissions ?? mclaims.authorities ?? [];
log("  manager void perms:", JSON.stringify((Array.isArray(mperms) ? mperms : []).filter((p) => /void|refund|discount/.test(p))));
const r3 = await apiSend(mgr, "POST", `/api/v1/pos/orders/${st.order3Id}/void`, { reason: "shift walkthrough — manager voiding a fired, unpaid check" }, mtok);
log("  manager POST /void on the fired check →", r3.status, JSON.stringify(r3.body).slice(0, 260));
saveState({ voidFiredManager: { status: r3.status, body: r3.body }, managerPerms: mperms });

// ── discount on an UNFIRED check ──────────────────────────────────────────────
log("\n=== discount on a check that has NOT been fired ===");
const list2 = await apiGet(cash, `/api/v1/pos/orders?branchId=${bid}&size=60`, tok);
const rows2 = list2.body?.data ?? [];
const stillDraft = rows2.find((o) => o.cashierId === claims.sub && (o.settlementStatus === "DRAFT"));
log("  candidate:", JSON.stringify(stillDraft && { no: stillDraft.orderNo, s: stillDraft.settlementStatus }));
if (stillDraft) {
  for (const scope of ["ORDER", "LINE"]) {
    const d = await apiSend(cash, "POST", `/api/v1/pos/orders/${stillDraft.orderId}/discounts`, { scope, type: "PERCENT", value: 10 }, tok);
    log(`  cashier discount scope=${scope} on DRAFT →`, d.status, JSON.stringify(d.body).slice(0, 200));
    saveState({ [`discountDraft_${scope}`]: { status: d.status, body: JSON.stringify(d.body).slice(0, 400) } });
  }
}

await browser.close();
log("\nstep 3f done");
