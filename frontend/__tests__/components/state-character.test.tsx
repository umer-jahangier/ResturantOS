import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Color from "colorjs.io";
import { describe, expect, it, vi } from "vitest";

import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary, QueryErrorNotice } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { ZoneProvider, type Zone } from "@/components/providers/zone-provider";
import { compositeOver, wcagContrastCheck } from "@/lib/theme/wcag-validator";

import { token, type Scope } from "../lib/theme/css-tokens";
import { FRONTEND_ROOT } from "../lib/theme/module-graph";

/**
 * `@teispace/next-themes` ships an ESM build that imports `next/navigation` without the
 * extension Node's resolver requires, so importing the real module throws before a single
 * assertion runs. Only `useTheme` is consumed by the toaster, and only to pass a string
 * through to sonner — none of the assertions in this file depend on which theme it reports.
 */
vi.mock("@teispace/next-themes", () => ({
  useTheme: () => ({ theme: "light" as const }),
}));

/**
 * Plan 34-05's gate: the four data states got character, and none of them got quieter.
 *
 * <h3>The defect being re-asked (GA-001)</h3>
 *
 * Phase 14b found eleven of fifteen list screens rendering the EMPTY state when the request
 * FAILED — a forced 500 and a forced `[]` produced byte-identical text. The API fix made that
 * unrepresentable. Restyling those states is the activity most likely to reintroduce the
 * *visual* half of the same defect while the API stays correct, because a designer's instinct
 * on an error screen is to calm it, and a calm error looks like an empty result.
 *
 * So the salience assertion below is written first and is deliberately a MEASUREMENT rather
 * than a class-name check. A class list can be rearranged without changing what a person sees;
 * the composited chroma of the surface cannot.
 *
 * <h3>Negative controls performed, each observed RED before being restored</h3>
 *
 * Recorded as observed rather than asserted, per this phase's standing rule that an assertion
 * nobody has watched fail is not evidence. Run log in 34-05-SUMMARY.md.
 *
 * <ol>
 *   <li>`bg-destructive/15` on the error notice replaced with the empty state's `bg-surface-2`
 *       → the chroma-margin assertion failed (light 1.0× against a required 3×), and the
 *       "different semantic colour family" assertion failed with it.</li>
 *   <li>`role="alert"` removed from `QueryErrorNotice` → the role assertion failed and the
 *       distinguishability assertion failed naming the missing role.</li>
 *   <li>`Skeleton`'s zone branch inverted so the operational zone kept the shimmer → the
 *       operational-stillness assertion failed naming the `skeleton` class.</li>
 *   <li>The `.skeleton` rule deleted from the reduced-motion block in `globals.css` → the
 *       reduced-motion assertion failed.</li>
 *   <li>The `data-zone` wrapper removed from `components/ui/sonner.tsx` → the toast-root
 *       assertion failed with ANCHOR NOT FOUND rather than passing on an empty query.</li>
 *   <li>The precedence in `QueryBoundary` inverted to check empty before error — bug shape 1
 *       from its own header comment → the precedence assertion failed.</li>
 * </ol>
 */

const CSS = readFileSync(resolve(FRONTEND_ROOT, "app/globals.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

const THEMES: Scope[] = ["light", "dark"];

function inZone(zone: Zone, node: React.ReactNode) {
  return <ZoneProvider zone={zone}>{node}</ZoneProvider>;
}

/** Re-express a token at a Tailwind alpha suffix (`bg-destructive/15`). */
function atAlpha(colour: string, alpha: number): string {
  const c = new Color(colour);
  c.alpha = alpha;
  return c.toString();
}

/** OKLCH chroma of a composited surface — how far it sits from neutral. */
function chroma(colour: string): number {
  return new Color(colour).to("oklch").c ?? 0;
}

/**
 * The surface fill a Tailwind class list actually paints, resolved to the composited colour.
 *
 * <h3>Why the class list is READ rather than assumed</h3>
 *
 * The first draft of this file measured `--destructive` at 0.15 because that is what the error
 * notice happens to use today. That gate would have survived the exact restyle it exists to
 * catch: swap `bg-destructive/15` for `bg-surface-2` in the component and a hard-coded
 * measurement of the destructive ramp keeps reporting a 7× chroma margin that nothing on
 * screen has any more. Six gates in this phase have already failed that way. So the tokens
 * come from the rendered element, and a class list with no background utility THROWS rather
 * than resolving to a default.
 */
function fillOf(element: Element, theme: Scope, what: string): string {
  const match = /(?:^|\s)bg-([a-z0-9-]+?)(?:\/(\d{1,3}))?(?=\s|$)/.exec(element.className);
  if (!match) {
    throw new Error(
      `ANCHOR NOT FOUND: ${what} paints no \`bg-*\` utility, so there is no surface to ` +
        `measure and this assertion would otherwise pass against nothing. Class list: ` +
        `"${element.className}"`,
    );
  }
  const [, name, alpha] = match;
  const base = token(`--${name}`, theme);
  const fill = alpha === undefined ? base : atAlpha(base, Number(alpha) / 100);
  return compositeOver(fill, token("--background", theme));
}

/** The error notice as rendered, and the empty state's most prominent surface. */
function renderBothStates() {
  const failure = render(<QueryErrorNotice what="vendors" error={{}} />);
  const errorEl = failure.container.querySelector('[data-testid="query-error"]');
  if (!errorEl) throw new Error("ANCHOR NOT FOUND: QueryErrorNotice rendered no query-error node");

  const emptiness = render(<EmptyState title="No vendors yet" />);
  const emptyEl = emptiness.container.querySelector('[aria-hidden="true"]');
  if (!emptyEl) throw new Error("ANCHOR NOT FOUND: EmptyState rendered no decorative surface");

  return { errorEl, emptyEl, cleanup: () => (failure.unmount(), emptiness.unmount()) };
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// The assertion this file exists for, written first.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe("D-34-01 · the error state is LOUDER than the empty state, measured", () => {
  /**
   * Salience is measured on two axes because a person reads both:
   *
   *   chroma — a coloured surface on a near-neutral page is what catches the eye first, and
   *            it is the axis a "calm" restyle collapses. The margin here is 4–7×, not 5%.
   *   luminance contrast against the page — how far the surface separates from the page it
   *            sits on. The margin is small in dark, so it is asserted as an ordering rather
   *            than as a factor. Stating the weaker axis weakly is the point.
   */
  it.each(THEMES)(
    "%s: the error surface carries at least 3x the chroma of the empty state's",
    (theme) => {
      const { errorEl, emptyEl, cleanup } = renderBothStates();
      const errorChroma = chroma(fillOf(errorEl, theme, "the error notice"));
      const emptyChroma = chroma(fillOf(emptyEl, theme, "the empty state's disc"));
      cleanup();

      expect(
        errorChroma / Math.max(emptyChroma, 1e-6),
        `the error surface composites to chroma ${errorChroma.toFixed(4)} and the empty ` +
          `state's disc to ${emptyChroma.toFixed(4)}. Phase 14b exists because a failure that ` +
          `reads as an empty result told an owner their business had no vendors while the ` +
          `service was down; a restyle that neutralises the failure surface recreates that ` +
          `defect with better typography.`,
      ).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(THEMES)("%s: the error surface separates from the page at least as much", (theme) => {
    const background = token("--background", theme);
    const { errorEl, emptyEl, cleanup } = renderBothStates();
    const errorSeparation = wcagContrastCheck(
      fillOf(errorEl, theme, "the error notice"),
      background,
    ).ratio;
    const emptySeparation = wcagContrastCheck(
      fillOf(emptyEl, theme, "the empty state's disc"),
      background,
    ).ratio;
    cleanup();

    expect(
      errorSeparation,
      `error surface separates from the page at ${errorSeparation}:1, empty at ` +
        `${emptySeparation}:1. The error may never be the quieter of the two.`,
    ).toBeGreaterThanOrEqual(emptySeparation);
  });

  it.each(THEMES)("%s: the error's own text still clears AA on its restyled surface", (theme) => {
    const { errorEl, cleanup } = renderBothStates();
    const fill = fillOf(errorEl, theme, "the error notice");

    // `text-*` is overloaded in Tailwind: `text-sm` is a size and `text-destructive` is a
    // colour. Candidates are tried in order and the first that resolves to a declared custom
    // property wins; none resolving is an ANCHOR failure, never a silent skip.
    const candidates = [...errorEl.className.matchAll(/(?:^|\s)text-([a-z0-9-]+?)(?=\s|$)/g)].map(
      (m) => m[1]!,
    );
    const colourName = candidates.find((name) => {
      try {
        token(`--${name}`, theme);
        return true;
      } catch {
        return false;
      }
    });
    if (!colourName) {
      throw new Error(
        `ANCHOR NOT FOUND: none of the error notice's \`text-*\` utilities ` +
          `(${candidates.join(", ") || "none at all"}) resolves to a token in globals.css, so ` +
          `there is no foreground to measure. Class list: "${errorEl.className}"`,
      );
    }
    cleanup();

    const result = wcagContrastCheck(token(`--${colourName}`, theme), fill);
    expect(
      result.passAA,
      `text-${colourName} on the error surface measures ${result.ratio}:1. D-34-01: a ` +
        `surface treatment that drops text below its floor is a regression, not a style.`,
    ).toBe(true);
  });

  it("the error surface is raised and the empty state is not — depth moves salience UP", () => {
    render(<QueryErrorNotice what="vendors" error={new Error("boom")} />);
    const notice = screen.getByTestId("query-error");
    expect(notice.className, "the error box carries a depth token").toMatch(/shadow-depth-/);

    expect(
      notice.className,
      "no entrance animation may gate the appearance of a failure — if the animation does " +
        "not run, the failure must already be on screen and readable",
    ).not.toMatch(/vdl-enter|vdl-reveal|vdl-stagger/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Task 1 — the loading placeholder
// ─────────────────────────────────────────────────────────────────────────────────────────

describe("D-34-02 · the loading placeholder is zone-aware", () => {
  it.each(["expressive", "restrained"] as const)("%s carries the shimmer treatment", (zone) => {
    const { container } = render(inZone(zone, <Skeleton className="h-4 w-24" />));
    const node = container.querySelector('[data-slot="skeleton"]');
    if (!node) throw new Error("ANCHOR NOT FOUND: no [data-slot=skeleton] rendered");

    expect(node.className).toContain("skeleton");
    expect(node.getAttribute("data-zone")).toBe(zone);
  });

  it("operational renders STILL — no animation of any kind", () => {
    const { container } = render(inZone("operational", <Skeleton className="h-4 w-24" />));
    const node = container.querySelector('[data-slot="skeleton"]');
    if (!node) throw new Error("ANCHOR NOT FOUND: no [data-slot=skeleton] rendered");

    expect(
      node.className.split(/\s+/),
      "the shimmer is a perpetual animation, and a suspense boundary in the SHELL can push " +
        "one onto a POS terminal without anybody choosing to. That is why the zone is read " +
        "from context rather than from the importing file.",
    ).not.toContain("skeleton");
    expect(node.getAttribute("data-zone")).toBe("operational");
  });

  it("under a reduced-motion preference the shimmer is ABSENT, not shortened, in every zone", () => {
    // Derived from the shipped stylesheet: jsdom applies no CSS, so a rendered assertion here
    // would be a rendered assertion of nothing. This is the same technique
    // motion-vocabulary.test.ts uses, and it is checked against the REAL text of the rule
    // rather than by proximity — the phase's first vacuous gate matched `animation: none`
    // from a neighbouring rule.
    const block = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/.exec(CSS);
    expect(block, "globals.css has no prefers-reduced-motion block at all").not.toBeNull();

    const open = CSS.indexOf("{", block!.index);
    let depth = 0;
    let body = "";
    for (let i = open; i < CSS.length; i += 1) {
      if (CSS[i] === "{") depth += 1;
      else if (CSS[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          body = CSS.slice(open + 1, i);
          break;
        }
      }
    }

    const rule = /(^|\})\s*\.skeleton\s*\{([^}]*)\}/.exec(body);
    expect(
      rule,
      "no `.skeleton` rule inside the reduced-motion block. The shimmer is the only " +
        "perpetual animation this product ships; it must be removed under the preference, " +
        "not merely collapsed by the global 0.01ms safety net.",
    ).not.toBeNull();

    expect(
      rule![2]!.replace(/\s+/g, " "),
      "D-34-03 asks for decorative motion to be ABSENT, not fast",
    ).toMatch(/animation:\s*none/);
  });

  it("the placeholder stays hidden from assistive technology in every variant", () => {
    for (const zone of ["expressive", "restrained", "operational"] as const) {
      const { container, unmount } = render(inZone(zone, <Skeleton />));
      const node = container.querySelector('[data-slot="skeleton"]');
      if (!node) throw new Error(`ANCHOR NOT FOUND: no skeleton rendered in ${zone}`);
      expect(node.getAttribute("aria-hidden")).toBe("true");
      expect(node.getAttribute("role")).toBe("presentation");
      unmount();
    }
  });

  it("dimension and radius classes reach the element unchanged in every zone", () => {
    // Three skeleton compositions depend on the shape (sidebar, dashboard, data-table), and
    // the sidebar one renders inside the SHELL — which is what puts it above the POS.
    for (const zone of ["expressive", "restrained", "operational"] as const) {
      const { container, unmount } = render(inZone(zone, <Skeleton className="h-12 w-40" />));
      const node = container.querySelector('[data-slot="skeleton"]');
      expect(node!.className).toContain("h-12");
      expect(node!.className).toContain("w-40");
      expect(node!.className).toContain("rounded-md");
      unmount();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Task 2 — empty, error and success
// ─────────────────────────────────────────────────────────────────────────────────────────

describe("D-34-01 · the empty state keeps teaching the next action", () => {
  it("renders title, description and an operable action with animation suppressed", async () => {
    const onClick = vi.fn();
    render(
      inZone(
        "expressive",
        <EmptyState
          title="No vendors yet"
          description="Add your first supplier to start raising purchase orders."
          action={{ label: "Add vendor", onClick }}
        />,
      ),
    );

    expect(screen.getByText("No vendors yet")).toBeInTheDocument();
    expect(screen.getByText(/Add your first supplier/)).toBeInTheDocument();

    // jsdom runs no animations at all, which is exactly the "suppressed" condition: if the
    // action were gated behind an entrance it would be unreachable here.
    const action = screen.getByRole("button", { name: "Add vendor" });
    await userEvent.click(action);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("the decoration is additive — the action still follows the title in reading order", () => {
    const { container } = render(
      inZone(
        "expressive",
        <EmptyState title="No vendors yet" action={{ label: "Add vendor", onClick: () => {} }} />,
      ),
    );

    const text = container.textContent ?? "";
    expect(text.indexOf("No vendors yet")).toBeLessThan(text.indexOf("Add vendor"));

    const disc = container.querySelector('[aria-hidden="true"]');
    expect(disc, "ANCHOR NOT FOUND: the empty state renders no decorative disc").not.toBeNull();
    expect(
      disc!.getAttribute("aria-hidden"),
      "the illustration is decoration and must not be announced",
    ).toBe("true");
  });
});

describe("D-34-01 · the failure state at first paint", () => {
  it("carries the alert role, the failure wording and the retry, before any animation", () => {
    const onRetry = vi.fn();
    render(inZone("expressive", <QueryErrorNotice what="vendors" error={{}} onRetry={onRetry} />));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-testid", "query-error");
    expect(alert.textContent).toMatch(/Couldn.t load vendors/);
    expect(screen.getByTestId("query-error-retry")).toBeInTheDocument();
  });

  it("uses the danger semantic family and the empty state uses a neutral one", () => {
    const { container: errorTree } = render(
      inZone("expressive", <QueryErrorNotice what="vendors" error={{}} />),
    );
    const { container: emptyTree } = render(
      inZone("expressive", <EmptyState title="No vendors yet" />),
    );

    expect(errorTree.innerHTML).toMatch(/destructive/);
    expect(
      emptyTree.innerHTML,
      "an empty state that borrows the danger ramp is a screen claiming a failure that did " +
        "not happen — the mirror image of GA-001",
    ).not.toMatch(/destructive/);
  });
});

describe("GA-001 · precedence, unchanged by the restyle", () => {
  const failing = { isError: true, error: {}, isPending: false };
  const pending = { isError: false, isPending: true };
  const ok = { isError: false, isPending: false };

  it("error is checked BEFORE loading", () => {
    render(
      <QueryBoundary
        query={[failing, pending]}
        what="vendors"
        loading={<p>loading marker</p>}
        isEmpty
        empty={<p>empty marker</p>}
      >
        <p>children marker</p>
      </QueryBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("loading marker")).toBeNull();
    expect(screen.queryByText("empty marker")).toBeNull();
  });

  it("error is checked BEFORE empty — bug shape 1, re-asked after the restyle", () => {
    render(
      <QueryBoundary query={failing} what="vendors" isEmpty empty={<p>empty marker</p>}>
        <p>children marker</p>
      </QueryBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("empty marker")).toBeNull();
  });

  it("loading is checked before empty", () => {
    render(
      <QueryBoundary
        query={pending}
        what="vendors"
        loading={<p>loading marker</p>}
        isEmpty
        empty={<p>empty marker</p>}
      >
        <p>children marker</p>
      </QueryBoundary>,
    );
    expect(screen.getByText("loading marker")).toBeInTheDocument();
    expect(screen.queryByText("empty marker")).toBeNull();
  });

  it("a forced failure and a forced empty result differ by TEXT and by ROLE", () => {
    const { container: failureTree, unmount } = render(
      <QueryBoundary
        query={failing}
        what="vendors"
        isEmpty
        empty={<EmptyState title="No vendors yet" />}
      >
        <p>children</p>
      </QueryBoundary>,
    );
    const failureText = failureTree.textContent ?? "";
    const failureRoles = failureTree.querySelector('[role="alert"]');
    unmount();

    const { container: emptyTree } = render(
      <QueryBoundary
        query={ok}
        what="vendors"
        isEmpty
        empty={<EmptyState title="No vendors yet" />}
      >
        <p>children</p>
      </QueryBoundary>,
    );
    const emptyText = emptyTree.textContent ?? "";

    expect(failureText).not.toBe(emptyText);
    expect(failureText, "the failure names a failure").toMatch(/Couldn.t load/);
    expect(emptyText, "the empty result must not claim a failure").not.toMatch(/Couldn.t load/);
    expect(failureRoles, "only the failure carries an alert").not.toBeNull();
    expect(emptyTree.querySelector('[role="alert"]')).toBeNull();
  });
});

/**
 * The generalisation of the error-surface measurement above, aimed at the place it actually
 * broke: a SUBTLE semantic tint with a text stop chosen for a SOLID one.
 *
 * Found on `/settings/appearance` on 2026-08-12, by looking at the screen in a real browser in
 * dark mode as a persona who could reach it. `--warning-foreground` is the stop for text on a
 * solid warning fill; in dark it resolves to `--neutral-1000`, and on `bg-warning/10` over the
 * card that measured **1.21:1**. Light measured 17.74:1, which is exactly why it survived —
 * the defect is invisible in the theme people develop in, and the same class list is correct
 * in one theme and unreadable in the other.
 *
 * Scoped to the notices that pair a `/NN` semantic tint with an explicit text colour, read out
 * of the shipped source rather than restated here, so a later edit to the class list is what
 * this test sees.
 */
describe("D-34-01 · a semantic tint's text stop clears AA in BOTH themes", () => {
  const NOTICES: { file: string; testid: string; what: string }[] = [
    {
      file: "components/settings/appearance-form.tsx",
      testid: "appearance-not-persisted",
      what: "the appearance screen's not-persisted warning",
    },
  ];

  it.each(NOTICES.flatMap((n) => THEMES.map((t) => [n, t] as const)))(
    "%o in %s",
    (notice, theme) => {
      const source = readFileSync(resolve(FRONTEND_ROOT, notice.file), "utf8");
      const block = source.slice(source.indexOf(`data-testid="${notice.testid}"`));
      const classMatch = /className="([^"]+)"/.exec(block);
      if (!classMatch) {
        throw new Error(
          `ANCHOR NOT FOUND: no className on the element carrying ` +
            `data-testid="${notice.testid}" in ${notice.file}`,
        );
      }
      const classes = classMatch[1]!;

      const bg = /(?:^|\s)bg-([a-z0-9-]+?)\/(\d{1,3})(?=\s|$)/.exec(classes);
      if (!bg) {
        throw new Error(
          `ANCHOR NOT FOUND: ${notice.what} paints no translucent \`bg-*\/NN\` tint, so there ` +
            `is nothing to composite. Class list: "${classes}"`,
        );
      }
      const textNames = [...classes.matchAll(/(?:^|\s)text-([a-z0-9-]+?)(?=\s|$)/g)].map(
        (m) => m[1]!,
      );
      const colourName = textNames.find((name) => {
        try {
          token(`--${name}`, theme);
          return true;
        } catch {
          return false;
        }
      });
      if (!colourName) {
        throw new Error(
          `ANCHOR NOT FOUND: none of ${notice.what}'s text-* utilities resolves to a token`,
        );
      }

      const composited = compositeOver(
        atAlpha(token(`--${bg[1]}`, theme), Number(bg[2]) / 100),
        token("--card", theme),
      );
      const result = wcagContrastCheck(token(`--${colourName}`, theme), composited);

      expect(
        result.passAA,
        `${notice.what}: text-${colourName} on bg-${bg[1]}/${bg[2]} over --card measures ` +
          `${result.ratio}:1 in ${theme}. A stop chosen for a SOLID semantic fill is not a stop ` +
          `for a 10% tint of it, and the two themes disagree about which is which.`,
      ).toBe(true);
    },
  );
});

describe("D-34-02 · the toast surface declares a zone", () => {
  it("stamps data-zone on its root, and it is never expressive", () => {
    const { container } = render(<Toaster />);
    const root = container.querySelector('[data-slot="toaster-zone-root"]');
    if (!root) {
      throw new Error(
        "ANCHOR NOT FOUND: no [data-slot=toaster-zone-root]. sonner's ToasterProps forwards " +
          "no arbitrary DOM attributes, so if the wrapper in components/ui/sonner.tsx is " +
          "removed the zone is not stamped anywhere and this assertion must fail loudly " +
          "rather than query null and assert nothing.",
      );
    }

    const zone = root.getAttribute("data-zone");
    expect(zone).not.toBeNull();
    expect(
      zone,
      "one root-mounted toaster renders over the POS terminal and the KDS board as readily " +
        "as over a dashboard. SPEC §1: chrome is bound by the poorest zone it can appear over.",
    ).not.toBe("expressive");
  });

  it("resolves the zone of the surface it is mounted in", () => {
    const { container } = render(inZone("operational", <Toaster />));
    const root = container.querySelector('[data-slot="toaster-zone-root"]');
    expect(root!.getAttribute("data-zone")).toBe("operational");
  });
});
