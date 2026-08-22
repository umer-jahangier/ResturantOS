import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/auth.fixture";
import { persona } from "../fixtures/personas";

/**
 * GA-001, re-asked at runtime after phase 34 restyled the four data states (plan 34-05).
 *
 * <h3>The defect</h3>
 *
 * Phase 14b found eleven of fifteen list screens rendering the EMPTY state when the request
 * FAILED. A forced HTTP 500 and a forced `[]` produced byte-identical text: "No vendors yet".
 * An owner whose purchasing service was down was told, in the product's own confident voice,
 * that their business has no suppliers.
 *
 * `QueryBoundary` made the API-level confusion unrepresentable. This spec asks the *visual*
 * half of the same question, because a restyle is exactly the activity that reconverges two
 * states while both remain technically correct — a designer's instinct on an error screen is
 * to calm it, and a calm error looks like an empty result.
 *
 * <h3>Three channels, because a person uses three</h3>
 *
 * By TEXT — the failure names a failure and the empty result does not claim one.
 * By ROLE — only the failure carries an alert, so a screen-reader user is told.
 * By PIXELS — the two renderings must differ by more than a trivial count. This is the one
 * that catches a restyle that converged them while text and role stayed right.
 *
 * Each is then re-asked with `prefers-reduced-motion: reduce`. A failure that is only
 * distinguishable once its entrance has played is not distinguishable to a user for whom the
 * entrance never runs.
 *
 * <h3>Negative control performed, OBSERVED red, then restored</h3>
 *
 * A. `QueryErrorNotice` rewritten with the empty state's neutral surface and wording
 * ("No vendors yet", no `role="alert"`) — the TEXT channel failed first, naming the missing
 * "Couldn't load vendors".
 *
 * B. The same convergence with the text and role assertions temporarily suppressed so the
 * PIXEL channel was reached. It reported 2,920 differing pixels and PASSED against a floor of
 * 2,000 — so the control found a defect in this file rather than in the product, and the floor
 * was recalibrated to 20,000 from the two measured populations. Re-run of B after that change
 * failed as it should. Both restored; the file is green. Run log in 34-05-SUMMARY.md.
 *
 * <h3>Why `reducedMotion` is set on the CONTEXT and asserted</h3>
 *
 * `test.use({ reducedMotion })` is not typed on this suite's extended fixture and had NO
 * runtime effect — the phase's second vacuous gate: a "reduce" pass that ran with no
 * preference set while still reporting `reduce` in its name. So the preference is applied with
 * `page.emulateMedia()` and then READ BACK from `matchMedia` before anything is asserted under
 * it.
 */

const MANAGER = persona("terrace", "manager");

/** The canonical GA-001 screen, and the API path its list is built from. */
const VENDORS_ROUTE = "/app/purchasing/vendors";
const VENDORS_API = "**/api/v1/purchasing/vendors";

/**
 * The manager dashboard. Its portlet boundary takes FOUR queries and fails as a unit, so both
 * halves of the comparison are forced: the failure by breaking one of them, and the loaded
 * state by answering all four with an empty-but-successful payload in each one's own wire
 * shape.
 *
 * <p>The first version compared the forced failure against the LIVE dashboard, and it failed
 * on a real 503 from the gateway — which is vacuous gate #4 of this phase repeating itself
 * exactly: a control anchored to a screen that renders an error whenever a backing service is
 * down spends most of its life not measuring what it claims to. Forcing both halves makes the
 * comparison about the two states and about nothing else.
 */
const DASHBOARD_ROUTE = "/app/dashboard";
const DASHBOARD_FAIL_API = "**/api/v1/pos/tables**";
const EMPTY_PAGE = { data: [], meta: { page: 0, size: 20, totalElements: 0, totalPages: 0 } };

/**
 * Every GET the manager dashboard makes, answered empty-but-successful in its own wire shape.
 *
 * <p>Six, not four. The portlet boundary consumes four, but the page ALSO issues the tills and
 * admin-menu queries outside it, and the observability guard rightly fails a test whose page
 * logged undeclared network errors. Leaving those two to a live backend is how this test
 * failed twice on a real gateway 503 that had nothing to do with what it measures.
 *
 * <p>The globs end in `**` rather than `?**` — Playwright treats `?` as a literal character in
 * a URL glob, so `**\/orders?**` matched nothing and the request went to the real service.
 */
const DASHBOARD_EMPTY_ROUTES: { api: string; body: unknown }[] = [
  { api: "**/api/v1/pos/tables**", body: { data: [] } },
  { api: "**/api/v1/pos/orders**", body: EMPTY_PAGE },
  { api: "**/api/v1/pos/tills**", body: EMPTY_PAGE },
  { api: "**/api/v1/pos/menu/items/admin**", body: { data: [] } },
  { api: "**/api/v1/kitchen/kds/tickets**", body: { content: [], totalElements: 0 } },
  { api: "**/api/v1/kitchen/kds/stations**", body: [] },
];

/**
 * Pixels that must differ before two renderings count as telling a person different things.
 *
 * <h3>This number is CALIBRATED, not chosen — and the first value chosen was wrong</h3>
 *
 * The floor started at 2,000 (~0.2% of a 1280x720 viewport) on the reasoning that
 * antialiasing and a caret could not reach it. Then the negative control was run: the error
 * notice was rewritten to render the empty state's surface, disc and wording, with the retry
 * suppressed and the alert role removed — a total convergence, the exact defect this file
 * exists to catch — and the two renderings still differed by **2,920 pixels**, because the
 * empty state also carries a description line the converged error did not. The assertion
 * PASSED against completely broken code. That is a seventh vacuous gate, found in this file,
 * by this project's own rule that an assertion nobody has watched fail is not evidence.
 *
 * Measured, on this screen, at this viewport:
 *
 *   genuinely distinct states  89,911 differing pixels
 *   fully converged states      2,920 differing pixels
 *
 * 20,000 sits between them with a wide margin on both sides — 4.5x below the real figure and
 * 6.8x above the converged one — so it cannot be cleared by a residual line of text and cannot
 * be tripped by a font-rendering difference.
 */
const PIXEL_FLOOR = 20_000;

/**
 * A second, lower floor for the empty-vs-populated pair, calibrated the same way and stated
 * separately rather than folded into the number above.
 *
 * One row of vendor against the empty state's disc and description is a **12,652** pixel
 * difference — a genuinely different screen, and legitimately a smaller difference than the
 * one between a red failure panel and a centred empty state. Reusing the 20,000 floor here
 * failed a correct product, which is the opposite error and just as bad: a gate that fails on
 * correct code gets deleted, and then nothing is checked at all. Convergence in this pair
 * means the list rendered no row, which is a difference of approximately zero, so 5,000
 * separates the two populations with 2.5x of margin below the real figure.
 */
const LIST_CONTENT_FLOOR = 5_000;

type Forced = "failure" | "empty" | "populated";

/**
 * Force one of the three data states by fulfilling the route.
 *
 * A fulfilled 500 rather than a real outage: the point is to hold everything else on the
 * screen constant so the only difference between the two captures is the state itself.
 *
 * <p>The success bodies are wrapped in this API's `{ data: … }` envelope, which `request.ts`
 * unwraps. The first version of this spec fulfilled a bare `[]`, and the empty state duly
 * appeared — for the WRONG reason: `response.data.data` was `undefined`, the page's
 * `data ?? []` turned that into a zero-length list, and the spec would have reported "the
 * empty state renders" against a payload the product never receives.
 */
async function force(page: Page, api: string, state: Forced, populated: unknown): Promise<void> {
  await page.route(api, async (route) => {
    if (state === "failure") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "INTERNAL", message: "forced by state-distinguishability" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: state === "empty" ? [] : populated }),
    });
  });
}

/**
 * A real differing-PIXEL count, decoded in the browser.
 *
 * Comparing the PNG bytes would be cheaper and would be a different measurement: a
 * one-pixel change perturbs the whole deflate stream, so a byte count says nothing about how
 * much of the screen a person sees differently. There is no PNG decoder in this repo's
 * dependency tree and D-34-05 forbids adding one for a single assertion, so the decode
 * happens where a decoder already exists — `createImageBitmap` in the page under test.
 *
 * Per-channel tolerance of 8/255 so subpixel antialiasing is not counted as a difference.
 */
async function differingPixels(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([aB64, bB64]) => {
      const decode = async (b64: string) => {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context available to decode the capture");
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      };

      const A = await decode(aB64!);
      const B = await decode(bB64!);
      if (A.width !== B.width || A.height !== B.height) {
        return Math.max(A.width * A.height, B.width * B.height);
      }

      let differing = 0;
      for (let i = 0; i < A.data.length; i += 4) {
        if (
          Math.abs(A.data[i]! - B.data[i]!) > 8 ||
          Math.abs(A.data[i + 1]! - B.data[i + 1]!) > 8 ||
          Math.abs(A.data[i + 2]! - B.data[i + 2]!) > 8
        ) {
          differing += 1;
        }
      }
      return differing;
    },
    [a.toString("base64"), b.toString("base64")],
  );
}

/** Read the preference back out of the browser rather than trusting that setting it worked. */
async function assertReducedMotion(page: Page, expected: boolean): Promise<void> {
  const actual = await page.evaluate(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  expect(
    actual,
    `the reduced-motion preference did not take effect. This is the phase's second vacuous ` +
      `gate verbatim: a "reduce" pass that ran with NO preference set while still reporting ` +
      `"reduce" in its name.`,
  ).toBe(expected);
}

interface Capture {
  text: string;
  /** Alerts inside the page's own content region, with their text, so a failure names them. */
  alerts: string[];
  shot: Buffer;
}

/**
 * The alert query is scoped to `<main>` deliberately.
 *
 * Unscoped, it counted an alert the app shell renders outside the content region — so the
 * empty state "carried an alert" and the assertion failed for a reason that had nothing to do
 * with the state under test. The question this spec asks is whether the CONTENT REGION
 * announces a failure, and scoping it there is what makes the answer mean that. Widening the
 * scope back would make the assertion pass or fail on chrome the boundary does not control.
 */
async function capture(page: Page, anchor: string): Promise<Capture> {
  /*
   * `.filter({ visible: true })` because a text anchor on ANY `DataGrid` screen resolves twice.
   *
   * <p>`DataGrid` keeps both of its branches in the DOM at all times — the desktop `<table>` and
   * the card fallback — and lets CSS choose between them, which is the shape
   * `responsive.spec.ts:138-141` documents and the shape that spec's `tablesBelowMd` check
   * exists to police. So `text=Forced Vendor A` matched `<div class="font-medium">` inside the
   * table AND `<div class="truncate text-body font-medium">` inside `data-grid-cards`, and
   * Playwright's strict mode refused both — a populated screen failing an assertion whose whole
   * job is to prove the screen was populated (measured against dev 2026-08-22).
   *
   * <p>Filtering on visibility rather than taking `.first()` blindly is the part that matters:
   * the surviving node is the branch CSS actually chose, so the text, the alerts and the
   * screenshot below are all read off the rendering the user is looking at. It weakens nothing
   * — the anchor's job was only ever "this screen resolved", and a hidden duplicate has never
   * been evidence of that.
   */
  const settled = page.locator(anchor).filter({ visible: true }).first();
  await expect(
    settled,
    `ANCHOR NOT FOUND: nothing matched "${anchor}". A distinguishability assertion made ` +
      `against a screen that never resolved is an assertion about a blank page.`,
  ).toBeVisible({ timeout: 30_000 });

  const main = page.locator("main");
  await expect(
    main,
    "ANCHOR NOT FOUND: the page renders no <main>, so there is no content region to scope " +
      "the alert query to and the role channel would be measuring the whole shell",
  ).toHaveCount(1);

  return {
    text: (await main.innerText()).trim(),
    alerts: await main.locator('[role="alert"]').allInnerTexts(),
    // `animations: "disabled"` freezes any entrance so the comparison is of finished frames,
    // not of two arbitrary moments in two independent timelines.
    shot: await page.screenshot({ animations: "disabled" }),
  };
}

/**
 * Turn the compositing filter off the way a real deployment does — a browser that reports
 * support and then does nothing with it (D-34-04). The injection is ASSERTED to have taken
 * effect; an injected stylesheet that silently matched nothing is how a "degraded path"
 * screenshot ends up identical to the composited one.
 */
async function forceFilterOff(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*, *::before, *::after {
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }`,
  });

  const remaining = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll("*")).filter((el) => {
        const cs = getComputedStyle(el);
        const v = cs.backdropFilter || cs.getPropertyValue("backdrop-filter");
        return Boolean(v) && v !== "none";
      }).length,
  );
  expect(
    remaining,
    "the injected stylesheet did not remove every compositing filter, so the capture that " +
      "follows is not the degraded rendering it claims to be",
  ).toBe(0);
}

test.describe.configure({ mode: "serial" });

test.describe("GA-001 · a forced failure and a forced empty result stay distinguishable", () => {
  for (const reduced of [false, true]) {
    const label = reduced ? "with prefers-reduced-motion: reduce" : "with motion available";

    test(`vendors list · text, role and pixels ${label}`, async ({ as, obs }) => {
      test.setTimeout(180_000);
      obs.expectNetworkFailure({
        url: "/api/v1/purchasing/vendors",
        status: 500,
        because: "the 500 is forced by this spec — it IS the state under test",
      });
      obs.expectConsoleError(
        /vendors|500|INTERNAL|Failed to load resource/i,
        "the app logging the failure it was handed is correct behaviour here",
      );

      const page = await as(MANAGER);
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });

      // ── forced FAILURE ──────────────────────────────────────────────────────────────────
      await force(page, VENDORS_API, "failure", []);
      await page.goto(VENDORS_ROUTE, { waitUntil: "domcontentloaded" });
      await assertReducedMotion(page, reduced);
      const failure = await capture(page, '[data-testid="query-error"]');

      // ── forced EMPTY ────────────────────────────────────────────────────────────────────
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await force(page, VENDORS_API, "empty", []);
      await page.goto(VENDORS_ROUTE + "?state=empty", { waitUntil: "domcontentloaded" });
      await assertReducedMotion(page, reduced);
      const empty = await capture(page, "text=No vendors yet");

      // ── forced POPULATED ────────────────────────────────────────────────────────────────
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await force(page, VENDORS_API, "populated", [
        {
          // A syntactically valid UUID with the RFC 9562 version and variant nibbles set. Zod 4
          // enforces both, and `1111…-1111-1111-…` is REJECTED — which surfaced here as
          // "We couldn't read the server response" on the populated state and cost an hour.
          id: "11111111-1111-4111-8111-111111111111",
          name: "Forced Vendor A",
          paymentTerms: "NET_30",
          contactPerson: "A. Tester",
          active: true,
        },
      ]);
      await page.goto(VENDORS_ROUTE + "?state=populated", { waitUntil: "domcontentloaded" });
      await assertReducedMotion(page, reduced);
      const populated = await capture(page, "text=Forced Vendor A");

      // ── CHANNEL 1: text ─────────────────────────────────────────────────────────────────
      expect(failure.text, "the failure must name a failure").toMatch(/Couldn.t load vendors/i);
      expect(
        empty.text,
        "the empty result must not claim a failure — that IS the GA-001 defect",
      ).not.toMatch(/Couldn.t load/i);
      expect(empty.text).toMatch(/No vendors yet/i);
      expect(populated.text).toMatch(/Forced Vendor A/);

      // ── CHANNEL 2: role ─────────────────────────────────────────────────────────────────
      expect(
        failure.alerts.length,
        "only the failure carries an alert, so only the failure is announced",
      ).toBeGreaterThan(0);
      expect(
        empty.alerts,
        "an empty result must not announce an alert — a screen-reader user would be told a " +
          "failure happened when none did",
      ).toEqual([]);
      expect(populated.alerts).toEqual([]);

      // ── CHANNEL 3: pixels ───────────────────────────────────────────────────────────────
      const failureVsEmpty = await differingPixels(page, failure.shot, empty.shot);
      test.info().annotations.push({
        type: "MEASURED",
        description: `failure vs empty: ${failureVsEmpty} differing pixels (floor ${PIXEL_FLOOR}) — ${label}`,
      });
      process.stdout.write(
        `\n  vendors failure vs empty: ${failureVsEmpty} differing pixels (${label})\n`,
      );
      expect(
        failureVsEmpty,
        `the forced failure and the forced empty result render ${failureVsEmpty} differing ` +
          `pixels. Below the floor they have visually reconverged, which is GA-001 with better ` +
          `typography: the text and the role are still right and the screen still lies.`,
      ).toBeGreaterThan(PIXEL_FLOOR);

      const emptyVsPopulated = await differingPixels(page, empty.shot, populated.shot);
      expect(
        emptyVsPopulated,
        `an empty result and a populated list render ${emptyVsPopulated} differing pixels; ` +
          `below ${LIST_CONTENT_FLOOR} the list is not drawing its rows`,
      ).toBeGreaterThan(LIST_CONTENT_FLOOR);
    });
  }

  /**
   * The dashboard half. Its portlet boundary declares NO empty branch — it fails four queries
   * as a unit and otherwise renders portlets — so there is no empty state on this screen to
   * reconverge with, and this test does not pretend there is. What it asserts is the half that
   * does apply: the failure names a failure, carries an alert, and does not render as a
   * dashboard whose queries were answered.
   */
  test("manager dashboard · a failed portlet boundary is not mistakable for a loaded one", async ({
    as,
    obs,
  }) => {
    test.setTimeout(180_000);
    obs.expectNetworkFailure({
      url: "/api/v1/pos/tables",
      status: 500,
      because: "the 500 is forced by this spec",
    });
    obs.expectConsoleError(/500|INTERNAL|Failed to load resource|tables/i, "the forced failure");

    const page = await as(MANAGER);

    const answerEverythingEmpty = async () => {
      for (const { api, body } of DASHBOARD_EMPTY_ROUTES) {
        await page.route(api, (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(body),
          }),
        );
      }
    };

    // Both phases answer every query. The failure phase then registers the broken one LAST,
    // which is the handler Playwright uses. Without this the "failure" capture also carried
    // five live requests, and when pos-service was circuit-broken they came back 503 — so the
    // screen under test was failing for a reason the spec had not chosen.
    await answerEverythingEmpty();
    await force(page, DASHBOARD_FAIL_API, "failure", []);
    await page.goto(DASHBOARD_ROUTE, { waitUntil: "domcontentloaded" });
    const failure = await capture(page, '[data-testid="query-error"]');

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await answerEverythingEmpty();
    await page.goto(DASHBOARD_ROUTE + "?state=live", { waitUntil: "domcontentloaded" });
    // Anchored on a PORTLET's testid, not on the page heading and not on its label text. The
    // heading renders ABOVE the query boundary and is present in the failure state too, so
    // anchoring on it would have waited for something already there and captured whatever was
    // underneath. The label text is rendered through `text-transform: uppercase`, which
    // Playwright's text engine honours — `text="Open orders"` matched nothing on a screen
    // showing "OPEN ORDERS".
    const live = await capture(page, '[data-testid="portlet-manager-open-orders"]');

    /*
     * The notice NAMES THE RESOURCE, and this pattern has to name it too.
     *
     * <p>`DASHBOARD_FAIL_API` is `/api/v1/pos/tables`, and what the boundary renders for it is
     * "Couldn't load tables. Unable to reach the server. Check your connection and try again."
     * (measured against dev 2026-08-22). `Couldn't load today's service` is copy this product no
     * longer writes — `QueryErrorNotice` composes the sentence from the `what` each portlet
     * declares, which is the improvement: a manager is told which number is missing rather than
     * that something, somewhere, did not load.
     *
     * <p>The NEGATIVE assertion below is why this could not simply be left alone. It reads "the
     * live dashboard must not be claiming a failure" — and a pattern that matches nothing on any
     * build passes it no matter what the screen says. Both directions were dead; both are alive
     * now.
     */
    const FAILURE_COPY = /Couldn.t load tables/i;

    expect(failure.text).toMatch(FAILURE_COPY);
    expect(failure.alerts.length).toBeGreaterThan(0);
    expect(
      live.text,
      "with all four of its queries answered the dashboard must not be claiming a failure",
    ).not.toMatch(FAILURE_COPY);
    expect(live.alerts, "a dashboard whose queries succeeded announces nothing").toEqual([]);

    const diff = await differingPixels(page, failure.shot, live.shot);
    test.info().annotations.push({
      type: "MEASURED",
      description: `dashboard failure vs live: ${diff} differing pixels (floor ${PIXEL_FLOOR})`,
    });
    process.stdout.write(`\n  dashboard failure vs answered: ${diff} differing pixels\n`);
    expect(diff).toBeGreaterThan(PIXEL_FLOOR);
  });
});

test.describe("D-34-04 · the restyled states are accessible with the filter unavailable", () => {
  const BLOCKING = new Set(["critical", "serious"]);

  for (const state of ["failure", "empty"] as const) {
    test(`axe: the vendors ${state} state, compositing filter forced off`, async ({
      as,
      obs,
    }, testInfo) => {
      test.setTimeout(180_000);
      if (state === "failure") {
        obs.expectNetworkFailure({
          url: "/api/v1/purchasing/vendors",
          status: 500,
          because: "the 500 is forced by this spec",
        });
        obs.expectConsoleError(/vendors|500|INTERNAL|Failed to load resource/i, "the forced 500");
      }

      const page = await as(MANAGER);
      await force(page, VENDORS_API, state, []);
      await page.goto(VENDORS_ROUTE, { waitUntil: "domcontentloaded" });
      await capture(
        page,
        state === "failure" ? '[data-testid="query-error"]' : "text=No vendors yet",
      );
      await forceFilterOff(page);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      const violations = results.violations as unknown as {
        id: string;
        impact?: string | null;
        help: string;
        helpUrl: string;
        nodes: { html: string; target: string[] }[];
      }[];

      await testInfo.attach(`axe-vendors-${state}-filter-off.json`, {
        body: JSON.stringify(violations, null, 2),
        contentType: "application/json",
      });

      const counts = violations.reduce<Record<string, number>>((acc, v) => {
        const key = v.impact ?? "unknown";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});
      console.log(
        `[axe] vendors ${state} state, filter off: ` +
          (Object.entries(counts)
            .map(([k, n]) => `${k}=${n}`)
            .join(" ") || "no violations"),
      );

      const blocking = violations.filter((v) => BLOCKING.has(v.impact ?? ""));
      expect(
        blocking.map((v) => `${v.impact}:${v.id}`),
        blocking
          .map(
            (v) =>
              `  · [${v.impact}] ${v.id} — ${v.help}\n      ${v.helpUrl}\n` +
              v.nodes
                .slice(0, 3)
                .map((n) => `        ${n.target.join(" ")}\n          ${n.html.slice(0, 160)}`)
                .join("\n"),
          )
          .join("\n"),
      ).toEqual([]);
    });
  }
});
