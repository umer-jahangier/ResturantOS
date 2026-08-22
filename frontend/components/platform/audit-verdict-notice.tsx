"use client";

import { AlertTriangle, Building2, FileSearch, SearchX } from "lucide-react";

import { formatNumber } from "@/lib/format/locale";
import { ConsoleNote } from "@/components/platform/console-section";
import { EmptyState } from "@/components/ui/empty-state";
import type { AuditVerdict, TenantReadFailure } from "@/lib/models/platform-audit.model";

/**
 * The one component on this screen that exists because of a defect class rather than a feature.
 *
 * <h3>GA-001, on the surface where it costs the most</h3>
 *
 * The cross-tenant trail is read by fanning out one query per tenant, each executed under that
 * tenant's own row-level-security policy. **A row-level-security policy that excludes everything
 * does not raise — it returns zero rows and reports success.** `audit_events` is FORCE RLS on every
 * partition; if nothing on the cross-tenant path sets the tenant GUC, every one of those queries
 * is filtered to nothing, every call is a 200, `tenantsRead` equals `tenantsInScope`, and `events`
 * comes back empty.
 *
 * <p>Which is byte-for-byte what a platform where nothing happened looks like.
 *
 * <p>So `events.length === 0` is not a fact about activity, and the ordinary rendering of it —
 * a calm "No audit events" empty state — converts a possible scoping fault into a reassuring
 * sentence. An operator running a security review would read it and conclude nothing happened.
 * That is the whole of GA-001: a failure that reads as an empty result.
 *
 * <h3>What this component does NOT claim</h3>
 *
 * It does not say the audit service is broken. It cannot know that, and a status page that cries
 * fault on a quiet week is a status page nobody reads twice. It reports exactly what was and was
 * not established — "N tenants reported a successful read and returned no rows between them" — and
 * hands the reader the check that settles it. The distinction between a stated uncertainty and an
 * asserted failure is the same distinction `SystemHealthDtos` spends two enum members on.
 *
 * <h3>Why a warning tone and not an error tone</h3>
 *
 * An error surface promises the reader something went wrong, and offers a retry. Nothing here has
 * gone wrong that we can name, and retrying returns the same nothing. The tone that fits an
 * unresolved question is the one `ConsoleNote` reserves for a stated caveat — visible, ruled off,
 * impossible to mistake for a result.
 */

function FailedTenants({ failures }: { failures: TenantReadFailure[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {failures.map((failure) => (
        <li key={failure.tenantId} className="text-small">
          <span className="font-medium text-foreground">
            {failure.tenantSlug ?? "Unregistered tenant"}
          </span>{" "}
          <span className="font-mono text-label tabular-nums text-foreground-tertiary">
            {failure.tenantId}
          </span>
          {failure.reason ? (
            <span className="block text-foreground-secondary">{failure.reason}</span>
          ) : (
            <span className="block text-foreground-secondary">
              No reason was returned, which is itself unusual.
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * @param onClearFilters offered only on the filtered-empty verdict — the way OUT of a filter, and
 *        never a create affordance. There is nothing to create on a read-only screen.
 */
export function AuditVerdictNotice({
  verdict,
  windowLabel,
  onClearFilters,
}: {
  verdict: AuditVerdict;
  /** The server's window, printed from the response so the caption cannot drift from the cut. */
  windowLabel: string;
  onClearFilters?: () => void;
}) {
  switch (verdict.kind) {
    case "rows":
      return null;

    case "noTenants":
      return (
        <EmptyState
          icon={Building2}
          title="There are no tenants on this platform"
          description="Nothing has been audited because nothing exists to audit yet. This is a statement about the tenant registry, not about the audit trail."
        />
      );

    case "filteredEmpty":
      return (
        <div className="flex flex-col gap-(--space-md)" data-testid="audit-filtered-empty">
          <EmptyState
            icon={SearchX}
            title="No events match these filters"
            description={`Nothing in ${windowLabel} matched. Widen or clear the filters to see more.`}
            action={onClearFilters ? { label: "Clear all", onClick: onClearFilters } : undefined}
          />
          {/*
            Stated even under a filter, because a narrowed zero is only meaningful if the
            unnarrowed trail is being read at all. A reader who filters, sees nothing, and moves on
            has learned nothing about whether the log works — and this screen is where they would
            find that out.
          */}
          <ConsoleNote>
            A zero here is a zero for these filters only. It does not establish that the trail is
            being read — clear the filters to check the whole window.
          </ConsoleNote>
        </div>
      );

    case "unverified":
      return (
        <div className="flex flex-col gap-(--space-md)" data-testid="audit-unverified">
          <ConsoleNote tone="warning" role="status">
            <span className="mb-1 flex items-center gap-2 font-semibold text-foreground">
              <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
              No rows came back, and that has not been confirmed as an empty log
            </span>
            The audit service reported a successful read for{" "}
            <span className="font-semibold text-foreground">
              {formatNumber(verdict.tenantsRead)}
            </span>{" "}
            tenant{verdict.tenantsRead === 1 ? "" : "s"} across {windowLabel} with no filters
            applied, and returned no events at all — not one login, not one account change.
            <span className="mt-2 block">
              On a platform with live tenants that is not what an idle week looks like.{" "}
              <code className="font-mono">audit_events</code> is FORCE row-level security on every
              partition, and a query whose tenant scope is not set is filtered to nothing and
              reports success — so a fault on this path and a genuinely empty trail arrive here as
              the same 200 with the same empty list.
            </span>
            <span className="mt-2 block">
              This console cannot tell them apart, so it does not guess. Confirm against a
              tenant&apos;s own audit screen — if events are visible there and absent here, the
              cross-tenant read is the problem, not the platform&apos;s quietness.
            </span>
          </ConsoleNote>
        </div>
      );

    case "partial":
      return (
        <ConsoleNote tone="warning" role="status" data-testid="audit-partial">
          <span className="mb-1 flex items-center gap-2 font-semibold text-foreground">
            <FileSearch className="size-4 text-warning" aria-hidden="true" />
            {formatNumber(verdict.failures.length)} tenant
            {verdict.failures.length === 1 ? "'s log" : "s' logs"} could not be read
          </span>
          Whatever is shown below is a PARTIAL view and the total is a lower bound. On an audit
          surface, being wrong about how much history exists is most damaging in this direction — so
          the tenants that did not answer are named rather than counted.
          <FailedTenants failures={verdict.failures} />
        </ConsoleNote>
      );
  }
}
