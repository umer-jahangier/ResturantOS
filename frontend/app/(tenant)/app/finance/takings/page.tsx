"use client";

import { Suspense } from "react";

import { DailyTakings } from "@/components/finance/DailyTakings";

// URL: /app/finance/takings — the Finance landing screen (37-12, D-37-02).
export default function TakingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Takings</h1>
        <p className="text-sm text-muted-foreground">
          The day&apos;s money, reconciled against what each till counted. Where a figure cannot be
          worked out, this screen says so and says why — it will not show you a zero it does not
          mean.
        </p>
      </div>
      {/* `useSearchParams` needs a Suspense boundary for the static shell; without it `next build`
          refuses the route outright. */}
      <Suspense fallback={<div className="h-64 animate-pulse rounded-md bg-muted" />}>
        <DailyTakings />
      </Suspense>
    </div>
  );
}
