"use client";

import { ServerOff, UserCheck, UserMinus, Users } from "lucide-react";

import { formatNumber } from "@/lib/format/locale";
import { CardEyebrow } from "@/components/ui/card";
import { ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { usePlatformDirectorySummary } from "@/lib/hooks/use-platform-overview";
import {
  inactiveUsers,
  isScanComplete,
  type DirectoryScan,
  type DirectorySummary,
} from "@/lib/models/platform-overview.model";

/**
 * People across every tenant — and, when the count is not knowable, the reason instead.
 *
 * <h3>This is the screen the `scan` block was designed for</h3>
 *
 * There is **no cross-tenant user query in this product**. `auth_db.users` is FORCE row-level
 * security on `app.current_tenant_id`, `platform_db` holds no grant in `auth_db` and has neither
 * `postgres_fdw` nor `dblink`, and the only door — `GET /internal/auth/users` — requires an
 * `X-Tenant-Id` and returns one tenant's page. So a fleet headcount is N HTTP calls with N chances
 * to fail, and the endpoint returns a `scan` block saying how many it made, which tenants it could
 * not read, and whether the fan-out cap cut it short.
 *
 * <p>When any tenant is unreachable the backend **withholds the total** rather than reporting a
 * smaller one. This component's entire job is to honour that: the tile renders
 * `unavailableReason`, the tenants that could not be reached are NAMED, and no number that reads
 * as complete appears anywhere. "3 tenants unreachable" tells an operator their list is wrong;
 * naming them tells them WHICH restaurant is missing from it, which is the difference between a
 * warning they can act on and one they learn to ignore.
 *
 * <h3>Why "inactive" is often blank while the other two are not</h3>
 *
 * It is a subtraction, and a subtraction is only as sound as both operands. The headcount and the
 * active headcount are two independent fan-outs — a tenant can answer one and time out on the
 * other — so `inactiveUsers()` refuses to subtract unless both scans are complete AND covered the
 * same number of tenants. A difference computed across two different tenant sets would be the
 * most confidently-rendered wrong number on the page.
 */

/** Why a tile has no figure, phrased for the person reading it rather than for a log. */
function whyNoTotal(scan: DirectoryScan): string {
  if (scan.totalNote) return scan.totalNote;
  if (scan.unreachable.length > 0) {
    return `${formatNumber(scan.unreachable.length)} of ${formatNumber(scan.tenantsMatched)} tenants could not be read, so the total is not known.`;
  }
  if (scan.truncated) {
    return "The scan stopped at the fan-out cap, so this would be a prefix rather than a total.";
  }
  return "The directory did not return a total for this scan.";
}

/**
 * The provenance strip.
 *
 * <p>Rendered whenever the scan was anything less than exhaustive — never hidden behind a
 * disclosure. The backend's own note on the shape is the argument: the scan block is part of the
 * DATA rather than a warning header "because a client that has to opt in to noticing an incomplete
 * answer will not", and a screen that puts it behind a chevron has opted out on the reader's
 * behalf.
 *
 * <p>The caveat itself goes through `ConsoleNote`, the console's shared "stated absence, ruled
 * off" device, so it looks ISSUED rather than broken and reads in the same voice as every other
 * absence in this console. `ConsoleNote` renders a `<p>`, so the NAMED tenants sit in a real
 * `<ul>` beside it rather than being smuggled into a paragraph as spans — a list of restaurants
 * an operator has to go and check is a list, and marking it up as one is what lets them navigate
 * it.
 */
function ScanProvenance({ summary }: { summary: DirectorySummary }) {
  const { all } = summary;
  const complete = isScanComplete(all) && isScanComplete(summary.active);

  if (complete) {
    return (
      <p className="text-small text-foreground-tertiary">
        Counted across all {formatNumber(all.tenantsScanned)} tenants. Every tenant answered.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-(--space-sm)" data-testid="directory-scan-partial">
      <ConsoleNote tone="warning">
        <span className="mb-1 flex items-center gap-2 font-semibold text-warning">
          <ServerOff className="size-4 shrink-0" aria-hidden="true" />
          Partial scan — the fleet headcount is not complete
        </span>
        Read {formatNumber(all.tenantsScanned)} of {formatNumber(all.tenantsMatched)} tenants.{" "}
        {whyNoTotal(all)}
        {all.truncated
          ? " The scan stopped at the fan-out ceiling, so the tenants after it in slug order were never asked. Narrow by tenant on the user directory to get an exact answer."
          : null}
      </ConsoleNote>

      {all.unreachable.length > 0 && (
        <div className="flex flex-col gap-1">
          <CardEyebrow>Could not be reached</CardEyebrow>
          <ul className="flex flex-col gap-1">
            {all.unreachable.map((tenant) => (
              <li key={tenant.tenantId} className="flex flex-wrap items-baseline gap-2 text-small">
                {/* Mono tabular for the identifier, which is the column an operator matches by eye
                    against a log line or a support ticket. */}
                <span className="font-mono font-medium text-foreground">{tenant.tenantSlug}</span>
                {tenant.detail && <span className="text-foreground-tertiary">{tenant.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PeopleTiles({ summary }: { summary: DirectorySummary }) {
  const inactive = inactiveUsers(summary);

  return (
    <div className="grid gap-(--space-md) md:grid-cols-3">
      {summary.all.total === null ? (
        <StatTile
          label="Users"
          unavailableReason={whyNoTotal(summary.all)}
          icon={Users}
          accent="secondary"
          surface="glass"
        />
      ) : (
        <StatTile
          label="Users"
          value={formatNumber(summary.all.total)}
          icon={Users}
          accent="secondary"
          surface="glass"
        />
      )}

      {summary.active.total === null ? (
        <StatTile
          label="Can sign in today"
          unavailableReason={whyNoTotal(summary.active)}
          icon={UserCheck}
          accent="secondary"
          surface="glass"
        />
      ) : (
        <StatTile
          label="Can sign in today"
          value={formatNumber(summary.active.total)}
          icon={UserCheck}
          accent="secondary"
          surface="glass"
        />
      )}

      {inactive === null ? (
        <StatTile
          label="Deactivated or locked"
          unavailableReason="Both headcounts must be exact and cover the same tenants before one can be subtracted from the other. One of them is not."
          icon={UserMinus}
          surface="glass"
        />
      ) : (
        <StatTile
          label="Deactivated or locked"
          value={formatNumber(inactive)}
          icon={UserMinus}
          surface="glass"
        />
      )}
    </div>
  );
}

export function OverviewPeople() {
  const directory = usePlatformDirectorySummary();
  const summary = directory.data;

  return (
    <ConsoleSection
      anchorId="platform-people"
      eyebrow="Directory"
      title="People across the fleet"
      description="Two fan-outs, one per headcount — there is no cross-tenant user query in this product."
    >
      <QueryBoundary
        query={directory}
        what="the cross-tenant user directory"
        moduleLabel="Platform"
        loading={
          <div className="grid gap-(--space-md) md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        }
      >
        {summary ? (
          <div className="flex flex-col gap-(--space-md)">
            {/*
              "Can sign in today" rather than "Active", because that is what the filter actually
              means: the backend's ACTIVE is the flag AND the absence of a live lockout, since an
              account with a future `locked_until` cannot log in and listing it as active tells an
              operator the opposite of what they need.
            */}
            <PeopleTiles summary={summary} />
            <ScanProvenance summary={summary} />
          </div>
        ) : null}
      </QueryBoundary>
    </ConsoleSection>
  );
}
