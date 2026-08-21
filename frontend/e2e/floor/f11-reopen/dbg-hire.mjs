/* debug: hire a cashier and watch every screen on the way in */
import { BASE, PEOPLE, newBrowser, newPage, login, go, shot, log } from "./lib.mjs";

const STAMP = Date.now().toString().slice(-6);
const NEW = {
  slug: "floating-terrace",
  email: `reopen.f11.${STAMP}@terrace.local`,
  fullName: `Reopen F11 ${STAMP}`,
  newPassword: "Reopen#Cashier1",
};

const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
await go(owner, "/app/users", { waitMs: 6000 });
await owner.getByRole("button", { name: /add (a )?user|new user/i }).first().click();
await owner.waitForTimeout(1500);
await owner.locator("input[type=email]").first().fill(NEW.email);
const nameInput = owner.locator('input[placeholder="Optional"]');
if (await nameInput.count()) await nameInput.first().fill(NEW.fullName);
const branchSel = owner.locator("#create-user-branch");
const branchOpts = await branchSel.locator("option").allTextContents();
const mainIdx = branchOpts.findIndex((x) => /HQ/i.test(x.trim()));
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
log("otp:", otp ? "(captured, len " + otp.length + ")" : "NONE");
await shot(owner, "dbg-01-owner-otp");

const hire = await newPage(browser);
await hire.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await hire.waitForTimeout(1500);
const slug = hire.locator('input[name="tenantSlug"], input#tenantSlug');
if (await slug.count()) await slug.first().fill(NEW.slug);
await hire.locator('input[name="email"], input#email').first().fill(NEW.email);
await hire.locator('input[name="password"], input#password').first().fill(otp);
await hire.locator('button[type="submit"]').first().click();
await hire.waitForTimeout(6000);
log("after otp login url:", hire.url());
await shot(hire, "dbg-02-after-otp-login");
log(
  "body:",
  (await hire.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 500))),
);
const fields = await hire.evaluate(() =>
  Array.from(document.querySelectorAll("input")).map((i) => ({
    type: i.type,
    name: i.name,
    id: i.id,
  })),
);
log("fields:", JSON.stringify(fields));
console.log("EMAIL=" + NEW.email);
console.log("OTP=" + otp);
await browser.close();
