import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { FRONTEND_ROOT, sourceFilesUnder, stripComments, toRelative } from "../theme/module-graph";

/**
 * The static half of the D-34-03 motion gate. The runtime half is
 * `e2e/journeys/reduced-motion.spec.ts`, which runs the same route twice under opposite
 * preferences.
 *
 * <p>What this file exists to make unrepresentable is the invisible-screen defect: an element
 * whose RESTING style is hidden and which relies on a keyframe to reveal itself. Under reduced
 * motion, where D-34-03 requires decorative animation to be absent rather than fast, such an
 * element never appears. It reads as a data-loading bug rather than a motion bug, which is
 * exactly why it survives review — so it is checked structurally here rather than trusted.
 *
 * <p><b>Negative controls performed (34-03 task 3), each observed red then restored:</b>
 * <ol>
 *   <li>`opacity: 0` added as a resting declaration on `.vdl-enter` → the resting-state
 *       assertion failed, naming the class.</li>
 *   <li>The reduced-motion `animation: none` block replaced by a shortened duration → the
 *       absence assertion failed.</li>
 *   <li>`.vdl-enter` unscoped from `[data-zone="expressive"]` → the duration-ceiling
 *       assertion failed.</li>
 * </ol>
 */

const CSS_PATH = resolve(FRONTEND_ROOT, "app/globals.css");
const CSS = readFileSync(CSS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Duration tokens that exceed phase 20's 240ms ceiling. Expressive-only by D-34-02. */
const OVER_CEILING_TOKENS = ["--motion-entrance", "--motion-reveal"];

/** The decorative animation classes. These must be ABSENT under reduced motion, not fast. */
const DECORATIVE_CLASSES = [".vdl-enter", ".vdl-enter-scale", ".vdl-reveal", ".vdl-stagger"];

/**
 * The BODY of an at-rule, brace-matched — not `CSS.slice(indexOf(prelude))`.
 *
 * Written after watching the slice-to-end-of-file form pass a negative control it had to fail.
 * 38-13's reduced-motion assertion collapsed `::view-transition-*` from `animation: none` to
 * `animation-duration: 1ms` and stayed green, because the "reduced-motion block" it was reading
 * ran to EOF and therefore contained the `@media print` block appended below it — which
 * legitimately declares `animation: none` on the very same selectors. The gate was reading a
 * rule from a different at-rule and reporting on this one.
 *
 * This is the third recorded instance of the same species in this file's history: 34-03's
 * "within 400 characters" proximity match, this one, and the type-annotation false positive in
 * `zone-containment.test.ts`. A gate that names a block must be bounded by that block.
 */
function atRuleBody(prelude: string): string {
  const at = CSS.indexOf(prelude);
  expect(at, `${prelude} is missing from globals.css entirely`).toBeGreaterThan(-1);
  const open = CSS.indexOf("{", at);
  expect(open, `${prelude} has no body`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = open; i < CSS.length; i += 1) {
    if (CSS[i] === "{") depth += 1;
    else if (CSS[i] === "}") {
      depth -= 1;
      if (depth === 0) return CSS.slice(open + 1, i);
    }
  }
  throw new Error(`${prelude} is unbalanced`);
}

/** Split the stylesheet into `{ selector, body }` for every plain rule. */
function rules(): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(CSS)) !== null) {
    out.push({
      selector: match[1]!.replace(/\s+/g, " ").trim(),
      body: match[2]!.trim(),
    });
  }
  return out;
}

describe("D-34-02 · the 240ms ceiling still binds outside the expressive zone", () => {
  it.each(OVER_CEILING_TOKENS)("%s is only reachable from an expressive selector", (tokenName) => {
    const consumers = rules().filter(
      (r) => r.body.includes(`var(${tokenName})`) && !r.selector.startsWith(":root"),
    );

    expect(
      consumers.length,
      `nothing consumes ${tokenName} — the ceiling assertion would pass vacuously`,
    ).toBeGreaterThan(0);

    const unscoped = consumers.filter(
      (r) => !/\[data-zone=["']?expressive["']?\]/.test(r.selector),
    );
    expect(
      unscoped.map((r) => r.selector),
      `${tokenName} exceeds §3.12's 240ms ceiling and may only be reached from the expressive ` +
        `zone. The ceiling exists because an operator navigates ~200 times a shift; extending ` +
        `it for a login screen is fine, extending it for a list page is not.`,
    ).toEqual([]);
  });

  it("the four phase-20 durations are unchanged", () => {
    // These are additions BESIDE phase 20's vocabulary, never replacements.
    for (const [name, value] of [
      ["--motion-instant", "0ms"],
      ["--motion-fast", "120ms"],
      ["--motion-base", "180ms"],
      ["--motion-slow", "240ms"],
    ]) {
      expect(CSS).toContain(`${name}: ${value}`);
    }
  });
});

describe("D-34-03 · the resting-state contract", () => {
  it("no animation class sets a hidden resting style", () => {
    /*
     * THE assertion of this file. An element that depends on its animation to become visible
     * is invisible to: a reduced-motion user, a backgrounded tab, a paused compositor, and
     * anyone whose animation simply failed to run.
     *
     * Only NON-reduced-motion rules are checked. Inside the reduced-motion block a
     * `transform: none !important` is a RESET toward the resting state, not away from it.
     */
    const reducedBlockStart = CSS.indexOf("@media (prefers-reduced-motion: reduce)");
    const offenders: string[] = [];

    for (const cls of DECORATIVE_CLASSES.concat([".vdl-lift", ".vdl-tilt"])) {
      const pattern = new RegExp(`([^{}]*\\${cls}[^{}]*)\\{([^{}]*)\\}`, "g");
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(CSS)) !== null) {
        if (reducedBlockStart !== -1 && match.index > reducedBlockStart) continue;
        const selector = match[1]!.replace(/\s+/g, " ").trim();
        if (selector.includes(":hover")) continue; // a hover state is not a resting style
        const body = match[2]!;

        if (/opacity:\s*0(\D|$)/.test(body)) offenders.push(`${selector} → opacity: 0`);
        if (/visibility:\s*hidden/.test(body)) offenders.push(`${selector} → visibility: hidden`);

        const transform = /transform:\s*([^;]+)/.exec(body);
        if (transform) {
          const value = transform[1]!.trim();
          /*
           * A resting transform is permitted ONLY when it is the identity for every dynamic
           * part — i.e. every var() in it falls back to a no-op. `.vdl-tilt` is the case this
           * allows: `perspective(900px) rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y,
           * 0deg))` renders flat when the hook is inert, which is exactly the resting-state
           * contract rather than an exception to it.
           *
           * A literal offset — `translateY(10px)`, `scale(0.9)` — is still rejected, because
           * that is a displacement nothing will undo if the animation does not run.
           */
          const identity =
            value === "none" ||
            (/var\(/.test(value) &&
              !/(?:translate|scale|rotate|skew)[XYZ3d]*\(\s*(?!0(?:deg|px|%|\b))(?!var\()[^)]/.test(
                value,
              ) &&
              (value.match(/var\([^,)]+,\s*(0deg|0px|0|1)\s*\)/g) ?? []).length ===
                (value.match(/var\(/g) ?? []).length);

          if (!identity) offenders.push(`${selector} → transform: ${value}`);
        }
      }
    }

    expect(
      offenders,
      "An animated element's RESTING style must be its FINISHED style — the offset belongs in " +
        "the keyframe's opening frame, not on the class. Authoring it the other way renders a " +
        "blank screen for every reduced-motion user, and it reads as a data-loading bug rather " +
        "than a motion bug.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("every decorative keyframe's CLOSING frame is empty (the element's own style)", () => {
    for (const name of ["vdlEnter", "vdlEnterScale", "vdlReveal"]) {
      const block = new RegExp(`@keyframes\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`, "m").exec(CSS);
      expect(block, `@keyframes ${name} not found`).not.toBeNull();
      const body = block![1]!;
      expect(
        /\bto\s*\{|100%\s*\{/.test(body),
        `@keyframes ${name} declares a closing frame. It should declare only \`from\`, so the ` +
          `animation ends at whatever the element's own style already is — that is what makes ` +
          `deleting the animation safe.`,
      ).toBe(false);
      expect(/\bfrom\s*\{/.test(body), `@keyframes ${name} must declare a from frame`).toBe(true);
    }
  });
});

describe("D-34-03 · reduced motion removes decorative animation, it does not shorten it", () => {
  // Was `CSS.slice(indexOf(...))` — correct only while this was the last block in the file.
  // 38-13 appended an `@media print` block after it, and that silently widened this gate to
  // include rules it does not own. Brace-matched now. See `atRuleBody` above.
  const reduced = atRuleBody("@media (prefers-reduced-motion: reduce)");

  /**
   * Rules inside the reduced-motion block, parsed rather than pattern-matched by proximity.
   *
   * The first version of this used a "class name within 400 characters of `animation: none`"
   * regex, and it passed when the block was edited to `animation-duration: 1ms` — because a
   * DIFFERENT nearby rule (`.skeleton`) supplied the `animation: none` it matched. Found by
   * running that exact negative control. A proximity match across rule boundaries is not an
   * assertion about the rule you think you are asserting about.
   */
  const reducedRules = (() => {
    const out: { selector: string; body: string }[] = [];
    const pattern = /([^{}]+)\{([^{}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(reduced)) !== null) {
      out.push({
        selector: match[1]!.replace(/\s+/g, " ").trim(),
        body: match[2]!,
      });
    }
    return out;
  })();

  it.each(DECORATIVE_CLASSES)("%s is set to animation: none", (cls) => {
    // "Absent, not fast" (D-34-03). A two-frame flourish is still a vestibular trigger and
    // still a paint.
    const owning = reducedRules.filter((r) => r.selector.includes(cls));
    expect(
      owning.length,
      `no rule in the reduced-motion block mentions ${cls} at all`,
    ).toBeGreaterThan(0);

    const removes = owning.some((r) => /animation:\s*none/.test(r.body));
    expect(
      removes,
      `${cls} must be removed outright under reduced motion, not collapsed to a short duration. ` +
        `Rules found:\n` +
        owning.map((r) => `  ${r.selector} { ${r.body.trim()} }`).join("\n"),
    ).toBe(true);
  });

  it("the global 0.01ms safety net is retained BELOW the explicit rules", () => {
    // The explicit rules name what this phase authored; the net catches third-party and
    // legacy animation, and anything added later that forgets this block exists.
    const netAt = reduced.indexOf("animation-duration: 0.01ms");
    const explicitAt = reduced.indexOf("animation: none");
    expect(netAt, "phase 20's global reduced-motion net was removed").toBeGreaterThan(-1);
    expect(
      explicitAt < netAt,
      "the explicit removals must precede the global net so they are not merely duplicated by it",
    ).toBe(true);
  });

  it("the perpetual loading shimmer stops", () => {
    // A shimmer runs forever. Under reduced motion that is a permanent animation on screen.
    expect(/\.skeleton\s*\{[^}]*animation:\s*none/.test(reduced)).toBe(true);
  });
});

describe("D-34-03 · imperative motion consults the preference itself", () => {
  it("every module writing a transform from JavaScript imports useReducedMotion", () => {
    /*
     * A CSS media query cannot reach a transform written from an event handler, so the
     * stylesheet's reduced-motion block does nothing for imperative motion. Each such module
     * has to consult the preference itself.
     *
     * This walks lib/hooks, which is where imperative motion belongs by this repo's layering.
     * The primitives added in 34-04 land under lib/hooks/ui and are covered.
     *
     * `lib/motion` was walked here too until 38-13 deleted it with the page-transition island.
     * `sourceFilesUnder` returns [] for a missing directory rather than throwing, so a stale
     * entry here would be a silent no-op — a walk that reads nothing and reports success. It is
     * removed rather than left as a comment, because the next person to add imperative motion
     * needs the list to name directories that exist.
     */
    const candidates = sourceFilesUnder("lib/hooks");
    const offenders: string[] = [];

    for (const file of candidates) {
      const rel = toRelative(file);
      if (rel.includes("use-reduced-motion")) continue;
      const source = stripComments(readFileSync(file, "utf8"));

      // A module writes imperative motion if it assigns to style.transform or sets a
      // transform-valued custom property on an element.
      const writesTransform =
        /\.style\.(transform|setProperty\(\s*["']transform)/.test(source) ||
        /setProperty\(\s*["']--[\w-]*(tilt|parallax|lift)/.test(source);

      if (writesTransform && !/useReducedMotion/.test(source)) {
        offenders.push(rel);
      }
    }

    expect(
      offenders,
      "These modules write a transform from JavaScript but never read the reduced-motion " +
        "preference. A stylesheet rule cannot reach them, so an animation they drive runs for " +
        "a user who explicitly asked for none.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});

describe("D-34-05 · no animation dependency was added", () => {
  const pkg = JSON.parse(readFileSync(resolve(FRONTEND_ROOT, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it.each([
    "gsap",
    "animejs",
    "@react-spring/web",
    "react-spring",
    "motion",
    "lottie-web",
    "@lottiefiles/react-lottie-player",
    "three",
    "@react-three/fiber",
    "@react-three/drei",
    "popmotion",
    "auto-animate",
    "@formkit/auto-animate",
  ])("%s is not a dependency", (name) => {
    // Named explicitly rather than checked as a count: a name in this list is a decision
    // recorded, and D-34-06 forecloses the three.js entries specifically — "3D" in this phase
    // means layered shadows and restrained transforms, not a rendering engine.
    expect(pkg.dependencies[name] ?? pkg.devDependencies[name]).toBeUndefined();
  });

  it("framer-motion is imported by nothing at all", () => {
    /*
     * STRENGTHENED by 38-13, which deleted the island this used to make an exception for.
     *
     * 34-03 unwired `PageTransition` but left it on disk, and recorded why: leaving it WIRED
     * was the defect, and deleting a file is a different review than unwiring one. That
     * follow-up is this plan (§4). With `page-transition.tsx`, `page-transition-motion.tsx`
     * and `lib/motion/variants.ts` gone, the exception list is gone with them and the
     * assertion is now the strongest form it can take: ZERO importers, no carve-outs.
     *
     * `framer-motion` deliberately STAYS in package.json. `dependency-budget.test.ts` asserts
     * the runtime dependency count is exactly 24 and would fail on a removal that did not move
     * the baseline in the same commit — which is the point: dropping a dependency is a
     * build-surface decision with its own measurement, not a side effect of a design plan.
     */
    const files = [
      ...sourceFilesUnder("app"),
      ...sourceFilesUnder("components"),
      ...sourceFilesUnder("lib"),
    ];
    const importers = files
      .filter((f) => /from\s+["']framer-motion["']/.test(stripComments(readFileSync(f, "utf8"))))
      .map(toRelative);

    expect(
      importers,
      "a framer-motion import appeared. D-34-05 puts any animation dependency behind a " +
        "blocking human checkpoint, and CSS keyframes cover everything this phase needs.\n" +
        importers.join("\n"),
    ).toEqual([]);
  });

  it("the page-transition island is deleted, not merely unreferenced", () => {
    /*
     * The removal half of §4, asserted as ABSENCE FROM DISK rather than absence of importers.
     *
     * An unreferenced file passes every import check ever written and is still one `import`
     * away from wrapping the whole tenant shell — POS and KDS included — in a 350ms
     * `fadeSlideUp`. §3.12 settled that with arithmetic an operator navigates ~200 times a
     * shift and pays the duration every time. The file not existing is the only version of
     * this that a moment of convenience cannot undo.
     */
    for (const orphan of [
      "components/shared/page-transition.tsx",
      "components/shared/page-transition-motion.tsx",
      "lib/motion/variants.ts",
    ]) {
      expect(
        existsSync(resolve(FRONTEND_ROOT, orphan)),
        `${orphan} is back on disk. It is the only framer-motion consumer this codebase has ` +
          `ever had, and an unwired page transition is one import away from being a wired one.`,
      ).toBe(false);
    }
  });
});

describe("D-38-01 · depth is achromatic, so a gold glow cannot come back as a fourth level", () => {
  /*
   * The gate behind 38-13's first conflict resolution. The reasoning lives beside the tokens in
   * `globals.css`; this is the half that makes the rejected option unrepresentable rather than
   * merely discouraged.
   *
   * The demo declares `--glow-primary: 0 0 32px rgba(232,160,69,0.2)` and REFERENCES IT ZERO
   * TIMES — it is one of five dead tokens out of 39. What actually paints is two hand-inlined
   * glows that disagree with each other and with the token: `0 0 20px rgba(232,160,69,.3)` on
   * `.btn-primary:hover` and `0 0 16px rgba(232,160,69,.3)` on `.pay-btn.cash:hover`, the
   * CHARGE button, on a touchscreen where `:hover` never resolves under a finger.
   *
   * Every shadow token in this stylesheet is two layers at chroma 0, by phase 20's elevation
   * rule and phase 34's depth rule, so depth never tints the surface beneath it. A chromatic
   * shadow is a new depth treatment, which D-38-01 forecloses.
   */
  const SHADOW_TOKEN = /^\s*(--(?:elev|depth|shadow)-[\w-]+)\s*:\s*([^;]+);/gm;

  const declarations = (() => {
    const out: { name: string; value: string }[] = [];
    let match: RegExpExecArray | null;
    const pattern = new RegExp(SHADOW_TOKEN.source, "gm");
    while ((match = pattern.exec(CSS)) !== null) {
      out.push({ name: match[1]!, value: match[2]!.replace(/\s+/g, " ").trim() });
    }
    return out;
  })();

  it("finds the shadow tokens at all (a scan that reads nothing passes anything)", () => {
    // Light and dark both redeclare --elev-* and --depth-*, so the real count is well above
    // the eight distinct names.
    expect(declarations.length).toBeGreaterThan(10);
    expect(declarations.map((d) => d.name)).toContain("--depth-lift-shadow");
  });

  it("every oklch() layer in a shadow token has chroma 0", () => {
    const offenders: string[] = [];
    for (const { name, value } of declarations) {
      // `--depth-lift-y: -3px` and `--shadow-*: var(--depth-*)` carry no colour; skip cleanly
      // rather than reporting them, so the failure list only ever names real colour.
      for (const layer of value.matchAll(/oklch\(\s*([^)]+)\)/g)) {
        const parts = layer[1]!.split("/")[0]!.trim().split(/\s+/);
        const chroma = Number(parts[1]);
        if (!Number.isFinite(chroma) || chroma !== 0) {
          offenders.push(`${name} → oklch(${layer[1]!.trim()}) has chroma ${parts[1]}`);
        }
      }
    }
    expect(
      offenders,
      "A shadow that carries chroma tints the surface under it and stops being depth. The " +
        "demo's gold glow was rejected on exactly this ground (see the tombstone in " +
        "globals.css); reintroducing it as a --depth-* token is the quiet way back in.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("no shadow token uses an off-system colour space", () => {
    // rgb()/hsl()/#hex cannot be checked for chroma by the rule above, so they are refused
    // outright — which is also the form the demo's glow is written in.
    const offenders = declarations
      .filter(({ value }) => /\b(rgba?|hsla?)\(|#[0-9a-fA-F]{3,8}\b/.test(value))
      .map(({ name, value }) => `${name}: ${value}`);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("declares no --glow-* token", () => {
    const glows = [...CSS.matchAll(/^\s*(--glow-[\w-]+)\s*:/gm)].map((m) => m[1]!);
    expect(
      glows,
      "38-13 rejected the demo's gold glow and wrote down why. If it is genuinely wanted, " +
        "reopen that decision in the tombstone above the depth tokens — do not add the token " +
        "and leave the paragraph saying it does not exist.",
    ).toEqual([]);
  });
});

describe("D-38-14 · the theme reveal cannot reach the print path or a reduced-motion user", () => {
  /*
   * The view transition is the one animation in this product that covers the whole viewport,
   * and it is driven from JavaScript inside `@teispace/next-themes`. Two things follow.
   *
   * ONE — the global reduced-motion net cannot see it. `*, ::before, ::after` matches
   * ELEMENTS. `::view-transition-*` is a tree-abiding pseudo-element tree parented to the
   * snapshot containing block and no `*` selector in this stylesheet matches it. Without an
   * explicit rule, the fork's own JS check is a single point of failure.
   *
   * TWO — while it runs, `::view-transition-group(*)` is animated with a UA-authored transform
   * inside its own stacking and containment context. `receipt-print.css` pins `.receipt-root`
   * to `position: fixed` and names a transformed ancestor as the thing that breaks it. Nothing
   * in `zone-containment.test.ts` can catch this: there is no `transform:` in anybody's source
   * to grep for. `receipt-view.tsx` auto-fires `window.print()` from a rAF on mount, so the
   * race is real rather than theoretical.
   */
  const printBlock = atRuleBody("@media print");
  const reducedBlock = atRuleBody("@media (prefers-reduced-motion: reduce)");

  it("the two blocks are disjoint (this gate read across them once, and passed wrongly)", () => {
    // The control that caught it: each block declares `animation: none` on the SAME
    // `::view-transition-*` selectors for different reasons, so an unbounded read of either one
    // is satisfied by the other's rule. Asserting they do not overlap is what makes the two
    // assertions below independent rather than one assertion counted twice.
    expect(printBlock).not.toContain("prefers-reduced-motion");
    expect(reducedBlock).not.toContain("@media print");
    expect(reducedBlock).toContain(".skeleton");
    expect(printBlock).not.toContain(".skeleton");
  });

  it("print suppresses the root's view-transition-name", () => {
    // A transition STARTING during print then captures nothing.
    expect(
      /view-transition-name:\s*none\s*!important/.test(printBlock),
      "a theme reveal that starts during a print run prints app chrome onto a customer's bill",
    ).toBe(true);
  });

  it.each([
    ["@media print", () => printBlock],
    ["@media (prefers-reduced-motion: reduce)", () => reducedBlock],
  ])("%s removes the view-transition pseudo animations outright", (_label, blockOf) => {
    const block = blockOf();
    // Anchored to a rule that actually names the pseudo-element, not to `animation: none`
    // appearing somewhere nearby — the proximity-matching mistake recorded above, which passed
    // on a negative control because a DIFFERENT rule supplied the text it matched.
    const rule = /([^{}]*::view-transition-[\w-]+\([^)]*\)[^{}]*)\{([^{}]*)\}/g;
    const owning = [...block.matchAll(rule)];
    expect(
      owning.length,
      "no rule here names a ::view-transition-* pseudo-element",
    ).toBeGreaterThan(0);
    expect(
      owning.some((m) => /animation:\s*none\s*!important/.test(m[2]!)),
      "removed, not shortened — a 1ms circular wipe is still a circular wipe, and a " +
        "half-composited snapshot is still what gets printed",
    ).toBe(true);
  });

  it("the theme provider never hands the fork a raw `css` escape hatch", () => {
    /*
     * `TransitionOptions.css` (types-Cm_0mzdd.d.ts) replaces the built-in pseudo-element CSS
     * wholesale with a caller-supplied string, injected into <head> for the duration. That
     * string is the one way to reintroduce a filter or a transform on the snapshot tree
     * without it appearing in any stylesheet this repo's gates read.
     */
    const provider = readFileSync(
      resolve(FRONTEND_ROOT, "components/providers/theme-provider.tsx"),
      "utf8",
    );
    expect(stripComments(provider)).not.toMatch(/\bcss\s*:/);
  });
});

describe("§34 / 38-13 · hover is never the only channel", () => {
  /**
   * "Never make hover the only way to understand functionality" (38-13 task 2).
   *
   * This product's operators are the reason that sentence is not boilerplate. A POS register and
   * a KDS board are TOUCHSCREENS: `:hover` resolves for nobody standing at one. An affordance
   * that only exists on hover is an affordance the people who use this software most never see —
   * and the failure is silent, because every developer building it has a mouse.
   *
   * So a control hidden at rest must be revealed by something OTHER than a pointer as well:
   * `focus-visible` / `focus-within` for the keyboard, or simply not being fully hidden. This
   * scans class STRINGS, because that is the only way a Tailwind utility reaches the DOM; prose
   * naming a class is not a class.
   */
  const HIDDEN_AT_REST = /(^|\s)(opacity-0|invisible)(\s|$)/;
  const POINTER_REVEAL = /(^|\s)(group-)?hover:(opacity-100|visible)/;
  const NON_POINTER_REVEAL =
    /(^|\s)(group-)?(focus|focus-visible|focus-within|peer-focus|peer-focus-visible):(opacity-100|visible)/;

  it("no element is revealed by hover alone", () => {
    const offenders: string[] = [];
    for (const file of [...sourceFilesUnder("app"), ...sourceFilesUnder("components")]) {
      const source = stripComments(readFileSync(file, "utf8"));
      for (const literal of source.matchAll(/["'`]([^"'`\n]*)["'`]/g)) {
        const cls = literal[1]!;
        if (!HIDDEN_AT_REST.test(cls) || !POINTER_REVEAL.test(cls)) continue;
        if (NON_POINTER_REVEAL.test(cls)) continue;
        offenders.push(`${toRelative(file)} — ${cls}`);
      }
    }

    expect(
      offenders,
      "This element is invisible until a POINTER hovers it. There is no pointer on a POS " +
        "register or a KDS board, and a keyboard user never triggers it either. Give it a " +
        "focus-visible counterpart, or leave it faintly visible at rest — see " +
        "`components/dashboard/portlets/portlet.tsx`, which does both.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the scan reads real class strings (it found the portlet arrow before it was fixed)", () => {
    // Anchor. A scan whose regexes stop matching passes silently and forever, and this one is
    // guarding a defect that is invisible to anyone reviewing it on a laptop.
    const portlet = stripComments(
      readFileSync(resolve(FRONTEND_ROOT, "components/dashboard/portlets/portlet.tsx"), "utf8"),
    );
    const arrow = [...portlet.matchAll(/["'`]([^"'`\n]*)["'`]/g)]
      .map((m) => m[1]!)
      .find((c) => POINTER_REVEAL.test(c));
    expect(arrow, "the portlet drill arrow no longer carries a hover reveal at all").toBeDefined();
    expect(NON_POINTER_REVEAL.test(arrow!), "the portlet arrow lost its non-pointer channel").toBe(
      true,
    );
  });
});
