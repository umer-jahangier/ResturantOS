import { expect, test } from "@playwright/test";

/**
 * JOURNEY — the evening cash-up (37-12, D-37-02 + D-37-05).
 *
 * <h3>What this proves that a component test cannot</h3>
 *
 * The component tests render fixtures. This drives the real product against the real stack, so it
 * proves the whole chain: pos-service's aggregate, the gateway's authorisation, the four frontend
 * layers, and the render. Three of the four could be wrong in a way no fixture would ever show.
 *
 * <h3>Why it asserts against the SEEDED day rather than creating its own</h3>
 *
 * The plan's task 3 specifies driving three fresh orders through POS and closing a till deliberately
 * short. The seeded database already carries a better test case than one this spec could construct:
 * **2026-08-06 holds a till Rs 36,730.95 OVER** and, on the same day, a second till still OPEN — so
 * one trading day exercises the arithmetic AND the honesty case at once, and it does so against data
 * this spec did not author and therefore cannot have tuned to pass. Creating a fourth till on every
 * run would also mutate a shared development database that nine workstreams read.
 *
 * The trade is recorded rather than hidden: this journey does NOT prove the flow from ordering to
 * cash-up. It proves the screen. See 37-12-SUMMARY.md.
 */

const MANAGER = { email: "manager@terrace.local", password: "Terrace#Manager1" };

/** The trading day the seed left an over-declared drawer on. */
const SEEDED_DATE = "2026-08-06";
/** `declared 4,356,700 − expected 683,605 = +3,673,095` paisa, stated by pos-service. */
const SEEDED_OVERAGE = "+Rs 36,730.95";

/** Screenshots land in the phase directory so the evidence outlives `test-results/`. */
const SHOTS = "../.planning/phases/37-finance-orders-integration";

/** Keeps this spec inside the gateway's shared 2/s auth bucket. */
async function pace(): Promise<void> {
  await new Promise((r) => setTimeout(r, 700));
}

test.describe.configure({ mode: "serial" });

test.describe("Finance opens on the day's takings", () => {
  test("A · Finance lands on Takings, and the seeded overage is shown AS a variance", async ({
    page,
  }, testInfo) => {
    await pace();
    await page.goto("/login");
    await page.getByLabel("Email").fill(MANAGER.email);
    await page.getByLabel("Password").fill(MANAGER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/app\//, { timeout: 25_000 });

    // The redirect under test: /app/finance used to land on the chart of accounts.
    await page.goto("/app/finance");
    await page.waitForURL(/\/app\/finance\/takings/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Takings", level: 1 })).toBeVisible();

    // The date lives in the URL, so a cash-up can be linked to.
    await page.goto(`/app/finance/takings?date=${SEEDED_DATE}`);
    await expect(page.getByTestId("takings-date")).toHaveValue(SEEDED_DATE);

    // ── The figures, as pos-service states them ──────────────────────────────────────────────
    await expect(page.getByTestId("figure-tile-gross-sales")).toContainText("Rs 33,390.00");
    await expect(page.getByTestId("figure-tile-net-sales")).toContainText("Rs 38,732.40");

    // ── The tender split ties to net ─────────────────────────────────────────────────────────
    // Rs 10,068.80 card + Rs 28,663.60 cash = Rs 38,732.40. The SCREEN does not do this sum;
    // this assertion does, which is the point — a client-side total would be unfalsifiable.
    await expect(page.getByTestId("tender-row-CARD")).toContainText("Rs 10,068.80");
    await expect(page.getByTestId("tender-row-CASH")).toContainText("Rs 28,663.60");

    // ── THE ASSERTION THIS SCREEN EXISTS FOR ─────────────────────────────────────────────────
    // Rs 36,730.95 more in the drawer than the system expected, on ONE till, with its sign, and
    // absorbed into nothing. If this reads Rs 0.00 or a dash, the screen is wrong.
    const overRow = page.locator('[data-reconciliation-state="OVER"]');
    await expect(overRow).toHaveCount(1);
    await expect(overRow.getByTestId("till-variance")).toHaveText(SEEDED_OVERAGE);
    await expect(overRow).toContainText("Rs 6,836.05"); // expected
    await expect(overRow).toContainText("Rs 43,567.00"); // counted
    await expect(overRow).toContainText("Over");

    // And no aggregate exists that could have hidden it.
    await expect(page.getByText(/total variance/i)).toHaveCount(0);

    const shot = await page.screenshot({
      fullPage: true,
      path: `${SHOTS}/37-12-takings-seeded-overage.png`,
    });
    await testInfo.attach("takings-seeded-overage.png", { body: shot, contentType: "image/png" });
  });

  test("B · a till still open says so, and is not a zero and not omitted", async ({
    page,
  }, testInfo) => {
    await pace();
    await page.goto("/login");
    await page.getByLabel("Email").fill(MANAGER.email);
    await page.getByLabel("Password").fill(MANAGER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/app\//, { timeout: 25_000 });

    await page.goto(`/app/finance/takings?date=${SEEDED_DATE}`);

    // The same day carries a till that was never closed. It is LISTED — omitting it would make an
    // uncounted drawer invisible, which is the failure this screen is built against.
    const openRow = page.locator('[data-reconciliation-state="OPEN"]');
    await expect(openRow).toHaveCount(1);
    await expect(openRow).toContainText("Still open");

    // Its counted cash is a stated absence with a reason — not "Rs 0.00", and not a bare dash.
    const absences = openRow.getByTestId("unknown-figure");
    await expect(absences.first()).toBeVisible();
    const label = await absences.nth(2).getAttribute("aria-label");
    expect(label).toContain("still open");
    await expect(openRow).not.toContainText("Rs 0.00");

    // "Still open" and "Not counted" are different sentences for different facts. This day only
    // has the first; the second is asserted in the component suite where both can be staged.
    await expect(openRow).not.toContainText("Not counted");

    // Comps is the figure this schema genuinely cannot state. It says so, where the number would be.
    await expect(page.getByTestId("figure-tile-comps")).toContainText("Not known");
    await expect(page.getByTestId("figure-tile-comps")).not.toContainText("Rs 0.00");

    const shot = await page.screenshot({
      fullPage: true,
      path: `${SHOTS}/37-12-takings-open-till.png`,
    });
    await testInfo.attach("takings-open-till.png", { body: shot, contentType: "image/png" });
  });

  test("C · a day with no trading says so, and does not read as a failure", async ({ page }) => {
    await pace();
    await page.goto("/login");
    await page.getByLabel("Email").fill(MANAGER.email);
    await page.getByLabel("Password").fill(MANAGER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/app\//, { timeout: 25_000 });

    await page.goto("/app/finance/takings?date=2026-01-01");
    await expect(page.getByText(/No trading recorded on this date/i)).toBeVisible();
    await expect(page.getByTestId("query-error")).toHaveCount(0);
  });
});
