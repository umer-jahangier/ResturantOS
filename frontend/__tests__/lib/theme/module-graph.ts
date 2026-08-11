import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Transitive import closure of a route, resolved the way the app's tsconfig paths do.
 *
 * <p><b>Why a closure and not a grep of the route's own files.</b> D-34-02 forbids a
 * compositing filter in the operational zone, and the way that rule actually gets broken is
 * not by someone adding glass to `pos-terminal.tsx`. It is by someone adding glass to a
 * shared `Card`, or to the shell header, which the POS then renders inside of. Both of those
 * are invisible to a check that only reads the route's own source. When this helper was
 * written, three surfaces were blurring the POS and NONE of them lived under `app/pos/` —
 * they arrived through the back-office layout.
 *
 * <p><b>Why layout ancestors are entry points too.</b> Next.js composes a route from every
 * `layout.tsx` between the route group root and the page. Those layouts are never imported by
 * the page — the framework wraps them around it — so a pure import walk from the page would
 * miss exactly the shell chrome that was the real defect. {@link routeEntries} adds them.
 *
 * <p>Not a general module resolver. It understands the `@/` alias and relative specifiers,
 * which is everything this repo authors. `node_modules` is deliberately out of scope: a
 * third-party module cannot be edited, and the runtime half of the gate covers it by reading
 * computed style in a real browser.
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
  throw new Error("could not locate the frontend root from " + process.cwd());
}

export const FRONTEND_ROOT = locateFrontendRoot();

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;

/** Resolve a file specifier to a real path, trying each extension and `/index`. */
function resolveFile(candidate: string): string | null {
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  for (const ext of EXTENSIONS) {
    const withExt = candidate + ext;
    if (existsSync(withExt) && statSync(withExt).isFile()) return withExt;
  }
  for (const ext of EXTENSIONS) {
    const index = join(candidate, "index" + ext);
    if (existsSync(index) && statSync(index).isFile()) return index;
  }
  return null;
}

/**
 * Resolve one import specifier from one importing file.
 *
 * Returns `null` for a bare package specifier (`react`, `lucide-react`, `radix-ui`) and for
 * non-code assets — both are legitimately outside the closure. Throws for a specifier that
 * LOOKS local (`@/…` or `./…`) but does not resolve, because a silently skipped local module
 * is a hole in the gate and the whole point of this file is that the gate has no holes.
 */
export function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (/\.(css|scss|json|svg|png|jpe?g|webp|woff2?)$/.test(specifier)) return null;

  let candidate: string | null = null;
  if (specifier.startsWith("@/")) {
    candidate = resolve(FRONTEND_ROOT, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    candidate = resolve(dirname(fromFile), specifier);
  } else {
    return null; // bare package specifier — node_modules, out of scope by design
  }

  const resolved = resolveFile(candidate);
  if (!resolved) {
    throw new Error(
      `module-graph: cannot resolve \`${specifier}\` from ` +
        `${relative(FRONTEND_ROOT, fromFile)}. A local specifier that does not resolve is a ` +
        `hole in the containment gate, so this fails loudly rather than skipping it.`,
    );
  }
  return resolved;
}

/** Every import/export/dynamic-import specifier in a source file. */
function specifiersIn(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\bimport\s+[\s\S]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bexport\s+[\s\S]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) if (match[1]) found.push(match[1]);
  }
  return found;
}

/** Strip `/* … *\/` and `// …` so a comment cannot trip a source-text assertion. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

export interface ClosureResult {
  /** Absolute paths of every local module reachable from the entries, entries included. */
  files: string[];
  /** Entry files that did not exist on disk — a stale entry list is itself a gate hole. */
  missingEntries: string[];
}

const MAX_FILES = 4000;

/** Walk the transitive import closure from a set of entry files. */
export function moduleClosure(entries: string[]): ClosureResult {
  const seen = new Set<string>();
  const missingEntries: string[] = [];
  const queue: string[] = [];

  for (const entry of entries) {
    const absolute = resolve(FRONTEND_ROOT, entry);
    const file = resolveFile(absolute);
    if (!file) {
      missingEntries.push(entry);
      continue;
    }
    if (!seen.has(file)) {
      seen.add(file);
      queue.push(file);
    }
  }

  while (queue.length > 0) {
    if (seen.size > MAX_FILES) {
      throw new Error(`module-graph: closure exceeded ${MAX_FILES} files — walk is unbounded`);
    }
    const file = queue.shift() as string;
    const source = readFileSync(file, "utf8");
    for (const specifier of specifiersIn(stripComments(source))) {
      const target = resolveSpecifier(file, specifier);
      if (target && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }

  return { files: [...seen].sort(), missingEntries };
}

/**
 * Entry files for a Next.js app-router route: the page itself plus EVERY `layout.tsx`
 * between the `app/` root and it. The layouts are the reason this function exists — the
 * framework wraps them around the page rather than the page importing them, so they are
 * invisible to an import walk and they are exactly where the POS's blur was coming from.
 */
export function routeEntries(routeDir: string): string[] {
  const entries: string[] = [];
  const abs = resolve(FRONTEND_ROOT, routeDir);

  for (const leaf of ["page.tsx", "layout.tsx", "template.tsx"]) {
    const file = join(abs, leaf);
    if (existsSync(file)) entries.push(file);
  }

  // Walk back up to `app/`, collecting each ancestor layout.
  let dir = dirname(abs);
  const appRoot = resolve(FRONTEND_ROOT, "app");
  for (let up = 0; up < 12; up += 1) {
    for (const leaf of ["layout.tsx", "template.tsx"]) {
      const file = join(dir, leaf);
      if (existsSync(file) && !entries.includes(file)) entries.push(file);
    }
    if (dir === appRoot) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return entries;
}

/** Every `.ts`/`.tsx` file under a directory, recursively. */
export function sourceFilesUnder(dir: string): string[] {
  const root = resolve(FRONTEND_ROOT, dir);
  const out: string[] = [];
  if (!existsSync(root)) return out;

  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      if (name === "node_modules" || name === ".next") continue;
      const full = join(current, name);
      const info = statSync(full);
      if (info.isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?)$/.test(name)) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

export function toRelative(file: string): string {
  return relative(FRONTEND_ROOT, file);
}
