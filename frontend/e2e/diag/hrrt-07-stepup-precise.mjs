/* Precisely: after "Sign in again" + TOTP, does Approve work WITHOUT any further navigation? */
import { P, login, newPage, shot, totpNow, visit } from "./hrrt-lib.mjs";

const { browser, page } = await newPage();
const net = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!/\/api\/v1\/(hr\/payroll|auth)\//.test(u)) return;
  let t = "";
  if (r.status() >= 400) { try { t = (await r.text()).slice(0, 160); } catch {} }
  net.push(`${new Date().toISOString().slice(11, 19)} ${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "")}${t ? " :: " + t : ""}`);
});
const toasts = async () =>
  (await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])).map((s) => s.replace(/\n/g, " | "));

try {
  await login(page, P.owner);
  await visit(page, "/app/hr/payroll", { persona: P.owner, waitMs: 3500 });
  const row = () => page.locator("main .rounded.border", { hasText: "7/2026" }).first();
  await row().getByRole("button", { name: "Approve", exact: true }).click();
  await page.waitForTimeout(3500);
  console.log("A1 status:", (await row().innerText()).split("\n")[0]);

  await page.getByRole("button", { name: /Sign in again/i }).or(page.getByRole("link", { name: /Sign in again/i })).first().click();
  await page.waitForTimeout(4000);
  const pwd = page.locator('input[name="password"], input#password');
  if (await pwd.count()) {
    const em = page.locator('input[name="email"], input#email');
    if (await em.count()) await em.first().fill(P.owner.email);
    await pwd.first().fill(P.owner.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(3500);
  }
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    await totp.first().fill(totpNow(P.owner.totpSecret));
    await page.locator('button[type="submit"]').first().click();
  }
  // Wait for the app to land itself back on payroll. NO manual navigation from here on.
  await page.waitForURL(/\/app\/hr\/payroll/, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);
  console.log("landed:", page.url());
  await shot(page, "stepup-01-back-on-payroll");

  for (let attempt = 1; attempt <= 3; attempt++) {
    const btn = row().getByRole("button", { name: "Approve", exact: true });
    if (!(await btn.count())) { console.log(`A${attempt + 1}: no Approve button — row is`, (await row().innerText()).split("\n")[0]); break; }
    await btn.click();
    await page.waitForTimeout(4000);
    const line = (await row().innerText()).split("\n")[0];
    console.log(`A${attempt + 1} (no navigation since re-auth): toasts=${JSON.stringify(await toasts())} row="${line}"`);
    await shot(page, `stepup-0${attempt + 1}-approve-attempt`);
    if (line.includes("APPROVED")) break;
    await page.waitForTimeout(2000);
  }

  // If approved, finish the cycle.
  const pay = row().getByRole("button", { name: "Mark paid" });
  if (await pay.count()) {
    await pay.click();
    await page.waitForTimeout(4500);
    console.log("PAY:", JSON.stringify(await toasts()), "row:", (await row().innerText()).split("\n")[0]);
    await shot(page, "stepup-05-paid");
  }
} catch (e) {
  console.log("FATAL", String(e).slice(0, 400));
  await shot(page, "stepup-FATAL");
} finally {
  console.log("\n[network]");
  for (const l of net) console.log("   " + l);
  await browser.close();
}
