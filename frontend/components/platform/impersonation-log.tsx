"use client";

import * as React from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format/locale";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary } from "@/components/ui/query-boundary";
import {
  impersonationStatusLabel,
  type ImpersonationPage,
  type ImpersonationRecord,
  type ImpersonationStatus,
} from "@/lib/models/platform.model";

/**
 * The SuperAdmin's view of who assumed whose identity.
 *
 * <h3>What this screen is for</h3>
 *
 * `impersonation_log` is the accountability record of platform staff signing in as a restaurant's
 * own users. It has been written correctly since PLATFORM-05 and — until this change — could not be
 * read by the one principal it exists to hold to account. A tenant OWNER could already see
 * impersonations of their own users through the audit log; the platform SuperAdmin had no path at
 * all, and the repository method that would have served one had no callers.
 *
 * <h3>Two things it will not do</h3>
 *
 * <ol>
 *   <li><b>It never shows a token.</b> The API has no field for one and the table has no column for
 *       one — the issued JWT is handed over once and never stored.</li>
 *   <li><b>It never claims a session ended.</b> `ended_at` exists in the schema with no writer
 *       anywhere in the product, so there is no such thing as a closed session to display. Status
 *       is the server's, derived from `expires_at`, and it is rendered rather than recomputed: a
 *       browser evaluating "is this still live?" against its own clock would disagree with the
 *       server on any machine whose time is off.</li>
 * </ol>
 *
 * <h3>Why the target is a bare id</h3>
 *
 * The impersonated person is a tenant user, and tenant users live in a database the platform plane
 * cannot reach — no cross-database bridge exists and the platform roles hold no grants there. The
 * column says "user id" and shows the id. Rendering a guessed or blank name on an accountability
 * screen would be worse than the id, which at least resolves in the tenant's own audit log.
 */

const STATUS_STYLES: Record<ImpersonationStatus, string> = {
  // A live session is the one an operator may need to act on, so it is the one that stands out.
  ACTIVE: "border-warning/30 bg-warning/15 text-warning",
  EXPIRED: "border-border bg-muted text-muted-foreground",
  // Not a failure and not a live session — a row whose expiry was never recorded. Neutral-but-
  // visible, because "we do not know" is information, not an error.
  UNKNOWN: "border-info/30 bg-info/15 text-info",
};

export function ImpersonationStatusBadge({ status }: { status: ImpersonationStatus }) {
  return (
    <span
      data-testid={`impersonation-status-${status}`}
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        STATUS_STYLES[status],
      )}
    >
      {impersonationStatusLabel(status)}
    </span>
  );
}

function when(value: Date | null): string {
  return formatDateTime(value);
}

/**
 * @param onSelectAdmin when supplied, the administrator cell becomes the way to ask "where else
 *        has this person been?". There is no platform-users list endpoint to build a dropdown
 *        from, and a bare UUID text box is not a filter anybody would use — so the filter is
 *        applied by clicking a name that is already on screen. Nothing is invented: the only
 *        administrators offered are the ones present in the result.
 */
export function ImpersonationTable({
  records,
  showTenant,
  onSelectAdmin,
}: {
  records: ImpersonationRecord[];
  showTenant: boolean;
  onSelectAdmin?: (adminUserId: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm" data-testid="impersonation-table">
        <caption className="sr-only">SuperAdmin impersonation sessions</caption>
        <thead className="bg-muted/50 text-left">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">
              Started
            </th>
            {showTenant && (
              <th scope="col" className="px-4 py-2 font-medium">
                Tenant
              </th>
            )}
            <th scope="col" className="px-4 py-2 font-medium">
              Administrator
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Signed in as (user id)
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Session
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Reason
            </th>
          </tr>
        </thead>
        <tbody>
          {records.map((row) => (
            <tr
              key={row.id}
              className="border-t align-top hover:bg-muted/40"
              data-testid={`impersonation-row-${row.id}`}
            >
              <th scope="row" className="px-4 py-2.5 text-left font-normal whitespace-nowrap">
                {formatDateTime(row.startedAt)}
              </th>
              {showTenant && (
                <td className="px-4 py-2.5">
                  {row.tenantSlug ? (
                    <Link
                      href={`/platform/tenants/${row.tenantId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {row.tenantBrandName ?? row.tenantSlug}
                    </Link>
                  ) : (
                    // The tenant registration is gone and the record is not. Say that, rather than
                    // rendering an empty cell that reads as a missing value.
                    <span className="text-muted-foreground">
                      Tenant no longer registered
                      <span className="block font-mono text-xs">{row.tenantId}</span>
                    </span>
                  )}
                </td>
              )}
              <td className="px-4 py-2.5">
                {onSelectAdmin ? (
                  <button
                    type="button"
                    className="text-left font-medium text-primary hover:underline"
                    onClick={() => onSelectAdmin(row.adminUserId)}
                    data-testid={`impersonation-filter-admin-${row.adminUserId}`}
                  >
                    {row.adminEmail ?? `Deleted account ${row.adminUserId}`}
                  </button>
                ) : (
                  (row.adminEmail ?? (
                    <span className="text-muted-foreground">
                      Account deleted
                      <span className="block font-mono text-xs">{row.adminUserId}</span>
                    </span>
                  ))
                )}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs">{row.targetUserId}</td>
              <td className="px-4 py-2.5 whitespace-nowrap">
                <ImpersonationStatusBadge status={row.status} />
                <span className="mt-1 block text-xs text-muted-foreground">
                  {row.status === "UNKNOWN"
                    ? "No expiry recorded"
                    : `Token expiry ${when(row.expiresAt)}`}
                </span>
              </td>
              <td className="max-w-sm px-4 py-2.5 text-muted-foreground">
                {row.reason ?? <span className="italic">No reason recorded</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Table + pager + the honest counts, shared by the tenant panel and the platform-wide screen.
 *
 * The pager is driven by `nextPage` from the response envelope, never by "did this page come back
 * full?" — a full final page would otherwise offer a next page that does not exist, which on this
 * screen reads as records being hidden.
 */
export function ImpersonationResults({
  query,
  page,
  onPageChange,
  showTenant,
  onSelectAdmin,
  emptyTitle,
  emptyDescription,
  what,
}: {
  query: {
    data?: ImpersonationPage;
    isError: boolean;
    error?: unknown;
    isPending?: boolean;
    isLoading?: boolean;
    refetch?: () => unknown;
    isFetching?: boolean;
  };
  page: number;
  onPageChange: (page: number) => void;
  showTenant: boolean;
  onSelectAdmin?: (adminUserId: string) => void;
  emptyTitle: string;
  emptyDescription: string;
  what: string;
}) {
  const data = query.data;
  const records = data?.records ?? [];

  return (
    <QueryBoundary
      query={query}
      what={what}
      isEmpty={Boolean(data) && records.length === 0}
      empty={<EmptyState icon={ShieldAlert} title={emptyTitle} description={emptyDescription} />}
    >
      <div className="space-y-3">
        <ImpersonationTable
          records={records}
          showTenant={showTenant}
          onSelectAdmin={onSelectAdmin}
        />

        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground" data-testid="impersonation-count">
            {data ? `${data.totalCount} session${data.totalCount === 1 ? "" : "s"} recorded` : null}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => onPageChange(page - 1)}
              data-testid="impersonation-prev"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!data || data.nextPage === null}
              onClick={() => onPageChange(page + 1)}
              data-testid="impersonation-next"
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </QueryBoundary>
  );
}
