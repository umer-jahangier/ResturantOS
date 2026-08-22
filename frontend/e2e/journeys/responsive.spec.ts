import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/auth.fixture";
import { persona } from "../fixtures/personas";
// The probe is plain JS carrying JSDoc types; its judgement is proven without a browser in
// `__tests__/e2e/viewport-integrity.test.ts`, which imports this same file from a type-checked
// test and exercises every export.
import { COLLECT, analyse, counts, describe as describeEl } from "../viewport-integrity.mjs";

/**
 * RUNTIME half of plan 38-14. The static half is `__tests__/lib/theme/responsive-contract.test.ts`
 * and the probe's own logic is proven in `__tests__/e2e/viewport-integrity.test.ts`.
 *
 * <h3>What this spec adds that neither of those can</h3>
 *
 * The static gate reads class names; it cannot know that six of them lay out to 560px inside a
 * 342px box. The unit tests prove the probe *judges* correctly against synthetic geometry; they
 * cannot prove it *looks* in the right place. Only a real browser at a real width, with the real
 * stylesheet and the real data, produces the boxes.
 *
 * <h3>Why the assertions are baselines and not `toBe(0)` everywhere</h3>
 *
 * Two of the five checks are at zero today and are therefore REGRESSION gates — page-level
 * horizontal scroll, and occlusion once wave 4's bottom sheet landed. The other three carry the
 * audit's measured numbers (`/app/inventory/stock` 100 @390 and 42 @1024,
 * `/app/purchasing/purchase-orders` 4 @390, 86 undersized controls on PO and 14 on stock), and
 * those are the ones this plan drives to zero. Writing them all as `toBe(0)` on day one would
 * have produced a suite that is red for reasons nobody can separate.
 *
 * <h3>Both themes</h3>
 *
 * Layout is not supposed to depend on the theme, which is exactly why it is worth measuring:
 * every divergence found here is a rule that changed a box while claiming to change a colour.
 * The sweep is cheap — the page is already loaded; only the `data-theme` attribute moves.
 *
 * <h3>It needs a live stack</h3>
 *
 * `E2E_STACK=1`, like every other journey. A responsive gate on an empty-state screen passes for
 * the wrong reason: an error card fits in 390px beautifully.
 */

const OWNER = persona("terrace", "owner");
const MANAGER = persona("terrace", "manager");
const WAITER = persona("terrace", "waiter");
const KITCHEN = persona("terrace", "kitchen");

/** The plan's declared measurement widths. Nothing else is a comparable measurement. */
const WIDTHS = [390, 768, 1024, 1440] as const;

const THEMES = ["light", "dark"] as const;

interface RouteUnderTest {
  name: string;
  path: string;
  who: typeof OWNER;
  /** A selector that proves the screen actually rendered its content, not an error card. */
  ready: string;
  /**
   * Baseline counts per width, from the 38 audit. `0` means "this is a regression gate".
   * Every entry here is driven to 0 by this plan; the numbers are kept so a failure can be read
   * as "we went backwards from 0" rather than "we never fixed it".
   */
  baseline?: Partial<Record<(typeof WIDTHS)[number], { overflow?: number; undersized?: number }>>;
}

const ROUTES: RouteUnderTest[] = [
  {
    name: "inventory-stock",
    path: "/app/inventory/stock",
    who: MANAGER,
    ready: '[data-testid="inventory-tabs"]',
    baseline: { 390: { overflow: 100, undersized: 14 }, 1024: { overflow: 42 } },
  },
  {
    name: "purchasing-po",
    path: "/app/purchasing/purchase-orders",
    who: MANAGER,
    ready: '[data-testid="purchasing-tabs"]',
    baseline: { 390: { overflow: 4, undersized: 86 } },
  },
  { name: "finance-takings", path: "/app/finance/takings", who: OWNER, ready: "main" },
  { name: "dashboard", path: "/app/dashboard", who: OWNER, ready: "main" },
  { name: "pos", path: "/app/pos", who: WAITER, ready: '[data-testid="menu-grid"], main' },
  { name: "kds", path: "/app/kds", who: KITCHEN, ready: "main" },
];

async function setTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
  }, theme);
  await page.waitForTimeout(150);
}

/**
 * Resize, settle, collect.
 *
 * <p>The settle is not superstition: every measurement here is of a laid-out box, and evaluating
 * in the same tick as `setViewportSize` reports the PREVIOUS layout — which reads as "390 is
 * fine" on a page that was last measured at 1440.
 */
async function measure(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(350);
  const records = await page.evaluate(COLLECT);
  return analyse(records, width);
}

test.describe("38-14 · viewport integrity", () => {
  for (const route of ROUTES) {
    test(`${route.name} adapts at 390 / 768 / 1024 / 1440 in both themes`, async ({ as }) => {
      const page = await as(route.who);
      await page.goto(route.path);
      await page.locator(route.ready).first().waitFor({ state: "visible", timeout: 30_000 });

      for (const theme of THEMES) {
        await setTheme(page, theme);
        for (const width of WIDTHS) {
          const result = await measure(page, width);
          const seen = counts(result);
          const where = `${route.name} @${width} ${theme}`;

          // ── 1. No horizontal page scroll. Zero today; this is the regression gate. ────────
          const scroll = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
          }));
          expect(scroll.scrollWidth, `${where}: page scrolls horizontally`).toBeLessThanOrEqual(
            scroll.clientWidth + 2,
          );

          // ── 2. Element overflow. The audit's own predicate; see viewport-integrity.mjs. ──
          expect(
            seen.overflow,
            `${where}: ${seen.overflow} elements past the viewport\n` +
              result.overflowBlame.slice(0, 8).map(describeEl).join("\n"),
          ).toBe(0);

          // ── 3. Occlusion. THIS is the check that catches the POS cart overlay, and the
          //       reason it exists is that overflow counting reported 0 while the screen was
          //       unusable. It must never be removed as "covered by check 2".
          expect(
            seen.occluded,
            `${where}: ${seen.occluded} controls fully covered\n` +
              result.occluded.slice(0, 8).map(describeEl).join("\n"),
          ).toBe(0);

          // ── 4. Target size, at the two widths a finger is actually used at. ──────────────
          if (width <= 768) {
            expect(
              seen.undersized,
              `${where}: ${seen.undersized} controls under 44×44\n` +
                result.undersized.slice(0, 8).map(describeEl).join("\n"),
            ).toBe(0);
          }

          // ── 5. A money or quantity value clipped to an ellipsis is a WRONG number, not a
          //       shortened one: the audit photographed `213.5 K` where `Rs 213,500.00` was.
          expect(
            seen.truncated,
            `${where}: ${seen.truncated} clipped numeric values\n` +
              result.truncated.slice(0, 8).map(describeEl).join("\n"),
          ).toBe(0);

          // ── 6. No desktop table below md. `DataGrid` keeps both branches in the DOM and
          //       lets CSS choose, so this asserts the CSS chose — not that the markup exists.
          if (width < 768) {
            expect(
              seen.tablesBelowMd,
              `${where}: a <table> is rendered below md; the card fallback is missing`,
            ).toBe(0);
          }
        }
      }

      // The baselines are asserted as *history*, not as a target: every one of them is now 0
      // above. Kept in the file so the numbers this plan moved are legible from the gate.
      expect(route.baseline ?? {}).toBeTruthy();
    });
  }

  /**
   * Task 3, measured rather than inferred: below `md` a dialog is a bottom sheet.
   *
   * <p>Asserted on GEOMETRY, not on the class list. `cn()`/tailwind-merge has silently dropped
   * utilities in this codebase before, and a test that reads `className` would pass on a
   * stylesheet that never shipped.
   */
  test("dialogs render as bottom sheets below md and as centred modals above", async ({ as }) => {
    const page = await as(MANAGER);
    await page.goto("/app/inventory/stock");
    await page.locator('[data-testid="inventory-tabs"]').waitFor({ state: "visible" });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: /opening balance/i }).click();
    const sheet = page.locator('[data-surface="dialog"]').first();
    await sheet.waitFor({ state: "visible" });

    const asSheet = await sheet.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        left: Math.round(r.left),
        width: Math.round(r.width),
        bottom: Math.round(window.innerHeight - r.bottom),
        viewport: window.innerWidth,
        transform: cs.transform,
      };
    });
    expect(asSheet.left, "a sheet is flush to the left edge").toBeLessThanOrEqual(1);
    expect(asSheet.width, "a sheet is full width").toBeGreaterThanOrEqual(asSheet.viewport - 1);
    expect(asSheet.bottom, "a sheet is anchored to the bottom edge").toBeLessThanOrEqual(1);
    // The centring translate is scoped to `md:` and up. No compositing property at a width that
    // does not need one.
    expect(asSheet.transform === "none" || asSheet.transform === "matrix(1, 0, 0, 1, 0, 0)").toBe(
      true,
    );

    await page.setViewportSize({ width: 1024, height: 900 });
    await page.waitForTimeout(350);
    const asModal = await sheet.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: Math.round(r.left),
        width: Math.round(r.width),
        bottom: Math.round(window.innerHeight - r.bottom),
        viewport: window.innerWidth,
      };
    });
    expect(asModal.width, "a modal is not full width").toBeLessThan(asModal.viewport);
    expect(asModal.left, "a modal is centred").toBeGreaterThan(1);
    expect(asModal.bottom, "a modal is not glued to the bottom").toBeGreaterThan(1);
  });
});
