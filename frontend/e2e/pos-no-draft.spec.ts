import { test, expect, type Page } from "@playwright/test";

/**
 * Wave-0 E2E proof for POS-16/D-01 (07.3-03): the order-taking terminal holds a
 * client-only cart — no order is persisted to pos-service until the cashier
 * explicitly hits Send to Kitchen. Mirrors pos-settlement.spec.ts's login/gotoRobust
 * helpers, cashier seed constants, screenshot pattern, and Blocked-vs-FAIL
 * convention (live dev stack — frontend :3000, gateway -> pos-service :8084).
 *
 * "FAIL" = a real frontend defect (e.g. a create-order POST fires on tap — the
 * regression this spec exists to catch). "BLOCKED" = missing seed data / environment
 * precondition, not a code defect.
 */

const CASHIER_EMAIL = "cashier@demo.local";
const CASHIER_PASSWORD = "Cashier#2026";
const TENANT_SLUG = "demo";
const SHOT_DIR = "e2e/__screenshots__";

/** Thrown to mean "environment/seed-data precondition missing", not a code bug. */
class Blocked extends Error {}

// Matches ONLY the order-CREATE endpoint (`POST /api/v1/pos/orders`), never
// `/orders/{id}/items` (addItem) or `/orders/{id}/send-to-kds` (fire) — both also
// contain "/api/v1/pos/orders" as a substring, so this must anchor on the path
// ending right after "orders" (optionally followed by a query string).
const CREATE_ORDER_PATH = /\/api\/v1\/pos\/orders(\?[^/]*)?$/;

test.describe("POS no-draft client cart (07.3-03, POS-16)", () => {
  test("menu taps build a local cart with no persisted order; Send to Kitchen persists it", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);

    // Neutralize the PWA service worker so every stage exercises the fresh bundle
    // (mirrors pos-settlement.spec.ts).
    await context.addInitScript(() => {
      try {
        if ("serviceWorker" in navigator) {
          Object.defineProperty(navigator.serviceWorker, "register", {
            configurable: true,
            writable: true,
            value: () => Promise.reject(new Error("[e2e] SW registration disabled for this run")),
          });
        }
      } catch {
        /* best-effort only */
      }
    });

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
      // One retry on a slow/transient first attempt (mirrors gotoRobust's own retry
      // tolerance) — a bare login-navigation timeout is dev-stack latency, not a
      // defect in the terminal behaviour this spec exists to prove.
      for (let attempt = 0; attempt < 2; attempt++) {
        await gotoRobust(`/login?tenant=${TENANT_SLUG}`);
        const tenantField = page.locator('input[name="tenantSlug"]');
        if (await tenantField.isVisible({ timeout: 1000 }).catch(() => false)) {
          await tenantField.fill(TENANT_SLUG);
        }
        await page.locator('input[type="email"]').fill(email);
        await page.locator('input[type="password"]').fill(password);
        await page.locator('button[type="submit"]').click();
        const arrived = await page
          .waitForURL(/\/app\//, { timeout: 20_000 })
          .then(() => true)
          .catch(() => false);
        if (arrived) return;
      }
      throw new Error("login: never reached /app/** within 2 attempts");
    }

    /**
     * DataTable paginates at 10 rows/page (components/ui/data-table.tsx), so counting
     * visible `open-order-*` rows undercounts once the branch has more than a page of
     * active orders. The table's own "Showing X–Y of Z" footer always renders the true
     * total Z whenever there is at least one row — parse that instead of the DOM rows.
     */
    async function orderManagementRowCount(p: Page): Promise<number> {
      await p.getByRole("button", { name: "Order Management", exact: true }).click();
      const emptyState = p.getByText("No active orders");
      if (await emptyState.isVisible({ timeout: 3000 }).catch(() => false)) {
        return 0;
      }
      const footer = p.getByText(/Showing \d+–\d+ of \d+/);
      await footer.waitFor({ state: "visible", timeout: 10_000 });
      const text = (await footer.textContent()) ?? "";
      const match = text.match(/of (\d+)/);
      if (!match) {
        throw new Error(`could not parse total row count from Order Management footer text: "${text}"`);
      }
      return Number(match[1]);
    }

    // ── S1 — login, land on /app/pos ────────────────────────────────────────
    await login(CASHIER_EMAIL, CASHIER_PASSWORD);
    await gotoRobust("/app/pos");
    await page.waitForTimeout(1000);

    const notEnabled = page.getByText("POS feature is not enabled for this account.");
    if (await notEnabled.isVisible({ timeout: 500 }).catch(() => false)) {
      test.skip(true, "BLOCKED: FEATURE_POS is not enabled for the demo tenant");
    }
    const noPermission = page.getByText("You do not have permission to access the POS terminal.");
    if (await noPermission.isVisible({ timeout: 500 }).catch(() => false)) {
      test.skip(true, "BLOCKED: cashier@demo.local lacks pos.order.update permission");
    }

    // ── S2 — baseline Order Management count (before touching the terminal) ──
    const baselineCount = await orderManagementRowCount(page);
    await shot("s2-baseline-order-management");

    // ── S3 — build a client-only cart: NO create-order POST, NO new row ──────
    await page.getByRole("button", { name: "POS Terminal", exact: true }).click();

    const firstItem = page.getByTestId("menu-item-first");
    if (!(await firstItem.isVisible({ timeout: 15_000 }).catch(() => false))) {
      test.skip(true, "BLOCKED: no menu items rendered (menu-item-first never appeared)");
    }

    const createOrderRequests: string[] = [];
    const onRequest = (req: import("@playwright/test").Request) => {
      if (req.method() === "POST" && CREATE_ORDER_PATH.test(req.url())) {
        createOrderRequests.push(req.url());
      }
    };
    page.on("request", onRequest);

    try {
      await firstItem.click();
      const menuGrid = page.locator('[data-testid="menu-grid"] button');
      const itemCount = await menuGrid.count();
      if (itemCount < 2) {
        throw new Blocked(`menu-grid has only ${itemCount} item(s); need >= 2 for this spec`);
      }
      await menuGrid.nth(1).click();

      // Give any (incorrect) create-order call time to fire before asserting absence.
      await page.waitForTimeout(2000);

      expect(
        createOrderRequests,
        `no POST to the order-create endpoint should fire on a menu tap (regression proof for POS-16): ${JSON.stringify(createOrderRequests)}`,
      ).toHaveLength(0);
    } finally {
      page.off("request", onRequest);
    }
    await shot("s3-cart-built-no-network");

    // Cart lines rendered locally — Send to Kitchen is enabled once the cart has
    // items, WITHOUT any order having been created server-side yet.
    const sendButton = page.getByTestId("send-to-kitchen-button");
    await expect(sendButton).toBeEnabled({ timeout: 10_000 });
    await expect(page.getByTestId("charge-now-button")).toBeDisabled();

    const midCartCount = await orderManagementRowCount(page);
    expect(
      midCartCount,
      "Order Management must show no new row while the cart is still local-only (pre-send)",
    ).toBe(baselineCount);
    await shot("s4-order-management-still-baseline");

    // Tab switch remounts PosTerminal (fresh cart) — build it again for the send leg.
    await page.getByRole("button", { name: "POS Terminal", exact: true }).click();
    await page.getByTestId("menu-item-first").click();
    await expect(page.getByTestId("send-to-kitchen-button")).toBeEnabled({ timeout: 10_000 });

    // ── S5 — Send to Kitchen: the order now persists (lazy create + fire) ────
    // Capture the create-order response's assigned id so the follow-up Order
    // Management check can look for THIS specific order — a bare total-row-count
    // diff is fragile on a shared live dev stack where concurrent activity (other
    // sessions, prior test runs) can create/close orders between reads.
    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === "POST" && CREATE_ORDER_PATH.test(r.url()),
        { timeout: 15_000 },
      ),
      page.getByTestId("send-to-kitchen-button").click(),
    ]);
    const createdOrderId: string | undefined = (await createResponse.json())?.data?.id;
    expect(createdOrderId, "create-order response must return an assigned order id").toBeTruthy();

    await expect(page.getByTestId("charge-now-button")).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByTestId("clear-new-order-button")).toBeVisible();
    await shot("s5-sent-charge-enabled");

    await page.getByRole("button", { name: "Order Management", exact: true }).click();
    await expect(
      page.getByTestId(`open-order-${createdOrderId}`),
      "the just-sent order must appear in Order Management once persisted",
    ).toBeVisible({ timeout: 10_000 });
    await shot("s6-order-management-after-send");
  });
});
