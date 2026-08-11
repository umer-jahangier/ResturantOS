import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

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

const ROLES = ["display", "h1", "h2", "body", "small", "label", "pos", "kds"];

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
