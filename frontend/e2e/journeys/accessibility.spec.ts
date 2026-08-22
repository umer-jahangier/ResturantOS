import { expect, test } from "../fixtures/auth.fixture";
import { persona } from "../fixtures/personas";

/**
 * GATE G12, browser half — the twenty-two Tab presses (UI-SPEC §11, plan 38-15).
 *
 * ╔══════════════════════════════════════════════════════════════════════════════════════════╗
 * ║  THIS SPEC HAS NOT BEEN RUN.                                                             ║
 * ║                                                                                          ║
 * ║  It was written during 38-15 with no live stack available: `e2e/audit-38-a11y.mjs`, the  ║
 * ║  probe that produced the 22, needs a signed-in session against a running gateway, and    ║
 * ║  so does this. Every number quoted below as "measured" comes from that probe's recorded  ║
 * ║  output (`.planning/phases/38-erp-design-transformation/evidence/audit-a11y.json`) or    ║
 * ║  from 38-AUDIT.md — none of it was re-measured, and no assertion here has been observed  ║
 * ║  passing OR failing.                                                                     ║
 * ║                                                                                          ║
 * ║  Two consequences the next person needs, stated rather than discovered:                  ║
 * ║                                                                                          ║
 * ║  1. The SKIP-LINK and LANDMARK assertions should pass — the source-level gate            ║
 * ║     `__tests__/lib/theme/a11y-invariants.test.ts` was run, with negative controls        ║
 * ║     observed red, and it holds the precondition. If they fail, the failure is in the     ║
 * ║     rendered tab order (a portal, a positive `tabindex`), not in the mechanism.          ║
 * ║  2. The TARGET-SIZE and LABEL assertions are expected to be **RED on first run**, and    ║
 * ║     they are written to be. 38-15 did not do the target-size sweep — that is 108         ║
 * ║     controls on one screen and it needs the browser this session did not have. They are  ║
 * ║     ratchets against the audit's own figures, so the first run records the truth and     ║
 * ║     nothing may get worse while the sweep is paid down.                                  ║
 * ╚══════════════════════════════════════════════════════════════════════════════════════════╝
 *
 * <h3>Anchoring (the plan's explicit warning, and phase 34's vacuous-gate pattern #4)</h3>
 *
 * The plan says, in bold: *"Do not anchor the label or target gates on HR routes while
 * `hr-service` is down. They will SKIP and report green."* That is pattern #4 — a positive
 * control anchored to a surface that errors whenever a backing service is unavailable, which is
 * how a gate silently measured nothing for weeks.
 *
 * <p>So every route below carries an `anchor` that must be ATTACHED before anything is measured,
 * and the anchor is a piece of the page's own content rather than a shell element — a shell that
 * renders over an error state would satisfy a shell anchor. `/app/purchasing/purchase-orders` and
 * `/app/inventory/stock` are the two the audit found reachable throughout, so they carry the
 * label and target gates. HR is deliberately absent.
 */

/** Skip-link contract from UI-SPEC §11: the caret reaches `<main>` in at most two presses. */
const TABS_TO_MAIN_CONTRACT = 2;

/** What the audit measured, on 2026-08-12, before any of this existed. */
const TABS_TO_MAIN_BASELINE = 22;

interface Route {
  name: string;
  path: string;
  persona: "manager" | "cashier";
  /** A selector for the page's OWN content. Asserted attached before any measurement. */
  anchor: string;
}

const ROUTES: Route[] = [
  {
    name: "purchase orders",
    path: "/app/purchasing/purchase-orders",
    persona: "manager",
    // The audit's own anchor route, and the one it measured the 22 on.
    anchor: '[data-testid="purchasing-tabs"]',
  },
  {
    name: "stock",
    path: "/app/inventory/stock",
    persona: "manager",
    anchor: '[data-testid="inventory-tabs"]',
  },
  {
    name: "dashboard",
    path: "/app/dashboard",
    persona: "manager",
    anchor: "h1",
  },
  {
    name: "POS terminal",
    path: "/app/pos",
    persona: "cashier",
    anchor: '[data-testid="pos-operator-strip"]',
  },
];

/**
 * How many Tab presses before focus lands inside `<main>`.
 *
 * <p>Deliberately the same loop `e2e/audit-38-a11y.mjs` used, so the number is comparable to the
 * 22 rather than merely similar to it: press, wait a beat for any focus handler, ask whether
 * `document.activeElement` is contained by `<main>`. Returns `null` if it never gets there
 * within `limit`, which is a different failure from "too many" and is reported as one.
 */
async function tabsToMain(page: import("@playwright/test").Page, limit = 40) {
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 1; i <= limit; i += 1) {
    await page.keyboard.press("Tab");
    const inMain = await page.evaluate(() => {
      const active = document.activeElement;
      const main = document.querySelector("main");
      return !!(active && main && main.contains(active));
    });
    if (inMain) return i;
  }
  return null;
}

test.describe("G12 — accessibility invariants in the browser", () => {
  for (const route of ROUTES) {
    test(`skip link and landmarks: ${route.name}`, async ({ as }) => {
      test.setTimeout(120_000);
      const page = await as(persona("terrace", route.persona));
      await page.goto(route.path, { waitUntil: "domcontentloaded" });

      // Pattern #4 guard: measure nothing until the page's own content is really here.
      await expect(
        page.locator(route.anchor).first(),
        `${route.path} did not render its own content, so nothing below would be a measurement. ` +
          "This is the vacuous-gate failure mode, and it is meant to be loud.",
      ).toBeAttached({ timeout: 45_000 });

      // ── 1. The skip link exists and is the first thing Tab reaches ──────────────────────
      const skip = page.getByTestId("skip-to-content");
      await expect(skip, "measured 0 skip links on every route (audit-a11y.json)").toBeAttached();
      await expect(skip).toHaveAttribute("href", "#main-content");

      await page.locator("body").click({ position: { x: 2, y: 2 } });
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("Tab");
      await expect(
        skip,
        "the skip link must be the FIRST tab stop. Rendered after the sidebar it is still a " +
          "skip link, still announced, still correct in a screenshot — and still stop 22.",
      ).toBeFocused();

      // ── 2. …and it is VISIBLE while focused, which is the half a DOM check cannot see ───
      const box = await skip.boundingBox();
      expect(box, "a focused skip link must have a box").not.toBeNull();
      expect(
        box!.y,
        "the skip link must come back into the viewport on focus. Parked at `-top-24` and never " +
          "moved, it is reachable and invisible — a sighted keyboard user cannot see where their " +
          "caret went.",
      ).toBeGreaterThanOrEqual(0);
      expect(box!.height).toBeGreaterThanOrEqual(44);

      // ── 3. Activating it moves FOCUS, not just the scroll offset ───────────────────────
      await page.keyboard.press("Enter");
      const landedInMain = await page.evaluate(() => {
        const main = document.querySelector("main");
        return !!(main && document.activeElement && main.contains(document.activeElement));
      });
      expect(
        landedInMain,
        "after activating the skip link the caret must be inside <main>. A fragment target " +
          "without tabindex=-1 scrolls and leaves focus behind, so the next Tab resumes at " +
          "sidebar link 2 — the failure this pattern is famous for.",
      ).toBe(true);

      // ── 4. The headline number ─────────────────────────────────────────────────────────
      const tabs = await tabsToMain(page);
      expect(tabs, `focus never reached <main> within 40 presses on ${route.path}`).not.toBeNull();
      expect(
        tabs!,
        `tabs to <main> on ${route.path}. Baseline ${TABS_TO_MAIN_BASELINE} ` +
          `(measured 2026-08-12 on /app/purchasing/purchase-orders); contract ` +
          `${TABS_TO_MAIN_CONTRACT}.`,
      ).toBeLessThanOrEqual(TABS_TO_MAIN_CONTRACT);

      // ── 5. Landmarks ───────────────────────────────────────────────────────────────────
      const landmarks = await page.evaluate(() => ({
        mains: document.querySelectorAll("main").length,
        h1s: Array.from(document.querySelectorAll("h1")).map((h) => h.textContent?.trim() ?? ""),
        unnamedNavs: Array.from(document.querySelectorAll("nav"))
          .filter((n) => !n.getAttribute("aria-label") && !n.getAttribute("aria-labelledby"))
          .map((n) => n.className || n.outerHTML.slice(0, 80)),
      }));

      expect(landmarks.mains, `exactly one <main> on ${route.path}`).toBe(1);
      expect(
        landmarks.h1s,
        `exactly one <h1> on ${route.path}. Measured 0 on /app/pos, /app/pos/tills, POS order ` +
          "management and /app/hr/attendance; a fifth, /app/pos/orders/*/receipt, was found in " +
          "38-15 and fixed. A screen-reader user landing on a route with none gets no page " +
          "identity at all.",
      ).toHaveLength(1);
      expect(
        landmarks.unnamedNavs,
        `every <nav> on ${route.path} needs an accessible name — four of eight had none`,
      ).toEqual([]);
    });
  }

  /**
   * Target size (SC 2.5.5 / 2.5.8) and input labelling.
   *
   * <h3>These are RATCHETS, not contracts, and that is deliberate</h3>
   *
   * The contract is zero. 38-15 did not reach it: the sweep is 108 controls on purchase orders
   * alone, plus 63 vendors, 62 ingredients, 31 hr-attendance and 30 stock, and every one needs a
   * rendered box to judge — which this session had no browser for. Asserting zero would produce
   * a gate that is red on its first run and switched off by its second, which is exactly the
   * mechanism D-38-17 records being lost once already.
   *
   * <p>So each route asserts against the audit's own count and may only go down. The first run
   * prints the real number beside the baseline; whoever does the sweep tightens the constant as
   * they go. A control added below 44px in the meantime pushes the count over its baseline and
   * fails immediately, which is the property worth having today.
   */
  const TARGET_SIZE_BASELINE: Record<string, number> = {
    "/app/purchasing/purchase-orders": 108,
    "/app/inventory/stock": 30,
  };

  for (const route of ROUTES.filter((r) => r.path in TARGET_SIZE_BASELINE)) {
    test(`target size: ${route.name}`, async ({ as }) => {
      test.setTimeout(120_000);
      const page = await as(persona("terrace", route.persona));
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await expect(page.locator(route.anchor).first()).toBeAttached({ timeout: 45_000 });

      const small = await page.evaluate(() => {
        const SELECTOR =
          'main a[href], main button, main input, main select, main textarea, main [role="button"]';
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll(SELECTOR))) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue; // not rendered
          /*
           * The HIT AREA, not the ink. UI-SPEC §11 allows a back-office row to render a 32px
           * control provided padding carries the hit area to 44px, and `getBoundingClientRect`
           * already includes padding — so this measures the thing the contract is written about
           * rather than the visual box, and a dense grid is not forced to inflate.
           */
          if (rect.width < 44 || rect.height < 44) {
            out.push(
              `${el.tagName.toLowerCase()} ${Math.round(rect.width)}×${Math.round(rect.height)} ` +
                `"${(el.textContent ?? "").trim().slice(0, 24)}"`,
            );
          }
        }
        return out;
      });

      const baseline = TARGET_SIZE_BASELINE[route.path]!;
      console.log(`[G12] target size ${route.path}: ${small.length} (baseline ${baseline})`);
      expect(
        small.length,
        `controls under a 44×44 hit area on ${route.path}. Audit baseline ${baseline}; ` +
          `contract 0. First twelve:\n  ${small.slice(0, 12).join("\n  ")}`,
      ).toBeLessThanOrEqual(baseline);
    });

    test(`every input is named: ${route.name}`, async ({ as }) => {
      test.setTimeout(120_000);
      const page = await as(persona("terrace", route.persona));
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await expect(page.locator(route.anchor).first()).toBeAttached({ timeout: 45_000 });

      const unnamed = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of Array.from(
          document.querySelectorAll<HTMLElement>("main input, main select, main textarea"),
        )) {
          if ((el as HTMLInputElement).type === "hidden") continue;
          const byLabel = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          const named =
            byLabel ||
            el.getAttribute("aria-label") ||
            el.getAttribute("aria-labelledby") ||
            el.closest("label");
          // A placeholder is NEVER the label (UI-SPEC §11) — it disappears on the first
          // keystroke, which is precisely when a user most needs to know what the field is.
          if (!named) {
            out.push(
              `${el.tagName.toLowerCase()} name="${el.getAttribute("name") ?? ""}" ` +
                `placeholder="${el.getAttribute("placeholder") ?? ""}"`,
            );
          }
        }
        return out;
      });

      expect(
        unnamed,
        `inputs with no accessible name on ${route.path}. Measured 6 on /app/hr/attendance ` +
          "(fixed in 38-08) plus 3 unnamed controls. A placeholder is not a label.",
      ).toEqual([]);
    });
  }

  test("every dialog is modal to assistive tech", async ({ as }) => {
    test.setTimeout(120_000);
    const page = await as(persona("terrace", "manager"));
    await page.goto("/app/purchasing/vendors", { waitUntil: "domcontentloaded" });

    // The command palette is the one dialog reachable from every route, and it is the one the
    // audit probed and found `aria-modal: null` on.
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByTestId("command-palette-input");
    await expect(
      palette,
      "the ⌘K palette must open before its modality can be measured",
    ).toBeAttached({ timeout: 15_000 });

    const modal = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('[role="dialog"]')).map((d) =>
          d.getAttribute("aria-modal"),
        ),
      // 38-03 set this on the shared DialogContent; 38-15 found a fourth surface built from the
      // Radix primitives directly (the POS order drawer) that had never had it.
    );
    expect(modal.length).toBeGreaterThanOrEqual(1);
    expect(
      modal.every((value) => value === "true"),
      `aria-modal per open dialog: ${modal}`,
    ).toBe(true);
  });

  /*
   * "One announcement per async result, not two" — DELIBERATELY NOT WRITTEN AS A PASSING TEST.
   *
   * `test.fixme` so it reports as skipped-with-a-reason rather than green. A test that opened
   * the page and asserted the live regions were empty would pass, prove nothing, and be counted
   * as coverage — which is the vacuous-gate failure this suite already paid for five times in
   * phase 34.
   *
   * <h3>The finding it has to be read against</h3>
   *
   * `useStatusAnnouncer` has **zero call sites** in the product. Measured in 38-15:
   * `grep -rn "useStatusAnnouncer" app components lib` returns one hit and it is the hook's own
   * declaration. The application's dedicated live region carries nothing; announcements reach
   * assistive tech, where they reach it at all, through Sonner's own region mounted beside it in
   * `app-providers.tsx`. So "not twice" is currently true because the channel is empty, and the
   * audit never measured the number that matters.
   *
   * <h3>What to build, once there is a stack</h3>
   *
   * 1. Sign in as `terrace/manager`, go to `/app/tables`, open the table dialog, save a change,
   *    and wait for the row to update — an anchor on the CHANGED ROW, not on the toast, so the
   *    measurement survives a toast that never appears.
   * 2. Install a `MutationObserver` over every `[aria-live]` on the page BEFORE the save and
   *    count text insertions, not final text. The failure mode is two regions each announcing
   *    once; a snapshot after the fact sees one string in each and cannot tell that from one.
   * 3. Expect exactly one insertion. If it is two, the likely cause is a future wiring of
   *    `announce()` that ALSO raises a toast with the same words — the specific regression
   *    `status-announcer.tsx`'s docblock names.
   * 4. Repeat the same save immediately. Expect a second insertion: the `key={seq}` fix in
   *    `status-announcer.tsx` exists because the previous implementation announced an identical
   *    consecutive message zero times, which is the same defect in the other direction.
   */
  test.fixme("one announcement per async result, not two", async () => {
    // See the note above. Needs a live stack and a MutationObserver harness; 38-15 had neither.
  });
});
