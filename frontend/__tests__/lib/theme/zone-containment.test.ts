import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  FRONTEND_ROOT,
  moduleClosure,
  routeEntries,
  sourceFilesUnder,
  stripComments,
  toRelative,
} from "./module-graph";

/**
 * The static half of the D-34-02 containment gate.
 *
 * <p>The runtime half lives in `e2e/journeys/operational-zone-containment.spec.ts` and reads
 * computed style in a real browser. Neither half is sufficient alone:
 *
 * <ul>
 *   <li>Source analysis cannot see a rule arriving from a third-party stylesheet, a selector
 *       this file's parser does not model, or a node portalled to `document.body` that never
 *       had an ancestor in the zone at all.</li>
 *   <li>The browser sweep cannot see a filter that is only reachable on a route or a state the
 *       spec does not happen to visit, and it cannot run in CI without a live stack.</li>
 * </ul>
 *
 * <p><b>Negative controls performed while writing this (34-01 task 3).</b> Each was observed
 * red and then restored:
 * <ol>
 *   <li>`backdrop-blur` reintroduced to `top-bar.tsx` → closure containment failed, naming the
 *       file, and it reached the POS through the LAYOUT rather than through the page.</li>
 *   <li>A `backdrop-filter` rule added to globals.css outside an expressive-zone selector →
 *       stylesheet scoping failed. The SAME rule rewritten as
 *       `[data-zone="expressive"] .probe` passed, which is what proves the check
 *       discriminates rather than simply rejecting every rule.</li>
 *   <li>The `data-zone` stamp removed from `dialog.tsx` → the portalled overlay's attribute
 *       read back `null` in a real browser, which is the assertion the runtime spec gates on.
 *       Restored, it reads `restrained`. This is the control that matters most: the stamp is
 *       the one thing here that can be written, look correct, and do nothing.</li>
 * </ol>
 */

/** The Tailwind utility family and the raw property, in both CSS and JSX-style casings. */
const FILTER_PATTERNS: { label: string; pattern: RegExp }[] = [
  {
    label: "Tailwind backdrop-* utility",
    pattern:
      /\bbackdrop-(blur|filter|saturate|brightness|contrast|grayscale|invert|opacity|sepia|hue-rotate)\b/,
  },
  { label: "CSS backdrop-filter property", pattern: /(^|[^-\w])backdrop-filter\s*:/ },
  { label: "JSX backdropFilter style", pattern: /\bbackdropFilter\b/ },
  { label: "-webkit-backdrop-filter property", pattern: /-webkit-backdrop-filter\s*:/ },
];

/**
 * `supports-backdrop-filter:` is a Tailwind VARIANT, not the utility. It reads as a feature
 * query and is harmless on its own, but in this repo it only ever appeared prefixing the
 * utility, so it is not separately allowed — the utility pattern above catches the pair.
 */
function offendingLines(source: string): { line: number; text: string; label: string }[] {
  const found: { line: number; text: string; label: string }[] = [];
  const lines = stripComments(source).split("\n");
  lines.forEach((text, index) => {
    for (const { label, pattern } of FILTER_PATTERNS) {
      if (pattern.test(text)) found.push({ line: index + 1, text: text.trim(), label });
    }
  });
  return found;
}

const OPERATIONAL_ROUTES = ["app/(tenant)/app/pos", "app/(tenant)/app/kitchen/[stationCode]"];

describe("D-34-02 · the operational zone carries no compositing filter", () => {
  it("no file in the POS or KDS import closure declares one", () => {
    const entries = OPERATIONAL_ROUTES.flatMap(routeEntries);
    expect(
      entries.length,
      "route entry discovery found nothing — the gate would pass vacuously",
    ).toBeGreaterThan(3);

    const { files, missingEntries } = moduleClosure(entries);
    expect(missingEntries, "an entry file listed above does not exist").toEqual([]);

    // A closure this small would mean the walk is not actually walking.
    expect(
      files.length,
      "closure is implausibly small — the walk is not resolving",
    ).toBeGreaterThan(20);

    const offenders: string[] = [];
    for (const file of files) {
      for (const hit of offendingLines(readFileSync(file, "utf8"))) {
        offenders.push(`${toRelative(file)}:${hit.line} — ${hit.label} — ${hit.text}`);
      }
    }

    expect(
      offenders,
      "A compositing filter reaches the operational zone. It need not be under app/pos — " +
        "this closure includes the layout ancestors, which is where all three of the filters " +
        "found in 34-01 actually lived.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the closure includes the shell chrome, so a filter there would be caught", () => {
    // Guards the gate itself. If the layout ancestors ever stop being walked, the test above
    // keeps passing while the exact defect it was written for goes undetected.
    const { files } = moduleClosure(OPERATIONAL_ROUTES.flatMap(routeEntries));
    const relative = files.map(toRelative);
    for (const chrome of [
      "components/shared/top-bar.tsx",
      "components/shared/mobile-bottom-nav.tsx",
      "app/(tenant)/layout.tsx",
    ]) {
      expect(relative, `${chrome} must be inside the operational closure`).toContain(chrome);
    }
  });
});

describe("D-34-02 · the backdrop utility family has exactly one legal home", () => {
  it("appears in no file under app/ or components/", () => {
    const files = [...sourceFilesUnder("app"), ...sourceFilesUnder("components")];
    expect(files.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const file of files) {
      for (const hit of offendingLines(readFileSync(file, "utf8"))) {
        offenders.push(`${toRelative(file)}:${hit.line} — ${hit.label} — ${hit.text}`);
      }
    }

    expect(
      offenders,
      "The compositing filter has ONE legal home: a zone-scoped rule in globals.css. Writing " +
        "it at a call site makes the effect depend on developer discipline rather than on the " +
        "cascade, and the call site is exactly where nobody remembers which zone they are in.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});

describe("D-34-02 · every compositing-filter rule in globals.css is expressive-scoped", () => {
  const cssPath = resolve(FRONTEND_ROOT, "app/globals.css");
  const css = readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  /** Selector text immediately preceding each `{` that opens a block declaring the filter. */
  function rulesDeclaringFilter(): { selector: string; declaration: string }[] {
    const out: { selector: string; declaration: string }[] = [];
    const pattern = /(^|[^-\w])(-webkit-)?backdrop-filter\s*:\s*([^;}]+)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(css)) !== null) {
      // Walk back to the `{` that opens this block, then back again to the previous
      // `}`/`{`/`;` — what lies between is the selector.
      const open = css.lastIndexOf("{", match.index);
      if (open === -1) continue;
      let start = 0;
      for (const boundary of ["}", "{", ";"]) {
        const at = css.lastIndexOf(boundary, open - 1);
        if (at + 1 > start) start = at + 1;
      }
      out.push({
        selector: css.slice(start, open).replace(/\s+/g, " ").trim(),
        declaration: match[3]!.trim(),
      });
    }
    return out;
  }

  it("has no unscoped rule", () => {
    // Deliberately passes on an empty set: plan 34-02 lands the first such rule in the same
    // wave, and requiring the rule to already exist would be a false dependency between them.
    const unscoped = rulesDeclaringFilter().filter(
      (rule) => !/\[data-zone(=|~=)?["']?expressive["']?\]/.test(rule.selector),
    );
    expect(
      unscoped.map((r) => `${r.selector} { backdrop-filter: ${r.declaration} }`),
      'Every compositing-filter rule must be rooted at [data-zone="expressive"]. An unscoped ' +
        "rule is one that reaches the POS and the KDS.",
    ).toEqual([]);
  });
});

describe("D-34-02 · every zone root declares its zone", () => {
  const read = (path: string) => {
    const file = resolve(FRONTEND_ROOT, path);
    expect(existsSync(file), `${path} does not exist`).toBe(true);
    return readFileSync(file, "utf8");
  };

  const OPERATIONAL = [
    "app/(tenant)/app/pos/layout.tsx",
    "components/kds/station-board.tsx",
    "app/(tenant)/app/kitchen/[stationCode]/page.tsx",
  ];
  const EXPRESSIVE = [
    "app/(tenant)/app/dashboard/page.tsx",
    "app/(auth)/layout.tsx",
    "app/(platform)/layout.tsx",
  ];

  it.each(OPERATIONAL)("%s declares the operational zone", (path) => {
    expect(read(path)).toMatch(/zone=["']operational["']/);
  });

  it.each(EXPRESSIVE)("%s declares the expressive zone", (path) => {
    expect(read(path)).toMatch(/zone=["']expressive["']/);
  });

  it("the back-office shell declares restrained, not expressive", () => {
    const shell = read("app/(tenant)/layout.tsx");
    expect(shell).toMatch(/zone=["']restrained["']/);
    // The chrome renders OVER the POS and the KDS. If this shell ever declares expressive,
    // every glass rule in the phase starts matching the header above an operator's terminal.
    expect(shell).not.toMatch(/ZoneProvider\s+zone=["']expressive["']/);
  });

  it("all three kitchen guard fallbacks are inside the zone", () => {
    // A permission-denied kitchen screen renders on the same wall display. If it falls out
    // of the zone it becomes the one route by which a filter reaches that display.
    const page = read("app/(tenant)/app/kitchen/[stationCode]/page.tsx");
    const declarations = page.match(/zone=["']operational["']/g) ?? [];
    expect(
      declarations.length,
      "board + feature/permission/branch fallbacks",
    ).toBeGreaterThanOrEqual(3);
  });

  it("the platform console's zone is declared inside its authorization guard", () => {
    const layout = read("app/(platform)/layout.tsx");
    const guardAt = layout.indexOf("<PlatformGuard>");
    const zoneAt = layout.indexOf('zone="expressive"');
    expect(guardAt, "PlatformGuard must be present").toBeGreaterThan(-1);
    expect(
      zoneAt > guardAt,
      "An access-denied response dressed as the console tells a tenant user which platform " +
        "screens exist. The guard decides first.",
    ).toBe(true);
  });
});

describe("D-34-02 · portalled overlays stamp their zone", () => {
  // The single most likely defect in this phase: a zone rule written against DOM ancestry,
  // which looks correct in the stylesheet and matches nothing, because Radix mounts the
  // overlay on document.body — outside every zone subtree.
  it.each([
    ["components/ui/dialog.tsx", "the shared dialog overlay"],
    ["components/pos/order-table-detail-drawer.tsx", "the POS drawer's own overlay"],
  ])("%s stamps data-slot and data-zone (%s)", (path) => {
    const source = readFileSync(resolve(FRONTEND_ROOT, path), "utf8");
    expect(source).toMatch(/data-slot="dialog-overlay"/);
    expect(source).toMatch(/data-zone=\{zone\}/);
    expect(source, "the zone must be READ, not assumed").toMatch(/useZone\(\)/);
  });
});
