import { readFileSync } from "node:fs";
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

    for (const cls of DECORATIVE_CLASSES.concat([".vdl-lift"])) {
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
        if (transform && !/^(none)\s*$/.test(transform[1]!.trim())) {
          offenders.push(`${selector} → transform: ${transform[1]!.trim()}`);
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
  const reduced = (() => {
    const start = CSS.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(start, "the reduced-motion block is missing entirely").toBeGreaterThan(-1);
    return CSS.slice(start);
  })();

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
     * This walks lib/hooks and lib/motion, which is where imperative motion belongs by this
     * repo's layering. The primitives added in 34-04 land under lib/hooks/ui and are covered.
     */
    const candidates = [...sourceFilesUnder("lib/hooks"), ...sourceFilesUnder("lib/motion")];
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

  it("framer-motion is reachable from no route", () => {
    // Not removed in this plan — that is a build-surface change belonging with 34-08's bundle
    // measurement. But nothing under app/ or components/ may import it, so it cannot ship.
    const files = [...sourceFilesUnder("app"), ...sourceFilesUnder("components")];
    const importers = files
      .filter((f) => /from\s+["']framer-motion["']/.test(stripComments(readFileSync(f, "utf8"))))
      .map(toRelative)
      // The two page-transition files are the deliberately-orphaned island; nothing references
      // them, so they are unreachable even though they still exist on disk.
      .filter((f) => !f.startsWith("components/shared/page-transition"));

    expect(
      importers,
      "a new framer-motion import appeared. D-34-05 puts any animation dependency behind a " +
        "blocking human checkpoint, and CSS keyframes cover everything this phase needs.\n" +
        importers.join("\n"),
    ).toEqual([]);
  });

  it("the orphaned page-transition island is referenced by nothing", () => {
    const files = [...sourceFilesUnder("app"), ...sourceFilesUnder("components")];
    const referrers = files
      .filter((f) => !toRelative(f).startsWith("components/shared/page-transition"))
      .filter((f) =>
        /from\s+["'][^"']*page-transition/.test(stripComments(readFileSync(f, "utf8"))),
      )
      .map(toRelative);

    expect(
      referrers,
      "PageTransition is wired back into the tree. It wraps every route in the tenant shell, " +
        "which means it animates the POS terminal and the KDS board — the exact D-34-02 " +
        "violation 34-03 removed.\n" +
        referrers.join("\n"),
    ).toEqual([]);
  });
});
