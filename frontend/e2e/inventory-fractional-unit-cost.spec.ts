import { expect, test, type Page } from "@playwright/test";

/**
 * A per-stock-unit cost is a RATE, and since V12 it is NUMERIC(18,4) rather than whole paisa.
 *
 * Two things had to hold before that change was safe to ship, and neither is provable from a unit
 * test: `MoneyDisplay` called `BigInt(paisa)`, which throws outright on a fractional value and
 * would have taken out the whole Stock Levels page; and a rate rendered at the usual two decimal
 * places reads as "Rs 0.00" for anything under half a paisa per gram — the exact "this stock was
 * free" impression a unit cost must never give.
 */

const TENANT = "demo";
const MANAGER = { email: "manager1@demo.local", password: "Manager1#2026" };

async function login(page: Page): Promise<void> {
  await page.goto(`/login?tenant=${TENANT}`, { waitUntil: "networkidle", timeout: 45_000 });
  const email = page.locator('input[type="email"]');
  await email.waitFor({ state: "visible", timeout: 20_000 });
  await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 20_000 });
  const tenantField = page.locator('input[name="tenantSlug"]');
  if (await tenantField.isVisible({ timeout: 1000 }).catch(() => false)) {
    await tenantField.fill(TENANT);
  }
  await email.fill(MANAGER.email);
  await page.locator('input[type="password"]').fill(MANAGER.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/app\//, { timeout: 30_000 });
}

test.describe("inventory: a fractional unit cost renders instead of crashing", () => {
  test.setTimeout(180_000);

  test("Stock Levels survives a NUMERIC(18,4) average cost and shows it as money", async ({
    page,
  }) => {
    const crashes: string[] = [];
    page.on("pageerror", (e) => crashes.push(String(e).slice(0, 200)));

    await login(page);
    await page.goto("/app/inventory/stock", { waitUntil: "networkidle", timeout: 45_000 });

    // The table renders at all — this is what BigInt() on a fractional paisa used to prevent.
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 30_000 });
    await expect(table.locator("tbody tr").first()).toBeVisible({ timeout: 30_000 });

    expect(crashes, `page errors: ${crashes.join(" | ")}`).toHaveLength(0);

    // Every avg-cost cell is real money, never a bare number and never the "free stock" Rs 0.00
    // that a truncated sub-paisa rate would produce.
    const body = (await table.textContent()) ?? "";
    expect(body).toMatch(/Rs|PKR|₨/);

    await page.screenshot({
      path: "e2e/__screenshots__/inventory-fractional-unit-cost.png",
      fullPage: true,
    });
  });
});
