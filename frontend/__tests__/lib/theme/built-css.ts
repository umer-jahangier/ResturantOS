import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { compile } from "tailwindcss";

/**
 * Compiles `app/globals.css` through **Tailwind's own compiler** and hands back the
 * stylesheet the browser would actually receive.
 *
 * <h3>Why this exists next to `css-tokens.ts` rather than replacing it</h3>
 *
 * `css-tokens.ts` parses the globals.css SOURCE, which is the right instrument for the
 * question phase 20 asks: "is `--primary-700` authored at the measured lightness?". It is the
 * wrong instrument for the question 38-01 asks: **"does `class="text-body"` actually set 15px
 * in the shipped product?"**
 *
 * The difference is not pedantry. 38-01 moved the eight type roles out of `:root` and into
 * `@theme`, because only `@theme` makes Tailwind emit `text-body` as a utility. A source parser
 * cannot tell the two apart — both are `--text-body: 15px` in a block — but the browser can:
 * one produces a usable class and one produces a dead custom property that 700 call sites will
 * go on ignoring, which is precisely the state the audit measured (`--text-body` rendering on
 * **22 text nodes product-wide**). A token that does not survive the build is not a token, and
 * a test that reads the source cannot notice.
 *
 * <h3>Candidates</h3>
 *
 * Tailwind v4 only emits a utility if something references it, so the caller passes the class
 * names it wants compiled. That is a feature here: asking for `text-body` and getting nothing
 * back is a real failure, not a harness artefact.
 */

function locateFrontendRoot(): string {
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    if (existsSync(resolve(dir, "app/globals.css"))) return dir;
    if (existsSync(resolve(dir, "frontend/app/globals.css"))) return resolve(dir, "frontend");
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("could not locate app/globals.css from " + process.cwd());
}

const ROOT = locateFrontendRoot();

/**
 * Resolves `@import "tailwindcss"` / `@import "tw-animate-css"` to their STYLESHEET entry.
 * `require.resolve` is wrong here — it obeys JS export conditions and returns a `.mjs`, which
 * the CSS parser then rejects on the file's opening `"use strict"`.
 */
async function loadStylesheet(id: string, basedir: string) {
  let file: string;
  if (id.startsWith(".") || id.startsWith("/")) {
    file = resolve(basedir, id);
  } else {
    const pkgDir = resolve(ROOT, "node_modules", id);
    const pkg = JSON.parse(readFileSync(resolve(pkgDir, "package.json"), "utf8"));
    const entry = pkg.exports?.["."]?.style ?? pkg.style ?? pkg.exports?.["."]?.default ?? pkg.main;
    if (!entry) throw new Error(`no stylesheet entry for "${id}"`);
    file = resolve(pkgDir, entry);
  }
  return { path: file, base: dirname(file), content: readFileSync(file, "utf8") };
}

let cached: string | null = null;
let cachedKey = "";

/** The built stylesheet, with `candidates` compiled into real utility rules. */
export async function buildCss(candidates: string[]): Promise<string> {
  const key = candidates.join(",");
  if (cached !== null && cachedKey === key) return cached;
  const source = readFileSync(resolve(ROOT, "app/globals.css"), "utf8");
  const compiler = await compile(source, { base: ROOT, loadStylesheet });
  cached = compiler.build(candidates);
  cachedKey = key;
  return cached;
}

/** The declaration body of `.<utility>`, or null when Tailwind emitted no such rule. */
export function utilityBody(css: string, utility: string): string | null {
  const escaped = utility.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\.${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match ? match[1]!.trim() : null;
}

/** The value of a custom property as emitted into the built stylesheet. */
export function builtVar(css: string, name: string): string | null {
  const match = new RegExp(`${name.replace(/-/g, "\\-")}:\\s*([^;}]+)`).exec(css);
  return match ? match[1]!.trim() : null;
}
