/*
 * F11 RE-OPEN, part 5 — did the change break the path it did NOT set out to change, and
 * does it work for the OTHER roles that were given the new permission?
 *
 *   H. the pre-F11 path: a CASHIER opens their OWN drawer from the POS strip, with no
 *      cashierId anywhere near the request. This is the case that was never broken, and the
 *      one a "fix" of this shape is most likely to break.
 *   I. the OWNER — the other role auth changelog 090 granted pos.till.open.other — can also
 *      hand a drawer over. A thing fixed for one role is not fixed for the others.
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
  OUT,
  ok,
  log,
} from "./lib.mjs";

const second = JSON.parse(readFileSync(`${OUT}/journal-2.json`, "utf8"));
const HIRE = second.secondHire;
const hireId = second.secondHireId;
const out = {};
const checks = [];
const note = (k, v) => {
  out[k] = v;
  log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
};
const check = (...a) => {
  const r = ok(...a);
  checks.push(r);
  return r;
};

async function signIn(page, email, password) {
  for (let i = 0; i < 3; i++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await s.count()) await s.first().fill("floating-terrace");
    await page.locator('input[name="email"], input#email').first().fill(email);
    await page.locator('input[name="password"], input#password').first().fill(password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(5500);
    if (!page.url().includes("/login")) return log(`  ✓ signed in as ${email}`);
  }
  throw new Error(`login failed for ${email}`);
}
async function loginHard(page, who, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      await login(page, who);
      return;
    } catch (e) {
      if (i === tries) throw e;
      await page.waitForTimeout(6000);
    }
  }
}
const stripOf = (page) =>
  page.evaluate(() => {
    const c = document.querySelector("[data-testid=close-till-button]");
    if (c) return c.parentElement.innerText.replace(/\s+/g, " ").trim();
    const o = document.querySelector("[data-testid=open-till-button]");
    if (o) return o.parentElement.innerText.replace(/\s+/g, " ").trim();
    return "(no till strip)";
  });

const browser = await newBrowser();

// ═══ H. the cashier's OWN drawer, the pre-F11 path ═══════════════════════════
log("\n=== H. a cashier opens their OWN drawer from the POS strip ===");
const cash = await newPage(browser);
await signIn(cash, HIRE.email, HIRE.newPassword);
let tok = await tokenOf(cash);

// Cash the handed-over drawer up first (zero orders on it, so nothing is disturbed).
await go(cash, "/app/pos", { waitMs: 7000 });
await cash.locator("[data-testid=close-till-button]").click();
await cash.waitForTimeout(2500);
const expected = await cash.evaluate(
  () => (document.body.innerText.match(/Expected cash:\s*Rs ([\d,]+\.\d\d)/) ?? [])[1] ?? null,
);
note("expectedAtCashUp", expected);
await cash.locator('input[placeholder="e.g. 12500.00"]').first().fill((expected ?? "7250.50").replace(/,/g, ""));
await cash.waitForTimeout(600);
await cash.getByRole("button", { name: /^Close Till$/i }).last().click();
await cash.waitForTimeout(7000);
await go(cash, "/app/pos", { waitMs: 7000 });
const closed = await stripOf(cash);
note("stripAfterCashUp", closed);
await shot(cash, "70-after-cash-up");
check(/No active till/i.test(closed), "the handed-over drawer cashes up normally", closed);

// Now the cashier opens their own, by pressing the button on their own terminal.
await cash.locator("[data-testid=open-till-button]").click();
await cash.waitForTimeout(2500);
await shot(cash, "71-open-own-panel");
const ownBox = cash.locator('input[placeholder="e.g. 5000.00"], input[placeholder="e.g. 12500.00"]').first();
await ownBox.fill("3000");
await cash.waitForTimeout(600);
await cash.getByRole("button", { name: /^Open Till$/i }).last().click();
await cash.waitForTimeout(7000);
await go(cash, "/app/pos", { waitMs: 7000 });
const own = await stripOf(cash);
note("stripAfterSelfOpen", own);
await shot(cash, "72-own-drawer");
check(/Till\s*OPEN/i.test(own), "a cashier can still open their OWN drawer (the pre-F11 path)", own);
check(own.includes("Float: Rs 3,000.00"), "…with the float they counted", own);

const ownRows = await apiGet(cash, `/api/v1/pos/tills?cashierId=${hireId}&status=OPEN`, await tokenOf(cash));
const r = (ownRows.body?.data ?? [])[0] ?? {};
note("selfOpenedRow", { cashierId: r.cashierId, float: r.openingFloatPaisa });
check(r.cashierId === hireId, "…and it belongs to them", r.cashierId);
check(r.openingFloatPaisa === 300000, "…at 300000 paisa", String(r.openingFloatPaisa));

// ═══ I. the OWNER hands a drawer over too ════════════════════════════════════
log("\n=== I. the OWNER — the other role granted the new permission ===");
const owner = await newPage(browser);
await loginHard(owner, PEOPLE.owner);
const oTok = await tokenOf(owner);
const oClaims = JSON.parse(Buffer.from(oTok.split(".")[1], "base64").toString());
note("ownerHasNewPermission", (oClaims.permissions ?? []).includes("pos.till.open.other"));
check(
  (oClaims.permissions ?? []).includes("pos.till.open.other"),
  "the OWNER's token carries pos.till.open.other",
);
const ownerBranch = oClaims.branchId ?? oClaims.branch_id;
const roster = await apiGet(owner, `/api/v1/pos/tills/cashiers?branchId=${ownerBranch}`, oTok);
check(roster.status === 200, "the OWNER can read the eligible-cashier roster", String(roster.status));
const free = (roster.body?.data ?? []).find((c) => !c.hasOpenTill && c.roleCode === "CASHIER");
note("ownerPickedTarget", free ? { id: free.userId, name: free.name } : null);
if (free) {
  const r2 = await apiSend(
    owner,
    "POST",
    "/api/v1/pos/tills",
    { branchId: ownerBranch, openingFloatPaisa: 123456, cashierId: free.userId },
    oTok,
  );
  note("ownerOpenResult", { status: r2.status, cashierId: r2.body?.data?.cashierId, float: r2.body?.data?.openingFloatPaisa });
  check(r2.status === 201 || r2.status === 200, "the OWNER can hand a drawer over", String(r2.status));
  check(
    r2.body?.data?.cashierId === free.userId,
    "…and it lands on the NAMED cashier, not the owner",
    r2.body?.data?.cashierId,
  );
  check(
    r2.body?.data?.openingFloatPaisa === 123456,
    "…with an awkward float carried through to the paisa (123456)",
    String(r2.body?.data?.openingFloatPaisa),
  );
}

writeFileSync(`${OUT}/journal-3.json`, JSON.stringify({ ...out, checks5: checks }, null, 2));
log("\n--- part 5 checks ---");
checks.forEach((c) => log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.label}`));
log(`\n${checks.filter((c) => !c.pass).length} failures of ${checks.length}`);
await browser.close();
