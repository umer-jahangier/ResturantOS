/*
 * F1 re-open — local login wrapper.
 *
 * The shared shift/lib.mjs `login()` assumes the tenant-slug field is on the login form. While this
 * re-open was running another agent shipped an email-first login: the slug input is now behind a
 * "Use a restaurant identifier instead" toggle, and the email-only POST /api/v1/auth/login comes
 * back 503 ("The service is temporarily unavailable") — measured, screenshotted. So this reveals
 * the slug field first and signs in the way that still works. Nothing else is changed.
 */
import { totpNow } from "../shift/lib.mjs";

export async function loginTenant(page, who) {
  await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  let slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if ((await slug.count()) === 0) {
    const toggle = page.getByText(/restaurant identifier/i).first();
    if (await toggle.count()) {
      await toggle.click();
      await page.waitForTimeout(1200);
      slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
    }
  }
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"]').first().fill(who.email);
  await page.locator('input[name="password"]').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  // The dev server recompiles under ten agents; a fixed 3.5s sleep raced it and produced a
  // "login failed" with an EMPTY alert list — i.e. nothing had gone wrong, nothing had happened yet.
  await page
    .waitForFunction(
      () =>
        !location.pathname.startsWith("/login") ||
        !!document.querySelector('input[name="totpCode"], input#totpCode') ||
        !!document.querySelector('[role="alert"]'),
      { timeout: 45000 },
    )
    .catch(() => {});
  await page.waitForTimeout(1500);
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    if (!who.totpSecret) throw new Error(`${who.email} was challenged for TOTP with no secret`);
    await totp.first().fill(totpNow(who.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }
  if (page.url().includes("/login")) {
    const why = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()).join(" | "));
    throw new Error(`login failed for ${who.email} — ${page.url()} — ${why}`);
  }
  console.log(`  ✓ signed in as ${who.email}`);
  return page;
}
