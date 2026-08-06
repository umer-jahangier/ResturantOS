"use client";

import { formatUserFacingError } from "@/lib/errors";
import { Button } from "@/components/ui/button";

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
 * <p>Styling matches the inventory stock screen's failure banner so the two read as one system.
 */
export function HrErrorNotice({ what, error, onRetry }: HrErrorNoticeProps) {
  return (
    <div
      role="alert"
      className="space-y-2 rounded-md border border-destructive/30 bg-destructive/15 p-4 text-sm text-destructive"
    >
      <p>
        Couldn&apos;t load {what}. {formatUserFacingError(error)}
      </p>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
