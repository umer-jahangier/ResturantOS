/**
 * Typed loader over the finance guide's claim registry (D-37-03, plan 37-02).
 *
 * <h2>Why the registry is JSON and not a TypeScript module</h2>
 *
 * Two very different consumers read it: the React guide tab (37-13), which goes through the Next
 * build, and `scripts/verify-finance-guide-claims.mjs`, a dependency-free Node gate that runs with
 * no build step at all. A TypeScript module would be parseable by only one of them, so the gate
 * would end up reading a second copy — and a guide whose prose and whose proof come from two
 * different files is exactly the drift this whole mechanism exists to prevent.
 *
 * JSON is the only format both read natively. That is the entire reason.
 */
import registry from "./claims.json";

/** Which finance tab a claim belongs to. `cross-cutting` claims appear in the guide's preamble. */
export type FinanceGuideSurface =
  | "transactions"
  | "takings"
  | "journal"
  | "periods"
  | "coa"
  | "reports"
  | "cross-cutting";

export interface ClaimAssertion {
  /** Repository-relative path. Checked for existence by the registry test and by the gate. */
  file: string;
  /** The test identifier — a Java method name, a vitest/playwright test title, or a shell function. */
  test: string;
}

export interface FinanceGuideClaim {
  id: string;
  surface: FinanceGuideSurface;
  /** One sentence, plain language, written for a restaurant owner. */
  claim: string;
  /** Optional longer explanation. Still plain language. */
  why?: string;
  /**
   * Exact strings the claim depends on — a status code, an account code, an error code. The gate
   * greps each of these against non-test service source, so the guide cannot name a code the
   * product stopped emitting.
   */
  literals: string[];
  assertedBy: ClaimAssertion[];
}

const claims = registry.claims as FinanceGuideClaim[];

/**
 * The union of every declared claim id, derived from the data rather than hand-maintained, so the
 * guide renderer in 37-13 cannot reference an id that does not exist.
 */
export type FinanceGuideClaimId = (typeof registry.claims)[number]["id"];

/** The claim-id shape. Four digits, no slug — see the registry's `_readme` for why. */
export const CLAIM_ID_PATTERN = /^FIN-GUIDE-\d{4}$/;

/**
 * The marker text a test carries to declare which claim it defends. The gate resolves every
 * marker back to a row, so a deleted claim cannot leave an orphan test behind.
 */
export const CLAIM_MARKER_PREFIX = "GUIDE-CLAIM:";

/** Every claim, in registry order. */
export function allClaims(): FinanceGuideClaim[] {
  return claims;
}

/** Look up one claim. Returns `undefined` rather than throwing — the caller decides. */
export function claimById(id: string): FinanceGuideClaim | undefined {
  return claims.find((c) => c.id === id);
}

/** Claims grouped by the tab they belong to, because the guide renders per tab. */
export function claimsBySurface(): Record<FinanceGuideSurface, FinanceGuideClaim[]> {
  const grouped = {} as Record<FinanceGuideSurface, FinanceGuideClaim[]>;
  for (const claim of claims) {
    (grouped[claim.surface] ??= []).push(claim);
  }
  return grouped;
}
