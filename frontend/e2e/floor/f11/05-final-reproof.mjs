/*
 * F11 FINAL RE-PROOF — driven against the jar that is actually deployed, after
 * `scripts/check-stale-jars.sh` reported checked=16 stale=0.
 *
 * Hires a second cashier so the whole path is exercised from an empty drawer again:
 *   no drawer → manager hands one over by name → the cashier's own terminal shows it →
 *   the cashier is refused, by name, when they try to open one for the manager.
 */
import { writeFileSync } from "node:fs";
import {
  BASE, PEOPLE, newBrowser, newPage, login, go, shot, apiGet, apiSend, tokenOf, OUT, log,
} from "./lib.mjs";

const STAMP = Date.now().toString().slice(-6);
const NEW = {
  slug: "floating-terrace",
  email: `f11.final.${STAMP}@terrace.local`,
  fullName: `F11 Final ${STAMP}`,
  newPassword: "Shift#Cashier1",
};
const out = { newCashier: NEW };
const note = (k, v) => {
  out[k] = v;
  log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
};
const claimsOf = (tok) =>
  JSON.parse(Buffer.from(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());

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

const strip = (page) =>
  page.evaluate(() => {
    const c = document.querySelector("[data-testid=close-till-button]");
    if (c) return c.parentElement.innerText.replace(/\s+/g, " ").trim();
    const o = document.querySelector("[data-testid=open-till-button]");
    if (o) return o.parentElement.innerText.replace(/\s+/g, " ").trim();
    return "(no till strip)";
  });

const browser = await newBrowser();

// owner hires
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
await go(owner, "/app/users", { waitMs: 5000 });
await owner.getByRole("button", { name: /add (a )?user|new user/i }).first().click();
await owner.waitForTimeout(1200);
await owner.locator("input[type=email]").first().fill(NEW.email);
const nm = owner.locator('input[placeholder="Optional"]');
if (await nm.count()) await nm.first().fill(NEW.fullName);
const bs = owner.locator("#create-user-branch");
const bo = await bs.locator("option").allTextContents();
const mi = bo.findIndex((x) => /HQ|Floating Terrace$/i.test(x.trim()));
await bs.selectOption({ index: mi > 0 ? mi : 1 });
await owner.waitForTimeout(400);
const rs = owner.locator("[data-testid=role-select]");
const ro = await rs.locator("option").allTextContents();
await rs.selectOption({ label: ro.find((x) => /cashier/i.test(x)) });
await owner.getByRole("button", { name: /^Create user$/i }).click();
await owner.waitForTimeout(4000);
const otp = await owner.evaluate(
  () => document.querySelector("[data-testid=one-time-password-value]")?.textContent?.trim() ?? null,
);
if (!otp) throw new Error("no one-time password");
await owner.getByRole("button", { name: /^Done$/i }).click();

// the hire signs in and changes their password
const hire = await newPage(browser);
await fillLogin(hire, NEW.email, otp);
const inputs = hire.locator("input[type=password]");
const n = await inputs.count();
if (n >= 3) {
  await inputs.nth(0).fill(otp);
  await inputs.nth(1).fill(NEW.newPassword);
  await inputs.nth(2).fill(NEW.newPassword);
  await hire.locator('button[type="submit"]').first().click();
  await hire.waitForTimeout(5000);
}
if (hire.url().includes("/login")) await fillLogin(hire, NEW.email, NEW.newPassword);

await go(hire, "/app/pos", { waitMs: 7000 });
await shot(hire, "30-final-cashier-before");
note("stripBefore", await strip(hire));
const hireTok = await tokenOf(hire);
const hc = claimsOf(hireTok);
note("cashierUserId", hc.sub);

// the manager hands the drawer over
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
const mc = claimsOf(await tokenOf(mgr));
await go(mgr, "/app/pos/tills", { waitMs: 6000 });
await mgr.locator("[data-testid=open-drawer-for-cashier-button]").first().click();
await mgr.waitForTimeout(2500);
await mgr.locator("[data-testid=open-drawer-cashier-select]").selectOption(hc.sub);
await mgr.locator("[data-testid=open-drawer-float-input]").fill("5000.00");
await mgr.waitForTimeout(600);
note("summary", await mgr.evaluate(
  () => document.querySelector("[data-testid=open-drawer-summary]")?.innerText.replace(/\s+/g, " ").trim() ?? null));
await shot(mgr, "31-final-manager-panel");
await mgr.locator("[data-testid=open-drawer-confirm-button]").click();
await mgr.waitForTimeout(2000);
await shot(mgr, "32-final-manager-toast");
note("toast", await mgr.evaluate(() => {
  const t = document.querySelector("[data-sonner-toast]");
  return t ? t.innerText.replace(/\s+/g, " ").trim() : null;
}));

// the cashier's own terminal
await go(hire, "/app/pos", { waitMs: 7000 });
await shot(hire, "33-final-cashier-after");
note("stripAfter", await strip(hire));
const mine = await apiGet(hire, `/api/v1/pos/tills?cashierId=${hc.sub}&status=OPEN`, hireTok);
note("ownTillRow", JSON.stringify(mine.body?.data ?? mine.body).slice(0, 300));

// refused, by name
const refusal = await apiSend(hire, "POST", "/api/v1/pos/tills",
  { branchId: hc.branch_id, openingFloatPaisa: 500000, cashierId: mc.sub }, hireTok);
note("refusalStatus", refusal.status);
note("refusalDetail", refusal.body?.detail ?? refusal.body?.error?.message ?? null);

writeFileSync(`${OUT}/final-reproof.json`, JSON.stringify(out, null, 2));
await browser.close();
log("\nfinal re-proof done");
