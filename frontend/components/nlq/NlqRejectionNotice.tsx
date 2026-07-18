"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { NlqQueryError } from "@/lib/hooks/nlq/use-nlq";

/**
 * Maps every code `/api/v1/nlq/query` can refuse with to a specific, human, NON-BLAMING
 * explanation and a suggested next step. Never shows the raw code alone, never shows a stack
 * trace, and never shows the rejected SQL (12-07 deliberately does not return it for a rejected
 * query — it would be an oracle for probing the validator).
 *
 * The tenant/branch-filter cases are framed as "we couldn't PROVE it was safe", not "you did
 * something wrong" — the validator rejecting an exotic-but-legitimate query is a known, accepted
 * cost of the design (12-04), and the copy reflects that.
 */
const REJECTION_COPY: Record<string, { title: string; message: string }> = {
  TENANT_FILTER_MISSING: {
    title: "We couldn't safely scope that question",
    message:
      "That question produced a query we couldn't safely limit to your restaurant's data, so we didn't run it. Try being more specific — for example, name a date range or a branch.",
  },
  BRANCH_FILTER_MISSING: {
    title: "We couldn't safely scope that question",
    message:
      "That question produced a query we couldn't safely limit to your restaurant's data, so we didn't run it. Try being more specific — for example, name a date range or a branch.",
  },
  SHAPE_INVALID: {
    title: "This tool only reads data",
    message: "This tool can only read data, never change it. Try rephrasing as a question.",
  },
  TABLE_NOT_ALLOWED: {
    title: "That data isn't available to your role",
    message: "That question needs data your role can't access.",
  },
  PII_COLUMN_DENIED: {
    title: "That question asks for personal information",
    message: "That question asks for personal customer information, which this tool won't return.",
  },
  PARSE_FAILED: {
    title: "We couldn't understand that question",
    message: "We couldn't turn that into a valid query. Try rephrasing.",
  },
  LIMIT_INVALID: {
    title: "That question asked for too much data",
    message: "That query asked for too many rows. Narrow it down.",
  },
  ROW_CAP_EXCEEDED: {
    title: "That question asked for too much data",
    message: "That query returned too many rows. Try narrowing the date range or being more specific.",
  },
  QUERY_TIMEOUT: {
    title: "That question took too long",
    message: "That query took too long. Try a shorter date range.",
  },
  CLAUDE_UNAVAILABLE: {
    title: "This feature is temporarily unavailable",
    message: "The question service is temporarily unavailable. Please try again.",
  },
  QUOTA_SERVICE_UNAVAILABLE: {
    title: "This feature is temporarily unavailable",
    message: "The question service is temporarily unavailable. Please try again.",
  },
};

function quotaCopy(error: NlqQueryError): { title: string; message: string } {
  const isMonthly = error.code.includes("MONTHLY");
  return {
    title: "You've used your questions for now",
    message: `You've used all your questions for this ${isMonthly ? "month" : "hour"}. Try again later.`,
  };
}

interface NlqRejectionNoticeProps {
  error: NlqQueryError;
}

export function NlqRejectionNotice({ error }: NlqRejectionNoticeProps) {
  const copy =
    error.status === 429 || error.code.startsWith("QUOTA_EXCEEDED")
      ? quotaCopy(error)
      : (REJECTION_COPY[error.code] ?? {
          title: "That question couldn't be answered",
          message:
            "Something prevented us from answering that question safely. Try rephrasing it or asking something more specific.",
        });

  return (
    <Alert variant="destructive" role="status">
      <AlertTitle>{copy.title}</AlertTitle>
      <AlertDescription>{copy.message}</AlertDescription>
    </Alert>
  );
}
