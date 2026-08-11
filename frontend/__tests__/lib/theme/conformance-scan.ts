import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * The scanner behind conformance gates G1–G4 (UI-SPEC §11.1).
 *
 * <h3>Why a baseline that may only decrease, rather than a ban</h3>
 *
 * A ban on `text-sm` fails on the first run against 1,037 existing call sites, so it would be
 * disabled within a day. A per-file baseline that may only decrease makes the existing debt
 * visible, allows each screen plan to pay down its own share, and — the part that matters —
 * **fails the moment a file grows a new one**.
 *
 * That is not hypothetical. The audit counted 986 type-scale classes on 2026-08-12; scanning the
 * same trees at the start of 38-01 counted **1,037**, with bare `rounded` up 145 → 149 and
 * hand-rolled `<table>` up 37 → 39. The drift is ongoing and unattended, which is the argument
 * for the gate rather than for a cleanup.
 *
 * <h3>A file absent from the baseline must score zero</h3>
 *
 * New code is born on-contract. Without this rule the gate is trivially defeated by putting the
 * violation in a new file, which is exactly how the 986 accumulated in the first place.
 */

export function frontendRoot(): string {
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

const ROOT = frontendRoot();

/** Every `.tsx` under `app/` and `components/` — the same two trees the audit counted. */
export function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".tsx")) out.push(relative(ROOT, full));
    }
  };
  for (const tree of ["app", "components"]) {
    const full = resolve(ROOT, tree);
    if (existsSync(full)) walk(full);
  }
  return out.sort();
}

export function read(file: string): string {
  return readFileSync(resolve(ROOT, file), "utf8");
}

/** G1 — Tailwind's stock type scale. The eight contract roles are deliberately NOT matched. */
export const TYPE_SCALE = /\btext-(?:xs|sm|base|lg|xl|2xl|3xl)\b/g;

/**
 * G2 — bare `rounded`, i.e. Tailwind's 4px default, the ONE radius that does not resolve
 * through `--radius`. `rounded-lg`, `rounded-full` etc. are on-ladder and are not matched;
 * the negative lookahead is what tells them apart.
 */
export const BARE_ROUNDED = /\brounded(?![-\w])/g;

/** G3 — raw palette literals, which follow neither the theme nor `--brand-h`. */
export const RAW_PALETTE =
  /\b(?:bg|text|border|ring|from|via|to|fill|stroke|divide)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

/** G4 — hand-rolled tables. `DataGrid`/`DataTable` render the only sanctioned one. */
export const HAND_ROLLED_TABLE = /<table\b/g;

export function countMatches(source: string, pattern: RegExp): number {
  return (source.match(new RegExp(pattern.source, "g")) ?? []).length;
}

/** file → count, omitting zeros so the baseline records only real debt. */
export function scan(pattern: RegExp, files = sourceFiles()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const file of files) {
    const n = countMatches(read(file), pattern);
    if (n > 0) out[file] = n;
  }
  return out;
}

export interface Drift {
  regressions: Array<{ file: string; baseline: number; current: number }>;
  /** Files with no baseline entry that now carry violations — new code born off-contract. */
  newOffenders: Array<{ file: string; current: number }>;
  baselineTotal: number;
  currentTotal: number;
}

export function compare(baseline: Record<string, number>, current: Record<string, number>): Drift {
  const regressions: Drift["regressions"] = [];
  const newOffenders: Drift["newOffenders"] = [];

  for (const [file, count] of Object.entries(current)) {
    const allowed = baseline[file];
    if (allowed === undefined) newOffenders.push({ file, current: count });
    else if (count > allowed) regressions.push({ file, baseline: allowed, current: count });
  }

  const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
  return {
    regressions,
    newOffenders,
    baselineTotal: sum(baseline),
    currentTotal: sum(current),
  };
}
