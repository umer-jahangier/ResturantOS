/*
 * F11 RE-OPEN, step 4 — the paths NEXT to the one that was fixed.
 *
 *  a. a second drawer for the same cashier — does the conflict name the TARGET?
 *  b. a person who is not a cashier (kitchen@terrace.local)
 *  c. a user id that does not exist
 *  d. a user id belonging to ANOTHER TENANT (control-bistro)
 *  e. a cashier naming THEMSELVES — the self path must be untouched
 *  f. WHOSE drawer can be closed: does close honour the custody that open now establishes?
 *  g. the cash-up of the handed-over drawer, to the paisa
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  BASE,
  PEOPLE,
  newBrowser,
  newPage,
  login,
  go,
  shot,
  apiGet,
  apiSend,
  tokenOf,
  claims,
  tillStrip,
  OUT,
  log,
} from "./lib.mjs";

const j = JSON.parse(readFileSync(`${OUT}/journal.json`, "utf8"));
const out = { ...j };
const note = (k, v) => {
  out[k] = v;
  log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
};
const brief = (r) => ({
  status: r.status,
  title: r.body?.title ?? null,
  detail: r.body?.detail ?? null,
});

async function signIn(page, slug, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill(slug);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
  if (page.url().includes("/login")) throw new Error(`login failed for ${email}`);
  log(`  ✓ signed in as ${email}`);
}

const browser = await newBrowser();
const BRANCH = j.cashierBranchId;

// ── who is who ───────────────────────────────────────────────────────────────
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
const mgrTok = await tokenOf(mgr);

const kitchen = await newPage(browser);
await signIn(kitchen, "floating-terrace", PEOPLE.kitchen.email, PEOPLE.kitchen.password);
const kc = claims(await tokenOf(kitchen));
note("kitchenUserId", kc.sub);
note("kitchenTillPerms", (kc.permissions ?? []).filter((p) => p.includes("till")));

const other = await newPage(browser);
await signIn(
  other,
  "control-bistro-isolation-test-tenant",
  "cashier@control.local",
  "Control#Cashier1",
);
const oc = claims(await tokenOf(other));
note("otherTenantCashierId", oc.sub);
note("otherTenantId", oc.tenant_id ?? oc.tenantId ?? null);

// ── a. a second drawer for the same cashier ──────────────────────────────────
log("\n=== a. a second drawer for a cashier who already holds one ===");
note(
  "secondDrawerSameCashier",
  brief(
    await apiSend(
      mgr,
      "POST",
      "/api/v1/pos/tills",
      { branchId: BRANCH, openingFloatPaisa: 100000, cashierId: j.cashierUserId },
      mgrTok,
    ),
  ),
);

// The same refusal, as the manager meets it on screen.
await go(mgr, "/app/pos/tills", { waitMs: 6000 });
await mgr.locator("[data-testid=open-drawer-for-cashier-button]").click();
await mgr.waitForTimeout(2500);
await mgr.locator("[data-testid=open-drawer-cashier-select]").selectOption(j.cashierUserId);
await mgr.waitForTimeout(800);
note(
  "onScreenAlreadyHasDrawer",
  await mgr.evaluate(
    () =>
      document.querySelector("[data-testid=open-drawer-cashier-error]")?.innerText.trim() ?? null,
  ),
);
note(
  "confirmDisabledWhenTargetHoldsADrawer",
  await mgr.locator("[data-testid=open-drawer-confirm-button]").isDisabled(),
);
await shot(mgr, "30-target-already-has-a-drawer");
await mgr.keyboard.press("Escape");
await mgr.waitForTimeout(800);

// ── b. somebody who is not a cashier ─────────────────────────────────────────
log("\n=== b. a drawer for the kitchen ===");
note(
  "drawerForKitchen",
  brief(
    await apiSend(
      mgr,
      "POST",
      "/api/v1/pos/tills",
      { branchId: BRANCH, openingFloatPaisa: 500000, cashierId: kc.sub },
      mgrTok,
    ),
  ),
);
note("kitchenInPicker", await mgr.evaluate((id) => {
  const sel = document.querySelector("[data-testid=open-drawer-cashier-select]");
  return sel ? Array.from(sel.options ?? []).some((o) => o.value === id) : null;
}, kc.sub));

// ── c. a user id that does not exist ─────────────────────────────────────────
log("\n=== c. a stranger's uuid ===");
note(
  "drawerForNobody",
  brief(
    await apiSend(
      mgr,
      "POST",
      "/api/v1/pos/tills",
      {
        branchId: BRANCH,
        openingFloatPaisa: 500000,
        cashierId: "00000000-0000-4000-8000-000000000abc",
      },
      mgrTok,
    ),
  ),
);

// ── d. ANOTHER TENANT's cashier ──────────────────────────────────────────────
log("\n=== d. a cashier belonging to another tenant ===");
note(
  "drawerForOtherTenantCashier",
  brief(
    await apiSend(
      mgr,
      "POST",
      "/api/v1/pos/tills",
      { branchId: BRANCH, openingFloatPaisa: 500000, cashierId: oc.sub },
      mgrTok,
    ),
  ),
);
// And the reverse direction: can the other tenant's manager see our roster?
note(
  "otherTenantReadsOurRoster",
  brief(await apiGet(other, `/api/v1/pos/tills/cashiers?branchId=${BRANCH}`, null)),
);

// ── e. a cashier naming themselves ───────────────────────────────────────────
log("\n=== e. the self path ===");
const cash = await newPage(browser);
await signIn(cash, "floating-terrace", j.newCashier.email, j.newCashierPassword);
const cashTok = await tokenOf(cash);
note(
  "cashierNamingThemselves",
  brief(
    await apiSend(
      cash,
      "POST",
      "/api/v1/pos/tills",
      { branchId: BRANCH, openingFloatPaisa: 500000, cashierId: j.cashierUserId },
      cashTok,
    ),
  ),
);
note(
  "cashierOmittingCashierId",
  brief(
    await apiSend(
      cash,
      "POST",
      "/api/v1/pos/tills",
      { branchId: BRANCH, openingFloatPaisa: 500000 },
      cashTok,
    ),
  ),
);

// ── f. whose drawer can be CLOSED ────────────────────────────────────────────
log("\n=== f. can a cashier close a colleague's drawer? ===");
const colleagueTill = j.otherCashierTillId ?? null;
note("managerOwnOpenTillId", (await apiGet(cash, `/api/v1/pos/tills?cashierId=${j.managerUserId}&status=OPEN`, cashTok)).body?.data?.[0]?.id ?? null);
if (out.managerOwnOpenTillId) {
  // Read first — the leak already filed. Then the write, which is the question that matters.
  note(
    "cashierReadsManagersReconciliation",
    brief(await apiGet(cash, `/api/v1/pos/tills/${out.managerOwnOpenTillId}/reconciliation`, cashTok)),
  );
}
note("colleagueTillProbed", colleagueTill);

// ── g. the cash-up of the handed-over drawer ─────────────────────────────────
log("\n=== g. the cashier cashes up the drawer they were handed ===");
await go(cash, "/app/pos", { waitMs: 8000 });
note("stripBeforeCashUp", await tillStrip(cash));
await cash.locator("[data-testid=close-till-button]").click();
await cash.waitForTimeout(3000);
const expected = (await cash.locator("[data-testid=close-till-expected]").first().innerText())
  .replace(/\s+/g, " ")
  .trim();
note("expectedCashOnScreen", expected);
await shot(cash, "31-close-panel");
await cash.locator('input[type=number]').last().fill(expected.replace(/[^0-9.]/g, ""));
await cash.waitForTimeout(900);
note(
  "varianceOnScreen",
  await cash.evaluate(
    () => document.querySelector("[data-testid=close-till-variance]")?.innerText.trim() ?? null,
  ),
);
await cash.locator("[data-testid=close-till-confirm-button]").click();
await cash.waitForTimeout(7000);
await shot(cash, "32-after-cash-up");
note("stripAfterCashUp", await tillStrip(cash));
const closed = await apiGet(cash, `/api/v1/pos/tills/${j.tillId}`, cashTok);
note("closedTillRow", JSON.stringify(closed.body?.data ?? closed.body).slice(0, 420));

// The manager's Till Review must show that drawer, closed.
await go(mgr, "/app/pos/tills", { waitMs: 6000 });
await shot(mgr, "33-manager-till-review-after");
note(
  "tillReviewTopRowAfter",
  await mgr.evaluate(() => {
    const tr = document.querySelector("tbody tr");
    return tr ? tr.innerText.replace(/\s+/g, " ").trim() : null;
  }),
);

writeFileSync(`${OUT}/journal.json`, JSON.stringify(out, null, 2));
log("\nstep 4 done");
await browser.close();
