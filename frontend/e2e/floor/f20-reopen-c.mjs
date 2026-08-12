/*
 * F20 re-open, part C — the paths beside the one that was proved.
 *
 *  C1. The TILL the tipped check is bound to: does its expected cash carry the tip?
 *      (physically: amount + tip − change is what is in the drawer)
 *  C2. The DAILY TAKINGS the owner reads: does the tip appear, and does it reconcile?
 *  C3. PERMISSIONS. Who can set this? CASHIER, WAITER, MANAGER, KITCHEN — screen and API.
 *  C4. CROSS-TENANT. Control Bistro's OWNER against Floating Terrace's branch id.
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, apiSend, log } from "../shift/lib.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F20/reopen");
mkdirSync(OUT, { recursive: true });
const R = {};
const rec = (k, v) => { R[k] = v; log(`  [${k}]`, JSON.stringify(v)); };
const save = () => writeFileSync(`${OUT}/reopen-c.json`, JSON.stringify(R, null, 2));

const BRANCH = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
const TILL = "42ed0480-fe85-4751-9382-078e42dd4c9f";
const TIPPED_ORDER = "af087e09-9f60-4082-a500-b7e5b2727512"; // ORD-20260812-0411

const CONTROL = {
  owner: { slug: "control-bistro-isolation-test-tenant", email: "owner@control.local",
           password: "Control#Owner1", totpSecret: "77YCNG564SWVW7YPUCJRGDSE6ZSCC3GQ" },
};
const WAITER = { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" };
const KITCHEN = PEOPLE.kitchen;

async function signIn(page, who, n = 3) {
  for (let i = 1; ; i += 1) {
    try { return await login(page, who); } catch (e) { if (i >= n) throw e; await page.waitForTimeout(4000); }
  }
}
const clean = (page) => page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((n) => n.remove()));

const browser = await newBrowser();

// ── C1. the till ────────────────────────────────────────────────────────────
log("\n=== C1. the till the tipped check is bound to ===");
const cash = await newPage(browser);
await signIn(cash, PEOPLE.cashier);
const recon = await apiGet(cash, `/api/v1/pos/tills/${TILL}/reconciliation?branchId=${BRANCH}`);
const d = recon.body?.data;
rec("C1-reconciliation", {
  status: recon.status,
  openingFloat: d?.session?.openingFloatPaisa,
  cashCollectedPaisa: d?.cashCollectedPaisa,
  nonCashCollectedPaisa: d?.nonCashCollectedPaisa,
  liveExpectedCashPaisa: d?.liveExpectedCashPaisa,
  orderCount: d?.orderCount,
  tippedOrderLine: (d?.orders ?? []).find((o) => o.orderId === TIPPED_ORDER) ?? null,
});
// the till REVIEW screen a cashier/manager actually reads
const t1 = await go(cash, "/app/pos/till", { waitMs: 6000, allowTrouble: true });
await clean(cash);
rec("C1-till-screen", { trouble: t1, text: await cash.evaluate(() => (document.body.innerText || "").slice(0, 700).replace(/\n+/g, " | ")) });
await cash.screenshot({ path: `${OUT}/r12-till-screen.png` });
save();

// ── C2. the owner's daily takings ───────────────────────────────────────────
log("\n=== C2. daily takings ===");
const own = await newPage(browser);
await signIn(own, PEOPLE.owner);
const today = new Date().toISOString().slice(0, 10);
for (const path of [
  `/api/v1/reporting/daily-takings?branchId=${BRANCH}&businessDate=${today}`,
  `/api/v1/pos/reports/daily-takings?branchId=${BRANCH}&businessDate=${today}`,
]) {
  const r = await apiGet(own, path);
  if (r.status === 200) { rec("C2-takings-api", { path, status: r.status, body: r.body?.data }); break; }
  rec(`C2-takings-miss-${path.split("/")[3]}`, { path, status: r.status });
}
const t2 = await go(own, "/app/reports/daily-takings", { waitMs: 7000, allowTrouble: true });
await clean(own);
rec("C2-takings-screen", { trouble: t2,
  text: await own.evaluate(() => (document.body.innerText || "").slice(0, 1600).replace(/\n+/g, " | ")) });
await own.screenshot({ path: `${OUT}/r13-daily-takings.png`, fullPage: true });
save();

// ── C3. permissions ─────────────────────────────────────────────────────────
log("\n=== C3. who can set the service charge ===");
const WRITE = { enabled: true, ratePct: 25, label: "HIJACKED", dineIn: true, takeaway: true, pickup: true };
const results = {};
for (const [name, who] of [["cashier", PEOPLE.cashier], ["waiter", WAITER], ["manager", PEOPLE.manager], ["kitchen", KITCHEN]]) {
  const p = await newPage(browser);
  try {
    await signIn(p, who);
    const get = await apiGet(p, `/api/v1/pos/branches/${BRANCH}/service-charge`);
    const put = await apiSend(p, "PUT", `/api/v1/pos/branches/${BRANCH}/service-charge`, WRITE);
    const screen = await go(p, "/app/settings/service-charge", { waitMs: 5000, allowTrouble: true });
    await clean(p);
    const form = await p.evaluate(() => ({
      formPresent: !!document.querySelector("[data-testid=service-charge-enabled]"),
      rateDisabled: document.querySelector("[data-testid=service-charge-rate]")?.disabled ?? null,
      saveDisabled: document.querySelector("[data-testid=service-charge-save]")?.disabled ?? null,
      readOnlyNotice: document.querySelector("[data-testid=service-charge-read-only-notice]")?.textContent?.trim() ?? null,
      inNav: Array.from(document.querySelectorAll("a")).some((a) => a.getAttribute("href") === "/app/settings/service-charge"),
      head: (document.body.innerText || "").slice(0, 160).replace(/\n+/g, " | "),
    }));
    results[name] = { getStatus: get.status, canManageFlag: get.body?.data?.canManage ?? null,
      putStatus: put.status, putCode: put.body?.error?.code ?? put.body?.code ?? null,
      screenTrouble: screen, form };
    await p.screenshot({ path: `${OUT}/r14-${name}-service-charge.png` });
  } catch (e) {
    results[name] = { error: e.message };
  }
  await p.close();
  rec(`C3-${name}`, results[name]);
  save();
}

// verify nothing was actually hijacked
const stillOk = await apiGet(own, `/api/v1/pos/branches/${BRANCH}/service-charge`);
rec("C3-policy-after-attempts", { status: stillOk.status, body: stillOk.body?.data });
save();

// ── C4. cross-tenant ────────────────────────────────────────────────────────
log("\n=== C4. Control Bistro's owner against Floating Terrace's branch ===");
const foreign = await newPage(browser);
await signIn(foreign, CONTROL.owner);
const fGet = await apiGet(foreign, `/api/v1/pos/branches/${BRANCH}/service-charge`);
const fPut = await apiSend(foreign, "PUT", `/api/v1/pos/branches/${BRANCH}/service-charge`, WRITE);
rec("C4-foreign", {
  getStatus: fGet.status, getBody: fGet.body?.data,
  putStatus: fPut.status, putBody: fPut.body?.data ?? fPut.body?.error ?? fPut.body,
});
const afterForeign = await apiGet(own, `/api/v1/pos/branches/${BRANCH}/service-charge`);
rec("C4-terrace-policy-after", { status: afterForeign.status, body: afterForeign.body?.data });
save();

log("\ndone");
await browser.close();
