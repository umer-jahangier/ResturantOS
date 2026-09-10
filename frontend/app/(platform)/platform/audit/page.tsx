"use client";

import * as React from "react";

import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { AuditCoveragePanel } from "@/components/platform/audit-coverage-panel";
import { AuditTrail, AUDIT_VIEW_LABEL } from "@/components/platform/audit-trail";
import { ConsoleSection } from "@/components/platform/console-section";
import { ImpersonationResults } from "@/components/platform/impersonation-log";
import { OperatorAuditFeed } from "@/components/platform/operator-audit-feed";
import { usePlatformImpersonations } from "@/lib/hooks/use-platform-impersonations";
import type { AuditView } from "@/lib/models/platform-audit.model";

/**
 * URL: `/platform/audit` — the read-only, platform-wide security record.
 *
 * <h3>Five feeds, three sources, one screen</h3>
 *
 * A security review asks one question — *what happened, and who did it* — and the answer lives in
 * three places that cannot be merged server-side:
 *
 * <ul>
 *   <li><b>`audit_db.audit_events`</b>, per-tenant with FORCE row-level security, read by
 *       fanning out across every tenant. Serves the first three views.</li>
 *   <li><b>`platform_db.impersonation_log`</b>, written in the same transaction that mints an
 *       impersonation token. Already cross-tenant, already filtered, already has a screen — so
 *       this page renders that screen's own component rather than a second copy of it. The
 *       backend deliberately does NOT re-serve the register from the audit controller, on the
 *       grounds that two endpoints answering one question is how two screens start disagreeing;
 *       reusing the component is the frontend half of the same argument.</li>
 *   <li><b>`platform_db.platform_admin_audit`</b>, the operator trail. Survives an outbox failure
 *       and records two actions (unlock, revoke-sessions) that produce no tenant-side event at
 *       all.</li>
 * </ul>
 *
 * <p>They are switched rather than stacked because they have different columns, different filters
 * and different pagers, and a page that renders five grids at once is a page nobody scrolls to the
 * bottom of. The switch is client state and not a route: the views share a window and a mental
 * frame, and a reader comparing "was that login before or after the impersonation?" should not
 * lose their filters to a navigation.
 *
 * <h3>The defect this screen is written against</h3>
 *
 * **An empty audit log must not render as "no events."** The cross-tenant read succeeds and
 * returns zero rows whenever its tenant scope is not set — `audit_events` is FORCE RLS on every
 * partition — so a scoping fault and a genuinely quiet platform arrive as the identical 200 with
 * the identical empty list. `AuditVerdictNotice` is the component that refuses to collapse them,
 * and it is the reason `QueryBoundary`'s `isEmpty` is deliberately not wired to the row count in
 * `AuditTrail`.
 *
 * <h3>Read-only, and it looks it</h3>
 *
 * No row action, no selection, no bulk bar, no create button anywhere on this page — absent
 * rather than disabled. `audit_events` is append-only at the role grant, at a database trigger and
 * at the service's routing table; `platform_admin_audit` is append-only at the trigger layer. A
 * greyed-out control would imply a permission the product does not have.
 */

type ViewKey = AuditView | "impersonations" | "operators";

const VIEWS: Array<{ key: ViewKey; label: string; hint: string }> = [
  {
    key: "events",
    label: AUDIT_VIEW_LABEL.events,
    hint: "Everything in the tenant trail, filterable by tenant, action and date.",
  },
  {
    key: "logins",
    label: AUDIT_VIEW_LABEL.logins,
    hint: "Attempt-level login history, with a failures-only view for a brute-force review.",
  },
  {
    key: "authority-changes",
    label: AUDIT_VIEW_LABEL["authority-changes"],
    hint: "Role grants and revokes, account state changes, password resets, impersonation starts.",
  },
  {
    key: "impersonations",
    label: "Impersonations",
    hint: "Who assumed whose identity, when, and for how long.",
  },
  {
    key: "operators",
    label: "Operator actions",
    hint: "Every platform-tier action on a tenant account, with its stated reason.",
  },
];

/** Impersonations, rendered through the register's own component and its own hook. */
function ImpersonationView() {
  const [page, setPage] = React.useState(0);
  const query = usePlatformImpersonations({ page });

  return (
    <ConsoleSection
      anchorId="platform-audit-impersonations"
      eyebrow="Read-only"
      title="Impersonations"
      description="Written in the same transaction that mints the token. The token itself is never stored, and there is no field on this screen that could show one."
      data-testid="audit-impersonations"
    >
      <ImpersonationResults
        query={query}
        page={page}
        onPageChange={setPage}
        showTenant
        what="the impersonation register"
        emptyTitle="No impersonations recorded"
        emptyDescription="No platform administrator has ever signed in as a tenant user. This register is in platform_db and is read directly, so an empty result means the rows are genuinely absent."
      />
    </ConsoleSection>
  );
}

export default function PlatformAuditPage() {
  const [view, setView] = React.useState<ViewKey>("events");
  const active = VIEWS.find((v) => v.key === view)!;

  return (
    <div className="flex flex-col gap-(--space-lg)">
      <PageHeader
        title="Audit & security"
        description="Every action recorded across every tenant. Read-only by construction — there is no endpoint on this plane that can edit, redact or delete a row."
      />

      {/*
        A segmented control built from the shared `Button`, not a bespoke tab widget.

        `aria-pressed` rather than `role="tab"`: a tablist promises arrow-key navigation and an
        `aria-controls` relationship to a panel that persists, and this switch swaps an entire
        section including its filters. A group of toggle buttons is what it actually is, and
        announcing it as what it is beats announcing it as something better-sounding that then
        behaves differently from what a screen-reader user expects.
      */}
      <div
        role="group"
        aria-label="Audit view"
        className="flex flex-wrap gap-(--space-sm)"
        data-testid="audit-view-switch"
      >
        {VIEWS.map((entry) => (
          <Button
            key={entry.key}
            type="button"
            variant={entry.key === view ? "default" : "outline"}
            size="sm"
            aria-pressed={entry.key === view}
            onClick={() => setView(entry.key)}
            title={entry.hint}
            data-testid={`audit-view-${entry.key}`}
          >
            {entry.label}
          </Button>
        ))}
      </div>

      <p className="text-small text-foreground-secondary" data-testid="audit-view-hint">
        {active.hint}
      </p>

      {view === "impersonations" ? (
        <ImpersonationView />
      ) : view === "operators" ? (
        <OperatorAuditFeed />
      ) : (
        // Keyed on the view so switching remounts rather than reusing the previous view's filter
        // state. The three tenant-trail views share a component but not a question: an action
        // filter chosen on "All events" cannot return rows under "Logins", and carrying it across
        // would show a reader an empty grid for a filter they cannot see.
        <AuditTrail key={view} view={view} />
      )}

      <AuditCoveragePanel />
    </div>
  );
}
