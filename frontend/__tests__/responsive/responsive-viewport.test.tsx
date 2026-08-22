import { writeFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/app/dashboard",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// `@teispace/next-themes` resolves `next/navigation` through its own nested node_modules, which
// the mock above shadows. Mocking the theme hook too keeps TopBar renderable; the theme itself is
// applied by the harness as `class="dark"` on <html>, which is how the provider applies it.
vi.mock("@teispace/next-themes", () => ({
  useTheme: () => ({
    theme: "light",
    setTheme: vi.fn(),
    resolvedTheme: "light",
    systemTheme: "light",
    themes: ["light", "dark"],
  }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { seedSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { MobileBottomNav } from "@/components/shared/mobile-bottom-nav";
import { Sidebar } from "@/components/shared/sidebar";
import { TopBar } from "@/components/shared/top-bar";

import { FIXTURES, type Fixture } from "./fixtures";
import {
  AUDIT_WIDTHS,
  MAIN_CLASSES,
  OPERATOR_MAIN_CLASSES,
  THEMES,
  ViewportHarness,
  candidatesOf,
  type Measurement,
  type Theme,
} from "./viewport-harness";

/**
 * G14 — the responsive gate that can actually run.
 *
 * <h3>What the owner said, and what this measures</h3>
 *
 * *"Make sure complete app is Mob and Tablet responsive."* Plan 38-14 answered that with
 * `e2e/journeys/responsive.spec.ts`, which needs a signed-in session against sixteen services.
 * That gate has never executed against this product — the deployed build was reviewed and
 * rejected while 2,190 unit tests were green, because **JSDOM reports every box as 0×0** and
 * therefore cannot hold an opinion about width.
 *
 * <p>So this drives the same probe (`e2e/viewport-integrity.mjs`) over the same components in
 * headless Chromium, with `app/globals.css` compiled through Tailwind's own compiler. Each
 * fixture is wrapped in the REAL shell — the real `Sidebar`, the real `TopBar`, the real
 * `MobileBottomNav`, and `<main>`'s class list read out of `app/(tenant)/layout.tsx` — because
 * every complaint in the review was about content fighting chrome, and content measured without
 * chrome is a different measurement.
 *
 * <h3>The five judgements, and why none of them is "looks fine"</h3>
 *
 * | check | red when |
 * |---|---|
 * | page scroll | `documentElement.scrollWidth > clientWidth` — the literal "no sideways scroll" |
 * | element overflow | a box wider than 24px extends past the viewport's right edge |
 * | occlusion | an interactive element is covered at *every* sampled point by a foreign node |
 * | target size | an interactive box is under 44×44 (mobile and tablet only — see below) |
 * | table below md | a `<table>` is VISIBLE at 390px, i.e. a desktop grid dropped onto a phone |
 *
 * <p>The occlusion check is the one that matters most, and `__tests__/e2e/viewport-integrity.test.ts`
 * explains why: the first audit pass reported `overflow = 0` for the POS at 390px while the
 * screenshot showed the cart sitting on top of the menu. An overlay does not overflow.
 */

const REPORT_PATH = "/tmp/responsive-report.json";

function noop() {}

/**
 * The tenant shell, reproduced as React rather than as a string.
 *
 * <p>Rendering the real chrome is the point: the sidebar is `hidden md:flex`, the bottom nav is
 * `md:hidden`, and the interesting failures live exactly at the seam between them and the page.
 */
function BackOfficeShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="flex h-screen overflow-hidden">
        <Sidebar mobileOpen={false} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar onMobileMenuToggle={noop} />
          <main className={MAIN_CLASSES}>{children}</main>
        </div>
      </div>
      <MobileBottomNav />
    </>
  );
}

/**
 * The operator shell: a strip and the viewport, no sidebar and no bottom nav.
 *
 * <p>`OperatorStrip` itself is not rendered here — it reads the live session through hooks this
 * harness does not stand up — so what is measured is the geometry the terminal gets: a
 * full-height column with the operator `<main>`'s own class list.
 */
function OperatorShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <main className={OPERATOR_MAIN_CLASSES}>{children}</main>
    </div>
  );
}

/** Render one fixture inside its shell and hand back the markup the browser will lay out. */
function markupOf(fixture: Fixture): string {
  const Wrapper = createQueryWrapper();
  const Shell = fixture.bare ? OperatorShell : BackOfficeShell;
  render(
    <Wrapper>
      <Shell>{fixture.render()}</Shell>
    </Wrapper>,
  );
  // `document.body`, not the RTL container: a `Dialog` renders through a portal that is a SIBLING
  // of the container, and measuring the container alone would report a clean page with the dialog
  // simply absent — the exact shape of false green this whole file exists to prevent.
  const html = document.body.innerHTML;
  cleanup();
  return html;
}

const MARKUP = new Map<string, string>();
const RESULTS = new Map<string, Measurement>();

let harness: ViewportHarness;

const key = (id: string, width: number, theme: Theme) => `${id}@${width}/${theme}`;

beforeAll(async () => {
  seedSession();
  for (const fixture of FIXTURES) MARKUP.set(fixture.id, markupOf(fixture));

  // The candidate list is harvested from the markup the product just produced, so a class that
  // Tailwind cannot compile measures as nothing rather than being quietly supplied from a list
  // kept in step by hand (`pos-layout-css.test.ts` documents that failure).
  harness = await ViewportHarness.open(candidatesOf(...MARKUP.values()));

  for (const fixture of FIXTURES) {
    const html = MARKUP.get(fixture.id)!;
    for (const width of AUDIT_WIDTHS) {
      for (const theme of THEMES) {
        RESULTS.set(key(fixture.id, width, theme), await harness.measure({ html, width, theme }));
      }
    }
  }

  // Written unconditionally: a report only produced on failure is a report nobody reads before
  // making a change, and the counts are the thing a later plan compares against.
  writeFileSync(
    REPORT_PATH,
    JSON.stringify(Object.fromEntries([...RESULTS].map(([k, v]) => [k, v])), null, 1),
  );
}, 300_000);

afterAll(async () => {
  await harness?.close();
});

describe("G14 — no module scrolls the page sideways", () => {
  for (const fixture of FIXTURES) {
    for (const width of AUDIT_WIDTHS) {
      for (const theme of THEMES) {
        it(`${fixture.id} @${width} ${theme}`, () => {
          const m = RESULTS.get(key(fixture.id, width, theme))!;
          expect(
            m.pageScrollWidth,
            `the page scrolls sideways at ${width}px: scrollWidth ${m.pageScrollWidth} > ${m.clientWidth}`,
          ).toBeLessThanOrEqual(m.clientWidth);
        });
      }
    }
  }
});

describe("G14 — nothing extends past the viewport", () => {
  for (const fixture of FIXTURES) {
    for (const width of AUDIT_WIDTHS) {
      for (const theme of THEMES) {
        it(`${fixture.id} @${width} ${theme}`, () => {
          const m = RESULTS.get(key(fixture.id, width, theme))!;
          expect(m.escapees, m.escapees.join("\n")).toEqual([]);
        });
      }
    }
  }
});

describe("G14 — no interactive element is buried under another", () => {
  for (const fixture of FIXTURES) {
    for (const width of AUDIT_WIDTHS) {
      for (const theme of THEMES) {
        it(`${fixture.id} @${width} ${theme}`, () => {
          const m = RESULTS.get(key(fixture.id, width, theme))!;
          expect(m.occluded, m.occluded.join("\n")).toEqual([]);
        });
      }
    }
  }
});

/**
 * Target size is asserted at the two touch widths only.
 *
 * <p>390 and 768 are a phone and a tablet — both are fingers. 1024 and 1440 are measured and
 * REPORTED (the report file carries every width) but not gated, because a 32px icon button in a
 * desktop toolbar driven by a mouse is a deliberate density choice, and a gate that forbids it
 * everywhere is a gate that gets an exemption list and then gets deleted.
 */
describe("G14 — a finger can hit every control on a phone and a tablet", () => {
  for (const fixture of FIXTURES) {
    for (const width of [390, 768]) {
      for (const theme of THEMES) {
        it(`${fixture.id} @${width} ${theme}`, () => {
          const m = RESULTS.get(key(fixture.id, width, theme))!;
          expect(m.undersized, m.undersized.join("\n")).toEqual([]);
        });
      }
    }
  }
});

/**
 * The coverage this gate actually has, stated as an assertion rather than as a claim.
 *
 * <h3>Why a list of modules is a test</h3>
 *
 * The review said *"complete app"*, and the failure mode of a gate like this one is that it
 * measures eight screens beautifully and reads as though it measured eighty. So the modules this
 * file covers are enumerated, and the ones it does NOT are enumerated beside them — in the source,
 * where the next person adding a fixture will see them.
 *
 * <p>Every module in {@link UNCOVERED} needs a running stack or a large MSW fixture to render:
 * the component is a query away from its data, not a prop away. They are covered STATICALLY
 * instead — `responsive-contract.test.ts` holds the breakpoint set, the table-adaptation rule and
 * the scroll-container rule across all 400+ `.tsx` files in `app/` and `components/` — but static
 * coverage cannot see a box, and this list is the honest statement of that gap.
 */
const UNCOVERED = [
  // Each of these renders through a react-query hook with no prop-driven entry point.
  "crm", // CustomerList → useCustomerSearch
  "hr", // ShiftCalendar → useWeekGrid; TaxConfigForm → useSaveTaxConfig
  "orders", // OrderManagement → useOrders + live WS
  "tables", // the floor plan reads the table registry and the live order map
  "users", // UserList → useTenantUsers, and the create dialog behind a permission
  "branches",
  "terminals",
  "stations",
  "nlq",
];

/**
 * The two new stylesheet rules, proved to have survived the build.
 *
 * <p>UI-SPEC §7.2.2, and the lesson `__tests__/pos/pos-layout-css.test.ts` was written for: *a
 * class present in the source is not evidence it is present in the DOM.* Both of these are
 * hand-written CSS inside a Tailwind v4 stylesheet, both are load-bearing for every measurement
 * above, and a character out of place in either compiles to nothing while still reading correctly
 * in `globals.css` and passing every grep.
 */
describe("G14 — the rules the fixes rely on are in the shipped stylesheet", () => {
  it("emits `touch-floor`, and releases it at exactly `lg`", () => {
    const css = harness.stylesheet;
    expect(css, "`.touch-floor` did not survive the build").toMatch(
      /\.touch-floor\s*\{[^}]*min-height:\s*44px/,
    );
    // The release, and the boundary. `64rem` is `lg` — 1024 — which is where this product's own
    // target-size assertions stop. If the media query is gone, every control in the app is 44px
    // on a 1920px monitor and nobody would notice from a unit test.
    expect(css).toMatch(/@media \(width >= 64rem\)\s*\{\s*\.touch-floor\s*\{[^}]*min-height:\s*0/);
  });

  it("emits `table-stack`, scoped below `md`", () => {
    const css = harness.stylesheet;
    expect(css).toContain("table.table-stack");
    // 48rem is `md` — 768. The stack must NOT apply above it, or every adapted table in the
    // product loses its header row on a desktop.
    const block = /@media \(width < 48rem\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(block, "the `.table-stack` rules must live inside the below-md media query").toContain(
      "table.table-stack",
    );
    // The label channel. Without this the stacked cards are columns of unlabelled figures.
    expect(block).toMatch(/content:\s*attr\(data-label\)/);
  });
});

describe("G14 — the coverage this file has", () => {
  it("names every module it measures, and every one it does not", () => {
    const covered = [...new Set(FIXTURES.map((f) => f.module))].sort();
    expect(covered).toEqual([
      "dashboard",
      "finance",
      "inventory",
      "kds",
      "menu",
      "platform",
      "pos",
      "purchasing",
      "reports",
      "roles",
      "settings",
    ]);
    // Not a placeholder: a module may only leave this list by gaining a fixture above.
    expect(UNCOVERED.some((m) => covered.includes(m))).toBe(false);
  });

  it("measures both themes at all four widths, and says so in the report", () => {
    // A gate that quietly measured one theme would be green about half a product. 390 and 1440
    // are asserted here by name because they are the two the review actually complained about.
    expect(AUDIT_WIDTHS).toEqual([390, 768, 1024, 1440]);
    expect(THEMES).toEqual(["light", "dark"]);
    expect(RESULTS.size).toBe(FIXTURES.length * AUDIT_WIDTHS.length * THEMES.length);
  });
});

describe("G14 — no desktop table on a phone", () => {
  for (const fixture of FIXTURES) {
    for (const theme of THEMES) {
      it(`${fixture.id} @390 ${theme}`, () => {
        const m = RESULTS.get(key(fixture.id, 390, theme))!;
        expect(m.tablesBelowMd, m.tablesBelowMd.join("\n")).toEqual([]);
      });
    }
  }
});
