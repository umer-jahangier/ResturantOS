import { expect, test } from "../fixtures/auth.fixture";
import { persona } from "../fixtures/personas";
import { DEFECTS, tolerate } from "../fixtures/known-defects";

/**
 * GATE G12, browser half — the twenty-two Tab presses (UI-SPEC §11, plan 38-15).
 *
 * ╔══════════════════════════════════════════════════════════════════════════════════════════╗
 * ║  FIRST RUN: 2026-08-22, against https://dev.restaurantos.softxlogic.com.                 ║
 * ║                                                                                          ║
 * ║  Until then this file had never executed — it was written during 38-15 with no live      ║
 * ║  stack, and every number it quoted as "measured" came from `e2e/audit-38-a11y.mjs`'s     ║
 * ║  recorded output rather than from this spec. What that first run found:                  ║
 * ║                                                                                          ║
 * ║  1. The SKIP-LINK and LANDMARK assertions were RED on all four routes, and the           ║
 * ║     PRODUCT WAS NOT THE CAUSE. `<SkipLink />` is genuinely the first focusable element   ║
 * ║     in the document on every route — measured live, see the note on the Tab preamble     ║
 * ║     below. The four failures were this file's own preamble poisoning the thing it was    ║
 * ║     about to measure. Fixed here; the assertion itself was correct and is unchanged.     ║
 * ║  2. The TARGET-SIZE and LABEL assertions were expected to be red and were GREEN, by a    ║
 * ║     wide margin: purchase orders measured **8** controls under a 44×44 hit area against  ║
 * ║     a baseline of 108, stock **6** against 30, and both reported **0** unnamed inputs.   ║
 * ║     The baselines below are therefore now enormously slack — a screen could regress by   ║
 * ║     100 controls and still pass. Whoever next touches this file should ratchet them to   ║
 * ║     the measured figures. That is deliberately NOT done here: a ratchet tightened in     ║
 * ║     the same change that first measured it has no confirming second observation behind   ║
 * ║     it, and these two numbers come from one run against one environment.                 ║
 * ║  3. The ⌘K modality assertion was red because the chord was pressed before hydration.    ║
 * ║     `aria-modal="true"` is in fact set on the live palette. Also fixed here.             ║
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

/**
 * Skip-link contract from UI-SPEC §11: the caret reaches `<main>` in at most two presses.
 *
 * <p>PRESSES, not Tabs — and the distinction is the whole reason the measurement below changed
 * shape on 2026-08-22. A skip link is a CONTROL: reaching it is not arriving, activating it is.
 * A walk that only ever presses Tab therefore cannot satisfy "2" on any product that has one,
 * because stop 1 is the link and stop 2 is whatever the shell renders next — measured live, the
 * branch switcher. The two presses §11 is written about are `Tab` then `Enter`.
 */
const KEY_PRESSES_TO_MAIN_CONTRACT = 2;

/**
 * What the audit measured, on 2026-08-12, before any of this existed.
 *
 * <p>Directly comparable to the number produced below despite the unit rename: with no skip link
 * anywhere in the product there was nothing to activate, so the audit's 22 Tab presses were also
 * 22 key presses.
 */
const KEY_PRESSES_TO_MAIN_BASELINE = 22;

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
    /*
     * `menu-grid`, NOT `pos-operator-strip` — this file's own rule, applied to this file's own
     * table. The docblock above says the anchor must be "a piece of the page's own content
     * rather than a shell element", and `OperatorStrip` is shell: `app/(tenant)/layout.tsx:129`
     * renders it for every operator route, above `<main>`, whatever the page beneath does.
     *
     * That is not theoretical. Measured on dev, 2026-08-22, from one `goto`:
     *
     *     +739ms   pos-operator-strip attached   ·  0 <h1>   ·  0 menu-grid
     *     +2272ms  ——                            ·  1 <h1> "Point of sale"  ·  1 menu-grid
     *
     * So the shell anchor released the measurement a second and a half before the page existed,
     * and the landmark assertion below failed with "exactly one <h1> on /app/pos: received 0" —
     * reporting a defect the audit had already fixed. `accessibility-smoke.spec.ts` anchors this
     * same route on `menu-grid` for the same reason.
     */
    anchor: '[data-testid="menu-grid"]',
  },
];

/** Is the caret inside `<main>` right now? */
const IN_MAIN = () => {
  const active = document.activeElement;
  const main = document.querySelector("main");
  return !!(active && main && main.contains(active));
};

/**
 * How many key presses a keyboard user spends, from a document that has just loaded, before
 * focus is inside `<main>`.
 *
 * <p>Same loop `e2e/audit-38-a11y.mjs` used — press, ask whether `document.activeElement` is
 * contained by `<main>`, count — with one addition the audit had nothing to spend it on: when
 * the caret is sitting on the skip link, the press is `Enter` rather than `Tab`. That is what a
 * person does, and it is the only way the ≤ 2 contract is reachable at all; see
 * {@link KEY_PRESSES_TO_MAIN_CONTRACT}.
 *
 * <h3>The Enter is offered ONCE, deliberately</h3>
 *
 * If activating the link does not move focus — the `tabindex="-1"` on `<main>` removed, so the
 * fragment scrolls and leaves the caret behind — a second Enter would do nothing again and the
 * walk would burn its whole budget on one element. Falling back to Tab makes that regression
 * report as the ~22-press walk it actually is, which is the number worth reading.
 *
 * <h3>Why it re-navigates instead of measuring the page it was handed</h3>
 *
 * Both measured against dev on 2026-08-22:
 *
 * <p>· FOCUS. By the time this runs, the caller has already activated the skip link, so
 * `document.activeElement` is `<main>`. One Tab from there lands on main's first control and the
 * walk returns 1 without having walked anything — a vacuous green in the shape of a perfect
 * score.
 *
 * <p>· THE FRAGMENT. `SkipLink`'s handler calls `history.replaceState(…, "#main-content")`, so a
 * `reload()` re-enters ON the fragment, and Chrome focuses a `tabindex="-1"` fragment target at
 * load. Same vacuous 1, arrived at differently. A `goto` of the bare path avoids both.
 *
 * <p>Returns `null` if focus never gets there within `limit`, which is a different failure from
 * "too many" and is reported as one.
 */
async function keyPressesToMain(
  page: import("@playwright/test").Page,
  route: Route,
  limit = 40,
): Promise<number | null> {
  await page.goto(route.path, { waitUntil: "domcontentloaded" });
  await expect(page.locator(route.anchor).first()).toBeAttached({ timeout: 45_000 });

  let skipLinkTried = false;
  for (let i = 1; i <= limit; i += 1) {
    const onSkipLink = await page.evaluate(
      () => document.activeElement?.getAttribute("data-testid") === "skip-to-content",
    );
    if (onSkipLink && !skipLinkTried) {
      skipLinkTried = true;
      await page.keyboard.press("Enter");
    } else {
      await page.keyboard.press("Tab");
    }
    if (await page.evaluate(IN_MAIN)) return i;
  }
  return null;
}

test.describe("G12 — accessibility invariants in the browser", () => {
  for (const route of ROUTES) {
    test(`skip link and landmarks: ${route.name}`, async ({ as, obs }) => {
      test.setTimeout(120_000);

      /*
       * The POS route carries a refused live-orders WebSocket, and this gate is about landmarks.
       * Declared rather than left to fail the test, for the reason `accessibility-smoke.spec.ts`
       * states on the same route: a socket the page does not need in order to be navigable must
       * not be able to mask an accessibility result. Until 2026-08-22 this was invisible here —
       * the observability guard only judges a test that passed its own assertions, and the skip
       * link assertion above was failing first.
       *
       * <p>READ THIS BEFORE TREATING IT AS CLOSED. E2E-D4's matcher covers the URL, but the
       * message dev actually emits is NOT E2E-D4's:
       *
       *     Error during WebSocket handshake: 'Connection' header value must contain 'Upgrade'
       *
       * E2E-D4 is a 401 caused by `WS_UPGRADE_PATHS` omitting `/api/v1/pos/ws/`. This one also
       * hits `wss://…/api/v1/kitchen/kds/…`, which IS in that list — so it is a second, broader
       * fault in front of the gateway (the dev reverse proxy is not forwarding `Upgrade` /
       * `Connection`), and it takes down every socket in the product on that environment, not
       * just this one. This declaration silences it for a landmark test; it is not evidence that
       * either fault is fixed.
       */
      if (route.path.startsWith("/app/pos")) {
        tolerate(obs, DEFECTS.POS_ORDERS_WEBSOCKET_REJECTED_AT_GATEWAY);
      }

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

      /*
       * NO CLICK BEFORE THIS TAB. The two lines that used to stand here —
       *
       *     await page.locator("body").click({ position: { x: 2, y: 2 } });
       *     await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
       *
       * — failed this assertion on all four routes on 2026-08-22, and the product was correct
       * throughout. Measured live on that run:
       *
       *     first focusable in DOM order      -> A[data-testid=skip-to-content]   ✔ on 4/4
       *     fresh-load Tab                    -> A[data-testid=skip-to-content]   ✔ on 4/4
       *     element at viewport point (2,2)   =  the sidebar's brand row (a plain DIV)
       *     after body-click(2,2)+blur, Tab   -> BUTTON "Floating Terrace HQ"     ✘ on 4/4
       *
       * Clicking a non-focusable element sets Chrome's SEQUENTIAL FOCUS NAVIGATION STARTING
       * POINT to it, and `blur()` does not clear that — it clears `activeElement`, which is a
       * different piece of state. The next Tab therefore resumed *after the sidebar's brand
       * row*, i.e. downstream of the skip link, and reported the exact defect the skip link
       * had been added to remove. `audit-38-a11y.mjs`, which produced the 22 this file is a
       * ratchet against, pressed Tab straight after `goto` with no click — so the click was
       * never part of "the same loop" this spec claimed to run.
       *
       * The page was navigated to a moment ago and nothing has been clicked since, so the
       * starting point is unset and this is the press a real user's first Tab makes.
       */
      const focusBeforeTab = await page.evaluate(() =>
        document.activeElement && document.activeElement !== document.body
          ? `${document.activeElement.tagName}[${document.activeElement.getAttribute("data-testid") ?? ""}]`
          : "<body> (nothing focused — the state a fresh load is in)",
      );
      await page.keyboard.press("Tab");
      await expect(
        skip,
        "the skip link must be the FIRST tab stop. Rendered after the sidebar it is still a " +
          "skip link, still announced, still correct in a screenshot — and still stop 22. " +
          `Before this Tab, focus was on: ${focusBeforeTab} — if that is not <body>, something ` +
          "on the route autofocuses and THAT is the finding, not the link's position.",
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
      const landedInMain = await page.evaluate(IN_MAIN);
      expect(
        landedInMain,
        "after activating the skip link the caret must be inside <main>. A fragment target " +
          "without tabindex=-1 scrolls and leaves focus behind, so the next Tab resumes at " +
          "sidebar link 2 — the failure this pattern is famous for.",
      ).toBe(true);

      // ── 4. The headline number ─────────────────────────────────────────────────────────
      const presses = await keyPressesToMain(page, route);
      expect(
        presses,
        `focus never reached <main> within 40 presses on ${route.path}`,
      ).not.toBeNull();
      expect(
        presses!,
        `key presses to <main> on ${route.path}. Baseline ${KEY_PRESSES_TO_MAIN_BASELINE} ` +
          `(measured 2026-08-12 on /app/purchasing/purchase-orders); contract ` +
          `${KEY_PRESSES_TO_MAIN_CONTRACT} — one Tab onto the skip link, one Enter to take it.`,
      ).toBeLessThanOrEqual(KEY_PRESSES_TO_MAIN_CONTRACT);

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

    /*
     * THE CHORD CANNOT BE PRESSED BEFORE HYDRATION, AND "VISIBLE" DOES NOT MEAN HYDRATED.
     *
     * This test used to `goto(…, { waitUntil: "domcontentloaded" })` and press ⌘K on the next
     * line, then wait 15s for a palette that never came — red on 2026-08-22, and not because of
     * the palette. The shortcut is a `document` keydown listener registered in an effect
     * (`components/ui/command-palette.tsx:133-143`). A press issued before that effect runs is
     * not queued anywhere: it is delivered to a document with no listener on it and is simply
     * lost. No timeout recovers a press that already happened, which is why the symptom was a
     * 15-second hang rather than a race.
     *
     * Waiting for the trigger BUTTON to be visible is not enough on its own, and that is worth
     * stating because it is the obvious fix and it does not work: the button is server-rendered
     * markup, so it is on screen well before the bundle that animates it. Measured on dev:
     *
     *     goto waitUntil          trigger visible   palette after ONE press
     *     domcontentloaded        +691ms            0   (opened only on the retry, +2740ms)
     *     load                    +1256ms           1
     *
     * So: `load`, which waits for the scripts, THEN the trigger, and then the chord pressed
     * under `expect.poll` so a press that lands in the remaining gap costs a retry instead of
     * the test. This cannot mask a defect — a palette that never opens still fails, and the
     * `aria-modal` assertion below is untouched. `command-palette.spec.ts:38-41` gets away with
     * a single press for the same reason: its `goto` uses the default `load`.
     */
    await page.goto("/app/purchasing/vendors");

    // The command palette is the one dialog reachable from every BACK-OFFICE route, and it is
    // the one the audit probed and found `aria-modal: null` on. (Not from every route: the
    // operator shell removes `<TopBar>`, and with it the palette, from `/app/pos/**` by design
    // — UI-SPEC §4.1.)
    await expect(
      page.getByRole("button", { name: "Open command palette" }),
      "the ⌘K trigger must be on screen before the chord is pressed",
    ).toBeVisible({ timeout: 25_000 });

    const palette = page.getByTestId("command-palette-input");
    await expect
      .poll(
        async () => {
          if ((await palette.count()) > 0) return 1;
          await page.keyboard.press("ControlOrMeta+k");
          // Radix mounts the content synchronously on the state change; this is slack, not a
          // guess. It also keeps the poll from pressing twice and toggling the palette shut.
          await page.waitForTimeout(600);
          return palette.count();
        },
        {
          message: "the ⌘K palette must open before its modality can be measured",
          timeout: 20_000,
        },
      )
      .toBeGreaterThan(0);

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
