"use client";

import { claimById, type FinanceGuideClaimId } from "@/lib/finance/guide/claims";

/**
 * One rule from the registry, rendered where an owner will hit it (D-37-03, T-32-13-B).
 *
 * <h3>Why this takes an id and not a sentence</h3>
 *
 * The whole promise of this guide is that it cannot say something untrue. A component that
 * accepted prose would let anyone add a sentence to the page in one line, and nothing would ever
 * check it again. This one accepts a claim **id** and looks the words up in `claims.json` — the
 * same file `make verify-guide-claims` reads. So a sentence on this page has, by construction,
 * passed the gate: it names a live test, that test is not skipped, and every code it mentions
 * still exists in the service source.
 *
 * <h3>An honest limit on that guarantee</h3>
 *
 * `FinanceGuideClaimId` is derived from the JSON import, and TypeScript **widens JSON string
 * fields to `string`** — so this prop does not narrow to a literal union at compile time the way
 * 37-13's plan assumed it would. The structural guarantee is intact (free prose has no path in;
 * only registry text is ever rendered), but the check on the *id itself* is at runtime and in
 * `GuideTab.test.tsx`, not in `tsc`. An unknown id renders a visible, deliberately ugly warning
 * rather than nothing: a silently missing rule is the failure mode this file exists to prevent.
 */
export function ClaimCallout({ id }: { id: FinanceGuideClaimId }) {
  const claim = claimById(id);

  if (!claim) {
    return (
      <div
        role="alert"
        data-testid="claim-missing"
        data-claim-id={id}
        className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
      >
        This guide referenced a rule ({id}) that is not in the claim registry. That is a bug in the
        guide, not in the product — please report it rather than assuming the rule does not exist.
      </div>
    );
  }

  return (
    <div
      data-testid="claim-callout"
      data-claim-id={claim.id}
      className="rounded-md border-l-4 border-primary/60 bg-muted/50 p-3"
    >
      <p className="text-sm font-medium">{claim.claim}</p>
      {claim.why && (
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{claim.why}</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground/80">
        Checked by {claim.assertedBy.length} test
        {claim.assertedBy.length === 1 ? "" : "s"} in this codebase. If the product stopped behaving
        this way, {claim.assertedBy.length === 1 ? "it" : "they"} would fail.
      </p>
    </div>
  );
}
