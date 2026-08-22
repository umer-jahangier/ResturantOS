"use client";

import { GuideTab } from "@/components/finance/guide/GuideTab";

// URL: /app/finance/guide — the guide tab D-37-03 asked for by name (37-13).
export default function FinanceGuidePage() {
  return (
    <div className="space-y-6">
      <div className="max-w-prose">
        <h1 className="text-h1 font-semibold">How Finance works</h1>
        <p className="mt-1 text-small leading-relaxed text-muted-foreground">
          Every tab in this module, explained for someone who runs a restaurant rather than someone
          who keeps books. Each section answers the same four questions, and the boxed rules are the
          ones that most often come as a surprise — why cash needs an open till and card does not,
          why a closed month refuses a back-dated entry, what a discount really does to your sales
          figure, and why a few actions ask for a code.
        </p>
        <p className="mt-2 text-small leading-relaxed text-muted-foreground">
          Every boxed rule here is tied to a test in this codebase. If the product stopped behaving
          the way a rule describes, that test would fail before anyone read the wrong sentence.
        </p>
      </div>
      <GuideTab />
    </div>
  );
}
