"use client";

import { Suspense } from "react";

import { DailyTakings } from "@/components/finance/DailyTakings";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";

// URL: /app/finance/takings — the Finance landing screen (37-12, D-37-02).
//
// 38-08 treats this screen as the STANDARD the other eight tables are held to, not as a thing to
// tidy. What changed here is the type role of the heading, the shared PageHeader, and the money
// typeface inside DailyTakings — nothing about what it says or refuses to say.
export default function TakingsPage() {
  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Takings"
        description="The day's money, reconciled against what each till counted. Where a figure cannot be worked out, this screen says so and says why — it will not show you a zero it does not mean."
      />
      {/* `useSearchParams` needs a Suspense boundary for the static shell; without it `next build`
          refuses the route outright. */}
      <Suspense fallback={<Skeleton className="h-64" />}>
        <DailyTakings />
      </Suspense>
    </PageBody>
  );
}
