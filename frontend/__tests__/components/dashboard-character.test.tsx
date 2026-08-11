import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PortletRow } from "@/components/dashboard/dashboard-shell";
import { KpiTile } from "@/components/dashboard/portlets/portlet";
import { TrendChart, type TrendSeries } from "@/components/dashboard/portlets/trend-chart";
import { DASHBOARD_PRESETS, visiblePortlets } from "@/components/dashboard/presets";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { ZoneProvider } from "@/components/providers/zone-provider";
import { GLASS_SURFACES } from "@/lib/theme/glass-surfaces";

import { FRONTEND_ROOT } from "../lib/theme/module-graph";

/**
 * Plan 34-06's gate: the dashboard was given depth, and it is provably the same dashboard.
 *
 * <h3>The two things that are easy to get subtly wrong here</h3>
 *
 * A treatment pass that reorders a portlet or drops one from a preset has become an
 * unreviewed feature change wearing a restyle's clothes, and nothing on screen says so. The
 * preset-equivalence assertion is written first for that reason.
 *
 * A chart that "draws itself in" has become a rendering change the moment the drawing differs.
 * The path data is therefore asserted byte-identical against a captured baseline — a
 * difference between a reveal and a re-render is invisible on screen and obvious in a diff.
 *
 * <h3>Negative controls performed, each OBSERVED red then restored</h3>
 *
 * <ol>
 *   <li>A seventh portlet appended to the owner preset → the preset-equivalence assertion
 *       failed, naming the added id.</li>
 *   <li>`points` in `TrendChart` recomputed with `plotH * 0.9` — a plausible "tidy up the top
 *       margin" edit → the path-equivalence assertion failed with both point strings.</li>
 *   <li>The series labels moved back inside the masked group → the frame-zero label assertion
 *       failed.</li>
 *   <li>`AnimatedNumber` reverted to keying `end` off the live `value` → the
 *       does-not-animate-on-update assertion failed.</li>
 *   <li>`useReducedMotion` forced to `false` in the reduced-motion case → the
 *       never-counts-up-under-reduced-motion assertion failed.</li>
 *   <li>`.vdl-stagger` removed from `PortletRow` → the stagger assertion failed.</li>
 * </ol>
 */

const CSS = readFileSync(resolve(FRONTEND_ROOT, "app/globals.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

let reducedMotion = false;
vi.mock("@/lib/hooks/ui/use-reduced-motion", () => ({
  useReducedMotion: () => reducedMotion,
}));

afterEach(() => {
  reducedMotion = false;
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Written first: the composition did not move.
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The portlet sets, as they stood before phase 34 touched this screen.
 *
 * Captured from `presets.ts` rather than derived from it — a baseline derived from the thing
 * it is checking is not a baseline. `visiblePortlets` is called with every permission granted,
 * because permission filtering is phase 21's behaviour and this assertion is about whether a
 * TREATMENT pass moved anything.
 */
const PRESET_BASELINE: Record<string, string[]> = {
  owner: [
    "owner-net-sales",
    "owner-gross-margin",
    "owner-covers",
    "owner-avg-order",
    "owner-sales-trend",
    "owner-top-items",
    "owner-exceptions",
  ],
  manager: [
    "manager-open-orders",
    "manager-late-tickets",
    "manager-till-variance",
    "manager-tables-occupied",
    "manager-live-orders",
    "manager-station-load",
    "manager-exceptions",
    "manager-86d",
  ],
  cashier: ["cashier-till", "cashier-open-orders", "cashier-shortcuts"],
  kitchen: ["kitchen-late-tickets", "kitchen-open-tickets", "kitchen-shortcuts"],
};

function allPermissions(presetId: keyof typeof DASHBOARD_PRESETS): string[] {
  return DASHBOARD_PRESETS[presetId].portlets
    .map((p) => p.permission)
    .filter((p): p is string => Boolean(p));
}

describe("D-34-02 · the treatment pass did not move the composition", () => {
  it.each(Object.keys(PRESET_BASELINE))(
    "%s renders exactly the portlets it rendered before phase 34",
    (presetId) => {
      const key = presetId as keyof typeof DASHBOARD_PRESETS;
      const ids = visiblePortlets(DASHBOARD_PRESETS[key], allPermissions(key)).map((p) => p.id);

      expect(
        ids,
        `the ${presetId} preset's portlet set changed. Composition belongs to phases 21 and ` +
          `33; a design pass that quietly re-lays-out a screen is how a restyle becomes an ` +
          `unreviewed feature change.`,
      ).toEqual(PRESET_BASELINE[presetId]);
    },
  );

  it("every portlet still declares a drill target — a KPI you cannot click is a poster", () => {
    for (const preset of Object.values(DASHBOARD_PRESETS)) {
      for (const portlet of preset.portlets) {
        expect(portlet.drillTo, `${portlet.id} has no drill target`).toBeTruthy();
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Task 1 — glass, depth, lift, stagger
// ─────────────────────────────────────────────────────────────────────────────────────────

function renderTile(overrides: Partial<React.ComponentProps<typeof KpiTile>> = {}) {
  return render(
    <ZoneProvider zone="expressive">
      <KpiTile
        id="manager-open-orders"
        title="Open orders"
        drillTo="/app/pos/orders"
        density="comfortable"
        value="7"
        caption="7 orders in view"
        {...overrides}
      />
    </ZoneProvider>,
  );
}

describe("D-34-06 · portlets carry glass and depth, and the lift means something", () => {
  it("a portlet is a glass surface with a depth token and a hover lift", () => {
    const { container } = renderTile();
    const tile = container.querySelector('[data-testid="portlet-manager-open-orders"]');
    if (!tile) throw new Error("ANCHOR NOT FOUND: the portlet did not render its testid");

    expect(tile.className).toContain("glass-surface");
    expect(tile.className).toMatch(/shadow-depth-\d/);
    expect(
      tile.className,
      "the lift is reserved for tiles that respond to a click — §7.3 makes the whole card the " +
        "drill target, so every portlet qualifies and the affordance still means something",
    ).toContain("vdl-lift");
  });

  it("the glass rule ships its OPAQUE background outside any feature query", () => {
    // The same authoring rule 34-02 established, re-asserted from the portlet's side: the
    // degraded path is the one that ships, and translucency is the enhancement.
    const base = /(^|\})\s*\.glass-surface\s*\{([^}]*)\}/.exec(CSS);
    expect(
      base,
      "ANCHOR NOT FOUND: no unconditional `.glass-surface` rule in globals.css",
    ).not.toBeNull();
    expect(base![2]).toMatch(/background-color:\s*var\(--glass-panel-solid\)/);
  });

  it("the portlet's declared substrate is one the 34-02 manifest permits", () => {
    // PortletShell declares `--background` in its comment and inherits it from the shell's
    // <main>. If that substrate ever leaves the manifest, the measured contrast table stops
    // covering this surface and the figure in SPEC §2.4 stops applying to it.
    const panel = GLASS_SURFACES.find((s) => s.id === "panel");
    if (!panel) throw new Error("ANCHOR NOT FOUND: no `panel` surface in the 34-02 manifest");
    expect(panel.substrateTokens).toContain("--background");
  });

  it("no portlet emits a raw Tailwind palette class", () => {
    const source = readFileSync(
      resolve(FRONTEND_ROOT, "components/dashboard/portlets/portlet.tsx"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");

    const raw = source.match(
      /\b(?:bg|text|border|ring|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g,
    );
    expect(raw ?? [], `raw palette classes in portlet.tsx: ${(raw ?? []).join(", ")}`).toEqual([]);
  });

  it("the row stagger is computed from the token and the index, not hand-written", () => {
    const { container } = render(
      <ZoneProvider zone="expressive">
        <PortletRow density="comfortable" columns={4}>
          <div data-testid="a" />
          <div data-testid="b" />
          <div data-testid="c" />
        </PortletRow>
      </ZoneProvider>,
    );

    const row = container.querySelector(".vdl-stagger");
    if (!row) {
      throw new Error(
        "ANCHOR NOT FOUND: PortletRow rendered no `.vdl-stagger` element, so the stagger " +
          "assertion below would query nothing and assert nothing",
      );
    }

    const indices = ["a", "b", "c"].map((id) =>
      (screen.getByTestId(id) as HTMLElement).style.getPropertyValue("--vdl-i"),
    );
    expect(indices, "each child carries its own index; the delay is the stylesheet's job").toEqual([
      "0",
      "1",
      "2",
    ]);

    const rule = /\[data-zone="expressive"\]\s*\.vdl-stagger\s*>\s*\*\s*\{([^}]*)\}/.exec(CSS);
    expect(rule, "ANCHOR NOT FOUND: no `.vdl-stagger > *` rule in globals.css").not.toBeNull();
    expect(rule![1]).toMatch(
      /animation-delay:\s*calc\(var\(--vdl-i,\s*0\)\s*\*\s*var\(--motion-stagger\)\)/,
    );
  });

  it("with the entrance suppressed the drill target is still reachable", () => {
    // The stagger class sets no resting style, so removing it must leave the tile exactly
    // where it is. Asserted structurally: the anchor is a real link with a real href.
    const { container } = renderTile();
    const tile = container.querySelector('[data-testid="portlet-manager-open-orders"]');
    expect(tile!.tagName.toLowerCase()).toBe("a");
    expect(tile!.getAttribute("href")).toBe("/app/pos/orders");
    expect(tile!.className).not.toMatch(/opacity-0|invisible|scale-0/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Task 2 — the chart reveal
// ─────────────────────────────────────────────────────────────────────────────────────────

const SERIES: TrendSeries[] = [
  {
    label: "Net sales",
    values: [1200, 1500, 900, 1800],
    colorVar: "--chart-1",
    format: (v) => `Rs. ${v}`,
  },
  {
    label: "Orders",
    values: [30, 42, 21, 55],
    colorVar: "--chart-2",
    dash: "6 4",
    format: (v) => `${v}`,
  },
];

const CATEGORIES = ["Mon", "Tue", "Wed", "Thu"];

/**
 * The path geometry as it stood before the reveal was added, captured from a render of the
 * pre-reveal component and pasted here.
 *
 * A baseline recomputed by the test from the same formulae the component uses would pass
 * whatever the component did, which is the shape of a gate that measures nothing. These two
 * strings were rendered from `git show HEAD:…/trend-chart.tsx` — the component as it stood
 * before the mask was added — and pasted in.
 */
const PATH_BASELINE = [
  "8,66 186.66666666666666,39 365.3333333333333,93 544,12",
  "8,171.3 186.66666666666666,170.22 365.3333333333333,172.11 544,169.05",
];

function polylinePoints(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("polyline")).map(
    (p) => p.getAttribute("points") ?? "",
  );
}

describe("D-34-01 · the chart reveals itself without changing what it draws", () => {
  it("the reveal is a mask, and the drawing under it is untouched", () => {
    const { container } = render(
      <ZoneProvider zone="expressive">
        <TrendChart categories={CATEGORIES} series={SERIES} />
      </ZoneProvider>,
    );

    const mask = container.querySelector('[data-testid="trend-chart-reveal-mask"]');
    if (!mask) throw new Error("ANCHOR NOT FOUND: the chart renders no reveal mask");

    // Exactly one animated thing, and it is not part of the drawing.
    const animated = Array.from(container.querySelectorAll(".vdl-reveal"));
    expect(animated.length, "only the mask animates").toBe(1);
    expect(animated[0]).toBe(mask);

    // The masked group carries the series; the mask is not in it.
    const revealed = container.querySelector('[data-testid="trend-chart-revealed"]');
    expect(revealed, "ANCHOR NOT FOUND: no masked group").not.toBeNull();
    expect(revealed!.querySelectorAll("polyline").length).toBe(SERIES.length);
  });

  it("the CVD dash pattern on each series survives the reveal", () => {
    const { container } = render(
      <ZoneProvider zone="expressive">
        <TrendChart categories={CATEGORIES} series={SERIES} />
      </ZoneProvider>,
    );

    const lines = Array.from(container.querySelectorAll("polyline"));
    expect(
      lines.map((l) => l.getAttribute("stroke-dasharray")),
      "UI-SPEC §3.4 makes the dash PATTERN a redundant encoding channel because no " +
        "five-colour categorical palette is safe under dichromacy. A reveal implemented by " +
        "overwriting stroke-dasharray on these strokes would have traded that contract for " +
        "an animation, which is why the reveal lives on a mask.",
    ).toEqual([null, "6 4"]);
  });

  it("the series labels are present and positioned at frame zero, outside the mask", () => {
    const { container } = render(
      <ZoneProvider zone="expressive">
        <TrendChart categories={CATEGORIES} series={SERIES} />
      </ZoneProvider>,
    );

    const labels = Array.from(
      container.querySelectorAll('[data-testid="trend-chart-series-label"]'),
    );
    expect(labels.map((l) => l.textContent)).toEqual(["Net sales", "Orders"]);

    const revealed = container.querySelector('[data-testid="trend-chart-revealed"]');
    for (const label of labels) {
      expect(
        revealed!.contains(label),
        "a label inside the mask is a label that is absent for the whole animation and " +
          "absent permanently if the animation never runs — leaving the chart identified by " +
          "colour alone, on a palette measured at about sixteen separation under protanopia",
      ).toBe(false);
      expect(label.getAttribute("x")).toBeTruthy();
      expect(label.getAttribute("y")).toBeTruthy();
    }
  });

  it("the reveal class is expressive-scoped and removed outright under reduced motion", () => {
    const scoped = /\[data-zone="expressive"\]\s*\.vdl-reveal\s*\{([^}]*)\}/.exec(CSS);
    expect(scoped, "ANCHOR NOT FOUND: `.vdl-reveal` is not zone-scoped").not.toBeNull();
    expect(scoped![1]).toMatch(/animation:\s*vdlReveal/);

    // Under reduced motion the mask sits at dashoffset 0 — chart complete, not chart fast.
    const removal =
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.vdl-reveal[\s\S]*?\{([^}]*)\}/.exec(
        CSS,
      );
    expect(
      removal,
      "ANCHOR NOT FOUND: `.vdl-reveal` is not removed under reduced motion",
    ).not.toBeNull();
    expect(removal![1]).toMatch(/animation:\s*none/);
  });

  it("the keyframe carries the offset and the element's resting style is its finished style", () => {
    const keyframe = /@keyframes\s+vdlReveal\s*\{([\s\S]*?)\n\}/.exec(CSS);
    expect(keyframe, "ANCHOR NOT FOUND: no vdlReveal keyframe").not.toBeNull();
    expect(keyframe![1]).toMatch(/from\s*\{/);
    expect(
      keyframe![1],
      "a `to` frame would mean the element's own style is not its finished style, and a " +
        "reduced-motion user would see whatever the `from` frame left behind",
    ).not.toMatch(/\bto\s*\{/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Task 2 — the count-up
// ─────────────────────────────────────────────────────────────────────────────────────────

describe("D-34-03 · a number counts up once and never again", () => {
  it("counts up on first appearance", () => {
    const { container } = render(<AnimatedNumber value={248500} />);
    expect(container.querySelector('[data-animated="true"]')).not.toBeNull();
  });

  it("a new value from a refetch, a push or a filter change renders INSTANTLY", () => {
    const { container, rerender } = render(<AnimatedNumber value={248500} />);
    expect(container.querySelector('[data-animated="true"]')).not.toBeNull();

    rerender(<AnimatedNumber value={249900} />);

    expect(
      container.querySelector('[data-animated="true"]'),
      "a live dashboard receives pushes; a figure that re-animates on every push is a figure " +
        "an operator cannot read, and phase 20 already ruled that a data update does not animate",
    ).toBeNull();
    expect(container.textContent).toContain("249,900");
  });

  it("under a reduced-motion preference it never counts up, first appearance included", () => {
    reducedMotion = true;
    const { container } = render(<AnimatedNumber value={248500} />);

    expect(container.querySelector('[data-animated="true"]')).toBeNull();
    expect(container.textContent, "the final value, immediately").toContain("248,500");
  });

  it("the module consults the preference itself, because no stylesheet can reach a timer", () => {
    const source = readFileSync(
      resolve(FRONTEND_ROOT, "components/ui/animated-number.tsx"),
      "utf8",
    );
    expect(source).toContain("useReducedMotion");
  });

  it("prefix, suffix and decimals survive the instant path", () => {
    const { container, rerender } = render(
      <AnimatedNumber value={12.5} decimals={1} prefix="+" suffix="%" />,
    );
    act(() => {
      rerender(<AnimatedNumber value={13.25} decimals={1} prefix="+" suffix="%" />);
    });
    expect(container.textContent).toBe("+13.3%");
  });
});

describe("D-34-01 · the chart's path data is byte-identical to its pre-reveal baseline", () => {
  it("matches the captured baseline", () => {
    const { container } = render(
      <ZoneProvider zone="expressive">
        <TrendChart categories={CATEGORIES} series={SERIES} />
      </ZoneProvider>,
    );

    expect(
      polylinePoints(container as HTMLElement),
      "the reveal is a mask over an unchanged drawing. If these strings moved, the animation " +
        "has silently become a rendering change — invisible on screen, obvious here.",
    ).toEqual(PATH_BASELINE);
  });
});
