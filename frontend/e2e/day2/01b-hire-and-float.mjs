/* DAY 2 — step 1b: the owner hires today's cashier; the MANAGER counts the float into
 * that named cashier's drawer (the F11 path the previous walkthrough said did not exist). */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, finding, apiGet, log, BASE } from "./lib.mjs";

const STAMP = Date.now().toString().slice(-6);
const NEW = {
  slug: "floating-terrace",
  email: `day2.cashier.${STAMP}@terrace.local`,
  fullName: `Day2 Cashier ${STAMP}`,
  newPassword: "Day2#Cashier1",
};
const browser = await newBrowser();
log("  new hire will be:", NEW.email);

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

// ── owner hires ───────────────────────────────────────────────────────────────
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
await go(owner, "/app/users", { waitMs: 5000 });
await owner.getByRole("button", { name: /add (a )?user|new user/i }).first().click();
await owner.waitForTimeout(1200);
await owner.locator("input[type=email]").first().fill(NEW.email);
const nameInput = owner.locator('input[placeholder="Optional"]');
if (await nameInput.count()) await nameInput.first().fill(NEW.fullName);
const branchSel = owner.locator("#create-user-branch");
const branchOpts = await branchSel.locator("option").allTextContents();
const mainIdx = branchOpts.findIndex((t) => /HQ|Floating Terrace$/i.test(t.trim()));
await branchSel.selectOption({ index: mainIdx > 0 ? mainIdx : 1 });
await owner.waitForTimeout(500);
const roleSel = owner.locator("[data-testid=role-select]");
const roleOpts = await roleSel.locator("option").allTextContents();
await roleSel.selectOption({ label: roleOpts.find((t) => /cashier/i.test(t)) });
await owner.waitForTimeout(400);
await owner.getByRole("button", { name: /^Create user$/i }).click();
await owner.waitForTimeout(4000);
const otp = await owner.evaluate(
  () => document.querySelector("[data-testid=one-time-password-value]")?.textContent?.trim() ?? null,
);
log("  one-time password:", otp);
await shot(owner, "01c-account-created");
if (!otp) throw new Error("no one-time password");
await owner.getByRole("button", { name: /^Done$/i }).click();
await owner.waitForTimeout(800);

// ── the new hire signs in and sets a password ────────────────────────────────
const hire = await newPage(browser);
await fillLogin(hire, NEW.email, otp);
const onChange =
  hire.url().includes("change-password") || (await hire.locator("[data-testid=forced-password-change]").count()) > 0;
log("  forced change screen:", onChange, "at", hire.url());
if (onChange) {
  const inputs = hire.locator("input[type=password]");
  const n = await inputs.count();
  const byName = async (re, val) => {
    for (let i = 0; i < n; i++) {
      const nm = ((await inputs.nth(i).getAttribute("name")) ?? "") + ((await inputs.nth(i).getAttribute("id")) ?? "");
      if (re.test(nm)) {
        await inputs.nth(i).fill(val);
        return true;
      }
    }
    return false;
  };
  await byName(/current|old/i, otp);
  await byName(/^newPassword$|new(?!.*confirm)/i, NEW.newPassword);
  await byName(/confirm/i, NEW.newPassword);
  await hire.locator('button[type="submit"]').first().click();
  await hire.waitForTimeout(5000);
  log("  after change-password at:", hire.url());
  await shot(hire, "01d-after-password-change");
}
if (hire.url().includes("/login")) {
  finding({ id: "D2-01", sev: "cosmetic", what: "after setting a password the new hire is bounced to /login and must retype it" });
  await fillLogin(hire, NEW.email, NEW.newPassword);
  log("  re-login landed at:", hire.url());
}
const hireTok = await hire.evaluate(async () => {
  const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  const j = await r.json().catch(() => null);
  const at = j?.accessToken ?? j?.data?.accessToken ?? null;
  if (!at) return null;
  const p = JSON.parse(atob(at.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  return { sub: p.sub, perms: p.permissions ?? p.perms ?? [], branchId: p.branchId, tenantId: p.tenantId };
});
log("  new cashier subject:", JSON.stringify(hireTok).slice(0, 500));

// ── MANAGER opens the drawer for that NAMED cashier ──────────────────────────
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
await go(mgr, "/app/pos/tills", { waitMs: 4000 });
const openBtn = mgr.getByRole("button", { name: /open a drawer/i });
log("  'Open a drawer' present for manager:", await openBtn.count());
await openBtn.first().click();
await mgr.waitForTimeout(1500);
const dlg = await mgr.evaluate(() => {
  const d = document.querySelector("[role=dialog]");
  if (!d) return null;
  return {
    text: d.innerText.replace(/\s+/g, " ").trim().slice(0, 900),
    inputs: Array.from(d.querySelectorAll("input,select")).map((i) => ({
      tag: i.tagName, id: i.id, name: i.getAttribute("name"), type: i.getAttribute("type"),
      ph: i.getAttribute("placeholder"),
      opts: i.tagName === "SELECT" ? Array.from(i.options).map((o) => o.textContent.trim()) : undefined,
    })),
    btns: Array.from(d.querySelectorAll("button")).map((b) => b.textContent.trim()),
  };
});
log("  open-drawer dialog:", JSON.stringify(dlg, null, 1).slice(0, 2000));
await shot(mgr, "01e-manager-open-drawer-dialog");
saveState({ newCashier: NEW, tempPassword: otp, hireTok, openDrawerDialog: dlg });
await browser.close();
