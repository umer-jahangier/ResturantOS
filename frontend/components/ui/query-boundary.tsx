"use client";

import * as React from "react";

import Link from "next/link";

import {
  accessRefusalKind,
  accessRefusalMessage,
  formatUserFacingError,
  isServiceOutage,
} from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
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
  /**
   * One sentence naming what a person CAN still do while this service is down. Rendered only in
   * the 503 state (S1-09), because it is only true there — a 403 or a parse failure does not leave
   * a neighbouring capability working.
   *
   * <p>Optional, and the notice reads correctly without it. It is worth writing on any screen
   * where the honest answer is not "nothing": a cashier told "the till is down" will send the
   * queue away, and a cashier told "the till is down, the kitchen board is still running" will
   * go and check the pass.
   */
  stillWorks?: string;
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
 * A 503, told apart from every other failure (S1-09).
 *
 * <h3>Why this is its own state</h3>
 *
 * "Couldn't load the menu. This module is temporarily unavailable. Try again in a moment." is the
 * sentence the product used to show when a whole service was stopped, and every word of it is
 * wrong in the way that matters: it implies a blip, it implies retrying now will help, and it
 * gives the reader nothing to say when they telephone for help. The 2026-08-12 register recorded a
 * manager taking that message on the till, the kitchen board, the customer file and payroll at the
 * same moment and having no way to learn that five separate services were simply not running.
 *
 * <p>So an outage gets its own copy, and it does three things the generic notice cannot:
 *
 * <ul>
 *   <li>names what is unavailable in the reader's words, and says the SOFTWARE is not answering
 *       rather than that something went wrong with what they did;</li>
 *   <li>says what still works — the single most useful sentence during a partial outage, because
 *       the alternative is a manager assuming the whole product is dead and sending staff home;</li>
 *   <li>points an owner or administrator at the health screen, where they can see which services
 *       are down and how long they have been. Only if they hold the permission: an operator link
 *       that leads to an access-denied page is worse than no link.</li>
 * </ul>
 *
 * <p>The retry button STAYS. Unlike a 403 — where retrying a refusal is the product pretending a
 * structural problem is transient — a 503 genuinely does clear the moment the service comes back,
 * and pressing it is exactly what the operator should do after a restart.
 */
function ServiceOutageNotice({
  what,
  stillWorks,
  onRetry,
  isRetrying,
  className,
}: {
  what: string;
  stillWorks?: string;
  onRetry?: () => void;
  isRetrying?: boolean;
  className?: string;
}) {
  const { permissions } = useCurrentUser();
  const canSeeHealth = permissions.includes("ops.health.view");

  return (
    <div
      role="alert"
      data-testid="query-service-outage"
      className={cn(
        // Same weight as the generic failure, deliberately. An outage is not a gentler event than
        // a load error and must not be styled as one — 34-05 forbids lowering the salience of a
        // failure, and this is the most consequential failure the product has.
        // `text-small`, not Tailwind's `text-sm`: gate G1 requires a new call site to use the
        // contract role. The neighbouring notices below still carry their baselined `text-sm`
        // and are converged by their own screen plan, not smuggled into this one.
        "space-y-2 rounded-lg border border-destructive/30 bg-destructive/15 p-4 text-small text-destructive shadow-depth-1",
        className,
      )}
    >
      <p className="font-medium">{capitalise(what)} is unavailable right now.</p>
      <p>
        The part of RestaurantOS that handles {what} is not answering. This is not something you
        did, and nothing you have entered has been lost.
        {stillWorks ? ` ${stillWorks}` : ""}
      </p>
      <div className="flex flex-wrap items-center gap-2">
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
        {canSeeHealth && (
          <Link
            href="/app/settings/health"
            data-testid="query-outage-health-link"
            className="text-small font-medium underline underline-offset-4"
          >
            See which services are down
          </Link>
        )}
      </div>
    </div>
  );
}

function capitalise(text: string): string {
  const first = text.charAt(0);
  return first === "" ? text : first.toUpperCase() + text.slice(1);
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
  stillWorks,
}: QueryErrorNoticeProps) {
  // Checked FIRST, for the same reason error is checked before empty: a refusal has no
  // trustworthy failure story to tell, and "couldn't load" is not what happened.
  const refusal = accessRefusalKind(error);
  if (refusal) {
    return (
      <AccessRefusalNotice kind={refusal} moduleLabel={moduleLabel ?? what} className={className} />
    );
  }
  // Then the outage, before the generic sentence — for the same reason again. "Couldn't load the
  // menu, try again in a moment" is not what happened when pos-service is not running, and a
  // reader who acts on it will press Try again until the queue gives up.
  if (isServiceOutage(error)) {
    return (
      <ServiceOutageNotice
        what={what}
        stillWorks={stillWorks}
        onRetry={onRetry}
        isRetrying={isRetrying}
        className={className}
      />
    );
  }
  return (
    <div
      role="alert"
      data-testid="query-error"
      className={cn(
        // Phase 34 gives this depth and NOTHING else. 34-05 forbids making an error calmer,
        // softer, slower to appear or more decorative — phase 14b exists because eleven screens
        // told an owner their business had no vendors when the service was down, and character
        // that lowers the salience of a failure recreates that defect with better typography.
        // A raised surface reads as MORE urgent than a flat one, so depth is the one addition
        // that moves in the permitted direction. Deliberately no entrance animation: if the
        // animation does not run, the failure must already be on screen and readable.
        "space-y-2 rounded-lg border border-destructive/30 bg-destructive/15 p-4 text-sm text-destructive shadow-depth-1",
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
  /** What still works while this service is down. Only used by the 503 state — see above. */
  stillWorks?: string;
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
  stillWorks,
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
        stillWorks={stillWorks}
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
