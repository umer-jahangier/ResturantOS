"use client";

import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { AccessDenied } from "@/components/shared/access-denied";
import { NlqAskBox } from "@/components/nlq/NlqAskBox";
import { NlqResultPanel } from "@/components/nlq/NlqResultPanel";
import { NlqRejectionNotice } from "@/components/nlq/NlqRejectionNotice";
import { useNlqQuery } from "@/lib/hooks/nlq/use-nlq";

function NlqAskPage() {
  const mutation = useNlqQuery();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Ask a question</h1>
        <p className="text-sm text-muted-foreground">
          Ask about your restaurant&apos;s data in plain English — see the answer, and the exact
          SQL that ran to produce it.
        </p>
      </div>

      <NlqAskBox
        onAsk={(question) => mutation.mutate({ question })}
        isPending={mutation.isPending}
      />

      {mutation.isError && <NlqRejectionNotice error={mutation.error} />}
      {mutation.isSuccess && <NlqResultPanel result={mutation.data} />}
    </div>
  );
}

/**
 * `/app/nlq` — NLQ-01/NLQ-02. Gated on BOTH `FEATURE_NLQ` (GROWTH+, real per 12-01's
 * TierFeatureDefaults/RouteFeatureMap fix) and the `nlq.query.run` permission the backend
 * `@PreAuthorize`s on `POST /api/v1/nlq/query`.
 */
export default function NlqPage() {
  return (
    <FeatureGuard feature="FEATURE_NLQ" fallback={<AccessDenied />}>
      <PermissionGuard require="nlq.query.run" fallback={<AccessDenied />}>
        <div className="p-6">
          <NlqAskPage />
        </div>
      </PermissionGuard>
    </FeatureGuard>
  );
}
