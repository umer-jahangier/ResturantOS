/**
 * Viewport integrity — the measurement half of plan 38-14 task 5.
 *
 * <h2>Why this file exists at all</h2>
 *
 * The first audit pass reported `overflow = 0` for the POS at 390px and the screenshot showed a
 * broken screen: the cart panel sat ON TOP of the menu grid. Nothing overflowed, because an
 * overlay does not overflow. The plan states the lesson in one line — **a probe that measures the
 * wrong property returns a confident, useless green** — and the whole design of this module falls
 * out of taking that seriously:
 *
 *  1. **Five independent measurements, not one.** Overflow, occlusion, target size, value
 *     truncation, and desktop-table-on-a-phone. Each one can be green while another is red;
 *     collapsing them into a single "responsive OK" number is how the POS defect hid.
 *  2. **The overflow predicate is the AUDIT's predicate, character for character.** See
 *     {@link isOverflowing}. The plan's first negative control is "render the desktop table at
 *     390px → it should reproduce the 100-element baseline **exactly**; if it does not, the probe
 *     is measuring something else." A probe that cannot reproduce the number it is replacing has
 *     no baseline, and therefore no way to tell a fix from a re-measurement.
 *  3. **Collection and judgement are separate.** {@link COLLECT} runs in the browser and returns
 *     plain data. Every decision below it is a pure function of that data, exported, and unit
 *     tested in `__tests__/e2e/viewport-integrity.test.ts` — including all four negative
 *     controls, which run against synthetic geometry and therefore run in CI with no stack, no
 *     database and no browser. The rule this file follows is that the *logic* of a gate must be
 *     testable without the environment the gate observes.
 *
 * <h2>What it deliberately does not do</h2>
 *
 * It takes no screenshots and makes no judgement about whether a layout is *good*. It measures
 * five things that are false regardless of taste: content outside the box, controls under a
 * finger's width, a control buried under another one, a number rendered as `Rs 1,2…`, and a
 * twelve-column table on a 390px screen.
 */

/** The four widths the 38 audit measures. Anything else is not a comparable measurement. */
export const AUDIT_WIDTHS = [390, 768, 1024, 1440];

/**
 * @typedef {object} Box
 * @property {number} left
 * @property {number} right
 * @property {number} top
 * @property {number} bottom
 * @property {number} width
 * @property {number} height
 */

/**
 * One rendered element, as {@link COLLECT} reports it.
 *
 * <p>Written as JSDoc rather than left implicit so that the pure analysers below are typed for
 * the vitest suite that exercises them — `tsconfig` excludes `e2e/**`, so this file is never
 * type-CHECKED, but it is still read for inference by anything that imports it, and an untyped
 * export turns every callback in that suite into an implicit `any`.
 *
 * @typedef {object} ViewportRecord
 * @property {string} tag
 * @property {string | null} testid
 * @property {string | null} slot
 * @property {string} cls
 * @property {string} name
 * @property {Box} rect
 * @property {{width: number, height: number}} viewport
 * @property {boolean} interactive
 * @property {boolean} parentOverflows
 * @property {{sampled: number, covered: number, by: string | null}} coverage
 * @property {boolean} ellipsis
 * @property {boolean} clipping
 * @property {boolean} numeric
 * @property {boolean} isTable
 * @property {boolean} [inlineTarget]
 * @property {boolean} [rendersAsTable]
 * @property {string | null} clippedBy
 * @property {boolean} scrollContained
 */

/** The one layout boundary below which a desktop table may not appear (Tailwind `md`). */
export const MD = 768;

/** WCAG 2.2 SC 2.5.5 (AAA) / 2.5.8 target size, and the number wave 4 measured the POS against. */
export const MIN_TARGET = 44;

/**
 * Harvested inside the page. Computed styles and geometry only — nothing inferred from source.
 *
 * <p>Returned as an array of plain records so that every judgement below is a pure function and
 * can be tested without a browser. The cost is that a few fields look redundant (`displayed`,
 * `area`); they are here because the *analyser* must be able to re-derive every decision, and a
 * boolean computed in the browser and thrown away is a boolean no test can challenge.
 *
 * <p>Passed to Playwright as a function, not a string, so it is syntax-checked by the same
 * tooling as the rest of the file.
 */
export const COLLECT = () => {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  const INTERACTIVE_ROLES = [
    "button",
    "link",
    "menuitem",
    "tab",
    "switch",
    "checkbox",
    "radio",
    "option",
    "combobox",
    "textbox",
  ];

  const isInteractive = (el) => {
    const t = el.tagName;
    if (t === "BUTTON" || t === "A" || t === "SELECT" || t === "TEXTAREA") return true;
    if (t === "INPUT") return el.type !== "hidden";
    return INTERACTIVE_ROLES.includes(el.getAttribute("role") || "");
  };

  const accName = (el) =>
    (el.getAttribute("aria-label") || "").trim() ||
    (el.getAttribute("title") || "").trim() ||
    (el.textContent || "").trim();

  /**
   * Is this box covered by something that is not part of it?
   *
   * <p>Sampled with `elementFromPoint` at the centre and four inset corners. `elementFromPoint`
   * is hit-testing — it answers the question a finger asks — which is why it sees the POS cart
   * sitting over the menu grid while every geometric comparison in the world reports two boxes
   * that merely happen to intersect.
   *
   * <p>A hit that lands on a DESCENDANT counts as reaching the element (that is what tapping a
   * button's label does) and so does one that lands on an ANCESTOR (a padded wrapper). Only a
   * foreign node counts as coverage. Points outside the viewport are not sampled at all, because
   * `elementFromPoint` returns null there and a null would otherwise read as "not covered".
   *
   * <h3>Sampled inside the CLIPPED box, not the bounding box</h3>
   *
   * <p>`getBoundingClientRect()` reports where an element WOULD be, not where it can be seen. A
   * row scrolled out of its own scroll container still has a rect, and that rect lands wherever
   * the arithmetic puts it — frequently on top of whatever is painted at those coordinates. Hit
   * testing there answers a question nobody asked: it reports the thing in front, and the element
   * is scored as "fully covered" when it is simply scrolled away.
   *
   * <p>Measured on `/app/dashboard` at 768 against the live deployment 2026-08-22:
   * `a "Accounts" 239×36 @8,852` reported covered, in a sidebar `<nav>` running 110→839 with
   * `scrollHeight` 1610 against `clientHeight` 729. The link is 13px below the bottom of its own
   * scroll port. Nothing covers it — the sidebar footer merely occupies the coordinates its rect
   * happens to name. Scroll the rail and it is there.
   *
   * <p>So the sample points come from the element's rect intersected with every clipping
   * ancestor. An empty intersection means the element is not on screen at all right now, and
   * `sampled: 0` keeps it out of the verdict — which is the same answer this function already
   * gives for a point outside the viewport, for the same reason.
   *
   * <p>NEGATIVE CONTROL, run live rather than in jsdom, because the unit suite feeds
   * `occludedInteractives` synthetic coverage objects and therefore cannot exercise this function
   * at all: with the change in place, an opaque `position: fixed` panel dropped over a
   * fully-visible portlet on `/app/dashboard` at 390 took the count 0 → 1 and named the overlay
   * (`a[portlet-owner-net-sales] … by negative-control-overlay`). The narrowing removes two false
   * positives and does not switch the check off.
   */
  const clippedBox = (el, r) => {
    const box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (let p = el.parentElement; p; p = p.parentElement) {
      // `<html>`/`<body>` are the page itself; the viewport bound below already covers them.
      if (p.tagName === "HTML" || p.tagName === "BODY") continue;
      const cs = getComputedStyle(p);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const pr = p.getBoundingClientRect();
      box.left = Math.max(box.left, pr.left);
      box.top = Math.max(box.top, pr.top);
      box.right = Math.min(box.right, pr.right);
      box.bottom = Math.min(box.bottom, pr.bottom);
    }
    return box;
  };

  const coverage = (el, r) => {
    const b = clippedBox(el, r);
    const w = b.right - b.left;
    const h = b.bottom - b.top;
    if (w <= 0 || h <= 0) return { sampled: 0, covered: 0, by: null };

    const inset = Math.min(4, w / 4, h / 4);
    const points = [
      [b.left + w / 2, b.top + h / 2],
      [b.left + inset, b.top + inset],
      [b.right - inset, b.top + inset],
      [b.left + inset, b.bottom - inset],
      [b.right - inset, b.bottom - inset],
    ];
    let sampled = 0;
    let covered = 0;
    let by = null;
    for (const [x, y] of points) {
      if (x < 0 || y < 0 || x > vw || y > vh) continue;
      sampled += 1;
      const hit = document.elementFromPoint(x, y);
      if (!hit) continue;
      if (hit === el || el.contains(hit) || hit.contains(el)) continue;
      covered += 1;
      if (!by) {
        by =
          hit.getAttribute("data-testid") ||
          hit.getAttribute("data-slot") ||
          hit.tagName.toLowerCase();
      }
    }
    return { sampled, covered, by };
  };

  /**
   * The nearest ancestor that does NOT let this element paint outside it horizontally.
   *
   * <p>Why this exists: `getBoundingClientRect()` on a block-level child of an
   * `overflow-x: auto` container reports the child's FULL width, not the part you can see. So a
   * `DataGrid` table inside its own scroll container — the shape 38-02 built deliberately, and
   * the shape brief §57 sanctions ("scroll inside its own container with the page still fixed")
   * — measures as "past the viewport" while nothing is past anything. Counting those makes the
   * gate red on the fix, which is how a gate gets switched off.
   *
   * <p>Two ancestors are deliberately NOT accepted as containment:
   *
   * <ul>
   *   <li><b>`<main>`, `<body>`, `<html>`.</b> `<main>` in this product is `overflow-y-auto`, and
   *       CSS computes the other axis of a non-visible overflow to `auto` — so EVERY element in
   *       the product is horizontally clipped by `<main>`, and accepting it would make this
   *       check vacuously green on every page forever. It is also the right answer on the
   *       merits: content wider than `<main>` drags the page header and the tabs sideways with
   *       it, which is exactly what a person means by "the page scrolls sideways".</li>
   *   <li><b>A clipper that is itself past the viewport.</b> A scroll container you cannot reach
   *       has not contained anything.</li>
   * </ul>
   */
  const PAGE_LEVEL = new Set(["MAIN", "BODY", "HTML"]);
  const clipperOf = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === "visible") continue;
      if (PAGE_LEVEL.has(p.tagName)) return null;
      const r = p.getBoundingClientRect();
      if (r.right > vw + 2) return null;
      return {
        id: p.getAttribute("data-testid") || p.getAttribute("data-slot") || p.tagName.toLowerCase(),
        scrollable: cs.overflowX === "auto" || cs.overflowX === "scroll",
      };
    }
    return null;
  };

  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    // `display: none` is how BOTH halves of every responsive pair in this product stand down —
    // `DataGrid`'s table is `hidden md:block` and its card list is `md:hidden`, and both are
    // always in the DOM. Counting a hidden branch would make every migrated list screen fail at
    // every width, which is a probe that measures the fix as the defect.
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    const interactive = isInteractive(el);
    const record = {
      tag: el.tagName,
      testid: el.getAttribute("data-testid"),
      slot: el.getAttribute("data-slot"),
      cls: (el.className || "").toString().slice(0, 80),
      name: interactive ? accName(el).slice(0, 40) : "",
      rect: {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      },
      viewport: { width: vw, height: vh },
      interactive,
      // The parent's own overhang, so the analyser can name the SHALLOWEST offender without a
      // second pass over the DOM. A child of an overflowing parent is a symptom, not a cause.
      parentOverflows: Boolean(
        el.parentElement && el.parentElement.getBoundingClientRect().right > vw + 2,
      ),
      coverage: interactive ? coverage(el, r) : { sampled: 0, covered: 0, by: null },
      // `text-overflow: ellipsis` is only a DEFECT when it is actually clipping something.
      // Every `truncate` in the product declares it; the ones that matter are the ones where
      // the content does not fit.
      ellipsis: cs.textOverflow === "ellipsis",
      clipping: el.scrollWidth > el.clientWidth + 1,
      // A money or quantity value. `MoneyDisplay` renders `tabular-nums` on every branch
      // (money-display.tsx:70) and so does `DataGrid`'s card `trailing` slot, which makes the
      // computed `font-variant-numeric` a more reliable marker than any class name — `cn()` has
      // silently dropped utilities in this codebase before.
      numeric:
        cs.fontVariantNumeric.includes("tabular-nums") &&
        /\d/.test((el.textContent || "").trim()) &&
        el.children.length === 0,
      // WCAG 2.5.8's own exception, read off the layout rather than guessed: "the target is in a
      // sentence, or its size is otherwise constrained by the line-height of non-target text."
      // A control whose computed display is `inline` IS in a text flow — it cannot be given a
      // height without changing the line it sits in. Every real control in this product is
      // `inline-flex`, `flex`, `block` or `grid`, so this exempts text links and nothing else.
      inlineTarget: interactive && cs.display === "inline",
      isTable: el.tagName === "TABLE",
      // A `<table>` that has been given `display: block` below `md` is no longer a table on the
      // screen — its rows are stacked cards and its header is gone. The TAG is the wrong thing to
      // judge that on, and judging on the tag would mean the only sanctioned adaptation for a
      // hand-rolled table is a second copy of it in JSX.
      rendersAsTable: el.tagName === "TABLE" && cs.display.startsWith("table"),
      // Set below, once, so the analyser can tell "spilling into the viewport" from "wider than
      // its own scroll container", which look identical in a bounding box.
      clippedBy: null,
      scrollContained: false,
    };
    const clipper = clipperOf(el);
    if (clipper) {
      record.clippedBy = clipper.id;
      // `hidden`/`clip` contain the box but give no way to READ the rest of it, so they are
      // containment for the purposes of "does the page move" and not for "can the user get at
      // the last column". Only a scrollable clipper counts as an adaptation.
      record.scrollContained = clipper.scrollable;
    }
    out.push(record);
  }
  return out;
};

/**
 * The AUDIT's overflow predicate, reproduced exactly (`e2e/audit-38.mjs:105`).
 *
 * <p>`> vw + 2`, not `>= vw`: sub-pixel layout rounding puts a full-width element's right edge at
 * 390.004 constantly, and a probe that reports those is a probe nobody reads twice.
 *
 * <p>`width > 24` is the audit's own filter and it is kept for the same reason the tolerance is:
 * so the baselines in the plan (stock 100 @390, 42 @1024, PO 4 @390) are comparable to what this
 * returns. Changing either number silently redefines "fixed".
 */
/**
 * @param {ViewportRecord} record
 * @returns {boolean}
 */
export function isOverflowing(record) {
  return record.rect.right > record.viewport.width + 2 && record.rect.width > 24;
}

/** Every element past the right edge — the audit's count, for baseline comparison. */
/**
 * @param {ViewportRecord[]} records
 * @returns {ViewportRecord[]}
 */
export function overflowOffenders(records) {
  return records.filter(isOverflowing);
}

/**
 * The elements to actually fix: those that overflow while their parent does not.
 *
 * <p>Reported alongside the raw count rather than instead of it. The raw count is what the
 * baseline is expressed in; this is what a person reads to find out which element is too wide.
 */
/**
 * @param {ViewportRecord[]} records
 * @returns {ViewportRecord[]}
 */
export function overflowBlame(records) {
  return records.filter((r) => isOverflowing(r) && !r.parentOverflows);
}

/**
 * The overflow that actually reaches the viewport: past the right edge, blamed at the shallowest
 * element, and NOT absorbed by a horizontal scroll container of its own.
 *
 * <h3>Why this is a second predicate and not a redefinition of {@link isOverflowing}</h3>
 *
 * `isOverflowing` is the AUDIT's predicate, and the plan's baselines (stock 100 @390, 42 @1024,
 * PO 4 @390) are expressed in it. Changing it would silently redefine every number this phase is
 * measured against, so it stays exactly as it was and this sits beside it.
 *
 * <h3>Why containment is allowed at all</h3>
 *
 * Brief §57 offers two adaptations for a wide table and both are acceptable: *become a card list
 * below `md`*, or *scroll inside your own container with the page still fixed*. `DataGrid` does
 * the first below `md` and the second at `md`–`xl` (its `hideBelow` ladder plus an
 * `overflow-x-auto` wrapper), which is the design 38-02 shipped on purpose. A check that could
 * not tell that from a table dumped onto the page would report 41 offenders on the FIXED screen
 * — and the next person would delete the check rather than the table.
 *
 * <p>What it still catches, unchanged: anything wider than `<main>`, anything clipped by an
 * ancestor that is itself off-screen, and anything merely `overflow: hidden` (contained, but with
 * no way to read what was cut off — see the collector).
 */
/**
 * @param {ViewportRecord[]} records
 * @returns {ViewportRecord[]}
 */
export function viewportEscapees(records) {
  return records.filter((r) => isOverflowing(r) && !r.parentOverflows && !r.scrollContained);
}

/**
 * Interactive elements wholly covered by something that is not them.
 *
 * <p>This is the check that catches the POS cart overlay, and the reason the plan orders the
 * negative control to be run FIRST, against unfixed code: a check for a defect that has never
 * been observed failing is a check nobody has any reason to believe.
 *
 * <p>"Fully covered" means every sampled point was foreign. A control half-covered by a sticky
 * footer is a different (and often intended) thing — a bottom sheet is *supposed* to cover the
 * menu behind it, and the elements it covers are hidden from hit-testing by the sheet, not
 * broken. What is never intended is a control that is painted, announced, focusable, and
 * unreachable by touch at every single point of its box.
 *
 * <h3>…and only where the WHOLE box is on screen</h3>
 *
 * `coverage()` cannot sample a point outside the viewport — `elementFromPoint` returns null
 * there, and a null would read as "not covered". So a control that runs PAST THE FOLD is sampled
 * only across the sliver of it that is on screen, and if fixed bottom chrome happens to sit over
 * that sliver, "every sampled point was foreign" becomes true of a control the user reaches by
 * scrolling. Measured on `/app/dashboard` at 390 against the live deployment 2026-08-22:
 * `a[portlet-owner-sales-trend] 358×286 @16,856` in a 900-high viewport — 44px of it visible,
 * all of it beneath `MobileBottomNav` (`fixed bottom-0 h-16`), 2 of 5 points sampled, both
 * foreign. `<main>` carries `pb-20` precisely so that portlet can be scrolled clear of that nav,
 * so the control is reachable and the verdict was an artefact of WHERE THE PAGE HAPPENED TO BE
 * SCROLLED — a different answer at a different offset, which is a flake, not a finding.
 *
 * <p>So the box must end on screen before a coverage sample is allowed to convict it. This
 * narrows the check by exactly one case — a control both below the fold AND genuinely buried —
 * and that case is unmeasurable at a single scroll offset anyway. It does not touch the defect
 * the check exists for: the POS cart overlays controls that are fully in view, and those still
 * fail. The 2px is the same sub-pixel tolerance `isOverflowing` uses, for the same reason.
 */
/**
 * @param {ViewportRecord[]} records
 * @returns {ViewportRecord[]}
 */
export function occludedInteractives(records) {
  return records.filter(
    (r) =>
      r.interactive &&
      r.coverage.sampled > 0 &&
      r.coverage.covered === r.coverage.sampled &&
      r.rect.bottom <= r.viewport.height + 2 &&
      r.rect.top >= -2,
  );
}

/**
 * Controls smaller than 44×44.
 *
 * <p>The audit's predicate (`audit-38.mjs:106`), which measures the BORDER BOX and therefore
 * credits `min-height`/padding but not a bare `::after` hit-area expander. That is the stricter
 * reading and it is the right one here: this product's `touch-target` utility sets
 * `min-height`/`min-width`, so a control that passes does so honestly.
 */
/**
 * @param {ViewportRecord[]} records
 * @param {number} [min]
 * @returns {ViewportRecord[]}
 */
export function undersizedTargets(records, min = MIN_TARGET) {
  return records.filter(
    (r) =>
      r.interactive &&
      !r.inlineTarget &&
      r.rect.height > 0 &&
      (r.rect.height < min || r.rect.width < min),
  );
}

/**
 * Money and quantity values being clipped to an ellipsis.
 *
 * <p>Both conditions are required. `text-overflow: ellipsis` alone is a *declaration* and most of
 * the ones in this product never fire; the defect is the pairing with content that does not fit,
 * which is what turns `Rs 213,500.00` into `213.5 K` — a number that is not merely shortened but
 * WRONG, and wrong in the direction of looking plausible. The audit photographed exactly that on
 * `/app/inventory/stock`: `90 EACI`, `213.5 K`, `-2987 K`.
 */
/**
 * @param {ViewportRecord[]} records
 * @returns {ViewportRecord[]}
 */
export function truncatedValues(records) {
  return records.filter((r) => r.numeric && r.ellipsis && r.clipping);
}

/**
 * A rendered `<table>` on a viewport narrower than `md`.
 *
 * <p>Only VISIBLE tables count, which is the whole point: `DataGrid` keeps its table in the DOM
 * at every width and lets CSS choose (`hidden md:block`), because choosing in JS from a media
 * query renders one branch on the server and possibly the other on the client — a hydration
 * mismatch on every list screen in the product. The collector has already dropped
 * `display: none` nodes, so a screen that migrated correctly returns none of these and a screen
 * that dropped its desktop table in unchanged returns one.
 */
/**
 * @param {ViewportRecord[]} records
 * @param {number} viewportWidth
 * @returns {ViewportRecord[]}
 */
export function desktopTablesBelowMd(records, viewportWidth) {
  if (viewportWidth >= MD) return [];
  // `rendersAsTable` is what the browser is doing; `isTable` is what the markup says. Older
  // records (and the synthetic ones in the unit suite) carry only the latter, so it is the
  // fallback rather than an alternative.
  return records.filter((r) => (r.rendersAsTable === undefined ? r.isTable : r.rendersAsTable));
}

/** Every check, in one shape, so a caller cannot run four of the five and report a pass. */
/**
 * @param {ViewportRecord[]} records
 * @param {number} viewportWidth
 */
export function analyse(records, viewportWidth) {
  return {
    overflow: overflowOffenders(records),
    overflowBlame: overflowBlame(records),
    escapees: viewportEscapees(records),
    occluded: occludedInteractives(records),
    undersized: undersizedTargets(records),
    truncated: truncatedValues(records),
    tablesBelowMd: desktopTablesBelowMd(records, viewportWidth),
  };
}

/** `{check: count}` — what a spec asserts on and what a report prints. */
/**
 * @param {ReturnType<typeof analyse>} result
 */
export function counts(result) {
  return {
    overflow: result.overflow.length,
    // The number a gate should assert on: `overflow` counts every box whose rect runs past the
    // edge, including the ones a local scroll container has already dealt with.
    escapees: result.escapees.length,
    occluded: result.occluded.length,
    undersized: result.undersized.length,
    truncated: result.truncated.length,
    tablesBelowMd: result.tablesBelowMd.length,
  };
}

/** A one-line human description of an offender, for a failure message worth reading. */
/**
 * @param {ViewportRecord} record
 * @returns {string}
 */
export function describe(record) {
  const id = record.testid ? `[${record.testid}]` : record.slot ? `{${record.slot}}` : "";
  const box = `${Math.round(record.rect.width)}×${Math.round(record.rect.height)}`;
  const label = record.name ? ` "${record.name}"` : "";
  return `${record.tag.toLowerCase()}${id}${label} ${box} @${Math.round(record.rect.left)},${Math.round(record.rect.top)}`;
}

/**
 * Resize, settle, collect, analyse.
 *
 * <p>The settle is not superstition. Every one of these measurements is of a laid-out box, and a
 * `setViewportSize` that is measured in the same tick reports the PREVIOUS layout — which reads
 * as "390px is fine" on a page that was just measured at 1440.
 */
export async function measureAt(page, width, height = 900) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(350);
  const records = await page.evaluate(COLLECT);
  return { width, records, result: analyse(records, width) };
}
