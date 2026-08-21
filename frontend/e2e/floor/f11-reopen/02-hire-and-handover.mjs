/*
 * F11 RE-OPEN, step 2 — the whole handover, driven independently.
 *
 * The seeded cashier already holds a drawer carrying 94 orders from other agents' runs and
 * cannot be cashed up, so a fresh employee is hired to get a clean drawer. Everything after
 * that is the DONE definition, verbatim:
 *
 *   manager@terrace.local opens a Rs 5,000.00 float for a NAMED cashier
 *   → that cashier signs in in another context and sees the open till with that float.
 */
import { writeFileSync } from "node:fs";
import {
  BASE,
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
  OUT,
  log,
} from "./lib.mjs";

const STAMP = Date.now().toString().slice(-6);
const NEW = {
  slug: "floating-terrace",
  email: `reopen.f11.${STAMP}@terrace.local`,
  fullName: `Reopen F11 ${STAMP}`,
  newPassword: "Reopen#Cashier1",
};
const j = { newCashier: { ...NEW, newPassword: "(set)" } };
const note = (k, v) => {
  j[k] = v;
  log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
};

async function signIn(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(NEW.slug);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
}

const browser = await newBrowser();

// ── 1. OWNER hires a cashier ─────────────────────────────────────────────────
log("\n=== 1. owner hires a cashier ===");
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
let t = await go(owner, "/app/users", { waitMs: 6000 });
note("ownerUsersTrouble", t);

await owner.getByRole("button", { name: /add (a )?user|new user/i }).first().click();
await owner.waitForTimeout(1500);
await owner.locator("input[type=email]").first().fill(NEW.email);
const nameInput = owner.locator('input[placeholder="Optional"]');
if (await nameInput.count()) await nameInput.first().fill(NEW.fullName);
const branchSel = owner.locator("#create-user-branch");
const branchOpts = await branchSel.locator("option").allTextContents();
note("branchOptions", branchOpts.map((x) => x.trim()));
const mainIdx = branchOpts.findIndex((x) => /HQ|Floating Terrace$/i.test(x.trim()));
await branchSel.selectOption({ index: mainIdx > 0 ? mainIdx : 1 });
await owner.waitForTimeout(400);
const roleSel = owner.locator("[data-testid=role-select]");
const roleOpts = await roleSel.locator("option").allTextContents();
await roleSel.selectOption({ label: roleOpts.find((x) => /cashier/i.test(x)) });
await owner.waitForTimeout(400);
await owner.getByRole("button", { name: /^Create user$/i }).click();
await owner.waitForTimeout(5000);
const otp = await owner.evaluate(
  () => document.querySelector("[data-testid=one-time-password-value]")?.textContent?.trim() ?? null,
);
if (!otp) throw new Error("no one-time password panel — cannot continue");
await owner.getByRole("button", { name: /^Done$/i }).click();
await owner.waitForTimeout(800);
log("  ✓ hired " + NEW.email);

// ── 2. the new cashier signs in and changes their password ───────────────────
log("\n=== 2. the new cashier signs in ===");
const hire = await newPage(browser);
await signIn(hire, NEW.email, otp);
// The forced-change screen renders AT /login (no route change, no dedicated testid): the tell
// is the currentPassword field. Detecting on the URL is what made the first attempt fall through.
if (await hire.locator('input[name="currentPassword"]').count()) {
  log("  … forced password change");
  await hire.locator('input[name="currentPassword"]').fill(otp);
  await hire.locator('input[name="newPassword"]').fill(NEW.newPassword);
  await hire.locator('input[name="confirmPassword"]').fill(NEW.newPassword);
  await hire.getByRole("button", { name: /change password/i }).first().click();
  await hire.waitForTimeout(6000);
  note("afterChangeUrl", hire.url());
}
if (hire.url().includes("/login") && !(await hire.locator('input[name="currentPassword"]').count())) {
  await signIn(hire, NEW.email, NEW.newPassword);
}
note("cashierLandedAt", hire.url());

t = await go(hire, "/app/pos", { waitMs: 8000 });
note("cashierPosTrouble", t);
await shot(hire, "10-cashier-before-no-active-till");
note("cashierStripBefore", await tillStrip(hire));

const hireTok = await tokenOf(hire);
const hc = claims(hireTok);
note("cashierUserId", hc.sub);
note("cashierBranchId", hc.branch_id);
note("cashierTillPerms", (hc.permissions ?? []).filter((p) => p.includes("till")));

// ── 3. the manager hands the drawer over ─────────────────────────────────────
log("\n=== 3. manager@terrace.local opens a Rs 5,000.00 float for that cashier ===");
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
const mgrTok = await tokenOf(mgr);
const mc = claims(mgrTok);
note("managerUserId", mc.sub);
note("managerBranchId", mc.branch_id);
note("managerTillPerms", (mc.permissions ?? []).filter((p) => p.includes("till")));

t = await go(mgr, "/app/pos/tills", { waitMs: 7000 });
note("managerTillReviewTrouble", t);
await shot(mgr, "11-manager-till-review");

const btn = mgr.locator("[data-testid=open-drawer-for-cashier-button]");
note("openDrawerButtonCount", await btn.count());
await btn.first().click();
await mgr.waitForTimeout(2500);
await shot(mgr, "12-open-drawer-panel");

// Does the picker list the person the owner hired sixty seconds ago, by name?
const labelForHire = await mgr.evaluate((id) => {
  const sel = document.querySelector("[data-testid=open-drawer-cashier-select]");
  const o = sel && Array.from(sel.options ?? []).find((x) => x.value === id);
  return o ? o.text.trim() : null;
}, hc.sub);
note("pickerLabelForNewHire", labelForHire);

await mgr.locator("[data-testid=open-drawer-cashier-select]").selectOption(hc.sub);
await mgr.locator("[data-testid=open-drawer-float-input]").fill("5000.00");
await mgr.waitForTimeout(900);
note(
  "summarySentence",
  await mgr.evaluate(
    () =>
      document.querySelector("[data-testid=open-drawer-summary]")?.innerText.replace(/\s+/g, " ").trim() ??
      null,
  ),
);
await shot(mgr, "13-open-drawer-filled");

await mgr.locator("[data-testid=open-drawer-confirm-button]").click();
await mgr.waitForTimeout(5000);
await shot(mgr, "14-manager-after-open");
note(
  "managerToast",
  await mgr.evaluate(() => {
    const el = document.querySelector("[data-sonner-toast]");
    return el ? el.innerText.replace(/\s+/g, " ").trim() : null;
  }),
);
note(
  "openDrawerPanelError",
  await mgr.evaluate(
    () => document.querySelector("[data-testid=open-drawer-error]")?.innerText.trim() ?? null,
  ),
);

await go(mgr, "/app/pos/tills", { waitMs: 6000 });
await shot(mgr, "15-till-review-row");
note(
  "tillReviewTopRow",
  await mgr.evaluate(() => {
    const tr = document.querySelector("tbody tr");
    return tr ? tr.innerText.replace(/\s+/g, " ").trim() : null;
  }),
);

// ── 4. the cashier's own terminal, reloaded ──────────────────────────────────
log("\n=== 4. the cashier reloads their own terminal ===");
await go(hire, "/app/pos", { waitMs: 8000 });
await shot(hire, "16-cashier-after-till-open");
note("cashierStripAfter", await tillStrip(hire));

const mine = await apiGet(hire, `/api/v1/pos/tills?cashierId=${hc.sub}&status=OPEN`, hireTok);
note("cashierOwnTillRow", JSON.stringify(mine.body?.data ?? mine.body).slice(0, 400));
j.tillId = mine.body?.data?.[0]?.id ?? null;
j.newCashierPassword = NEW.newPassword;

writeFileSync(`${OUT}/journal.json`, JSON.stringify(j, null, 2));
log("\nstep 2 done");
await browser.close();
