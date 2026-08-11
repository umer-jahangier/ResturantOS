"use client";

import * as React from "react";

import {
  accessRefusalKind,
  accessRefusalMessage,
  formatUserFacingError,
} from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The one place a screen decides what a query LOOKS like.
 *
 * <h3>The defect this exists to make unrepresentable (GA-001)</h3>
 *
 * Eleven of fifteen list screens rendered the EMPTY state when the request FAILED. A forced HTTP
 * 500 and a forced `[]` produced byte-identical text — "No vendors yet", "No till sessions yet",
 * "No accounts found", "No journal entries", "No customers found". An owner whose purchasing
 * service was down was told, in the product's own confident voice, that their business has no
 * vendors. That is the single largest contributor to "the app is empty", and it is the product
 * lying about the one thing it must never lie about.
 *
 * It happened two ways, and both are shapes rather than typos:
 *
 *   1. `if (isError || !data?.data.length) return <EmptyState/>` — error deliberately folded into
 *      empty, in one expression, so the two can never be told apart again.
 *   2. `const { data, isLoading } = useVendors(); const vendors = data ?? []` — `isError` never
 *      destructured at all, so failure silently becomes a zero-length array one line later.
 *
 * Shape 2 is why this component takes the QUERY RESULT rather than three booleans. A caller cannot
 * pass a query and forget its error the way they can forget to destructure one; the failure mode
 * that produced the bug is not reachable through this API.
 *
 * <h3>Precedence, and why error is first</h3>
 *
 * `error → loading → empty → children`, always, and error is checked before anything else. A query
 * that has failed has no trustworthy `data`, so "is it empty?" is not a question that can be
 * honestly asked yet. Inverting these two is exactly bug shape 1.
 *
 * <h3>What this deliberately does NOT do</h3>
 *
 * It does not swallow, soften, or delay the failure. The remedy for a screen that looks broken is
 * never to make it look calm — a silent empty state IS the bug. Every failure here is announced to
 * assistive technology (`role="alert"`), names what failed in the reader's words, and offers the
 * one action that can help.
 */

/**
 * The subset of a TanStack query result this needs. Structural rather than
 * `UseQueryResult<T>` so a caller may pass a `useQuery`, a `useInfiniteQuery`, or a hand-rolled
 * hook that reports the same three facts — and so `components/**` never has to import a
 * transport type across the FE-08 layer boundary.
 */
export interface QueryLike {
  isError: boolean;
  error?: unknown;
  /** TanStack v5. Falls back to `isLoading` for hooks that only expose the v4 name. */
  isPending?: boolean;
  isLoading?: boolean;
  refetch?: () => unknown;
  isFetching?: boolean;
}

function isBusy(q: QueryLike): boolean {
  return q.isPending ?? q.isLoading ?? false;
}

interface QueryErrorNoticeProps {
  /** What failed to load, in the reader's words — "vendors", "the employee roster". */
  what: string;
  error?: unknown;
  onRetry?: () => void;
  isRetrying?: boolean;
  className?: string;
  /**
   * The module this screen belongs to, in the reader's words — "Purchasing", "Inventory". Used
   * only for the two 403 states. Defaults to `what`, which reads acceptably ("vendors is not
   * enabled") but is worth passing properly on any screen that has a module name.
   */
  moduleLabel?: string;
}

/**
 * A 403, told apart.
 *
 * 36-01 drove purchasing as MANAGER and OWNER and found the reported 403 no longer reproduces —
 * but while chasing it, the reason it took an afternoon was that the product could not say which
 * kind of refusal it had received. `FEATURE_DISABLED` ("purchasing is not on this tenant's plan")
 * and `PERMISSION_DENIED` ("this role may not") are both HTTP 403 and both rendered as the same
 * red "Couldn't load vendors" box, next to a retry button that could never help. Retrying a
 * refusal is not a remedy; it is the product suggesting the user's problem is transient when it
 * is structural.
 *
 * So: a distinct, calm, non-destructive state per kind, with NO retry button, and never an empty
 * state — GA-001's whole lesson is that "you have no vendors" must not be shown to someone who
 * simply was not allowed to look.
 */
function AccessRefusalNotice({
  kind,
  moduleLabel,
  className,
}: {
  kind: NonNullable<ReturnType<typeof accessRefusalKind>>;
  moduleLabel: string;
  className?: string;
}) {
  const { title, detail } = accessRefusalMessage(kind, moduleLabel);
  return (
    <div
      role="alert"
      data-testid="query-access-refusal"
      data-refusal-kind={kind}
      className={cn(
        "space-y-1 rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm",
        className,
      )}
    >
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground">{detail}</p>
    </div>
  );
}

/**
 * The visible failure state. Exported on its own for the handful of screens whose success branch
 * is too entangled to wrap (a table that must keep its header, a panel inside a dialog).
 */
export function QueryErrorNotice({
  what,
  error,
  onRetry,
  isRetrying,
  className,
  moduleLabel,
}: QueryErrorNoticeProps) {
  // Checked FIRST, for the same reason error is checked before empty: a refusal has no
  // trustworthy failure story to tell, and "couldn't load" is not what happened.
  const refusal = accessRefusalKind(error);
  if (refusal) {
    return (
      <AccessRefusalNotice
        kind={refusal}
        moduleLabel={moduleLabel ?? what}
        className={className}
      />
    );
  }
  return (
    <div
      role="alert"
      data-testid="query-error"
      className={cn(
        "space-y-2 rounded-md border border-destructive/30 bg-destructive/15 p-4 text-sm text-destructive",
        className,
      )}
    >
      <p>
        Couldn&apos;t load {what}. {formatUserFacingError(error)}
      </p>
      {onRetry && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={isRetrying}
          data-testid="query-error-retry"
        >
          {isRetrying ? "Retrying…" : "Try again"}
        </Button>
      )}
    </div>
  );
}

interface QueryBoundaryProps {
  /**
   * The query, or every query the children need. An array fails as a unit: if any one of them
   * errored the screen has failed, because a list rendered from a partial set of its inputs is
   * another way of showing the user something untrue.
   */
  query: QueryLike | QueryLike[];
  /** What failed to load, in the reader's words. Used in the error sentence. */
  what: string;
  /**
   * Whether a SUCCESSFUL response contained nothing. Only consulted once the query has resolved
   * without error, which is the entire point — this is the question that was being asked too early.
   */
  isEmpty?: boolean;
  /** Rendered when `isEmpty` and the query succeeded. Usually an `<EmptyState/>`. */
  empty?: React.ReactNode;
  /** Rendered while pending. Defaults to a three-row skeleton. */
  loading?: React.ReactNode;
  /** Suppress the retry button (a query with no `refetch` never shows one anyway). */
  hideRetry?: boolean;
  /** The module in the reader's words — "Purchasing". Only used by the two 403 states. */
  moduleLabel?: string;
  className?: string;
  children: React.ReactNode;
}

export function QueryBoundary({
  query,
  what,
  isEmpty,
  empty,
  loading,
  hideRetry,
  moduleLabel,
  className,
  children,
}: QueryBoundaryProps) {
  const queries = React.useMemo(() => (Array.isArray(query) ? query : [query]), [query]);

  const failed = queries.find((q) => q.isError);
  if (failed) {
    return (
      <QueryErrorNotice
        what={what}
        moduleLabel={moduleLabel}
        error={failed.error}
        isRetrying={queries.some((q) => q.isFetching)}
        onRetry={
          hideRetry
            ? undefined
            : () => {
                // Retry EVERY query, not just the one that failed: the others may hold stale data
                // fetched before the outage, and a screen half-refreshed is its own small lie.
                for (const q of queries) q.refetch?.();
              }
        }
        className={className}
      />
    );
  }

  if (queries.some(isBusy)) {
    return <>{loading ?? <DefaultSkeleton className={className} />}</>;
  }

  if (isEmpty && empty !== undefined) {
    return <>{empty}</>;
  }

  return <>{children}</>;
}

function DefaultSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse space-y-2", className)} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-12 rounded-md bg-muted" />
      ))}
    </div>
  );
}
