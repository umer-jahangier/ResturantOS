import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { FRONTEND_ROOT, sourceFilesUnder, stripComments, toRelative } from "./module-graph";

/**
 * D-34-05 and D-34-06, as a test rather than a review convention.
 *
 * <p>A review convention does not survive a deadline. The specific shortcut this forecloses is
 * real and tempting: "3D effects" reads as a licence to reach for a rendering engine, and
 * `three` plus `@react-three/fiber` plus `@react-three/drei` is roughly six hundred kilobytes
 * of JavaScript to draw two shadows. D-34-06 defines depth as layered shadows, restrained
 * transforms, in-card parallax and tilt — all of which this phase implements in CSS.
 *
 * <p>Bundle size is a real cost here, not an abstraction: a tablet over restaurant wifi is the
 * device this product runs on.
 *
 * <p><b>Negative control performed (34-04 task 3):</b> `"three": "^0.160.0"` added to
 * `dependencies` → the denylist test failed naming it, and the baseline test failed naming it
 * as an addition. Removed again.
 */

interface Manifest {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

const pkg = JSON.parse(readFileSync(resolve(FRONTEND_ROOT, "package.json"), "utf8")) as Manifest;

/**
 * The dependency set as it stood when phase 34 began. Recorded rather than counted, so a
 * failure NAMES the package instead of reporting that a number moved.
 */
const BASELINE_DEPENDENCIES = [
  "@tanstack/react-query",
  "@tanstack/react-table",
  "@teispace/next-themes",
  "axios",
  "class-variance-authority",
  "clsx",
  "cmdk",
  "colorjs.io",
  "framer-motion",
  "idb",
  "jose",
  "lucide-react",
  "next",
  "next-intl",
  // Added for the TOTP enrolment module: renders the `otpauth://` provisioning URI as a
  // scannable QR. ~19 kB gzipped and no transitive runtime deps, against the alternative of
  // adding zxing to auth-service and returning a base64 PNG of a live credential through the
  // gateway. The enrolment screen shipped with manual key entry only BECAUSE no package here
  // could draw one, and every authenticator app leads with the camera — this is the gap that
  // deferral left. Manual entry and the `otpauth:` link both stay as fallbacks.
  "qrcode",
  "radix-ui",
  "react",
  "react-countup",
  "react-dom",
  "react-hook-form",
  "sonner",
  "tailwind-merge",
  "tw-animate-css",
  "zod",
  "zustand",
].sort();

/**
 * Families D-34-06 forecloses BY NAME. Named rather than pattern-matched because a name in this
 * list is a decision recorded — a future reader sees that `three` was considered and rejected,
 * not merely that it never occurred to anyone.
 */
const FORECLOSED = {
  "3D rendering / scene graphs (D-34-06: depth means shadows, not a rendering engine)": [
    "three",
    "@react-three/fiber",
    "@react-three/drei",
    "babylonjs",
    "@babylonjs/core",
    "regl",
    "ogl",
    "pixi.js",
    "troika-three-text",
  ],
  "animation runtimes (D-34-05: CSS keyframes cover everything this phase needs)": [
    "gsap",
    "animejs",
    "@react-spring/web",
    "react-spring",
    "popmotion",
    "motion",
    "@formkit/auto-animate",
    "auto-animate",
    "velocity-animate",
    "mo-js",
  ],
  "physics engines": ["matter-js", "cannon-es", "@react-three/cannon", "rapier"],
  "vector/lottie players": [
    "lottie-web",
    "lottie-react",
    "@lottiefiles/react-lottie-player",
    "@rive-app/react-canvas",
  ],
} as const;

describe("D-34-05 · the dependency manifest did not grow", () => {
  it("no package was added to dependencies", () => {
    const current = Object.keys(pkg.dependencies).sort();
    const added = current.filter((name) => !BASELINE_DEPENDENCIES.includes(name));
    expect(
      added,
      "A dependency was added during or after phase 34. D-34-05 puts any such addition behind " +
        "a blocking human checkpoint — a package-legitimacy check, then an explicit decision. " +
        "If the addition is intended, add it to BASELINE_DEPENDENCIES in this file with a " +
        "comment saying which plan approved it.\n" +
        added.join("\n"),
    ).toEqual([]);
  });

  it("no package was removed either (the baseline is a fact, not a wish)", () => {
    // A baseline that quietly drifts downward is a baseline nobody is maintaining. framer-motion
    // is expected to leave in 34-08; when it does, this list changes in the same commit.
    const current = Object.keys(pkg.dependencies);
    const removed = BASELINE_DEPENDENCIES.filter((name) => !current.includes(name));
    expect(
      removed,
      "a baselined dependency is gone. If that was deliberate, update BASELINE_DEPENDENCIES in " +
        "the same commit so this list keeps describing reality.\n" +
        removed.join("\n"),
    ).toEqual([]);
  });
});

describe("D-34-06 · the four-hundred-kilobyte shortcut is foreclosed by name", () => {
  for (const [family, packages] of Object.entries(FORECLOSED)) {
    describe(family, () => {
      it.each(packages)("%s is absent", (name) => {
        const found = pkg.dependencies[name] ?? pkg.devDependencies[name];
        expect(
          found,
          `${name} appeared in package.json. "3D" in this phase means layered shadows, ` +
            `restrained transforms, in-card parallax and tilt — all of which ship as CSS. ` +
            `A rendering engine pulled in to draw two shadows is exactly the failure D-34-06 ` +
            `names, and it is ~600kB on a tablet over restaurant wifi.`,
        ).toBeUndefined();
      });
    });
  }

  it("no source file imports a foreclosed package", () => {
    // The manifest is one route in; a transitive or vendored import is another.
    const all = Object.values(FORECLOSED).flat() as string[];
    const files = [
      ...sourceFilesUnder("app"),
      ...sourceFilesUnder("components"),
      ...sourceFilesUnder("lib"),
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const source = stripComments(readFileSync(file, "utf8"));
      for (const name of all) {
        if (new RegExp(`from\\s+["']${name.replace(/[/@.]/g, "\\$&")}(/|["'])`).test(source)) {
          offenders.push(`${toRelative(file)} imports ${name}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("D-34-05 · the framer-motion consumer set has not grown", () => {
  /**
   * EMPTY as of 38-13, and that is the assertion.
   *
   * 34-03 unwired the page-transition island and left three files importing framer-motion,
   * orphaned. 38-13 §4 deleted them. The consumer set is now zero, so this no longer says
   * "the set has not grown" — it says the set is empty, which is a claim that cannot be
   * satisfied by a file nobody happens to import today.
   *
   * The PACKAGE stays. Removing it is a build-surface change that has to move the `24` runtime
   * dependency baseline above in the same commit, deliberately, so that dropping a dependency
   * is measured rather than absorbed.
   */
  const KNOWN_CONSUMERS: string[] = [];

  it("nothing imports it — the island 34-03 orphaned is gone", () => {
    const files = [
      ...sourceFilesUnder("app"),
      ...sourceFilesUnder("components"),
      ...sourceFilesUnder("lib"),
    ];
    const consumers = files
      .filter((f) => /from\s+["']framer-motion["']/.test(stripComments(readFileSync(f, "utf8"))))
      .map(toRelative)
      .sort();

    expect(
      consumers,
      "a framer-motion consumer appeared. 34-03 left three orphaned files importing it and " +
        "38-13 deleted them, so the correct number is zero. Removing the PACKAGE belongs with " +
        "34-08's bundle measurement and must move the dependency-count baseline above; ADDING " +
        "a consumer is what this asserts against.",
    ).toEqual(KNOWN_CONSUMERS);
  });
});
