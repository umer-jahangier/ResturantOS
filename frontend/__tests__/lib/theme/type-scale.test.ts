import { beforeAll, describe, expect, it } from "vitest";

import { buildCss, builtVar, utilityBody } from "./built-css";

/**
 * 38-01 — the type and space bridge (D-38-02, UI-SPEC §2, §3, §3.1).
 *
 * <h3>What this gate is for</h3>
 *
 * `globals.css` declared the eight type roles for eight phases and deliberately withheld them
 * from `@theme`. The audit measured what that cost: **986 Tailwind type-scale classes against
 * 1 contract-token class**, `--text-body` (15px) rendering on **22 text nodes product-wide**
 * while 14px rendered on **1,901** and 12px on **686** — twelve distinct sizes shipping against
 * a contract of eight roles.
 *
 * So this asserts the bridge against the **built** stylesheet, not the source. The failure this
 * is built to catch is the one a source-parsing test cannot see: a role declared in the right
 * shape, in the wrong at-rule, producing a dead custom property and no utility.
 *
 * <h3>Negative controls — run, observed red, restored (D-38-07)</h3>
 *
 * A gate nobody has watched fail is not evidence. Phase 34 shipped six gates that passed against
 * known-broken code, including a positive control that had been *skipping* for weeks. Each of
 * these was performed against this file:
 *
 * 1. `--text-body: 15px` → `14px` in the `@theme` block.
 *    → OBSERVED RED: "role text-body: font-size" expected 15px, received 14px. Restored.
 * 2. Deleted `--text-body--line-height` from the `@theme` block.
 *    → OBSERVED RED: the paired-line-height assertion failed with `null` — and, importantly,
 *      the SIZE assertion still passed, which is the whole reason line-height is asserted
 *      separately rather than being assumed to travel with the size. Restored.
 * 3. Moved the whole `@theme` block back to `:root` (the pre-38-01 state).
 *    → OBSERVED RED: every `utilityBody(...)` returned `null` — "text-body is not a utility".
 *      The `builtVar` half still passed, which is exactly the false green this file exists to
 *      prevent. Restored.
 * 4. Removed `--spacing-md` from the `@theme inline` block.
 *    → OBSERVED RED: "p-md" not generated. Restored.
 */

/** UI-SPEC §3 — the eight roles, verbatim. Sizes in px, line-heights in px. */
const ROLES: Array<{ role: string; size: string; lineHeight: string }> = [
  { role: "display", size: "30px", lineHeight: "36px" },
  { role: "h1", size: "20px", lineHeight: "28px" },
  { role: "h2", size: "16px", lineHeight: "24px" },
  { role: "body", size: "15px", lineHeight: "22px" },
  { role: "small", size: "13px", lineHeight: "18px" },
  { role: "label", size: "11px", lineHeight: "16px" },
  { role: "pos", size: "17px", lineHeight: "24px" },
  { role: "kds", size: "22px", lineHeight: "28px" },
];

/** UI-SPEC §2 — the seven usage steps. */
const SPACE: Array<{ step: string; value: string }> = [
  { step: "xs", value: "4px" },
  { step: "sm", value: "8px" },
  { step: "md", value: "16px" },
  { step: "lg", value: "24px" },
  { step: "xl", value: "32px" },
  { step: "2xl", value: "48px" },
  { step: "3xl", value: "64px" },
];

const CANDIDATES = [
  ...ROLES.map((r) => `text-${r.role}`),
  // The call-site form for spacing. NOT `p-md` — see the space-bridge docblock in globals.css
  // and `sizing-namespace.test.ts`: naming a key inside `--spacing-*` also redefines
  // `max-w-<key>`, which collapsed every dialog in the product to a sliver.
  ...SPACE.map((s) => `p-(--space-${s.step})`),
  ...SPACE.map((s) => `gap-(--space-${s.step})`),
  // The legacy scale, compiled alongside so the "did not re-typeset" assertion is real.
  "text-xs",
  "text-sm",
  "text-base",
];

let css = "";

beforeAll(async () => {
  css = await buildCss(CANDIDATES);
}, 30_000);

describe("38-01 type bridge — the eight roles reach the browser", () => {
  it.each(ROLES)("role text-$role is a real utility carrying $size/$lineHeight", (role) => {
    const body = utilityBody(css, `text-${role.role}`);

    // Assert the utility EXISTS before asserting what it contains. A null body would
    // otherwise make every `toContain` below fail with an unreadable message, and a
    // missing utility is a different defect from a wrong value.
    expect(body, `text-${role.role} is not a utility — is it declared in @theme?`).not.toBeNull();

    expect(body).toContain(`font-size: var(--text-${role.role})`);
    expect(body).toContain(`var(--text-${role.role}--line-height)`);

    // …and the variables those utilities dereference carry the contract values.
    expect(builtVar(css, `--text-${role.role}`), `--text-${role.role} size`).toBe(role.size);
    expect(
      builtVar(css, `--text-${role.role}--line-height`),
      `--text-${role.role} line-height`,
    ).toBe(role.lineHeight);
  });

  it("ships size and line-height together, so a call site cannot take one alone", () => {
    // UI-SPEC §3.1. The 12-distinct-sizes state the audit measured came partly from call sites
    // taking a size and inheriting whatever leading happened to be in scope.
    for (const role of ROLES) {
      const body = utilityBody(css, `text-${role.role}`)!;
      expect(body, `text-${role.role} must set both`).toMatch(/font-size:/);
      expect(body, `text-${role.role} must set both`).toMatch(/line-height:/);
    }
  });

  it("keeps the pre-38-01 `--text-<role>-lh` spelling resolving", () => {
    // kds-type.ts and dashboard-type.ts were written against this name. Breaking it would
    // silently un-typeset the KDS board and the dashboard portlets — both already on-contract.
    for (const role of ROLES) {
      expect(builtVar(css, `--text-${role.role}-lh`), `--text-${role.role}-lh alias`).toBe(
        `var(--text-${role.role}--line-height)`,
      );
    }
  });
});

describe("38-01 space scale — reachable, and namespace-inert", () => {
  // Tailwind v4 escapes the parentheses in the generated class name.
  const escaped = (step: string, prefix: string) => `${prefix}-\\(--space-${step}\\)`;

  it.each(SPACE)("step $step is reachable and equals $value", (step) => {
    expect(utilityBody(css, escaped(step.step, "p")), `p-(--space-${step.step})`).toBe(
      `padding: var(--space-${step.step});`,
    );
    expect(utilityBody(css, escaped(step.step, "gap")), `gap-(--space-${step.step})`).toBe(
      `gap: var(--space-${step.step});`,
    );
    expect(builtVar(css, `--space-${step.step}`)).toBe(step.value);
  });
});

describe("38-01 bridged WITHOUT re-typesetting the product", () => {
  // The reason the bridge was withheld for eight phases was the fear of re-typesetting ~700
  // call sites in one commit. It publishes NEW names; it does not redefine Tailwind's.
  it.each([
    { legacy: "text-xs", expected: "0.75rem" },
    { legacy: "text-sm", expected: "0.875rem" },
    { legacy: "text-base", expected: "1rem" },
  ])("$legacy still resolves to Tailwind's stock $expected", ({ legacy, expected }) => {
    const body = utilityBody(css, legacy);
    expect(body).not.toBeNull();
    const varName = `--${legacy.replace("text-", "text-")}`;
    expect(builtVar(css, varName)).toBe(expected);
  });
});
