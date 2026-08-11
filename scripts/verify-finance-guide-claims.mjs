#!/usr/bin/env node
/**
 * The finance guide's honesty gate (plan 37-02, D-37-03).
 *
 * D-37-03 asks for a guide a restaurant owner can trust and gives the reason: a guide that lies is
 * worse than no guide, because it is trusted. Hand-written prose about system behaviour drifts the
 * moment behaviour changes and nothing notices. So the guide is not authored as prose — it is
 * authored as a registry of claims, each naming the test that defends it, and this gate refuses to
 * pass unless that relationship holds in BOTH directions plus a third check on literals.
 *
 *   Direction 1 — every claim is defended.  Each `assertedBy` entry must resolve to a file that
 *                 exists, that carries a `GUIDE-CLAIM: <id>` marker, that contains the named test
 *                 identifier, and whose test is NOT disabled/skipped/commented out. An ignored
 *                 test is an unasserted claim wearing a badge.
 *   Direction 2 — every marker is declared.  Any `GUIDE-CLAIM: <id>` found anywhere in the test
 *                 sources must resolve to a registry row, so a claim deleted from the prose cannot
 *                 leave an orphan test behind still proving something nobody reads.
 *   Direction 3 — every literal is real.  Each declared literal (a status code, an error code, an
 *                 account code) must appear in non-test source under services/ or gateway/. A guide
 *                 naming a code the product stopped emitting is exactly the drift this is for.
 *
 * Node standard library only, by design: this runs with no build step and no install, so it cannot
 * be the reason a check is skipped.
 *
 * Usage:  make verify-guide-claims          (the documented entry point — CI and humans, identical)
 *         node scripts/verify-finance-guide-claims.mjs [--quiet]
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = join(REPO_ROOT, "frontend/lib/finance/guide/claims.json");
const MARKER = "GUIDE-CLAIM:";
const CLAIM_ID_RE = /^FIN-GUIDE-\d{4}$/;
const MARKER_RE = /GUIDE-CLAIM:\s*(FIN-GUIDE-\d{4})/g;

const QUIET = process.argv.includes("--quiet");

/** Directories that must never be scanned: build output, dependencies, and agent worktrees. */
const EXCLUDED_DIRS = new Set([
  "node_modules",
  "target",
  ".git",
  ".next",
  "dist",
  "build",
  ".worktrees",
  "worktrees",
  ".gitnexus",
  "__pycache__",
  ".venv",
  "coverage",
  "test-results",
  "playwright-report",
]);

const SCANNED_EXTENSIONS = [".java", ".ts", ".tsx", ".sh", ".mjs", ".js", ".sql", ".py"];

let passCount = 0;
let failCount = 0;
const failures = [];

function pass(direction, claimId, detail) {
  passCount++;
  if (!QUIET) console.log(`PASS  [${direction}] ${claimId} — ${detail}`);
}

function fail(direction, claimId, detail) {
  failCount++;
  const line = `FAIL  [${direction}] ${claimId} — ${detail}`;
  failures.push(line);
  console.log(line);
}

/**
 * Matches JUnit's disable annotations in every form a real file uses them: the bare `@Disabled`,
 * the fully-qualified `@org.junit.jupiter.api.Disabled`, and JUnit 4's `@Ignore`.
 *
 * This exists in this shape because the plan's required negative demonstration CAUGHT THE GATE
 * OUT: the first version matched only the literal `@Disabled`, so disabling a bound test with its
 * fully-qualified name sailed through with PASS: 14, FAIL: 0. A gate that can be bypassed by an
 * import style is not a gate.
 */
const DISABLED_ANNOTATION = /@(?:[\w.]+\.)?(?:Disabled|Ignore)\b/;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Recursively collect candidate files, skipping build output and worktrees. */
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".github") {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Is the named test disabled?
 *
 * Inspects the lines immediately around the test identifier rather than the whole file, because a
 * `@Disabled` on some *other* test in the same class says nothing about this one.
 */
function findDisabledEvidence(content, testIdentifier, file) {
  const lines = content.split("\n");

  // Find the DECLARATION, not merely a mention. A javadoc `{@link #someTest}` elsewhere in the
  // class contains the identifier and lives on a line beginning with `*`, which a naive
  // first-match scan reports as "commented out" — a false FAIL, and a false FAIL is how a gate
  // gets switched off. Comment lines are therefore only accepted if nothing else matches, in
  // which case the test really is commented out.
  const isComment = (l) => /^\s*(\/\/|\*|\/\*|#)/.test(l);
  const matches = [];
  lines.forEach((l, i) => {
    if (l.includes(testIdentifier)) matches.push(i);
  });
  if (matches.length === 0) return { found: false };

  const declarationLike = matches.filter((i) => {
    const l = lines[i];
    if (isComment(l)) return false;
    // Java method declaration, or a TS/playwright test(...) / it(...) with the title.
    return (
      new RegExp(`\\b${escapeRegExp(testIdentifier)}\\s*\\(`).test(l) ||
      /\b(test|it|describe)\s*(\.\s*\w+)?\s*\(/.test(l) ||
      /^\s*(public|private|protected|static|void|async|function)\b/.test(l)
    );
  });

  const idx = declarationLike.length > 0 ? declarationLike[0] : matches[0];
  const lineNo = idx + 1;
  const line = lines[idx];

  // TypeScript / vitest / playwright: test.skip(...), it.skip(...), describe.skip(...), xit(...)
  if (/\b(test|it|describe)\s*\.\s*(skip|todo|fails)\s*\(/.test(line) || /\bx(it|describe)\s*\(/.test(line)) {
    return { found: true, why: "declared with a skip/todo modifier", file, lineNo };
  }

  // A shell assertion commented out.
  if (/^\s*#/.test(line)) {
    return { found: true, why: "the assertion line is commented out", file, lineNo };
  }
  // A Java/TS line commented out.
  if (/^\s*(\/\/|\*)/.test(line)) {
    return { found: true, why: "the test declaration is commented out", file, lineNo };
  }

  // Java: @Disabled on the method, in the few lines above (past annotations and javadoc).
  for (let i = idx - 1; i >= Math.max(0, idx - 6); i--) {
    const above = lines[i];
    if (DISABLED_ANNOTATION.test(above)) {
      return { found: true, why: "annotated @Disabled", file, lineNo: i + 1 };
    }
    // Stop at the previous method's closing brace — do not walk into another test.
    if (/^\s*}\s*$/.test(above)) break;
  }

  // Java: a class-level @Disabled disables every test in it.
  const classDecl = lines.findIndex((l) => /^\s*(public\s+)?(final\s+)?class\s+/.test(l));
  if (classDecl > 0) {
    for (let i = classDecl - 1; i >= Math.max(0, classDecl - 6); i--) {
      if (DISABLED_ANNOTATION.test(lines[i])) {
        return { found: true, why: "the whole class is annotated @Disabled", file, lineNo: i + 1 };
      }
    }
  }

  return { found: false };
}

// ── Load the registry ────────────────────────────────────────────────────────────────────────
if (!existsSync(REGISTRY)) {
  console.error(`FATAL: registry not found at ${REGISTRY}`);
  process.exit(2);
}

let registry;
try {
  registry = JSON.parse(readFileSync(REGISTRY, "utf8"));
} catch (err) {
  console.error(`FATAL: registry is not valid JSON — ${err.message}`);
  process.exit(2);
}

const claims = registry.claims ?? [];
if (claims.length === 0) {
  console.error("FATAL: registry declares no claims");
  process.exit(2);
}

console.log(`Finance guide claim gate — ${claims.length} claim(s) in ${relative(REPO_ROOT, REGISTRY)}\n`);

// ── Direction 1: every claim is defended by a live assertion ─────────────────────────────────
console.log("── Direction 1: every claim is defended ──────────────────────────────────────");
for (const claim of claims) {
  if (!CLAIM_ID_RE.test(claim.id)) {
    fail("defended", claim.id, `id does not match the required shape ${CLAIM_ID_RE}`);
    continue;
  }
  if (!Array.isArray(claim.assertedBy) || claim.assertedBy.length === 0) {
    fail("defended", claim.id, "declares no asserting test — an unbound claim may not ship");
    continue;
  }

  for (const assertion of claim.assertedBy) {
    const abs = join(REPO_ROOT, assertion.file);
    if (!existsSync(abs)) {
      fail("defended", claim.id, `asserting file does not exist: ${assertion.file}`);
      continue;
    }
    const content = readFileSync(abs, "utf8");

    if (!content.includes(`${MARKER} ${claim.id}`) && !new RegExp(`${MARKER}\\s*${claim.id}`).test(content)) {
      fail(
        "defended",
        claim.id,
        `${assertion.file} carries no "${MARKER} ${claim.id}" marker — add it beside the test`,
      );
      continue;
    }

    if (!content.includes(assertion.test)) {
      fail("defended", claim.id, `${assertion.file} does not contain test "${assertion.test}"`);
      continue;
    }

    const disabled = findDisabledEvidence(content, assertion.test, assertion.file);
    if (disabled.found) {
      fail(
        "defended",
        claim.id,
        `test "${assertion.test}" is ${disabled.why} (${assertion.file}:${disabled.lineNo}) — an ignored test is an unasserted claim`,
      );
      continue;
    }

    pass("defended", claim.id, `${assertion.test} (${assertion.file})`);
  }
}

// ── Direction 2: every marker in the tree resolves to a registry row ─────────────────────────
console.log("\n── Direction 2: every marker is declared ─────────────────────────────────────");
const declaredIds = new Set(claims.map((c) => c.id));
const scanRoots = ["services", "frontend", "scripts", "gateway", "shared-lib"]
  .map((d) => join(REPO_ROOT, d))
  .filter((d) => existsSync(d));

let markersFound = 0;
const orphans = [];
for (const root of scanRoots) {
  for (const file of walk(root)) {
    // The registry itself and this gate both mention every id; neither is a marker site.
    if (file === REGISTRY || file === fileURLToPath(import.meta.url)) continue;
    let content;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!content.includes(MARKER)) continue;
    for (const match of content.matchAll(MARKER_RE)) {
      markersFound++;
      const id = match[1];
      if (!declaredIds.has(id)) {
        orphans.push({ id, file: relative(REPO_ROOT, file) });
      }
    }
  }
}

for (const orphan of orphans) {
  fail(
    "declared",
    orphan.id,
    `marker in ${orphan.file} resolves to no registry row — the claim was deleted but its badge survived`,
  );
}
if (orphans.length === 0) {
  pass("declared", `${markersFound} marker(s)`, "every marker resolves to a registry row");
}

// ── Direction 3: every declared literal still appears in product source ──────────────────────
console.log("\n── Direction 3: every literal is real ────────────────────────────────────────");
const productRoots = ["services", "gateway"].map((d) => join(REPO_ROOT, d)).filter((d) => existsSync(d));
const productSources = [];
for (const root of productRoots) {
  for (const file of walk(root)) {
    // Non-test sources only: a literal that exists solely in a test proves nothing about behaviour.
    if (file.includes(`${"/"}src${"/"}test${"/"}`)) continue;
    productSources.push(file);
  }
}

const productBlob = new Map();
for (const file of productSources) {
  try {
    productBlob.set(file, readFileSync(file, "utf8"));
  } catch {
    /* unreadable file — skipped, and its absence can only cause a FAIL, never a false PASS */
  }
}

for (const claim of claims) {
  const literals = claim.literals ?? [];
  if (literals.length === 0) {
    pass("literal", claim.id, "declares no literals");
    continue;
  }
  for (const literal of literals) {
    // Word-boundary matched, not substring matched. A bare `includes("409")` would happily
    // resolve against `4098` or `x409y` and report a PASS for a status code the product never
    // emits — a gate that can pass by accident is not a gate.
    const needle = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(literal)}(?![A-Za-z0-9_])`);
    let where = null;
    for (const [file, content] of productBlob) {
      if (needle.test(content)) {
        where = relative(REPO_ROOT, file);
        break;
      }
    }
    if (where) {
      pass("literal", claim.id, `"${literal}" found in ${where}`);
    } else {
      fail(
        "literal",
        claim.id,
        `"${literal}" appears in no non-test source under services/ or gateway/ — the guide names something the product no longer emits`,
      );
    }
  }
}

// ── Verdict ──────────────────────────────────────────────────────────────────────────────────
console.log("\n─────────────────────────────────────────────────────────────────────────────");
console.log(`claims: ${claims.length}   markers: ${markersFound}   PASS: ${passCount}   FAIL: ${failCount}`);
if (failCount > 0) {
  console.log("\nThe finance guide may not ship in this state:");
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
console.log("Every claim is defended, every marker is declared, every literal is real.");
