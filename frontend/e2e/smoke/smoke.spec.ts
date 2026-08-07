import { expect, test } from "@playwright/test";

// D6/W1 scaffold: ONE smoke journey. Visiting a protected /app URL while
// unauthenticated must redirect to /login — exercising proxy.ts's optimistic
// `has_session` check and the real `/app` URL segment established in 04-01.
// The full ~50-journey staging suite is cross-phase and NOT a Phase-4 deliverable.
test("unauthenticated /app/dashboard redirects to /login", async ({ page }) => {
  await page.goto("/app/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
