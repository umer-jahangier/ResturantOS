import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { FRONTEND_ROOT, stripComments } from "./module-graph";

/**
 * G5 — every user-visible number and date is formatted through a PINNED locale.
 *
 * <h3>The defect</h3>
 *
 * `new Intl.NumberFormat(undefined, …)` and the bare `value.toLocaleString()` that wraps it
 * resolve differently on the server and in the browser. Next prerenders a `"use client"` page
 * with the server's ICU default, then hydrates against `navigator.language`. For any value
 * >= 1000 or carrying a fraction the group and decimal separators differ — measured, `de-DE`
 * gives `1.234,5` where `en-US` gives `1,234.5` — so the rendered text of the prerender and the
 * rendered text of the hydration disagree on precisely the numbers a stat tile exists to show.
 * That is a hydration text mismatch: React discards the server HTML for that subtree and warns.
 *
 * The reasoning is written out at length in `components/ui/meter.tsx:191-203`, where this was
 * found and fixed once. It came straight back — eleven fresh call sites in the same wave — which
 * is the argument for a gate rather than for another fix.
 *
 * <h3>Why this is a SEPARATE file and not a fifth pattern in `conformance-scan.ts`</h3>
 *
 * `conformance-scan.ts:39-52` walks only `app/` and `components/`, and only `.tsx`. All of
 * `lib/` is invisible to it, which is exactly how an unpinned formatter reached
 * `lib/format/stat-line.ts` with every gate green. The fix is NOT to widen `sourceFiles()`:
 * gates G1–G4 are per-file baselines calibrated against those two trees, and widening the walk
 * would move all four counts for a reason that has nothing to do with type scale, radius,
 * palette or tables. So this gate brings its OWN walk — `app/` + `components/` + `lib/`, `.ts`
 * AND `.tsx` — and leaves the four baselines untouched.
 *
 * <h3>Why zero and not a baseline</h3>
 *
 * G1–G4 are baselines because they inherited ~1,000 pre-existing violations; a ban would have
 * been switched off within a day. This invariant had a countable, finite offender list — 34
 * lines across 18 files, measured by running this gate before fixing anything — so it was paid
 * off in full and the gate asserts ZERO. A baseline here would be a list of files permitted to
 * hydrate wrongly, which is not a thing worth recording.
 *
 * <h3>Scope boundary, deliberate</h3>
 *
 * This gate covers `toLocaleString` and `Intl.*Format`. It does NOT yet cover
 * `toLocaleDateString` / `toLocaleTimeString`, of which 22 unpinned sites remain in these trees.
 * They are the same family of bug, but fixing them is not a locale decision alone — a date also
 * needs a pinned TIME ZONE (an order closed 23:30 in Karachi renders as the previous day in
 * UTC), and the branch zone is plumbed to only some of those call sites today. Widening this
 * regex before that plumbing exists would produce a gate that cannot be made green honestly, so
 * the boundary is stated here rather than left to be discovered.
 *
 * <h3>Negative control — run, OBSERVED RED, then fixed for real</h3>
 *
 * This gate was written and run BEFORE `lib/format/locale.ts` existed. It failed:
 *
 * <pre>
 * FAIL __tests__/lib/theme/locale-pinning.test.ts > G5 — locale pinning
 *      > has no unpinned toLocaleString()
 * AssertionError: unpinned toLocaleString — hydration text mismatch on every value >= 1000.
 *   app/(tenant)/app/inventory/coverage/page.tsx:121 — value={allItems.length.toLocaleString()}
 *   …
 *   lib/format/stat-line.ts:33 — return `${n.toLocaleString()} ${n === 1 ? singular : plural}`;
 * </pre>
 *
 * 34 findings across 18 files — where the review that prompted this gate had enumerated 14 files
 * by hand. The extra four (`usage-panel`, `audit-log`, `TransactionRegister`,
 * `tenant-subscription-card` among them) are the argument for a gate over a checklist. And the
 * last line is `lib/format/stat-line.ts`, a `lib/` file that G1–G4 structurally cannot see, which
 * is the evidence this walk reaches where it claims to.
 *
 * <p>The other two assertions had NO offenders to find, so that run left them vacuously green —
 * an assertion nobody has watched fail is not yet a gate. They were controlled separately: two
 * lines appended to `lib/format/stat-line.ts`, run, OBSERVED RED, removed.
 *
 * <pre>
 * FAIL … > has no Intl.*Format(undefined
 *   lib/format/stat-line.ts:55 — const controlB = new Intl.DateTimeFormat(undefined, {…});
 * FAIL … > has no Intl.*Format() without a locale
 *   lib/format/stat-line.ts:54 — const controlA = new Intl.NumberFormat();
 * </pre>
 *
 * <p>Lines 54 and 55 were where those two lines actually were, which is also the check on
 * {@link stripComments} — a stripper that deleted comment bodies instead of blanking them would
 * have reported some smaller number and sent a reader to the wrong line.
 */

/** `app/` + `components/` + `lib/`, `.ts` and `.tsx` — deliberately NOT `sourceFiles()`. */
export function localeScannedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".ts") || entry.endsWith(".tsx"))
        out.push(relative(FRONTEND_ROOT, full));
    }
  };
  for (const tree of ["app", "components", "lib"]) {
    const full = resolve(FRONTEND_ROOT, tree);
    if (existsSync(full)) walk(full);
  }
  return out.sort();
}

/**
 * `.toLocaleString()`, `.toLocaleString(undefined, …)` and `.toLocaleString([], …)`.
 *
 * All three hand the choice of locale to whatever runtime happens to execute the line — an
 * empty locale list is not "no formatting", it is "the default", which is the whole bug.
 */
export const UNPINNED_TO_LOCALE_STRING = /\.toLocaleString\(\s*(?:\)|undefined\b|\[\s*\])/g;

/** `new Intl.NumberFormat(undefined, …)` — the explicit spelling of the same choice. */
export const INTL_UNDEFINED_LOCALE = /\bIntl\.[A-Za-z]*Format\(\s*undefined\b/g;

/** `new Intl.DateTimeFormat()` — the implicit spelling. */
export const INTL_NO_LOCALE = /\bIntl\.[A-Za-z]*Format\(\s*\)/g;

export interface Finding {
  file: string;
  line: number;
  text: string;
}

/**
 * Comments are stripped before matching, and `module-graph.ts`'s stripper is reused precisely
 * because it PRESERVES LINE NUMBERS — a block comment becomes spaces, not nothing — so a finding
 * can name the line a reader has to open. Stripping is not optional here: several files carry
 * GA-078/GA-007 notes recording past money-formatting bugs, quoting `toLocaleString()` in the
 * prose. A gate that fails a file for accurately describing the bug it fixed teaches people to
 * delete the description.
 */
export function findUnpinned(pattern: RegExp, files = localeScannedFiles()): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    const source = stripComments(readFileSync(resolve(FRONTEND_ROOT, file), "utf8"));
    const lines = source.split("\n");
    lines.forEach((text, index) => {
      const matcher = new RegExp(pattern.source, "g");
      if (matcher.test(text)) findings.push({ file, line: index + 1, text: text.trim() });
    });
  }
  return findings;
}

function render(findings: Finding[]): string {
  return findings.map((f) => `  ${f.file}:${f.line} — ${f.text}`).join("\n");
}

describe("G5 — locale pinning", () => {
  it("walks lib/ and .ts, which the G1–G4 scanner structurally cannot", () => {
    const files = localeScannedFiles();
    expect(files).toContain("lib/format/stat-line.ts");
    expect(files).toContain("lib/adapters/shared.ts");
    expect(files.some((f) => f.endsWith(".tsx"))).toBe(true);
    expect(files.some((f) => f.startsWith("lib/") && f.endsWith(".ts"))).toBe(true);
  });

  it("has no unpinned toLocaleString()", () => {
    const findings = findUnpinned(UNPINNED_TO_LOCALE_STRING);
    expect(
      findings,
      `unpinned toLocaleString — hydration text mismatch on every value >= 1000.\n` +
        `Format through lib/format/locale.ts instead.\n${render(findings)}`,
    ).toEqual([]);
  });

  it("has no Intl.*Format(undefined", () => {
    const findings = findUnpinned(INTL_UNDEFINED_LOCALE);
    expect(
      findings,
      `Intl formatter constructed with an explicit undefined locale.\n${render(findings)}`,
    ).toEqual([]);
  });

  it("has no Intl.*Format() without a locale", () => {
    const findings = findUnpinned(INTL_NO_LOCALE);
    expect(
      findings,
      `Intl formatter constructed with no locale at all.\n${render(findings)}`,
    ).toEqual([]);
  });

  it("does not fire on prose that merely mentions the bug", () => {
    const source = stripComments(
      readFileSync(resolve(FRONTEND_ROOT, "app/(tenant)/app/hr/payroll/page.tsx"), "utf8"),
    );
    expect(source).not.toContain("toLocaleString");
  });
});
