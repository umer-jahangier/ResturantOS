"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ImpersonationResults } from "@/components/platform/impersonation-log";
import { usePlatformImpersonations } from "@/lib/hooks/use-platform-impersonations";

/**
 * URL: /platform/impersonations — "where has admin X been?"
 *
 * <h3>Why this screen has to exist separately from the tenant audit log</h3>
 *
 * `audit_db.audit_events` is per-tenant with FORCED row-level security. A tenant OWNER can
 * correctly see impersonations of their own users there, and a Control Bistro OWNER correctly sees
 * none of Floating Terrace's. But *"every tenant this administrator has entered this month"* is not
 * a question that database can answer at all — it is one query per tenant, with one token per
 * tenant, and it silently misses any tenant whose outbox delivery failed. `impersonation_log`
 * answers it in one read of the row written in the same transaction that minted the token.
 *
 * <h3>Filtering by administrator, without inventing a dropdown</h3>
 *
 * There is no endpoint that lists platform users, so there is no honest way to populate a picker.
 * Rather than ship a UUID text box nobody would type into, the administrator names already on
 * screen are the filter: click one to see everywhere they have been. The active filter is shown as
 * a removable chip so it can never be on without the operator being able to see that it is.
 *
 * <h3>The date boundary is stated, not hidden</h3>
 *
 * A platform session has no tenant and therefore no branch, so there is no local business day to
 * cut on — the API cuts a bare date at UTC midnight. That is written on the screen. The Takings
 * screen's defect was a boundary silently five hours out; the remedy is to say where the boundary
 * is, not to guess a nicer one.
 */
export default function PlatformImpersonationsPage() {
  const [adminUserId, setAdminUserId] = React.useState<string | undefined>();
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [page, setPage] = React.useState(0);

  const query = usePlatformImpersonations({
    adminUserId,
    from: from || undefined,
    to: to || undefined,
    page,
  });

  // Any filter change resets to the first page. Staying on page 3 of a narrower result set shows
  // an empty table for a filter that matched rows, which reads as "nothing found".
  const selectAdmin = React.useCallback((id: string) => {
    setAdminUserId(id);
    setPage(0);
  }, []);

  const adminLabel = React.useMemo(() => {
    const match = query.data?.records.find((r) => r.adminUserId === adminUserId);
    return match?.adminEmail ?? adminUserId;
  }, [query.data, adminUserId]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Impersonation audit</h1>
        <p className="text-sm text-muted-foreground">
          Every time platform staff signed in as a tenant&apos;s user, across all tenants. The
          record is append-only — it cannot be edited or deleted by anyone, including the
          administrators it names — and the issued token is never stored.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(0);
            }}
            className="rounded-md border border-input bg-background px-2 py-1.5"
            data-testid="impersonation-from"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(0);
            }}
            className="rounded-md border border-input bg-background px-2 py-1.5"
            data-testid="impersonation-to"
          />
        </label>

        <p className="pb-1.5 text-xs text-muted-foreground">
          Dates are cut at UTC midnight. A platform session has no branch, so there is no local
          business day to use.
        </p>

        {adminUserId && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => {
              setAdminUserId(undefined);
              setPage(0);
            }}
            data-testid="impersonation-clear-admin"
          >
            <X className="size-4" aria-hidden="true" />
            {adminLabel}
          </Button>
        )}
      </div>

      <ImpersonationResults
        query={query}
        page={page}
        onPageChange={setPage}
        showTenant
        onSelectAdmin={selectAdmin}
        what="the impersonation audit"
        emptyTitle="No impersonations recorded"
        emptyDescription={
          adminUserId || from || to
            ? "No platform administrator signed in as a tenant user within these filters."
            : "No platform administrator has ever signed in as a tenant user."
        }
      />
    </div>
  );
}
