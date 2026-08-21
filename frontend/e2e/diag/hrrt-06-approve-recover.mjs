import { P, login, newPage, shot, totpNow, visit } from "./hrrt-lib.mjs";

const { browser, page } = await newPage();
const net = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!/\/api\/v1\/(hr|auth)\//.test(u)) return;
  let t = "";
  if (r.status() >= 400) { try { t = (await r.text()).slice(0, 200); } catch {} }
  net.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "")}${t ? " :: " + t : ""}`);
});
const toasts = async () =>
  (await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])).map((s) => s.replace(/\n/g, " | "));

try {
  await login(page, P.owner);
  await visit(page, "/app/hr/payroll", { persona: P.owner, waitMs: 3500 });
  const row = page.locator("main .rounded.border", { hasText: "7/2026" }).first();

  await row.getByRole("button", { name: "Approve", exact: true }).click();
  await page.waitForTimeout(4000);
  console.log("[approve#1]", (await page.locator("main").innerText()).slice(0, 60).replace(/\n/g, " | "));

  // The notice's only remedy.
  const again = page.getByRole("button", { name: /Sign in again/i }).or(page.getByRole("link", { name: /Sign in again/i }));
  console.log("[recover] 'Sign in again' control count:", await again.count());
  if (await again.count()) {
    await again.first().click();
    await page.waitForTimeout(4000);
    console.log("[recover] landed on:", page.url());
    await shot(page, "rec-01-after-signin-again");
    const body = await page.locator("body").innerText();
    console.log("[recover] screen says:", body.slice(0, 400).replace(/\n{2,}/g, " | "));

    // Complete whatever it asks for.
    const pwd = page.locator('input[name="password"], input#password');
    const totp = page.locator('input[name="totpCode"], input#totpCode');
    if (await pwd.count()) {
      const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
      if (await slug.count()) await slug.first().fill(P.owner.slug);
      const em = page.locator('input[name="email"], input#email');
      if (await em.count()) await em.first().fill(P.owner.email);
      await pwd.first().fill(P.owner.password);
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(4000);
    }
    const totp2 = page.locator('input[name="totpCode"], input#totpCode');
    if (await totp2.count()) {
      await totp2.first().fill(totpNow(P.owner.totpSecret));
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(5000);
    }
    console.log("[recover] after re-auth, url:", page.url());
    console.log("[recover] did it return the user to payroll?", page.url().includes("/hr/payroll") ? "YES" : "NO — dumped elsewhere");
    await shot(page, "rec-02-after-reauth");
  }

  // Approve again.
  await visit(page, "/app/hr/payroll", { persona: P.owner, waitMs: 3500 });
  const row2 = page.locator("main .rounded.border", { hasText: "7/2026" }).first();
  const btn = row2.getByRole("button", { name: "Approve", exact: true });
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(4500);
    console.log("[approve#2] toasts:", JSON.stringify(await toasts()));
    console.log("[approve#2] row:", (await row2.innerText()).split("\n")[0]);
  }
  await shot(page, "rec-03-approved");

  const payBtn = row2.getByRole("button", { name: "Mark paid" });
  if (await payBtn.count()) {
    await payBtn.click();
    await page.waitForTimeout(4500);
    console.log("[pay] toasts:", JSON.stringify(await toasts()));
    console.log("[pay] row:", (await row2.innerText()).split("\n")[0]);
  } else {
    console.log("[pay] no Mark paid button");
  }
  await shot(page, "rec-04-paid");
} catch (e) {
  console.log("FATAL", String(e).slice(0, 400));
  await shot(page, "rec-FATAL");
} finally {
  console.log("\n[network]");
  for (const l of net) console.log("   " + l);
  await browser.close();
}
