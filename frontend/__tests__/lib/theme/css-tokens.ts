import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Reads the design tokens straight out of `app/globals.css`.
 *
 * <p>The point of parsing the real stylesheet rather than re-declaring the palette in a
 * TypeScript fixture is that a fixture drifts. UI-SPEC §3.8 tabulates 53 measured contrast
 * ratios; if the test measured a copy of the palette, the table would keep passing while the
 * shipped CSS quietly regressed. This reads the shipped CSS, so the §3.8 numbers are a gate
 * on the actual product.
 *
 * <p>Not a general CSS parser — it understands exactly the three flat custom-property blocks
 * this file authors (`:root`, `.dark`, `[data-surface="kds"]`), each anchored at column 0.
 */

/** Walk up from the runner's cwd until `app/globals.css` turns up, so the test does not
 *  care whether it is invoked from `frontend/` or from the repo root. */
function locateGlobalsCss(): string {
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    const candidate = resolve(dir, "app/globals.css");
    if (existsSync(candidate)) return candidate;
    const frontend = resolve(dir, "frontend/app/globals.css");
    if (existsSync(frontend)) return frontend;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("could not locate app/globals.css from " + process.cwd());
}

const CSS_PATH = locateGlobalsCss();

export type Scope = "light" | "dark" | "kds";

const SELECTORS: Record<string, RegExp> = {
  root: /^:root\s*\{/m,
  dark: /^\.dark\s*\{/m,
  kds: /^\[data-surface="kds"\]\s*\{/m,
};

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Body of the block whose selector matches `pattern`, brace-matched so nesting is safe. */
function blockBody(css: string, pattern: RegExp, name: string): string {
  const match = pattern.exec(css);
  if (!match) throw new Error(`globals.css: no \`${name}\` block found`);
  const open = css.indexOf("{", match.index);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`globals.css: unbalanced braces in \`${name}\``);
}

/** `--name: value;` pairs. Splits on `;` so multi-line values (shadows) survive. */
function parseDeclarations(body: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const chunk of body.split(";")) {
    const trimmed = chunk.trim();
    if (!trimmed.startsWith("--")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const name = trimmed.slice(0, colon).trim();
    const value = trimmed
      .slice(colon + 1)
      .replace(/\s+/g, " ")
      .trim();
    declarations.set(name, value);
  }
  return declarations;
}

const css = stripComments(readFileSync(CSS_PATH, "utf8"));

export const rawTokens: Record<"root" | "dark" | "kds", Map<string, string>> = {
  root: parseDeclarations(blockBody(css, SELECTORS.root!, ":root")),
  dark: parseDeclarations(blockBody(css, SELECTORS.dark!, ".dark")),
  kds: parseDeclarations(blockBody(css, SELECTORS.kds!, '[data-surface="kds"]')),
};

/** Cascade order per scope. KDS sits on top of `:root` — it is theme-independent by design. */
const CHAIN: Record<Scope, ("root" | "dark" | "kds")[]> = {
  light: ["root"],
  dark: ["dark", "root"],
  kds: ["kds", "root"],
};

/** The value as authored, before `var()` substitution. */
export function rawToken(name: string, scope: Scope = "light"): string {
  for (const block of CHAIN[scope]) {
    const value = rawTokens[block].get(name);
    if (value !== undefined) return value;
  }
  throw new Error(`globals.css: \`${name}\` is not defined in scope \`${scope}\``);
}

/**
 * The fully-substituted value — a literal `oklch(...)` string, which is exactly what
 * `wcagContrastCheck` (and the browser) consumes.
 */
export function token(name: string, scope: Scope = "light"): string {
  let value = rawToken(name, scope);
  for (let depth = 0; value.includes("var("); depth += 1) {
    if (depth > 16) throw new Error(`globals.css: \`${name}\` has a cyclic var() chain`);
    value = value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, ref: string) => rawToken(ref, scope));
  }
  return value;
}

/** Every custom property declared in a scope's own block (not inherited). */
export function tokenNames(block: "root" | "dark" | "kds"): string[] {
  return [...rawTokens[block].keys()];
}
