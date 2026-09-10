"use client";

import * as React from "react";
import { KeyRound, LockOpen, LogOut, UserCheck, UserX } from "lucide-react";

import { ActivityRow, ActivitySubject, type ActivityTone } from "@/components/ui/activity-row";
import { Button } from "@/components/ui/button";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { formatDateTime, formatNumber } from "@/lib/format/locale";
import { useTenantOperatorAudit } from "@/lib/hooks/use-platform-operator-audit";
import { operatorActionLabel, type OperatorAuditRecord } from "@/lib/models/platform.model";

/**
 * What platform operators have done to this tenant's user accounts.
 *
 * <h3>What this trail covers, stated precisely, because the gap matters</h3>
 *
 * `platform_admin_audit` records exactly five actions, all of them against a tenant's USERS:
 * password reset, deactivate, reactivate, unlock and revoke-sessions. A CHECK constraint in the
 * schema mirrors that enum rather than trusting it, so adding a sixth requires a changeset — which
 * is the intended amount of friction for widening what a SuperAdmin may do.
 *
 * <p><b>It does not record tenant lifecycle transitions.</b> Suspending, cancelling, closing and
 * re-tiering write no row to this table: the first three leave a service log line carrying the
 * reason, and a tier or plan move lands in the subscription history above with its actor attached.
 * So this panel is NOT "everything that has happened to this tenant", and the note below says so.
 * A feed that quietly omitted four of the heaviest actions on the console while looking complete
 * would be worse than no feed — an abuse review would read it and conclude nothing happened.
 *
 * <h3>Refusals are here too, and that is the point</h3>
 *
 * A REFUSED row is written alongside every SUCCEEDED one. An operator repeatedly attempting
 * something they are refused is precisely the pattern a review looks for, and a trail of successes
 * alone cannot show it.
 *
 * <h3>Why the actor is not re-resolved</h3>
 *
 * `platformUserEmail` is stored at WRITE time. The SuperAdmin credential IS rotated, and a trail
 * that re-resolved its own actors would change its own history — so the email shown is the one that
 * account had when it acted, even if the account has since been renamed or deleted.
 */
export function TenantActivityPanel({
  tenantId,
  tenantName,
}: {
  tenantId: string;
  tenantName: string;
}) {
  const [page, setPage] = React.useState(0);
  const audit = useTenantOperatorAudit(tenantId, page);
  const data = audit.data;
  const records = data?.records ?? [];

  return (
    <ConsoleSection
      anchorId="activity"
      eyebrow="Activity"
      title="Platform operator actions"
      description={`Platform-tier actions taken against ${tenantName}'s user accounts, newest first.`}
      data-testid="tenant-activity"
    >
      <div className="flex flex-col gap-(--space-md)">
        <ConsoleNote data-testid="operator-audit-scope">
          This trail covers five platform-tier actions on a tenant&apos;s <em>users</em> — password
          reset, deactivate, reactivate, unlock and revoke sessions — and records refusals as well
          as successes. It does <span className="font-semibold">not</span> cover tenant lifecycle: a
          suspension, cancellation or close leaves a service log line carrying its reason, and a
          tier or plan move is recorded in the subscription history above. There is no single feed
          of everything that has happened to this tenant, and this is not one.
        </ConsoleNote>

        <QueryBoundary
          query={audit}
          what="this tenant's operator trail"
          loading={<Skeleton className="h-24" />}
          isEmpty={Boolean(data) && records.length === 0}
          empty={
            <ConsoleNote data-testid="operator-audit-empty">
              No platform operator has acted on a user account in {tenantName}. This is an
              append-only record with no edit or delete path, so an empty one means nothing happened
              — not that something was removed.
            </ConsoleNote>
          }
        >
          {data ? (
            <div className="flex flex-col gap-(--space-sm)">
              <ul className="flex flex-col" data-testid="operator-audit-feed">
                {records.map((record) => (
                  <li key={record.id} data-testid={`operator-audit-${record.id}`}>
                    <OperatorAuditEntry record={record} />
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center justify-between gap-(--space-sm)">
                <p className="text-small text-foreground-secondary">
                  {formatNumber(data.totalCount)} action{data.totalCount === 1 ? "" : "s"} recorded
                </p>
                <div className="flex items-center gap-(--space-sm)">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage(page - 1)}
                    data-testid="operator-audit-prev"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={data.nextPage === null}
                    onClick={() => setPage(page + 1)}
                    data-testid="operator-audit-next"
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </QueryBoundary>
      </div>
    </ConsoleSection>
  );
}

const ACTION_ICON: Record<string, React.ReactNode> = {
  USER_PASSWORD_RESET: <KeyRound />,
  USER_DEACTIVATED: <UserX />,
  USER_REACTIVATED: <UserCheck />,
  USER_UNLOCKED: <LockOpen />,
  USER_SESSIONS_REVOKED: <LogOut />,
};

function OperatorAuditEntry({ record }: { record: OperatorAuditRecord }) {
  const refused = record.outcome === "REFUSED";
  // The refusal is the loud one. A succeeded action on a user account is a normal operator act and
  // should not shout; a refused one is the shape an abuse review is scanning for.
  const tone: ActivityTone = refused ? "danger" : "neutral";

  return (
    <ActivityRow
      icon={ACTION_ICON[record.action ?? ""] ?? <KeyRound />}
      tone={tone}
      toneLabel={refused ? "Refused" : "Applied"}
      timeLabel={formatDateTime(record.occurredAt)}
      dateTime={record.occurredAt.toISOString()}
    >
      <span>
        <ActivitySubject>
          {record.platformUserEmail ?? "A platform account that no longer exists"}
        </ActivitySubject>{" "}
        {refused ? "was refused" : "performed"} {operatorActionLabel(record.action).toLowerCase()}
        {record.targetUserId ? (
          <>
            {" on user "}
            <span className="font-mono">{record.targetUserId.slice(0, 8)}</span>
          </>
        ) : null}
        {". "}
        {record.reason ? (
          <span className="text-foreground-secondary">{record.reason}</span>
        ) : (
          // The API refuses a blank reason on every one of these endpoints, so a null here means a
          // row written before that rule or by a path that bypassed it. Saying so beats a blank.
          <span className="text-foreground-tertiary">No reason recorded.</span>
        )}
        {record.detail ? <span className="text-foreground-tertiary"> {record.detail}</span> : null}
      </span>
    </ActivityRow>
  );
}
