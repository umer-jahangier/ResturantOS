import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CLAIM_ID_PATTERN,
  allClaims,
  claimById,
  claimsBySurface,
  type FinanceGuideClaim,
} from "@/lib/finance/guide/claims";

/**
 * The registry's own guarantees (plan 37-02, D-37-03).
 *
 * This suite checks the registry is well-formed and internally honest. It deliberately does NOT
 * check that the named tests pass or that the named literals exist in service code — those are
 * the gate's job (`make verify-guide-claims`), because they require reading the whole repository
 * and a vitest run should not depend on that.
 */

/** The repository root, two levels above `frontend/`'s vitest cwd. */
const REPO_ROOT = resolve(process.cwd(), "..");

const claims = allClaims();

describe("finance guide claim registry", () => {
  it("parses, and every row carries the required fields", () => {
    expect(claims.length).toBeGreaterThan(0);
    for (const c of claims) {
      expect(typeof c.id, `${c.id}: id`).toBe("string");
      expect(typeof c.surface, `${c.id}: surface`).toBe("string");
      expect(c.claim.trim().length, `${c.id}: claim must not be empty`).toBeGreaterThan(0);
      if (c.why !== undefined) expect(typeof c.why).toBe("string");
      expect(Array.isArray(c.literals), `${c.id}: literals must be an array`).toBe(true);
      expect(c.assertedBy.length, `${c.id}: MUST name at least one asserting test`).toBeGreaterThan(
        0,
      );
      for (const a of c.assertedBy) {
        expect(a.file.trim().length, `${c.id}: assertedBy.file`).toBeGreaterThan(0);
        expect(a.test.trim().length, `${c.id}: assertedBy.test`).toBeGreaterThan(0);
      }
    }
  });

  it("has no duplicate ids", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const c of claims) {
      if (seen.has(c.id)) duplicates.push(c.id);
      seen.add(c.id);
    }
    expect(duplicates).toEqual([]);
  });

  it("gives every claim an id of the fixed shape", () => {
    // The shape has to survive being embedded in a Java comment, a vitest title and a shell
    // script, and has to be greedy-safe to grep. Four digits, no slug — see claims.json _readme.
    for (const c of claims) {
      expect(c.id, `${c.id} does not match ${CLAIM_ID_PATTERN}`).toMatch(CLAIM_ID_PATTERN);
    }
  });

  it("names an asserting file that actually exists in the repository", () => {
    const missing: string[] = [];
    for (const c of claims) {
      for (const a of c.assertedBy) {
        if (!existsSync(resolve(REPO_ROOT, a.file))) missing.push(`${c.id} -> ${a.file}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("exposes claims grouped by surface, because the guide renders per tab", () => {
    const grouped = claimsBySurface();
    const regrouped = Object.values(grouped).flat();
    expect(regrouped).toHaveLength(claims.length);
    for (const [surface, rows] of Object.entries(grouped)) {
      for (const row of rows as FinanceGuideClaim[]) {
        expect(row.surface).toBe(surface);
      }
    }
    // A spot check that the grouping is load-bearing rather than a single bucket.
    expect(Object.keys(grouped).length).toBeGreaterThan(1);
  });

  it("declares every status code, account code and amount its prose depends on", () => {
    // A claim that says "refused with 423" must record "423" in `literals`, so the gate can check
    // the literal against the product's source instead of against the sentence that names it.
    // Checking prose against prose proves nothing.
    const failures: string[] = [];
    for (const c of claims) {
      const prose = `${c.claim} ${c.why ?? ""}`;
      const found = new Set<string>();

      // HTTP statuses and 4-digit account codes.
      for (const m of prose.matchAll(/\b\d{3,4}\b/g)) found.add(m[0]);
      // SCREAMING_SNAKE error codes.
      for (const m of prose.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) found.add(m[0]);

      for (const literal of found) {
        // Currency amounts inside an explanatory example (Rs 800) are illustrative prose, not a
        // contract the product must keep emitting, so they are exempt.
        if (new RegExp(`Rs\\s*${literal}\\b`).test(prose)) continue;
        if (!c.literals.includes(literal)) {
          failures.push(`${c.id}: prose names "${literal}" but literals does not declare it`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("looks a claim up by id, and returns undefined rather than throwing for an unknown one", () => {
    const first = claims[0];
    expect(first).toBeDefined();
    expect(claimById(first!.id)?.claim).toBe(first!.claim);
    expect(claimById("FIN-GUIDE-9999")).toBeUndefined();
  });

  /**
   * 37-02 seeded four and asserted the exact list, which was right while the registry was a seed.
   * 37-13 collects the rest of the phase's claims, so the strict equality is loosened to what it
   * was actually protecting: the four D-37-03 names BY NAME must be present, and the ids must stay
   * unique and contiguously numbered so a marker can never point at a gap.
   */
  it("still holds the four claims D-37-03 names explicitly", () => {
    const ids = claims.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "FIN-GUIDE-0001", // cash needs an open till, card does not
        "FIN-GUIDE-0002", // a closed period refuses a back-dated entry
        "FIN-GUIDE-0003", // what a discount does to sales
        "FIN-GUIDE-0004", // why some actions ask for a code
      ]),
    );
  });

  it("numbers its ids uniquely and without a gap", () => {
    const nums = claims.map((c) => Number(c.id.slice("FIN-GUIDE-".length)));
    expect(new Set(nums).size).toBe(nums.length);
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
    expect(nums[nums.length - 1]! - nums[0]!).toBe(nums.length - 1);
  });
});
