"use client";

import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { AccessDenied } from "@/components/shared/access-denied";
import { NlqAskBox } from "@/components/nlq/NlqAskBox";
import { NlqResultPanel } from "@/components/nlq/NlqResultPanel";
import { NlqRejectionNotice } from "@/components/nlq/NlqRejectionNotice";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { useNlqQuery } from "@/lib/hooks/nlq/use-nlq";

function NlqAskPage() {
  const mutation = useNlqQuery();

  return (
    <>
      <PageHeader
        title="Ask a question"
        description="Ask about your restaurant's data in plain English — see the answer, and the exact SQL that ran to produce it."
      />

      <NlqAskBox
        onAsk={(question) => mutation.mutate({ question })}
        isPending={mutation.isPending}
      />

      {mutation.isError && <NlqRejectionNotice error={mutation.error} />}
      {mutation.isSuccess && <NlqResultPanel result={mutation.data} />}
    </>
  );
}

/**
 * `/app/nlq` — NLQ-01/NLQ-02. Gated on BOTH `FEATURE_NLQ` (GROWTH+, real per 12-01's
 * TierFeatureDefaults/RouteFeatureMap fix) and the `nlq.query.run` permission the backend
 * `@PreAuthorize`s on `POST /api/v1/nlq/query`.
 *
 * <p>One of the three surfaces N12 named: it declared its own `<h1>` at `text-xl` where the
 * product has exactly one page heading (`PageHeader`, `--text-h1`), and sat outside `PageBody`
 * so its gutters did not match any other screen's.
 */
export default function NlqPage() {
  return (
    <FeatureGuard feature="FEATURE_NLQ" fallback={<AccessDenied />}>
      <PermissionGuard require="nlq.query.run" fallback={<AccessDenied />}>
        <PageBody className="space-y-(--space-lg)">
          <NlqAskPage />
        </PageBody>
      </PermissionGuard>
    </FeatureGuard>
  );
}
