import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { chromium, type Browser, type Page } from "@playwright/test";

import { buildCss } from "@/__tests__/lib/theme/built-css";
import { frontendRoot } from "@/__tests__/lib/theme/conformance-scan";
import {
  AUDIT_WIDTHS,
  COLLECT,
  analyse,
  counts,
  describe as describeRecord,
} from "../../e2e/viewport-integrity.mjs";

/**
 * A real browser, driven from a vitest file, measuring markup the product actually produced.
 *
 * <h2>Why this exists</h2>
 *
 * Plan 38-14 built the right instrument — `e2e/viewport-integrity.mjs` measures five things a
 * screenshot cannot argue with — and then wired it to `e2e/journeys/responsive.spec.ts`, which
 * needs a signed-in session against sixteen Spring services. The dev environment's refresh
 * endpoint is broken for everyone, so that gate has never once run against this product, and the
 * result was shipped and rejected: *"make sure complete app is Mob and Tablet responsive."*
 *
 * <p>A gate that cannot run is not a gate. So the same probe is pointed at the same components
 * through a path that needs no server at all:
 *
 * <ol>
 *   <li><b>The markup is the product's.</b> A fixture is rendered with React Testing Library — the
 *       real component, the real `cn()` output, the real conditional branches — and its
 *       `innerHTML` is what gets measured. Nothing is retyped into a template.</li>
 *   <li><b>The stylesheet is the product's.</b> `app/globals.css` is compiled through Tailwind's
 *       own compiler ({@link buildCss}), with the candidate list harvested from the rendered
 *       markup's own `class` attributes. A class that compiles to nothing therefore measures as
 *       nothing, which is the failure mode `__tests__/pos/pos-layout-css.test.ts` was written
 *       for.</li>
 *   <li><b>The layout engine is a real one.</b> Headless Chromium. JSDOM reports every box as
 *       0×0, so no assertion about width can be made in it — which is why 2,190 green tests
 *       coexisted with a product the owner called unusable on a phone.</li>
 * </ol>
 *
 * <h2>What it cannot see, stated plainly</h2>
 *
 * <ul>
 *   <li><b>Web fonts.</b> `next/font` self-hosts Sora, DM Mono and Fraunces; they are not present
 *       here. {@link FONT_STACK} substitutes metric-similar system families so text still has
 *       plausible width, but a label that fits by 2px here might not in production. Treat every
 *       *near*-miss as unproven.</li>
 *   <li><b>Data volume.</b> A fixture carries representative rows, not a tenant's worth. A column
 *       that overflows only at 40 characters of vendor name will not be caught.</li>
 *   <li><b>Anything that needs a running server.</b> Route-level composition, scroll behaviour
 *       across a real page, and any layout that only appears after a fetch resolves.</li>
 * </ul>
 */

const ROOT = frontendRoot();

export { AUDIT_WIDTHS };

/** Both themes, because a dark-mode-only overflow is still an overflow. */
export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/**
 * Stand-ins for the three self-hosted families.
 *
 * <p>Chosen for metrics, not looks: a proportional sans, a monospace, and a serif. The
 * alternative — leaving them undefined — makes every family fall back to the same default and
 * silently removes the width difference between a mono figure column and a sans one, which is
 * one of the things this harness is measuring.
 */
const FONT_STACK = `
  :root {
    --font-sora: system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    --font-dm-mono: ui-monospace, "SF Mono", Menlo, monospace;
    --font-fraunces: Georgia, "Times New Roman", serif;
  }
`;

/**
 * `<body>`'s class list, read out of `app/layout.tsx` rather than copied.
 *
 * <p>`min-h-full flex flex-col` is load-bearing — it is what makes the shell's `h-screen` child
 * behave — and a copy of it here would be a copy that drifts.
 */
export const BODY_CLASSES = (() => {
  const src = readFileSync(resolve(ROOT, "app/layout.tsx"), "utf8");
  const match = /<body\s+className="([^"]+)"/.exec(src);
  if (!match) throw new Error("could not read <body> className from app/layout.tsx");
  return match[1]!;
})();

/**
 * `<main>`'s class list on the back-office branch of `app/(tenant)/layout.tsx`, likewise read.
 *
 * <p>This is the element that owns the page gutter and the `pb-20` clearance under
 * `MobileBottomNav`, so measuring content inside anything else measures a different product.
 */
export const MAIN_CLASSES = (() => {
  const src = readFileSync(resolve(ROOT, "app/(tenant)/layout.tsx"), "utf8");
  // Both branches spell it `className="…flex-1 overflow-y-auto…"`. The back-office one is the one
  // that carries `pb-20` — bottom clearance for `MobileBottomNav`, which overlays the viewport.
  const all = [...src.matchAll(/className="([^"]*flex-1 overflow-y-auto[^"]*)"/g)].map(
    (m) => m[1]!,
  );
  const backOffice = all.find((c) => /\bpb-\d/.test(c));
  if (!backOffice) throw new Error("could not read <main> className from app/(tenant)/layout.tsx");
  return backOffice;
})();

/**
 * `<main>`'s class list on the OPERATOR branch — the POS and its charge/receipt pages.
 *
 * <p>It deliberately has no `pb-20`: `MobileBottomNav` is not rendered on those routes, so the
 * clearance would be dead space on the one axis a 390px terminal has none of.
 */
export const OPERATOR_MAIN_CLASSES = (() => {
  const src = readFileSync(resolve(ROOT, "app/(tenant)/layout.tsx"), "utf8");
  const all = [...src.matchAll(/className="([^"]*flex-1 overflow-y-auto[^"]*)"/g)].map(
    (m) => m[1]!,
  );
  const operator = all.find((c) => !/\bpb-\d/.test(c));
  if (!operator) throw new Error("could not read the operator <main> className");
  return operator;
})();

/** Every distinct token that appears in a `class="…"` attribute of some markup. */
export function candidatesOf(...html: string[]): string[] {
  const out = new Set<string>();
  for (const doc of html) {
    for (const attr of doc.matchAll(/class="([^"]*)"/g)) {
      for (const token of attr[1]!.split(/\s+/)) if (token) out.add(token);
    }
  }
  return [...out];
}

export interface MeasureOptions {
  /** Markup to place inside the scaffold, as the product rendered it. */
  html: string;
  width: number;
  theme: Theme;
  /** Viewport height. 844 is the iPhone 14 logical height; the audit used 900 for the rest. */
  height?: number;
}

export interface Measurement {
  width: number;
  theme: Theme;
  /** `document.documentElement.scrollWidth` — the owner's "no sideways scroll" in one number. */
  pageScrollWidth: number;
  clientWidth: number;
  counts: ReturnType<typeof counts>;
  /**
   * The overflow that actually reaches the viewport — shallowest offender, and not absorbed by a
   * horizontal scroll container of its own. This is what the gate asserts on; see
   * `viewportEscapees` in `e2e/viewport-integrity.mjs` for why it is not the raw count.
   */
  escapees: string[];
  /** Every shallowest overflowing element, contained or not. Reported, never gated. */
  blame: string[];
  occluded: string[];
  undersized: string[];
  truncated: string[];
  tablesBelowMd: string[];
}

export class ViewportHarness {
  private constructor(
    private readonly browser: Browser,
    private readonly page: Page,
    private readonly css: string,
  ) {}

  /**
   * Compile the stylesheet once, launch one browser, reuse one page.
   *
   * <p>Per-fixture browsers cost ~300ms each and this file measures ~30 fixtures × 4 widths × 2
   * themes; a gate that takes four minutes is a gate someone deletes.
   */
  static async open(candidates: string[]): Promise<ViewportHarness> {
    const css = await buildCss(candidates);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    return new ViewportHarness(browser, page, css);
  }

  async close(): Promise<void> {
    await this.browser.close();
  }

  /** The compiled stylesheet, exposed so a test can assert a utility survived the build. */
  get stylesheet(): string {
    return this.css;
  }

  async measure({ html, width, theme, height = 844 }: MeasureOptions): Promise<Measurement> {
    await this.page.setViewportSize({ width, height });
    await this.page.setContent(
      `<!doctype html>
<html lang="en" class="h-full antialiased${theme === "dark" ? " dark" : ""}">
<head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>${FONT_STACK}</style>
<style>${this.css}</style>
</head>
<body class="${BODY_CLASSES}">${html}</body>
</html>`,
      { waitUntil: "load" },
    );
    // Layout settles a tick after content lands; measuring in the same tick reports the previous
    // viewport, which reads as "390 is fine" on a page last laid out at 1440.
    await this.page.waitForTimeout(60);

    const records = await this.page.evaluate(COLLECT);
    const result = analyse(records, width);
    const { pageScrollWidth, clientWidth } = await this.page.evaluate(() => ({
      pageScrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    return {
      width,
      theme,
      pageScrollWidth,
      clientWidth,
      counts: counts(result),
      escapees: result.escapees.map(describeRecord),
      blame: result.overflowBlame.map(describeRecord),
      occluded: result.occluded.map(describeRecord),
      undersized: result.undersized.map(describeRecord),
      truncated: result.truncated.map(describeRecord),
      tablesBelowMd: result.tablesBelowMd.map(describeRecord),
    };
  }
}
