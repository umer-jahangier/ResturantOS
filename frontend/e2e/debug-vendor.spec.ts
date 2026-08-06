import { test } from "@playwright/test";

const MANAGER = { tenant: "demo", email: "manager1@demo.local", password: "Manager1#2026" };

test("debug: what does the vendor detail page actually do", async ({ page }) => {
  test.setTimeout(180_000);

  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e).slice(0, 300)));
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 400) {
      errors.push(`HTTP ${r.status()} ${r.url().slice(0, 140)}`);
    }
  });

  await page.goto("/login?tenant=" + MANAGER.tenant, { waitUntil: "networkidle", timeout: 45_000 });
  await page.locator('input[type="email"]').waitFor({ state: "visible", timeout: 20_000 });
  // Fills before hydration never reach react-hook-form's state.
  await page.locator('button[type="submit"]').waitFor({ state: "visible", timeout: 20_000 });
  await page.locator('input[type="email"]').fill(MANAGER.email);
  await page.locator('input[type="password"]').fill(MANAGER.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/app\//, { timeout: 45_000 });
  console.log("LOGGED IN ->", page.url());

  await page.goto("/app/purchasing/vendors", { waitUntil: "networkidle", timeout: 45_000 });
  console.log("LIST URL ->", page.url());

  const links = page.locator('a[href^="/app/purchasing/vendors/"]');
  const n = await links.count();
  console.log("VENDOR LINKS:", n);
  for (let i = 0; i < Math.min(n, 5); i++) {
    console.log("  href[" + i + "] =", await links.nth(i).getAttribute("href"));
  }

  if (n > 0) {
    await links.first().click();
    await page.waitForTimeout(6000);
    console.log("AFTER CLICK URL ->", page.url());
    const h1 = await page
      .locator("h1")
      .first()
      .textContent()
      .catch(() => null);
    console.log("H1 ->", JSON.stringify(h1));
    const btns = await page.getByRole("button").allTextContents();
    console.log("BUTTONS ->", JSON.stringify(btns.slice(0, 15)));
  }

  console.log("ERRORS ->", errors.length ? JSON.stringify(errors.slice(0, 8), null, 2) : "none");
});
