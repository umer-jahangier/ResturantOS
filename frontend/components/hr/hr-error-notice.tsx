"use client";

import { QueryErrorNotice } from "@/components/ui/query-boundary";

interface HrErrorNoticeProps {
  /** What failed to load, in the reader's words — "the employee roster", "payroll runs". */
  what: string;
  error: unknown;
  onRetry?: () => void;
}

/**
 * The visible failure state for an HR query.
 *
 * <p>Exists because the alternative is worse than ugly: a failed list that falls through to
 * "No employees yet." tells a manager the roster is EMPTY when in fact the server never
 * answered. That reads as data loss, and the one action it invites — re-entering everyone —
 * is exactly the wrong one. Every HR surface routes `isError` here instead.
 *
 * <p><b>14b:</b> HR reached this conclusion first, on its own, before the rest of the product did.
 * The audit then found the same defect on eleven other list screens (GA-001), so the markup moved
 * to the shared {@link QueryErrorNotice} and this became a thin alias. It is kept rather than
 * deleted because ten HR call sites name it, and because the name carries the module's own record
 * of having got this right early — the generalisation is HR's pattern, not a replacement for it.
 */
export function HrErrorNotice({ what, error, onRetry }: HrErrorNoticeProps) {
  return <QueryErrorNotice what={what} error={error} onRetry={onRetry} />;
}
