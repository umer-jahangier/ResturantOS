import { describe, expect, it } from "vitest";

import { buildCss, builtVar, utilityBody } from "./built-css";
import { read, sourceFiles } from "./conformance-scan";

/**
 * Gate G12 — accessibility invariants (UI-SPEC §11.1, plan 38-15 task 9).
 *
 * <h3>What this gate is FOR, and the two things it deliberately is not</h3>
 *
 * G12 exists because the audit's accessibility findings are all *structural* — a skip link that
 * is absent, a landmark that is unnamed, an attribute that is missing — and structure is exactly
 * what a source scan can hold. It runs in the unit suite, offline, on every commit, against every
 * `.tsx` in `app/` and `components/`.
 *
 * <p>It is **not** the axe scan. `e2e/journeys/accessibility-smoke.spec.ts` already runs axe
 * against three rendered screens, and the plan is explicit that automated scanning is "a
 * supplement here, not the gate: it does not catch a 22-Tab journey or an occluded control".
 *
 * <p>It is **not** the tab-order measurement either, and cannot be. "22 Tab presses to reach the
 * page content" is a property of a live document with a resolved session, focusable-element
 * computation and CSS visibility applied. `e2e/journeys/accessibility.spec.ts` owns that number.
 * What this file guarantees is the *precondition* — that the skip link exists, is first in the
 * source, and points at a `<main>` that can actually hold focus — so that when the browser gate
 * runs it is measuring a real mechanism rather than its absence.
 *
 * <h3>Gate hygiene (UI-SPEC §11.1, from phase 34's five vacuous gates)</h3>
 *
 * Every assertion below anchors on something it *also* asserts is present. A scan that finds no
 * `<nav>` elements would otherwise report "0 unnamed navigation regions" and pass forever — which
 * is precisely how a gate becomes a sentence in a document. Each check therefore has a companion
 * `toBeGreaterThanOrEqual` on the population it scanned.
 *
 * <h3>Negative controls — RUN, OBSERVED RED, RESTORED (D-38-07)</h3>
 *
 * Run on 2026-08-22 against this file. Recorded as observed, with the runner's own text — and
 * including the two that the FIRST version of this gate failed to catch, because those are the
 * findings, not footnotes to them.
 *
 * 1. **Skip link deleted from one branch.** Removed `<SkipLink />` from the back-office branch of
 *    `app/(tenant)/layout.tsx`, leaving the operator branch's copy in place.
 *    → **The first version passed** — `exit=0`, "(NO FAILURE — gate did not bite)". It asked
 *    whether the string appeared anywhere in the file. Fifty-nine routes would have lost their
 *    skip link with the gate green. Rewritten to count parity against `<main>`, then:
 *    → OBSERVED RED: *"each return branch that renders a &lt;main&gt; must render its own
 *    &lt;SkipLink&gt; … [ 'app/(tenant)/layout.tsx: 2 &lt;main&gt;, 1 &lt;SkipLink&gt;' ]"*.
 *    Restored.
 * 2. **Skip link moved below the sidebar.** Kept it, placed it after `<Sidebar />`.
 *    → **The first version passed this too** — it compared `indexOf("<SkipLink")` against
 *    `indexOf("<Sidebar")`, and the operator branch's link sits earlier in the file, so the
 *    index never moved. Rewritten to scan the enclosing `return (` branch, then:
 *    → OBSERVED RED: *"&lt;SkipLink&gt; must be the first focusable element its branch renders …
 *    [ 'app/(tenant)/layout.tsx: &lt;Sidebar renders before &lt;SkipLink&gt; at offset 2255' ]"*.
 *    Restored. This is the control that matters most: in both failing versions the link was
 *    present, announced, and correct in a screenshot — and still stop 22.
 * 3. **`tabIndex={-1}` removed from `<main>`.**
 *    → OBSERVED RED: *"every &lt;main&gt; must carry id={MAIN_CONTENT_ID} and tabIndex={-1} …
 *    [ 'app/(tenant)/layout.tsx: &lt;main id={MAIN_CONTENT_ID} key={branchId} className="flex-1
 *    overflow-y-auto p-4 pb-20 focu' ]"*. Restored.
 * 4. **A second `<h1>` beside a `PageHeader`.** Added `<h1>Vendors</h1>` to
 *    `app/(tenant)/app/purchasing/vendors/page.tsx`, which renders a `PageHeader`.
 *    → OBSERVED RED: *"a file must not declare both a literal &lt;h1&gt; and a &lt;PageHeader&gt;
 *    … [ 'app/(tenant)/app/purchasing/vendors/page.tsx' ]"*. Restored.
 * 5. **A `<nav>` unnamed.** Removed `aria-label="Purchasing"` from the purchasing layout.
 *    → OBSERVED RED: *"every &lt;nav&gt; landmark needs an accessible name … [
 *    'app/(tenant)/app/purchasing/layout.tsx: &lt;nav data-testid="purchasing-tabs"
 *    className="mb-4 flex gap-4 border-b"&gt;' ]"*. Restored.
 * 6. **`aria-modal` removed** from `components/pos/order-table-detail-drawer.tsx` — the surface
 *    this check was written after finding.
 *    → OBSERVED RED: *"every DialogPrimitive.Content must set aria-modal … [
 *    'components/pos/order-table-detail-drawer.tsx' ]"*. Restored.
 * 7. **A focus indicator removed with no replacement.** Put `outline-none` back on the ⌘K
 *    palette's search input — it carried exactly that before 38-15, and it is the demo's own
 *    failure (D-38-15: "`outline:none` on inputs with no replacement").
 *    → OBSERVED RED: *"[ 'components/ui/command-palette.tsx: 3 > 2' ]"*. Restored.
 * 8. **`aria-required` removed** from `FormControl`.
 *    → OBSERVED RED: *"expected '\"use client\";…' to match /aria-required=\{required \? true :
 *    un…/"*. Restored.
 * 9. **A skip-link class that does not compile.** Changed `min-h-11` to `min-h-touch` in
 *    `components/shared/skip-link.tsx`.
 *    → OBSERVED RED, twice: *"expected [ 'min-h-touch' ] to deeply equal []"* from the
 *    build-survival check, and the geometry check with it. Restored.
 * 10. **A class that compiles under a different name.** Changed `focus:top-(--space-sm)` to
 *    `focus:top-(--space-gutter)` — a valid utility resolving to an undefined token, i.e. the
 *    regression that leaves the link parked off-screen while it holds focus.
 *    → OBSERVED RED: *"focus:top-(--space-sm) must compile to a rule, not vanish: expected null
 *    not to be null"*. Restored.
 *    *(A third attempt — rewriting `left-(--space-sm)` as the Tailwind v3 form
 *    `left-[--space-sm]` — did NOT go red, and that is recorded rather than dropped: v4.3.1
 *    still compiles the bracket spelling. It is not the hazard it was assumed to be, so nothing
 *    in this gate should be justified by it.)*
 * 11. **Vacuity control.** Pointed the landmark scan at a tag name that does not exist
 *    (`openingTags(source, "navvv")`) to prove the population floor bites rather than the check
 *    passing on an empty set. → OBSERVED RED: *"expected 0 to be greater than or equal to 8"*.
 *    Restored.
 */

const FILES = sourceFiles();

/** file → stripped source, read once. The scan is ~600 files and every check walks all of them. */
const SOURCE = new Map(FILES.map((file) => [file, read(file)] as const));

function each(fn: (file: string, source: string) => void) {
  for (const [file, source] of SOURCE) fn(file, source);
}

/**
 * Every opening tag for `name` in `source`, as text.
 *
 * <h3>Why this is hand-written rather than a regex</h3>
 *
 * `/<main\b[^>]*>/` is the obvious spelling and it is wrong twice. It stops at the first `>`,
 * which in JSX is routinely inside an attribute — `onClick={() => setOpen(true)}` ends a tag
 * three attributes early — and a `/g` regex reused across a `.filter()` carries `lastIndex`
 * between calls, so alternate files silently report no match at all. Both failures make a gate
 * pass, which is the only direction that matters.
 *
 * <p>So: scan forward from the tag name tracking brace depth and quote state, and stop at the
 * first `>` seen at depth 0 outside a string.
 */
function openingTags(source: string, name: string): string[] {
  const out: string[] = [];
  const marker = `<${name}`;
  for (let at = source.indexOf(marker); at >= 0; at = source.indexOf(marker, at + 1)) {
    // `<main` must not match `<mainThing`; the next character has to end the tag name.
    const after = source[at + marker.length];
    if (after && /[\w.$-]/.test(after)) continue;
    let depth = 0;
    let quote: string | null = null;
    for (let i = at + marker.length; i < source.length; i += 1) {
      const ch = source[i];
      if (quote) {
        if (ch === quote && source[i - 1] !== "\\") quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) {
        out.push(source.slice(at, i + 1));
        break;
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// G12a — the skip link, and the target that makes it a skip rather than a scroll
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `app/not-found.tsx` renders a bare `<main>` with no shell around it — no sidebar, no top bar,
 * no branch switcher. There is nothing before it to skip, so a skip link there would be an
 * affordance that saves zero stops, and a fragment target with no link pointing at it.
 *
 * Exemptions are listed by name with the reason, never by pattern: a glob ending in
 * `not-found.tsx` would also exempt a future one that IS inside the shell.
 */
const SHELL_EXEMPT = new Set(["app/not-found.tsx"]);

describe("G12a — skip link (UI-SPEC §11: 0 measured, contract 1 and first)", () => {
  const shells = FILES.filter(
    (file) => openingTags(SOURCE.get(file)!, "main").length > 0 && !SHELL_EXEMPT.has(file),
  );

  it("scans a non-empty population of shells", () => {
    // The vacuity floor. Two shells own a `<main>` today: the tenant layout (which renders two,
    // one per branch of the operator/back-office split) and the platform console.
    expect(shells.length).toBeGreaterThanOrEqual(2);
    expect(shells).toContain("app/(tenant)/layout.tsx");
    expect(shells).toContain("components/platform/platform-shell.tsx");
  });

  /**
   * ONE `<SkipLink>` per `<main>`, not one per file — and the difference is not pedantry.
   *
   * <p>The first version of this check asked whether the string `"<SkipLink"` appeared anywhere
   * in a shell. It passed its own negative control: `app/(tenant)/layout.tsx` returns from TWO
   * places — the operator shell for `/app/pos/**` and the back-office shell for everything else
   * — so deleting the link from the back-office branch left the operator branch's copy in the
   * file and the gate saw nothing wrong. Fifty-nine routes would have lost their skip link
   * while the gate stayed green. Counting parity against `<main>` is what makes a per-branch
   * deletion visible.
   */
  it("every <main> a shell renders has a <SkipLink> of its own", () => {
    const mismatched: string[] = [];
    for (const file of shells) {
      const source = SOURCE.get(file)!;
      const mains = openingTags(source, "main").length;
      const links = (source.match(/<SkipLink\b/g) ?? []).length;
      if (links !== mains) mismatched.push(`${file}: ${mains} <main>, ${links} <SkipLink>`);
    }
    expect(
      mismatched,
      "each return branch that renders a <main> must render its own <SkipLink> — otherwise the " +
        "routes served by that branch have a fragment target nobody can reach, which is the " +
        'shape the audit measured: 0 `a[href^="#"]` on every route and 22 Tab presses to ' +
        "reach the content.",
    ).toEqual([]);
  });

  it("every <main> carries id={MAIN_CONTENT_ID} and tabIndex={-1}", () => {
    const bad: string[] = [];
    for (const file of shells) {
      for (const open of openingTags(SOURCE.get(file)!, "main")) {
        if (!open.includes("id={MAIN_CONTENT_ID}") || !open.includes("tabIndex={-1}")) {
          bad.push(`${file}: ${open.replace(/\s+/g, " ").slice(0, 90)}`);
        }
      }
    }
    expect(
      bad,
      "every <main> must carry id={MAIN_CONTENT_ID} and tabIndex={-1}. Without the id the link " +
        "points nowhere; without the tabindex the browser scrolls and leaves the caret in the " +
        "sidebar, so the next Tab resumes at nav link 2 and the whole affordance is decorative.",
    ).toEqual([]);
  });

  /**
   * The check the other three cannot make. A skip link is only a skip link if it is FIRST —
   * everything else about it can be right while it saves nothing.
   *
   * <h3>Why this is anchored on `return (` and not on the top of the file</h3>
   *
   * The first version compared `source.indexOf("<SkipLink")` against `source.indexOf("<Sidebar")`,
   * and it failed its own negative control. `app/(tenant)/layout.tsx` has TWO return branches;
   * the operator branch's link sits earlier in the file than the back-office branch's, so moving
   * the back-office link below `<Sidebar />` — the exact regression this test exists for — left
   * the first index unchanged and the gate green. Observed: "2 skip link moved BELOW the sidebar
   * :: exit=0 (NO FAILURE — gate did not bite)".
   *
   * <p>So the window is the BRANCH: from the `return (` that encloses each link, to the link. No
   * focusable chrome may appear inside it. This is deliberately not a claim about the rendered
   * tab order — a portal, or a `tabindex` on an earlier node, defeats source order entirely, and
   * `e2e/journeys/accessibility.spec.ts` measures the real thing in a browser. It is a claim
   * about the two hand-written shell files, whose chrome is rendered inline, and it holds there.
   */
  it("<SkipLink> is the first focusable thing in its return branch", () => {
    const CHROME = ["<Sidebar", "<TopBar", "<OperatorStrip", "<nav", "<header", "<main", "<a "];
    const bad: string[] = [];
    let links = 0;
    for (const file of shells) {
      const source = SOURCE.get(file)!;
      for (const hit of source.matchAll(/<SkipLink\b/g)) {
        links += 1;
        const at = hit.index!;
        const branchStart = Math.max(0, source.lastIndexOf("return (", at));
        const window = source.slice(branchStart, at);
        for (const marker of CHROME) {
          if (window.includes(marker)) {
            bad.push(`${file}: ${marker} renders before <SkipLink> at offset ${at}`);
          }
        }
      }
    }
    expect(links).toBeGreaterThanOrEqual(3);
    expect(
      bad,
      "<SkipLink> must be the first focusable element its branch renders. Placed after the " +
        "sidebar it is still a skip link, still announced, still correct in a screenshot — and " +
        "still stop 22.",
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G12b — landmarks are named
// ─────────────────────────────────────────────────────────────────────────────

describe("G12b — landmarks (UI-SPEC §11: one <main>, every <nav> named)", () => {
  it("every <nav> landmark has an accessible name", () => {
    const unnamed: string[] = [];
    let total = 0;
    each((file, source) => {
      for (const tag of openingTags(source, "nav")) {
        total += 1;
        if (!/aria-label(?:ledby)?[=\s]/.test(tag)) {
          unnamed.push(`${file}: ${tag.replace(/\s+/g, " ").slice(0, 90)}`);
        }
      }
    });
    // Vacuity floor: this product renders up to four navigation regions at once.
    expect(total).toBeGreaterThanOrEqual(8);
    expect(
      unnamed,
      "every <nav> landmark needs an accessible name. Four of the eight measured before 38-15 " +
        "had none, so a screen-reader rotor listed 'navigation, navigation, navigation, " +
        "navigation' and the user had to enter each one to find out which was which.",
    ).toEqual([]);
  });

  it("the sidebar's complementary landmark is named", () => {
    const sidebar = SOURCE.get("components/shared/sidebar.tsx");
    expect(
      sidebar,
      "components/shared/sidebar.tsx must exist for this check to mean anything",
    ).toBeDefined();
    expect(sidebar!).toMatch(/<aside\s+aria-label="[^"]+"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G12c — exactly one page heading, and PageHeader owns it
// ─────────────────────────────────────────────────────────────────────────────

describe("G12c — one <h1> per page (UI-SPEC §11: four screens measured at 0)", () => {
  it("PageHeader renders exactly one <h1> and offers no element escape hatch", () => {
    const header = SOURCE.get("components/ui/page-header.tsx");
    expect(header).toBeDefined();
    expect((header!.match(/<h1\b/g) ?? []).length).toBe(1);
    // "let the caller pass `as`" is how the sixty hand-written copies started. The docblock says
    // so; this asserts it, because a docblock does not fail a build.
    expect(header!).not.toMatch(/\bas\s*[?:]?\s*:\s*(?:React\.)?ElementType/);
  });

  it("no file declares both a literal <h1> and a <PageHeader>", () => {
    const both: string[] = [];
    let headings = 0;
    each((file, source) => {
      const h1 = /<h1\b/.test(source);
      const ph = /<PageHeader\b/.test(source);
      if (h1 || ph) headings += 1;
      if (h1 && ph) both.push(file);
    });
    expect(headings).toBeGreaterThanOrEqual(50);
    expect(
      both,
      "a file must not declare both a literal <h1> and a <PageHeader> — PageHeader RENDERS the " +
        "<h1>, so a file doing both ships two page headings and the document outline has no root.",
    ).toEqual([]);
  });

  /*
   * Why "exactly one heading per ROUTE" is not asserted here.
   *
   * Three page files legitimately contain more than one `<PageHeader>` — `roles/page.tsx`,
   * `roles/matrix/page.tsx` and `inventory/coverage/page.tsx` — because each is an early-return
   * branch (error / loading / loaded) and exactly one renders. A static count reports 2 and 3.
   *
   * And seventeen page files contain no heading at all because they delegate: `kitchen/**` to
   * `StationBoard`, `pos/tills` to `TillReview`, `hr/settings/*` to `LookupListScreen`, four more
   * are `redirect()` calls with no UI.
   *
   * So the per-route count is a RUNTIME property and it lives in
   * `e2e/journeys/accessibility.spec.ts`, which counts `document.querySelectorAll("h1")` on the
   * rendered page. A static version of it would be red on day one against six correct files,
   * which is how a gate gets switched off. What is asserted above is the half that IS static and
   * is the actual regression risk: the same file supplying the heading twice.
   */
});

// ─────────────────────────────────────────────────────────────────────────────
// G12d — a focus indicator is never removed without a replacement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Files that may legitimately carry `outline-none`, with the count they may carry.
 *
 * <p>Same shape as `conformance-baseline.json` and for the same reason: a flat ban would be red
 * on day one and switched off by the end of the week, while a per-file cap that may only decrease
 * makes the debt visible and **fails the moment a file grows a new one**. A file absent from this
 * map must score zero — new code is born with its focus indicator intact.
 *
 * <p>Every entry here is a surface whose focus is either replaced by another visible channel or
 * is not a keyboard destination at all:
 *
 * - `dialog.tsx`, `popover.tsx`, `order-table-detail-drawer.tsx` — Radix focuses the CONTENT
 *   CONTAINER when the surface opens, not an interactive control. The visible change is the
 *   surface appearing; a 2px outline traced around an entire dialog reads as a rendering fault.
 *   SC 2.4.7 governs the focused *element*, and these are containers.
 * - `command-palette.tsx` (×2) and `catalog-item-combobox.tsx` — `Command.Item` rows, driven by
 *   `aria-activedescendant`. Focus never lands on them at all; `data-[selected=true]:bg-accent`
 *   is the replacement, and it is a real one.
 *
 * <p>What is NOT here, and was, before 38-15: the three TEXT INPUTS in `command-palette.tsx`,
 * `combobox.tsx` and `catalog-item-combobox.tsx`. Those are keyboard destinations with no
 * replacement of any kind — the demo's exact failure (D-38-15: "`outline:none` on inputs with no
 * replacement"). In Tailwind v4 `outline-none` lands in the `utilities` layer while
 * `:focus-visible` lives in `base`, and later layers win, so a class that reads like a reset was
 * switching off the product's only focus indicator on those fields. They now carry
 * `focus-visible:outline-offset-[-2px]`, which draws the global outline INSIDE the box — a
 * positive offset would be painted outside an ancestor that is `overflow-hidden` and clipped to
 * nothing, which is indistinguishable from `outline: none` on screen.
 */
const OUTLINE_NONE_ALLOWED: Record<string, number> = {
  "components/pos/order-table-detail-drawer.tsx": 1,
  "components/shared/catalog-item-combobox.tsx": 1,
  "components/ui/command-palette.tsx": 2,
  "components/ui/dialog.tsx": 1,
  "components/ui/popover.tsx": 1,
};

describe("G12d — focus indicators (D-38-15: the demo's `outline:none` is not adopted)", () => {
  it("no file removes a focus outline beyond its recorded allowance", () => {
    const offenders: string[] = [];
    let scanned = 0;
    each((file, source) => {
      const n = (source.match(/\boutline-none\b/g) ?? []).length;
      if (n === 0) return;
      scanned += 1;
      const allowed = OUTLINE_NONE_ALLOWED[file] ?? 0;
      if (n > allowed) offenders.push(`${file}: ${n} > ${allowed}`);
    });
    // Vacuity floor: if the scan stops finding the five known files, the regex has drifted.
    expect(scanned).toBeGreaterThanOrEqual(5);
    expect(
      offenders,
      "`outline-none` sits in Tailwind's `utilities` layer and `:focus-visible` in `base`; later " +
        "layers win, so this class silently deletes the product's only focus indicator. Every " +
        "allowance in OUTLINE_NONE_ALLOWED names the replacement channel that justifies it. A " +
        "new one needs the same.",
    ).toEqual([]);
  });

  it("the global focus indicator is an outline, and it is still there", () => {
    // Phase 20's fix, which 38-15 explicitly does not reopen — asserted so it cannot be
    // reopened by accident. `ring` was measured ABSENT under Windows High Contrast.
    const css = read("app/globals.css").replace(/\s+/g, " ");
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--ring\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G12d(ii) — the skip link's utilities survive the build
// ─────────────────────────────────────────────────────────────────────────────

describe("G12d(ii) — the skip link compiles to the geometry it claims", () => {
  /*
   * Why this is worth a test rather than a glance.
   *
   * Every property that makes a skip link work is written as a Tailwind class, and Tailwind v4
   * emits a utility only if something references it. A class name that does not compile is
   * indistinguishable in source from one that does — `left-(--space-sm)` and
   * `left-[--space-sm]` read the same to a reviewer and only one of them is a rule. The result
   * would be a link parked at `top: 0` with `sr-only` never applied: visible, at the top-left
   * of every page in the product, forever.
   *
   * This session had no browser (see the header of `e2e/journeys/accessibility.spec.ts`), so
   * compiling the stylesheet through Tailwind's own compiler is the strongest available
   * substitute — the same instrument, and the same argument, `built-css.ts` was written for:
   * "a token that does not survive the build is not a token, and a test that reads the source
   * cannot notice."
   *
   * <p>It is NOT a claim that the link is visible on focus. That is layout, jsdom has none, and
   * `e2e/journeys/accessibility.spec.ts` asserts the focused bounding box is inside the
   * viewport.
   */
  /**
   * The candidates are READ OUT OF THE COMPONENT, not retyped here.
   *
   * <p>A hard-coded list would compile five class names that a reviewer believes are the ones
   * in `skip-link.tsx` — and would go on passing after a sixth was added, or after one was
   * misspelled into the Tailwind v3 form (`left-[--space-sm]`, which v4 does not compile). The
   * gate would then be asserting about a string that exists only inside the gate.
   */
  function skipLinkCandidates(): string[] {
    const source = SOURCE.get("components/shared/skip-link.tsx");
    expect(source, "components/shared/skip-link.tsx must exist").toBeDefined();
    const call = source!.slice(source!.indexOf("className={cn("));
    const tokens = new Set<string>();
    for (const literal of call.matchAll(/"([^"]+)"/g)) {
      for (const token of literal[1]!.split(/\s+/)) if (token) tokens.add(token);
    }
    return [...tokens];
  }

  it("every class the component writes compiles to a real rule", async () => {
    const candidates = skipLinkCandidates();
    // Vacuity floor: the component writes more than a dozen.
    expect(candidates.length).toBeGreaterThanOrEqual(12);
    const css = await buildCss(candidates);
    const dead = candidates.filter((token) => {
      const escaped = token.replace(/[.:()[\]\\]/g, (ch) => `\\${ch}`);
      return utilityBody(css, escaped) === null;
    });
    expect(
      dead,
      "Tailwind v4 emits a utility only if something references it, so a class that does not " +
        "compile is invisible in source and total at runtime: an unstyled skip link renders at " +
        "the top-left of every page in the product, permanently.",
    ).toEqual([]);
  });

  it("parks off-screen, returns on focus, and clears 44px", async () => {
    const css = await buildCss([
      ...skipLinkCandidates(),
      // Not the link's own — it is what `<main>` and the three un-reset search inputs use. Built
      // alongside so the inset indicator is proved to compile in the same pass.
      "focus-visible:outline-offset-[-2px]",
    ]);

    // Off-screen: -24 spacing steps. `--spacing` is Tailwind's own 0.25rem — asserted rather
    // than assumed, because globals.css deliberately did NOT bridge `--space-*` onto
    // `--spacing-*` (it would have broken `.max-w-sm`), and a future bridge would silently
    // rescale this.
    expect(builtVar(css, "--spacing")).toBe("0.25rem");
    expect(utilityBody(css, "-top-24")).toContain("calc(var(--spacing) * -24)");

    // Back into the viewport on focus, at the contract gutter.
    const onFocus = utilityBody(css, "focus\\:top-\\(--space-sm\\)");
    expect(onFocus, "focus:top-(--space-sm) must compile to a rule, not vanish").not.toBeNull();
    expect(onFocus!).toContain("top: var(--space-sm)");

    // SC 2.5.5: 44px. `min-h-11` is 11 × 0.25rem.
    expect(utilityBody(css, "min-h-11")).toContain("calc(var(--spacing) * 11)");

    // The inset focus outline the three search inputs now use, and `<main>` after a skip.
    const inset = utilityBody(css, "focus-visible\\:outline-offset-\\[-2px\\]");
    expect(inset, "the replacement indicator must be a real rule").not.toBeNull();
    expect(inset!).toContain("outline-offset: -2px");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G12e — every dialog surface is modal to assistive tech
// ─────────────────────────────────────────────────────────────────────────────

describe("G12e — aria-modal (UI-SPEC §11: unset on all three dialogs probed)", () => {
  it("every DialogPrimitive.Content sets aria-modal", () => {
    const missing: string[] = [];
    let total = 0;
    each((file, source) => {
      for (const tag of openingTags(source, "DialogPrimitive.Content")) {
        total += 1;
        if (!tag.includes('aria-modal="true"')) missing.push(file);
      }
    });
    // Vacuity floor: the shared surface plus the POS drawer.
    expect(total).toBeGreaterThanOrEqual(2);
    expect(
      missing,
      "every DialogPrimitive.Content must set aria-modal. 38-03 set it on the shared " +
        "`DialogContent` and its negative control PROVED Radix never supplies it — so a surface " +
        "built from the primitives directly, as the POS order drawer is, gets nothing. Asserting " +
        "against the primitive rather than the shared component is the check that finds those.",
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G12f — required fields are marked, in both channels
// ─────────────────────────────────────────────────────────────────────────────

describe("G12f — required marking (UI-SPEC §11: 0 marked in both audited dialogs)", () => {
  const form = () => {
    const source = SOURCE.get("components/ui/form.tsx");
    expect(
      source,
      "components/ui/form.tsx must exist for this check to mean anything",
    ).toBeDefined();
    return source!;
  };

  it("FormControl publishes aria-required and FormLabel draws a visible marker", () => {
    expect(form()).toMatch(/aria-required=\{required \? true : undefined\}/);
    expect(form()).toMatch(/data-slot="form-required-marker"/);
  });

  it("the marker is a glyph, not a colour (D-38-13, §4.2)", () => {
    // `activity-row.tsx` and `stat-tile.tsx` already agree the second channel must be a visible
    // shape or word rather than hue. The asterisk is that channel; `text-destructive` is a third,
    // redundant one. Delete the colour and the marker survives — which is the whole point.
    const marker = /data-slot="form-required-marker"[\s\S]{0,200}?\*/;
    expect(form()).toMatch(marker);
  });

  it("the audited dialogs now mark their required fields", () => {
    // `audit-interactions.json` recorded `tableDialog.requiredMarked: 0` and
    // `poDialog.requiredMarked: 0`. This anchors on the one of the two that is not held by
    // another workstream, and asserts the file is really there before asserting about it.
    const table = SOURCE.get("app/(tenant)/app/tables/TableFormDialog.tsx");
    expect(table).toBeDefined();
    expect((table!.match(/<FormItem required\b/g) ?? []).length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G12g — a <label> that WRAPS its control must establish a layout
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The bug the product owner photographed, stated exactly.
 *
 * <p>`components/pos/till-session-bar.tsx:367` read:
 *
 * ```tsx
 * <label className="text-body">
 *   Declared Cash Count (PKR)
 *   <input className="mt-1 min-h-11 w-full …" />
 * </label>
 * ```
 *
 * <p>A `<label>` is `display: inline`. An inline box does not establish a block formatting
 * context, so the `w-full` input inside it is laid out as an inline-level box on the SAME line
 * box as the text node beside it — and `mt-1` on an inline-level replaced element does not push
 * the line box apart. The result is the words "Declared Cash Count (PKR)" rendering ON TOP of the
 * input at any width where the two do not both fit: the collision in the owner's screenshot.
 *
 * <p>It is not a spacing bug and no amount of margin fixes it. The label has to become a
 * block/flex/grid container, or the control has to stop being its child. Both are one class or
 * one refactor, which is precisely why it recurs — nothing notices.
 *
 * <h3>Negative control — RUN, OBSERVED RED, RESTORED</h3>
 *
 * See the assertion message; the injection and its observed output are recorded in the plan.
 */
const WRAPPING_CONTROL =
  /<(?:input|textarea|select|Input|Textarea|Select|Combobox|NativeSelect|MoneyInput)\b/;

/**
 * Tokens that give the `<label>` a formatting context of its own, so a `w-full` child is laid
 * out as a block-level box instead of sharing the text's line box. Variant prefixes
 * (`md:flex`, `data-[x]:grid`) are stripped before the lookup.
 */
const LAYOUT_TOKENS = new Set([
  "flex",
  "inline-flex",
  "grid",
  "inline-grid",
  "block",
  "inline-block",
  "flow-root",
  "contents",
  "table",
  "table-cell",
]);

function classNameText(openTag: string): string {
  const at = openTag.indexOf("className");
  if (at < 0) return "";
  const rest = openTag.slice(at + "className".length).replace(/^\s*=\s*/, "");
  if (rest.startsWith('"') || rest.startsWith("'")) {
    const quote = rest.slice(0, 1);
    const end = rest.indexOf(quote, 1);
    return end < 0 ? rest : rest.slice(1, end);
  }
  if (!rest.startsWith("{")) return "";
  let depth = 0;
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "{") depth += 1;
    else if (rest[i] === "}") {
      depth -= 1;
      if (depth === 0) return rest.slice(1, i);
    }
  }
  return rest;
}

function establishesLayout(openTag: string): boolean {
  return classNameText(openTag)
    .split(/[\s"'`,{}()[\]]+/)
    .some((raw) => {
      const token = raw.slice(raw.lastIndexOf(":") + 1);
      return LAYOUT_TOKENS.has(token);
    });
}

/** Every `<label>…</label>` pair in a source file, as its opening tag and its inner text. */
function labelBlocks(source: string): Array<{ open: string; inner: string; line: number }> {
  const out: Array<{ open: string; inner: string; line: number }> = [];
  const marker = "<label";
  for (let at = source.indexOf(marker); at >= 0; at = source.indexOf(marker, at + 1)) {
    const after = source[at + marker.length];
    if (after && /[\w.$-]/.test(after)) continue;
    let depth = 0;
    let quote: string | null = null;
    let openEnd = -1;
    for (let i = at + marker.length; i < source.length; i += 1) {
      const ch = source[i];
      if (quote) {
        if (ch === quote && source[i - 1] !== "\\") quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) {
        openEnd = i;
        break;
      }
    }
    if (openEnd < 0 || source[openEnd - 1] === "/") continue;
    // `<label>` may not nest, so the next closing tag is this element's.
    const close = source.indexOf("</label>", openEnd);
    if (close < 0) continue;
    out.push({
      open: source.slice(at, openEnd + 1),
      inner: source.slice(openEnd + 1, close),
      line: source.slice(0, at).split("\n").length,
    });
  }
  return out;
}

describe("G12g — a wrapping <label> establishes a layout (the till-session-bar collision)", () => {
  it("no <label> contains a control while rendering as an inline box", () => {
    const offenders: string[] = [];
    each((file, source) => {
      for (const block of labelBlocks(source)) {
        if (!WRAPPING_CONTROL.test(block.inner)) continue;
        if (establishesLayout(block.open)) continue;
        offenders.push(`${file}:${block.line}`);
      }
    });
    expect(
      offenders,
      "a <label> that WRAPS its control is display:inline, so the control shares the label " +
        "text's line box and the two overlap — the 'Declared Cash Count (PKR)' collision. Give " +
        "the label `flex flex-col` / `grid` / `block`, or split it into a <Label htmlFor> beside " +
        "the control (components/ui/label.tsx, components/ui/form.tsx).",
    ).toEqual([]);
  });

  it("the check can see a control inside a label at all (self-test)", () => {
    // A gate that silently matches nothing passes forever. This proves the scanner finds the
    // shape it is looking for, using a fixture rather than a file that is about to be fixed.
    const fixture = `<label className="text-body">Declared\n  <input className="w-full" />\n</label>`;
    const blocks = labelBlocks(fixture);
    expect(blocks).toHaveLength(1);
    expect(WRAPPING_CONTROL.test(blocks[0]!.inner)).toBe(true);
    expect(establishesLayout(blocks[0]!.open)).toBe(false);
    expect(establishesLayout(`<label className="flex flex-col gap-1.5">`)).toBe(true);
    expect(establishesLayout(`<label className={cn("grid gap-2", x && "y")}>`)).toBe(true);
    // `flex-col` alone does NOT establish a flex container — the bug survives it.
    expect(establishesLayout(`<label className="flex-col gap-2">`)).toBe(false);
  });
});
