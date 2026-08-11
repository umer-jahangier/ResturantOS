import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cn, TYPE_ROLES } from "@/lib/utils";
import { frontendRoot } from "@/__tests__/lib/theme/conformance-scan";

/**
 * `cn` must not delete the contract type scale (38-02, UI-SPEC §3).
 *
 * <h3>Why this is its own gate</h3>
 *
 * tailwind-merge keeps the last class per conflict group. 38-01's eight roles are custom theme
 * keys, so an unconfigured tailwind-merge classifies `text-label` by shape — as a **text colour**
 * — and drops it when a real colour follows. `cn("text-label", "text-foreground-secondary")`
 * returned only the colour, and the font size vanished with no error and no warning.
 *
 * The failure is invisible in source review (both classes are right there), invisible to `tsc`,
 * and invisible to any test that asserts on props rather than rendered output. It is only visible
 * in the produced class string, which is what this reads.
 *
 * <h3>Negative control — run, OBSERVED RED, restored</h3>
 *
 * Reverted `lib/utils.ts` to the bare `twMerge(clsx(inputs))`.
 * → OBSERVED RED, 8 failures, first reading:
 *   `text-display survives beside a colour: expected 'text-foreground-secondary' to contain
 *    'text-display'`.
 * Restored, green.
 */

const ROLES = [...TYPE_ROLES];

describe("cn keeps a contract type role beside a colour utility", () => {
  it.each(ROLES)("text-%s survives beside a colour", (role) => {
    const out = cn(`text-${role}`, "text-foreground-secondary");
    expect(out, `text-${role} was swallowed as a colour`).toContain(`text-${role}`);
    expect(out).toContain("text-foreground-secondary");
  });

  // Compared as CLASS TOKENS, not substrings: "text-small" contains the substring "text-sm",
  // so `expect(out).not.toContain("text-sm")` fails against a perfectly correct result. The
  // first draft of this file made exactly that mistake and reported a passing merge as broken.
  const classes = (out: string) => out.split(/\s+/).filter(Boolean);

  it("still collapses a genuine size-vs-size conflict to the last one", () => {
    // The merge must not be disabled wholesale — a caller writing two sizes means the later one.
    expect(classes(cn("text-body", "text-h1"))).toEqual(["text-h1"]);
  });

  it("still lets a contract role override Tailwind's stock scale", () => {
    // The migration path: a call site overriding an inherited `text-sm` with `text-small`.
    expect(classes(cn("text-sm", "text-small"))).toEqual(["text-small"]);
  });

  it("leaves unrelated utilities alone", () => {
    const out = cn("flex items-center", "gap-(--space-md)");
    expect(out).toContain("flex");
    expect(out).toContain("items-center");
    expect(out).toContain("gap-(--space-md)");
  });
});

describe("the fix cannot rot quietly", () => {
  const root = frontendRoot();
  const utils = readFileSync(resolve(root, "lib/utils.ts"), "utf8");
  const globals = readFileSync(resolve(root, "app/globals.css"), "utf8");

  it("cn is built from extendTailwindMerge, not the bare twMerge", () => {
    // The whole defect is a one-line revert away. This names it so the revert cannot be
    // mistaken for a simplification during a cleanup.
    expect(
      utils,
      "lib/utils.ts no longer extends tailwind-merge — every contract type class is being " +
        "silently dropped wherever cn() composes it with a colour. See UI-SPEC §7.2.2.",
    ).toContain("extendTailwindMerge");
    expect(utils).toContain('"font-size"');
  });

  it("the registered roles are EXACTLY the roles globals.css declares", () => {
    // The failure this prevents: a ninth role added to @theme and not registered here. It would
    // work everywhere except inside cn(), on whichever screen adopted it first, with no error.
    const declared = [...globals.matchAll(/^\s+--text-([a-z0-9]+):\s*\d/gm)].map((m) => m[1]!);
    const unique = [...new Set(declared)].sort();
    expect(
      unique,
      "globals.css and lib/utils.ts disagree about the type roles. Register every new role " +
        "in TYPE_ROLES in the same commit that declares it in @theme.",
    ).toEqual([...TYPE_ROLES].sort());
  });
});
