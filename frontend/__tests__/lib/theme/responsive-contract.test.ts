import { describe, expect, it } from "vitest";

import { read, sourceFiles } from "./conformance-scan";
// The same list the runtime probe measures at, imported rather than restated: a static gate and
// a runtime gate that disagree about which widths matter is two gates and one contract. The probe
// is plain JS (`tsconfig` excludes `e2e/**`) but carries JSDoc types, so this import is typed.
import { AUDIT_WIDTHS } from "../../../e2e/viewport-integrity.mjs";

/**
 * G13 — the breakpoint contract (plan 38-14 task 1; brief §60; UI-SPEC §11).
 *
 * <h3>The declared set</h3>
 *
 * | audit width | how the layout expresses it |
 * |---|---|
 * | **390** | the base, unprefixed. Mobile-first: the phone layout is what you get by writing nothing |
 * | **768** | `md:` — the product's ONE mobile boundary. The sidebar is `hidden md:flex`, `MobileBottomNav` is `md:hidden`, `DataGrid`'s table is `hidden md:block` against a `md:hidden` card list, and since 38-14 a `Dialog` is a bottom sheet below it and a centred modal above it |
 * | **1024** | `lg:` — the second column. The POS earns its order rail here (wave 4 measured 768 as 2 menu columns against 5, and kept `lg`), and the back-office grid restores its reference columns |
 * | **1280** | `xl:` — the four-up step for tile and portlet grids |
 * | **1440 / 1920** | **no breakpoint at all.** Wide viewports are handled by container width and by `auto-fill minmax()`, which states "as many as fit" once instead of naming two more thresholds |
 *
 * <h3>What is forbidden, and why each is a separate check</h3>
 *
 * **`sm:` (640).** Not because 640 is a bad number — because it is a width nothing measures.
 * Every layout decision taken there produced a THIRD rendering, between the phone one and the
 * desktop one, that no audit width ever looked at. It was not hypothetical: the top bar showed
 * its desktop breadcrumb and desktop search button from 640 while the shell was still in its
 * mobile state until 768; `DataGrid`'s dialogs chose their width at 640; the dashboard folded
 * 4-up to 2-up at 640 in a viewport with no sidebar to pay for it; and the KDS board — whose
 * comment said "2 columns at 1024" — went two-up at **640**. 92 call sites, all migrated.
 *
 * **Arbitrary variants** (`min-[840px]:`, `max-md:`, a raw `@media` in a component). Zero today.
 * This is the check that keeps the set a *set*: brief §60 asks for a coherent strategy, and a
 * strategy dies one `min-[911px]:` at a time.
 *
 * **Two responsive utilities fighting over one property.** `md:grid-cols-4 md:grid-cols-6` on one
 * element: both rules ship, one silently wins by stylesheet order, and the class a person reads
 * is not the class that renders. This is not theoretical — the `sm:`→`md:` migration produced
 * exactly this collision twice in `table-floor-view.tsx`, and nothing but this check found it.
 * A dead class in a class list is worse than a missing one, because it reads as intent.
 */

/** Every responsive prefix Tailwind's stock ladder offers. */
const ALL_VARIANTS = ["sm", "md", "lg", "xl", "2xl"] as const;

/** The prefixes a layout decision may be taken at. `sm` is deliberately absent. */
const ALLOWED_VARIANTS = ["md", "lg", "xl", "2xl"] as const;

const FORBIDDEN_VARIANT = /\bsm:/g;

/**
 * A one-off breakpoint: an arbitrary min/max viewport variant, or a `max-*` ceiling variant.
 *
 * <p>Two carve-outs, both load-bearing:
 *
 * <p><b>`max-w-` / `max-h-` are sizes, not variants.</b> The negative lookahead is what tells
 * `max-md:hidden` (a ceiling variant) from `max-w-md` (a width), and without it this check would
 * fire on every dialog in the product.
 *
 * <p><b>Container queries are allowed and are not breakpoints.</b> `@min-[23rem]:grid-cols-4`
 * (`station-picker.tsx:501`) asks how much room *this component* has, not how wide the window is,
 * so it produces the right layout inside a sidebar, a sheet and a full-width board without
 * knowing which one it is in. That is the thing brief §60 wants and a viewport breakpoint cannot
 * give; forbidding it would have been this gate punishing the better answer. The lookbehind on
 * `@` is the whole carve-out.
 */
const ARBITRARY_VARIANT =
  /(?<![@\w-])(?:min|max)-\[[^\]]+\]:|(?<![@\w-])max-(?!w-|h-)(?:sm|md|lg|xl|2xl):/g;

const RAW_MEDIA_QUERY = /@media\b/g;

function countMatches(source: string, pattern: RegExp): number {
  return (source.match(new RegExp(pattern.source, pattern.flags)) ?? []).length;
}

/**
 * The contents of every string literal in a file, concatenated.
 *
 * <p>A Tailwind variant is only a Tailwind variant inside a string. `sm:` also appears as an
 * OBJECT KEY in three shared primitives — `avatar.tsx`'s `SIZE_CLASSES`, `button.tsx`'s `cva`
 * size map, `meter.tsx`'s `TRACK_HEIGHT` — where it names a component size prop and has nothing
 * to do with 640px. A gate that flagged those would be asking for a rename that breaks 50 call
 * sites to satisfy a rule about media queries, which is the fastest possible way to get a gate
 * switched off.
 */
function stringLiterals(source: string): string[] {
  return (source.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) ?? []).map((s) => s.slice(1, -1));
}

/**
 * The property a Tailwind utility sets, coarsely — enough to spot two utilities fighting.
 *
 * <p>Deliberately coarse in one direction and exact in the other. `grid-cols-4` and
 * `grid-cols-[minmax(...)]` must collapse to the same key, or the collision this check exists for
 * slips through; `flex` (display) and `flex-row` (flex-direction) must NOT, or every flex row in
 * the product reads as a conflict and the check gets deleted within a day.
 */
const DISPLAY_UTILITIES = new Set([
  "hidden",
  "block",
  "inline",
  "inline-block",
  "flex",
  "inline-flex",
  "grid",
  "inline-grid",
  "table",
  "table-cell",
  "table-row",
  "contents",
  "flow-root",
  "list-item",
]);

/** Trailing scale words that name a SIZE of the same property rather than a different one. */
const SCALE_WORDS = new Set([
  "px",
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
  "7xl",
  "full",
  "none",
  "auto",
  "screen",
  "min",
  "max",
  "fit",
  "prose",
  "reverse",
]);

export function propertyKey(utility: string): string {
  if (DISPLAY_UTILITIES.has(utility)) return "display";
  const parts = utility.split("-");
  const last = parts[parts.length - 1] ?? "";
  if (parts.length > 1 && (/^\d/.test(last) || last.startsWith("[") || SCALE_WORDS.has(last))) {
    return parts.slice(0, -1).join("-");
  }
  return utility;
}

/**
 * Every class-list string in a source file, one entry per STRING LITERAL.
 *
 * <p>Per literal, not per element, and the reason is `cn()`. `cn` is `twMerge(clsx(...))`, and
 * twMerge's entire job is to resolve conflicts BETWEEN its arguments — `cn(base, override)` is
 * the sanctioned way a caller widens a shared component, so grouping a whole `cn(...)` call
 * would report the override pattern as a defect on hundreds of call sites.
 *
 * <p>It would also report every mutually-exclusive branch: `dashboard-shell.tsx` writes
 * `columns === 3 && "xl:grid-cols-3"` beside `columns === 4 && "xl:grid-cols-4"`, which can
 * never both be in one class list at runtime.
 *
 * <p>What twMerge cannot help with — and what this therefore catches — is two conflicting
 * utilities inside ONE literal on a plain `className="…"` attribute, which never passes through
 * twMerge at all. That is exactly the shape the `sm:`→`md:` migration produced twice in
 * `table-floor-view.tsx` (`md:grid-cols-4 md:grid-cols-6`): both rules ship, the later one wins
 * by stylesheet order, and the class a reader sees is not the class that renders.
 */
function classListsOf(source: string): string[][] {
  return stringLiterals(source)
    .map((literal) => literal.split(/\s+/).filter(Boolean))
    .filter((tokens) => tokens.length > 1);
}

/** Collisions: two utilities with the same variant AND the same property, on one element. */
export function variantCollisions(tokens: string[]): string[] {
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const token of tokens) {
    const match = /^(sm|md|lg|xl|2xl):(.+)$/.exec(token);
    if (!match) continue;
    const [, variant, utility] = match as unknown as [string, string, string];
    const key = `${variant}:${propertyKey(utility)}`;
    const previous = seen.get(key);
    if (previous && previous !== token) clashes.push(`${previous} + ${token}`);
    else seen.set(key, token);
  }
  return clashes;
}

const FILES = sourceFiles();

/**
 * The gate's own negative controls.
 *
 * <p>Every check above currently returns `{}` against the whole tree, which is the same reading a
 * check with a broken regex returns. This plan's own warning applies to its own gates: *a probe
 * that measures the wrong property returns a confident, useless green.* So each detector is fired
 * at a synthetic offender AND at the shape it must not mistake for one.
 */
describe("G13 — the detectors themselves", () => {
  it("sees `sm:` in a class string and ignores it as an object key", () => {
    expect(
      countMatches(stringLiterals(`className="grid sm:grid-cols-2"`).join(" "), FORBIDDEN_VARIANT),
    ).toBe(1);
    // `avatar.tsx`, `button.tsx` and `meter.tsx` name a component SIZE PROP `sm`. Nothing to do
    // with 640px, and renaming it to satisfy this gate would break ~50 call sites.
    expect(
      countMatches(
        stringLiterals(`const S = { sm: "size-6", md: "size-8" };`).join(" "),
        FORBIDDEN_VARIANT,
      ),
    ).toBe(0);
  });

  it("sees a one-off viewport breakpoint and allows a container query", () => {
    expect(countMatches(`className="grid min-[840px]:grid-cols-3"`, ARBITRARY_VARIANT)).toBe(1);
    expect(countMatches(`className="max-md:hidden"`, ARBITRARY_VARIANT)).toBe(1);
    // A container query asks how much room THIS component has, which is the better answer, not a
    // worse one — see the note on ARBITRARY_VARIANT.
    expect(countMatches(`className="@min-[23rem]:grid-cols-4"`, ARBITRARY_VARIANT)).toBe(0);
    // A width is not a variant.
    expect(countMatches(`className="w-full md:max-w-lg"`, ARBITRARY_VARIANT)).toBe(0);
  });

  it("sees two utilities fighting over one property, and only when they really fight", () => {
    // The exact defect the sm:→md: migration produced in `table-floor-view.tsx`.
    expect(variantCollisions("grid grid-cols-3 md:grid-cols-4 md:grid-cols-6".split(" "))).toEqual([
      "md:grid-cols-4 + md:grid-cols-6",
    ]);
    // Display is one property however it is spelled.
    expect(variantCollisions("md:hidden md:block".split(" "))).toHaveLength(1);
    // Different steps of one ladder are the whole point of a ladder.
    expect(variantCollisions("md:grid-cols-2 lg:grid-cols-4".split(" "))).toEqual([]);
    // `flex` is display; `flex-row` is flex-direction. Conflating them would fire on every flex
    // row in the product, which is how a check gets deleted.
    expect(variantCollisions("md:flex md:flex-row".split(" "))).toEqual([]);
    // Different properties that share a prefix.
    expect(variantCollisions("md:rounded-t-xl md:rounded-b-xl".split(" "))).toEqual([]);
    // Sizes of one property DO fight.
    expect(variantCollisions("md:max-w-sm md:max-w-lg".split(" "))).toHaveLength(1);
  });

  it("groups per string literal, so a cn() override is not a collision", () => {
    // `cn(base, override)` is the sanctioned way a caller widens a shared component; twMerge
    // resolves it. Two separate literals, therefore two separate lists.
    const source = `cn("md:max-w-sm", className)` + `\ncn("md:max-w-2xl")`;
    expect(classListsOf(source).flatMap(variantCollisions)).toEqual([]);
  });
});

describe("G13 — one breakpoint set, and only it", () => {
  it("declares the same widths the runtime probe measures", () => {
    // Not decoration. The static gate and `e2e/journeys/responsive.spec.ts` are one contract in
    // two halves, and the failure mode worth designing against is the two halves drifting until
    // each is green about a different product.
    expect(AUDIT_WIDTHS).toEqual([390, 768, 1024, 1440]);
    expect(ALLOWED_VARIANTS).not.toContain("sm");
    expect(ALL_VARIANTS.filter((v) => !ALLOWED_VARIANTS.includes(v as never))).toEqual(["sm"]);
  });

  it("takes no layout decision at 640px", () => {
    const offenders: Record<string, number> = {};
    for (const file of FILES) {
      const n = countMatches(stringLiterals(read(file)).join(" "), FORBIDDEN_VARIANT);
      if (n > 0) offenders[file] = n;
    }
    expect(
      offenders,
      "`sm:` is 640px — a width the audit does not measure. Use `md:` (768) for the phone/desktop " +
        "boundary, or nothing at all if the base layout already suits a phone.",
    ).toEqual({});
  });

  it("invents no one-off breakpoints", () => {
    const offenders: Record<string, number> = {};
    for (const file of FILES) {
      const source = read(file);
      const n = countMatches(source, ARBITRARY_VARIANT) + countMatches(source, RAW_MEDIA_QUERY);
      if (n > 0) offenders[file] = n;
    }
    expect(
      offenders,
      "an arbitrary `min-[…]:` / `max-…:` variant or a raw @media in a component. Brief §60 asks " +
        "for a coherent strategy; this is where one stops being coherent.",
    ).toEqual({});
  });

  it("never puts two responsive utilities on one property of one element", () => {
    const offenders: Record<string, string[]> = {};
    for (const file of FILES) {
      const clashes = classListsOf(read(file)).flatMap(variantCollisions);
      if (clashes.length > 0) offenders[file] = clashes;
    }
    expect(
      offenders,
      "both rules ship and one wins by stylesheet order, so the class a reader sees is not the " +
        "class that renders.",
    ).toEqual({});
  });
});

describe("G13 — the adaptations this plan is accountable for", () => {
  it("routes every module tab strip through SectionTabs", () => {
    // Five layouts hand-rolled `<nav className="mb-4 flex gap-4 border-b">` with ~20px links.
    // At 390px finance's eleven labels lay out past 1,100px with no wrap and no scroll, and every
    // one of the five failed the 44px floor. The shared component wraps and carries the floor;
    // this asserts nobody re-rolls it.
    const rolled = FILES.filter((file) => /<nav[^>]*flex gap-4 border-b/.test(read(file)));
    expect(rolled, "use `SectionTabs` (components/shared/section-tabs.tsx)").toEqual([]);

    const layouts = FILES.filter(
      (f) => /app\/.*\/layout\.tsx$/.test(f) && /TABS|tabs=/.test(read(f)),
    );
    expect(layouts.length).toBeGreaterThanOrEqual(4);
    for (const layout of layouts) {
      expect(read(layout), `${layout} should render <SectionTabs>`).toMatch(/<SectionTabs\b/);
    }
  });

  it("makes a dialog a bottom sheet below md and a centred modal above it", () => {
    const dialog = read("components/ui/dialog.tsx");
    // The sheet half: bottom-anchored, full width, its own scroll, square top corners only.
    expect(dialog).toMatch(/inset-x-0 bottom-0/);
    expect(dialog).toMatch(/max-h-\[92dvh\]/);
    expect(dialog).toMatch(/rounded-t-xl/);
    // The modal half, scoped to md and up — including the centring translate, which is the
    // property that must NOT be present at 390px.
    expect(dialog).toMatch(/md:-translate-x-1\/2 md:-translate-y-1\/2/);
    expect(dialog).not.toMatch(/(?:^|["'\s])-translate-x-1\/2/m);
    // Stamped so the runtime gate can read the surface off the DOM rather than off a class list
    // `cn()` may have merged.
    expect(dialog).toMatch(/data-surface="dialog"/);
  });

  it("keeps `dvh` on any viewport-height cap a sheet or panel uses", () => {
    // `vh` on iOS Safari is the LARGEST viewport height, so a sheet sized in `vh` runs under the
    // URL bar — and the part that goes under it is the footer, i.e. the confirm button.
    const offenders = FILES.filter((file) => /max-h-\[\d+vh\]/.test(read(file)));
    expect(
      offenders,
      "use `dvh`; `vh` hides the confirm button under mobile browser chrome",
    ).toEqual([]);
  });

  it("never truncates an item name on a kitchen ticket", () => {
    // "Chicken Karahi (Half)" and "Chicken Karahi (Full)" truncate to the same characters, and
    // the cook cannot tell which one to plate.
    for (const file of [
      "components/kds/kds-ticket-detail.tsx",
      "components/kds/kds-ticket-card.tsx",
    ]) {
      const source = read(file);
      const truncatedNames = source
        .split("\n")
        .filter((line) => /truncate/.test(line) && /item\.name|\{item\.name\}/.test(line));
      expect(truncatedNames, `${file}: a dish name may wrap, never truncate`).toEqual([]);
    }
  });
});
