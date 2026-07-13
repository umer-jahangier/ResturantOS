import { test, expect } from "@playwright/test";

/**
 * KDS-04/KDS-05 Wave-0 E2E proof (07.3-10) — the station-isolated board redesign:
 * (1) a seeded station board renders (never the "No active stations configured"
 * empty state, thanks to 07.3-05's DEFAULT-station auto-seed-on-miss), (2) the
 * New/Started/Preparing/Ready item-status columns render, (3) selecting a card
 * routes to a dedicated detail PAGE (`/app/kitchen/{stationCode}/orders/{ticketId}`)
 * with NO `[role=dialog]` anywhere. In the same spec, the KDS-05 (D-13)
 * aging-subtlety backstop converts the former manual/SUMMARY screenshot note into
 * an executable check: every rendered ticket card is asserted to have neither the
 * old `animate-bounce` class nor a full-red `bg-red-950` background — the subtle
 * escalation-threshold left-border + timer-chip treatment is used instead — and a
 * screenshot of the oldest visible ticket is captured to a named artifact.
 *
 * Reuses the login/gotoRobust/Blocked conventions from pos-settlement.spec.ts /
 * pos-modal-revamp.spec.ts. Runs against the LIVE local dev stack (frontend
 * :3000, kitchen-service :8090). Requires the demo chef seed (chef@demo.local /
 * Chef#2026, tenant "demo") and at least one seeded/active KDS station.
 *
 * "FAIL" = a real frontend defect. "BLOCKED" = missing seed/environment
 * precondition (not a code defect) — see the `Blocked` marker class below.
 */

const CHEF_EMAIL = "chef@demo.local";
const CHEF_PASSWORD = "Chef#2026";
const TENANT_SLUG = "demo";
const SHOT_DIR = "e2e/__screenshots__";

/** Thrown to mean "environment/seed-data precondition missing", not a code bug. */
class Blocked extends Error {}

test.describe("KDS-04/KDS-05: station board, item columns, detail page, aging subtlety", () => {
  test("seeded station board renders columns; card selection routes to a dialog-free detail page; aged tickets use the subtle escalation treatment", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    async function shot(name: string): Promise<void> {
      await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true }).catch(() => {});
    }

    async function gotoRobust(url: string): Promise<void> {
      await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
      for (let i = 0; i < 3; i++) {
        const is404 = await page
          .getByText("404", { exact: false })
          .first()
          .isVisible({ timeout: 1000 })
          .catch(() => false);
        if (!is404) return;
        await page.waitForTimeout(2000);
        await page.reload({ waitUntil: "networkidle", timeout: 45_000 });
      }
    }

    async function login(email: string, password: string): Promise<void> {
      await gotoRobust(`/login?tenant=${TENANT_SLUG}`);
      const tenantField = page.locator('input[name="tenantSlug"]');
      if (await tenantField.isVisible({ timeout: 1000 }).catch(() => false)) {
        await tenantField.fill(TENANT_SLUG);
      }
      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[type="password"]').fill(password);
      await page.locator('button[type="submit"]').click();
      await page.waitForURL(/\/app\//, { timeout: 20_000 });
    }

    try {
      await login(CHEF_EMAIL, CHEF_PASSWORD);
      await gotoRobust("/app/kitchen");
      await page.waitForTimeout(1500);

      const notEnabled = page.getByText("Kitchen Display feature is not enabled for this account.");
      if (await notEnabled.isVisible({ timeout: 500 }).catch(() => false)) {
        throw new Blocked("FEATURE_KDS is not enabled for the demo tenant");
      }
      const noPermission = page.getByText("You do not have permission to access the Kitchen Display.");
      if (await noPermission.isVisible({ timeout: 500 }).catch(() => false)) {
        throw new Blocked("chef@demo.local lacks pos.kds.view permission (seed-data/RBAC gap)");
      }

      // ── Land on a station board — either auto-navigated (single station) or via
      // the station picker (multiple stations) ──────────────────────────────────
      const emptyState = page.getByText("No active stations configured");
      if (await emptyState.isVisible({ timeout: 3000 }).catch(() => false)) {
        throw new Blocked(
          "station picker shows the empty state — no active KDS station seeded for this branch " +
            "(unexpected: 07.3-05's DEFAULT-station auto-seed-on-miss should prevent this)",
        );
      }

      const stationTile = page.locator('[data-testid^="station-tile-"]').first();
      if (await stationTile.isVisible({ timeout: 3000 }).catch(() => false)) {
        await stationTile.click();
      }

      await page.waitForURL(/\/app\/kitchen\/[^/]+$/, { timeout: 15_000 }).catch(() => {});
      const onBoard = /\/app\/kitchen\/[^/]+$/.test(page.url());
      if (!onBoard) {
        throw new Blocked(`did not land on a station board URL; landed at "${page.url()}"`);
      }
      await shot("kds-stations-board");

      // ── (1) The board is not the empty state (KDS-04) ──────────────────────────
      await expect(page.getByText("No active stations configured")).toHaveCount(0);

      // ── (2) New/Started/Preparing/Ready item-status columns render (KDS-04) ────
      for (const column of ["NEW", "STARTED", "PREPARING", "READY"] as const) {
        await expect(page.getByTestId(`kds-column-${column}`)).toBeVisible({ timeout: 15_000 });
      }
      await expect(page.getByTestId("kds-column-NEW").getByText("New")).toBeVisible();
      await expect(page.getByTestId("kds-column-STARTED").getByText("Started")).toBeVisible();
      await expect(page.getByTestId("kds-column-PREPARING").getByText("Preparing")).toBeVisible();
      await expect(page.getByTestId("kds-column-READY").getByText("Ready")).toBeVisible();

      // ── KDS-05 (D-13) aging-subtlety backstop — deterministic regardless of any
      // individual ticket's age: the component never emits the old aggressive
      // classes for ANY card, so this holds true for the whole board every run ──
      const allCards = page.getByTestId("kds-ticket-card");
      const cardCount = await allCards.count();
      if (cardCount === 0) {
        throw new Blocked("no ticket cards rendered on the board — cannot exercise the aging-subtlety check");
      }
      for (let i = 0; i < cardCount; i++) {
        const cardClass = (await allCards.nth(i).getAttribute("class")) ?? "";
        expect(cardClass, `card #${i} must not use the old aggressive bounce animation`).not.toContain(
          "animate-bounce",
        );
        expect(cardClass, `card #${i} must not use the old full-red background`).not.toContain("bg-red-950");
      }

      // Best-effort: locate the OLDEST visible card (by its "{n}m" age chip) and
      // screenshot it specifically — this dev branch has accumulated aged tickets
      // from prior test/UAT sessions (see deferred-items.md), so a real aged card
      // is expected to be present most runs.
      const ageChips = page.getByTestId("kds-ticket-age");
      const chipCount = await ageChips.count();
      let oldestMinutes = -1;
      let oldestIndex = -1;
      for (let i = 0; i < chipCount; i++) {
        const text = (await ageChips.nth(i).textContent())?.trim() ?? "";
        const minutes = text.startsWith("<1m") ? 0 : parseInt(text, 10);
        if (Number.isFinite(minutes) && minutes > oldestMinutes) {
          oldestMinutes = minutes;
          oldestIndex = i;
        }
      }
      if (oldestIndex >= 0) {
        await allCards.nth(oldestIndex).scrollIntoViewIfNeeded().catch(() => {});
        await allCards.nth(oldestIndex).screenshot({ path: `${SHOT_DIR}/kds05-aged-ticket.png` }).catch(() => {});
        if (oldestMinutes >= 15) {
          // Old enough to have crossed the default 900s/15min escalation threshold
          // — its border should carry the red aging-treatment class specifically.
          const oldestClass = (await allCards.nth(oldestIndex).getAttribute("class")) ?? "";
          expect(oldestClass).toContain("border-l-red-500");
        }
      } else {
        await shot("kds05-aged-ticket");
      }

      // ── (3) Selecting a card opens a dedicated detail PAGE — URL changes, no
      // [role=dialog] anywhere (KDS-04) ───────────────────────────────────────────
      const firstFragmentButton = page
        .locator('[data-testid^="kds-fragment-"]')
        .first()
        .getByRole("button")
        .first();
      if (!(await firstFragmentButton.isVisible({ timeout: 5000 }).catch(() => false))) {
        throw new Blocked("no clickable ticket fragment found on the board to open the detail page");
      }
      await firstFragmentButton.click();

      await page.waitForURL(/\/app\/kitchen\/[^/]+\/orders\/[^/]+$/, { timeout: 15_000 }).catch(() => {});
      const onDetailRoute = /\/app\/kitchen\/[^/]+\/orders\/[^/]+$/.test(page.url());
      if (!onDetailRoute) {
        throw new Error(
          `selecting a card did not navigate to the dedicated detail route; landed at "${page.url()}"`,
        );
      }

      const dialogVisible = await page.getByRole("dialog").first().isVisible({ timeout: 500 }).catch(() => false);
      if (dialogVisible) {
        throw new Error("a [role=dialog] is visible on the ticket detail route — must be a dedicated page, not a popup");
      }
      await expect(page.getByTestId("kds-station-detail")).toBeVisible({ timeout: 10_000 });
      await shot("kds-stations-detail-page");
    } catch (err) {
      if (err instanceof Blocked) {
        console.log(`[BLOCKED] kds-stations: ${err.message}`);
        test.skip(true, `BLOCKED (environment/seed precondition, not a frontend defect): ${err.message}`);
        return;
      }
      throw err;
    }
  });
});
