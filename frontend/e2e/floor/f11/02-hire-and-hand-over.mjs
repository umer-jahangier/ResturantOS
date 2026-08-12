/*
 * F11 PROOF — "the duty manager counts the float and hands over the drawer".
 *
 * Driven in real Chromium, three personas in three browser contexts, no injected tokens.
 *
 *   1. OWNER hires a cashier (a fresh drawer, so every rupee after this is checkable).
 *   2. The new cashier signs in. Their terminal reads "No active till" — the walkthrough §0 state.
 *   3. MANAGER opens a Rs 5,000.00 float FOR that cashier, by name, from Till Review.
 *   4. The cashier reloads: the drawer is there, with that float.
 *   5. The cashier rings a check and settles it in CASH against that drawer.
 *   6. The cashier tries to open a drawer for someone else and is refused BY NAME.
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
  apiSend,
  tokenOf,
  OUT,
  log,
} from "./lib.mjs";

const STAMP = Date.now().toString().slice(-6);
const NEW = {
  slug: "floating-terrace",
  email: `f11.cashier.${STAMP}@terrace.local`,
  fullName: `F11 Cashier ${STAMP}`,
  newPassword: "Shift#Cashier1",
};
const journal = { newCashier: NEW };
const note = (k, v) => {
  journal[k] = v;
  log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
};

async function fillLogin(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(NEW.slug);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
}

/** The POS till strip, as the cashier reads it. */
async function tillStrip(page) {
  return page.evaluate(() => {
    const close = document.querySelector("[data-testid=close-till-button]");
    if (close) return close.parentElement.innerText.replace(/\s+/g, " ").trim();
    const open = document.querySelector("[data-testid=open-till-button]");
    if (open) return open.parentElement.innerText.replace(/\s+/g, " ").trim();
    const outage = document.querySelector("[data-testid=till-status-unavailable]");
    if (outage) return `OUTAGE: ${outage.innerText.trim()}`;
    return "(no till strip at all)";
  });
}

const browser = await newBrowser();

// ── 1. owner hires a cashier ─────────────────────────────────────────────────
log("\n=== 1. OWNER hires a cashier ===");
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
let t = await go(owner, "/app/users", { waitMs: 5000 });
log("  /app/users trouble:", JSON.stringify(t));

await owner.getByRole("button", { name: /add (a )?user|new user/i }).first().click();
await owner.waitForTimeout(1200);
await owner.locator("input[type=email]").first().fill(NEW.email);
const nameInput = owner.locator('input[placeholder="Optional"]');
if (await nameInput.count()) await nameInput.first().fill(NEW.fullName);

const branchSel = owner.locator("#create-user-branch");
const branchOpts = await branchSel.locator("option").allTextContents();
const mainIdx = branchOpts.findIndex((x) => /HQ|Floating Terrace$/i.test(x.trim()));
await branchSel.selectOption({ index: mainIdx > 0 ? mainIdx : 1 });
await owner.waitForTimeout(400);
const roleSel = owner.locator("[data-testid=role-select]");
const roleOpts = await roleSel.locator("option").allTextContents();
await roleSel.selectOption({ label: roleOpts.find((x) => /cashier/i.test(x)) });
await owner.waitForTimeout(400);
await owner.getByRole("button", { name: /^Create user$/i }).click();
await owner.waitForTimeout(4000);

const otp = await owner.evaluate(
  () => document.querySelector("[data-testid=one-time-password-value]")?.textContent?.trim() ?? null,
);
if (!otp) throw new Error("no one-time password panel — cannot continue");
note("oneTimePassword", "(captured)");
await owner.getByRole("button", { name: /^Done$/i }).click();
await owner.waitForTimeout(800);

// ── 2. the new cashier signs in — no drawer ──────────────────────────────────
log("\n=== 2. the new cashier signs in ===");
const hire = await newPage(browser);
await fillLogin(hire, NEW.email, otp);
const onChange =
  hire.url().includes("change-password") ||
  (await hire.locator("[data-testid=forced-password-change]").count()) > 0;
if (onChange) {
  const inputs = hire.locator("input[type=password]");
  const n = await inputs.count();
  const byName = async (re, val) => {
    for (let i = 0; i < n; i++) {
      const nm = (await inputs.nth(i).getAttribute("name")) ?? "";
      const id = (await inputs.nth(i).getAttribute("id")) ?? "";
      if (re.test(nm) || re.test(id)) {
        await inputs.nth(i).fill(val);
        return true;
      }
    }
    return false;
  };
  const okCur = await byName(/current|old/i, otp);
  await byName(/^newPassword$|new(?!.*confirm)/i, NEW.newPassword);
  await byName(/confirm/i, NEW.newPassword);
  if (!okCur && n === 3) {
    await inputs.nth(0).fill(otp);
    await inputs.nth(1).fill(NEW.newPassword);
    await inputs.nth(2).fill(NEW.newPassword);
  }
  await hire.locator('button[type="submit"]').first().click();
  await hire.waitForTimeout(5000);
}
if (hire.url().includes("/login")) await fillLogin(hire, NEW.email, NEW.newPassword);
note("cashierLandedAt", hire.url());

t = await go(hire, "/app/pos", { waitMs: 7000 });
log("  cashier /app/pos trouble:", JSON.stringify(t));
await shot(hire, "01-cashier-before-no-active-till");
note("cashierStripBefore", await tillStrip(hire));

const hireTok = await tokenOf(hire);
const hireClaims = JSON.parse(
  Buffer.from(hireTok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
);
note("cashierUserId", hireClaims.sub);
note("cashierBranchId", hireClaims.branch_id);
note("cashierTillPerms", (hireClaims.permissions ?? []).filter((p) => p.includes("till")));

// ── 3. the manager opens the drawer FOR them, by name ────────────────────────
log("\n=== 3. MANAGER opens a Rs 5,000.00 float for the named cashier ===");
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
const mgrTok = await tokenOf(mgr);
const mgrClaims = JSON.parse(
  Buffer.from(mgrTok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
);
note("managerUserId", mgrClaims.sub);
note("managerTillPerms", (mgrClaims.permissions ?? []).filter((p) => p.includes("till")));

t = await go(mgr, "/app/pos/tills", { waitMs: 6000 });
log("  /app/pos/tills trouble:", JSON.stringify(t));
await shot(mgr, "02-manager-till-review");

const btn = mgr.locator("[data-testid=open-drawer-for-cashier-button]");
note("openDrawerButtonCount", await btn.count());
await btn.first().click();
await mgr.waitForTimeout(2500);
await shot(mgr, "03-open-drawer-panel");

const options = await mgr.locator("[data-testid=open-drawer-cashier-select] option").allTextContents();
note("pickerOptions", options.slice(0, 12));

await mgr.locator("[data-testid=open-drawer-cashier-select]").selectOption(hireClaims.sub);
await mgr.locator("[data-testid=open-drawer-float-input]").fill("5000.00");
await mgr.waitForTimeout(600);
const summary = await mgr.evaluate(
  () => document.querySelector("[data-testid=open-drawer-summary]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
);
note("summarySentence", summary);
await shot(mgr, "04-open-drawer-filled");

await mgr.locator("[data-testid=open-drawer-confirm-button]").click();
await mgr.waitForTimeout(4500);
await shot(mgr, "05-manager-after-open");
const toastText = await mgr.evaluate(() => {
  const el = document.querySelector("[data-sonner-toast]");
  return el ? el.innerText.replace(/\s+/g, " ").trim() : null;
});
note("managerToast", toastText);

// The till table itself, read as the manager sees it.
await go(mgr, "/app/pos/tills", { waitMs: 5000 });
await shot(mgr, "06-till-review-row");
const firstRow = await mgr.evaluate(() => {
  const tr = document.querySelector("tbody tr");
  return tr ? tr.innerText.replace(/\s+/g, " ").trim() : null;
});
note("tillReviewTopRow", firstRow);

// ── 4. the cashier reloads ───────────────────────────────────────────────────
log("\n=== 4. the cashier's own terminal ===");
await go(hire, "/app/pos", { waitMs: 7000 });
await shot(hire, "07-cashier-after-till-open");
note("cashierStripAfter", await tillStrip(hire));

const mine = await apiGet(hire, `/api/v1/pos/tills?cashierId=${hireClaims.sub}&status=OPEN`, hireTok);
note("cashierOwnTillRow", JSON.stringify(mine.body?.data ?? mine.body).slice(0, 400));

writeFileSync(`${OUT}/journal.json`, JSON.stringify(journal, null, 2));
log("\nstep 2 done — journal written");
await browser.close();
