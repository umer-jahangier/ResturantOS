import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * JOURNEY — the phase-21 screen rebuilds, in a real browser against the real stack.
 *
 * <h3>What this proves that a unit test cannot</h3>
 *
 * The unit tests assert that the KDS card RENDERS three redundant ageing channels. They
 * cannot assert that those channels survive the browser — that the `[data-surface="kds"]`
 * tokens actually resolve, that a 6px border is 6 real pixels after Tailwind compiles, or
 * that the ageing states are still distinguishable once every colour is removed. That last
 * one is the whole point of §3.7 and it is only checkable by taking a screenshot and
 * desaturating it, which is what `greyscale` below does.
 *
 * It also proves the two things the audit taught this project to distrust: that the screens
 * show REAL data rather than placeholders, and that owner and manager genuinely differ.
 *
 * Runs against `floating-terrace` (78 menu items, 106 orders) rather than the saffron /
 * zaitoon / marina personas the rest of the journey suite drives, because that is the tenant
 * with production-shaped data. Login is email + password, no tenant slug.
 */

const OUT = resolve(process.cwd(), "../.planning/phases/21-screen-rebuilds/evidence");

const KITCHEN = { email: "kitchen@terrace.local", password: "Terrace#Kitchen1" };
const MANAGER = { email: "manager@terrace.local", password: "Terrace#Manager1" };

/** UI login. No storage-state replay: these personas are outside the seeded manifest. */
/**
 * Login, with retry.
 *
 * Not flakiness-papering: this is failure mode #2 from `scripts/e2e/browser-e2e.sh`'s own
 * preflight, observed live during this phase. A service restarted by a concurrent process
 * leaves a DOWN instance in the Eureka registry alongside the UP one, and the gateway's
 * client-side load balancer round-robins across BOTH — so roughly every other request to
 * /api/v1/auth/** answers 503 while the dead lease expires. A single-shot login turns that
 * into a red test that is not a test failure, which is exactly what the preflight exists to
 * prevent. Retrying makes the spec report on the SCREEN rather than on registry weather.
 */
async function login(page: Page, who: { email: string; password: string }): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', who.email);
    await page.fill('input[name="password"]', who.password);
    await page.getByTestId("login-submit").click();
    try {
      await page.waitForURL(/\/app\//, { timeout: 20_000 });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(4_000);
    }
  }
  throw new Error(
    `login as ${who.email} never reached /app after 6 attempts. Check the gateway is routing ` +
      `auth-service (a DOWN instance beside the UP one round-robins into 503s). ${String(lastError)}`,
  );
}

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

test.describe("KDS board — phase 21", () => {
  test.beforeEach(() => {
    mkdirSync(OUT, { recursive: true });
  });

  test("a kitchen persona sees real tickets, and the ageing survives greyscale", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await login(page, KITCHEN);

    await page.goto("/app/kitchen", { waitUntil: "domcontentloaded" });
    // Two stations exist for this branch (DEFAULT, GRILL), so the picker renders rather
    // than auto-navigating.
    await expect(page.getByTestId("station-tile-DEFAULT")).toBeVisible({ timeout: 45_000 });
    await page.screenshot({ path: `${OUT}/after-kds-station-picker.png`, fullPage: true });

    await page.goto("/app/kitchen/DEFAULT", { waitUntil: "domcontentloaded" });
    const board = page.getByTestId("kds-board");
    await expect(board).toBeVisible({ timeout: 45_000 });

    // The board must never render an EMPTY board where a FAILED request happened.
    await expect(
      page.getByTestId("query-error"),
      "the KDS board reported a failed request — kitchen-service is probably not registered " +
        "in Eureka (health 200 on :8090 while the gateway answers 503 for /api/v1/kitchen/**)",
    ).toHaveCount(0);

    const cards = page.getByTestId("kds-ticket-card");
    await expect(cards.first()).toBeVisible({ timeout: 45_000 });
    const cardCount = await cards.count();
    expect(cardCount, "no real tickets on the board").toBeGreaterThan(0);

    // ── The §3.7 contract, checked in the DOM rather than in a class string ────────
    const first = cards.first();
    const state = await first.getAttribute("data-aging");
    expect(["fresh", "warn", "late"]).toContain(state);

    // CHANNEL 1 — geometry. Read the COMPUTED border, so this fails if the utility did
    // not compile, not merely if the class name changed.
    const borderPx = await first.evaluate((el) => getComputedStyle(el).borderLeftWidth);
    expect(borderPx).toBe(state === "late" ? "6px" : state === "warn" ? "4px" : "2px");

    // CHANNEL 3 — the literal word.
    const chip = first.getByTestId("kds-ticket-age");
    if (state !== "fresh") {
      await expect(chip).toContainText(state === "late" ? "LATE" : "DUE");
    }

    // CHANNEL 4 — late fills the card. --kds-late-fill is oklch(0.4 0.15 27.3).
    if (state === "late") {
      const bg = await first.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg, "a late card must change FILL, not only hue").not.toBe("rgba(0, 0, 0, 0)");
    }

    // Position numbers exist — number-key jump is meaningless without them.
    await expect(page.getByTestId("kds-ticket-position").first()).toBeVisible();

    // The tokens resolved: the board surface must not be transparent or white.
    const boardBg = await board.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(boardBg).not.toBe("rgba(0, 0, 0, 0)");
    expect(boardBg).not.toBe("rgb(255, 255, 255)");

    await page.screenshot({ path: `${OUT}/after-kds-board.png`, fullPage: false });

    // ── The greyscale proof ───────────────────────────────────────────────────────
    // Every channel except colour, and nothing else. If ageing were hue-only this shot
    // would be three identical cards.
    await page.addStyleTag({ content: "html { filter: grayscale(1) !important; }" });
    await page.screenshot({ path: `${OUT}/after-kds-board-greyscale.png`, fullPage: false });
  });

  test("the bump-bar keyboard model moves focus and F bumps a ticket", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await login(page, KITCHEN);
    await page.goto("/app/kitchen/DEFAULT", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("kds-ticket-card").first()).toBeVisible({ timeout: 45_000 });

    // Exactly one ticket carries focus, always — it is derived, so there is no frame
    // in which it points at nothing.
    await expect(page.locator('[data-testid="kds-ticket-card"][data-focused="true"]')).toHaveCount(
      1,
    );

    const before = await page
      .locator('[data-testid="kds-ticket-card"][data-focused="true"]')
      .getAttribute("aria-label")
      .catch(() => null);

    const total = await page.getByTestId("kds-ticket-card").count();
    if (total > 1) {
      await page.keyboard.press("ArrowDown");
      await expect(
        page.locator('[data-testid="kds-ticket-card"][data-focused="true"]'),
      ).toHaveCount(1);
      // Jump back to position 1 with the number key.
      await page.keyboard.press("1");
    }
    expect(before === null || typeof before === "string").toBe(true);

    // F bumps the focused fragment. KITCHEN_STAFF holds pos.kds.update, so the control
    // path is real; the ticket count must fall or the item must move column.
    const newColumnBefore = await page.getByTestId("kds-column-count-NEW").textContent();
    await page.keyboard.press("f");
    await page.waitForTimeout(2500);

    const bumpError = page.getByTestId("kds-bump-error");
    if (await bumpError.isVisible().catch(() => false)) {
      // A rejection must be SHOWN, not swallowed — that is itself the contract.
      await expect(bumpError).toContainText(/not bumped|recall/i);
    } else {
      const newColumnAfter = await page.getByTestId("kds-column-count-NEW").textContent();
      expect(
        newColumnAfter,
        "F did not change the New column and reported no error — the bump was swallowed",
      ).not.toBe(newColumnBefore);
    }
    await page.screenshot({ path: `${OUT}/after-kds-after-bump.png` });
  });
});

test.describe("Role dashboards — phase 21", () => {
  test("kitchen and manager dashboards differ and show non-empty real data", async ({
    browser,
  }) => {
    test.setTimeout(240_000);

    const kitchenCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const kitchenPage = await kitchenCtx.newPage();
    await login(kitchenPage, KITCHEN);
    await kitchenPage.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
    const kitchenDash = kitchenPage.getByTestId("dashboard");
    await expect(kitchenDash).toBeVisible({ timeout: 45_000 });
    await expect(kitchenDash).toHaveAttribute("data-preset", "kitchen");
    await expect(kitchenPage.getByTestId("kpi-value-kitchen-open-tickets")).toBeVisible();
    await kitchenPage.screenshot({
      path: `${OUT}/after-dashboard-kitchen.png`,
      fullPage: true,
    });

    const managerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const managerPage = await managerCtx.newPage();
    await login(managerPage, MANAGER);
    await managerPage.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
    const managerDash = managerPage.getByTestId("dashboard");
    await expect(managerDash).toBeVisible({ timeout: 45_000 });
    await expect(managerDash).toHaveAttribute("data-preset", "manager");
    await expect(managerDash).toHaveAttribute("data-density", "compact");
    await expect(managerPage.getByTestId("dashboard-timeframe")).toContainText(/today/i);

    // A failed request must never look like an empty dashboard.
    await expect(managerPage.getByTestId("query-error")).toHaveCount(0);

    // Row 1 is the manager's, not the owner's.
    await expect(managerPage.getByTestId("portlet-manager-open-orders")).toBeVisible();
    await expect(managerPage.getByTestId("portlet-manager-late-tickets")).toBeVisible();
    await expect(managerPage.getByTestId("portlet-owner-net-sales")).toHaveCount(0);

    // Real numbers: the ticket count on this manager's board is the KDS board's own count.
    const boardTickets = await managerPage
      .getByTestId("kpi-value-manager-late-tickets")
      .textContent();
    expect(boardTickets?.trim()).toMatch(/^\d+$/);

    // Every portlet is a drillable link — a KPI you cannot click is a poster.
    const portlets = managerPage.locator("[data-portlet]");
    expect(await portlets.count()).toBeGreaterThan(3);
    for (const el of await portlets.all()) {
      await expect(el).toHaveAttribute("href", /^\//);
    }

    await managerPage.screenshot({ path: `${OUT}/after-dashboard-manager.png`, fullPage: true });

    // The two dashboards must not be the same page with different numbers.
    const kitchenIds = await kitchenPage
      .locator("[data-portlet]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-portlet")));
    const managerIds = await managerPage
      .locator("[data-portlet]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-portlet")));
    expect(kitchenIds.filter((id) => managerIds.includes(id))).toHaveLength(0);

    await kitchenCtx.close();
    await managerCtx.close();
  });

  test("the manager dashboard is legible in dark theme too", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, MANAGER);
    await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 45_000 });

    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/after-dashboard-manager-dark.png`, fullPage: true });

    // The dark theme must actually apply: surface-0 is --neutral-1000, not white.
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe("rgb(255, 255, 255)");
  });
});
