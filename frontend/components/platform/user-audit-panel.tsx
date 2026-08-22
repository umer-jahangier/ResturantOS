"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  KeyRound,
  LogOut,
  ShieldCheck,
  Unlock,
  UserCheck,
  UserX,
  type LucideIcon,
} from "lucide-react";

import { ActivityFeed, ActivityRow, type ActivityTone } from "@/components/ui/activity-row";
import { Button } from "@/components/ui/button";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { formatDateTime, formatNumber } from "@/lib/format/locale";
import { useUserOperatorAudit } from "@/lib/hooks/use-platform-access";
import { operatorActionLabel, type OperatorAuditRecord } from "@/lib/models/platform.model";

/**
 * What the platform has done to this person, and who did it.
 *
 * <h3>Why this trail and not the tenant's own audit log</h3>
 *
 * `audit_db.audit_events` is per-tenant with FORCE row-level security on every partition, and a
 * platform token carries no tenant claim — so the tenant-facing audit endpoint refuses it with a
 * 401, correctly. This reads `platform_admin_audit` instead: the row written in the same
 * transaction as the action it records, by the same service that performed it. That makes it the
 * trail that survives an outbox failure, and for two of the recorded actions — clearing a lockout
 * and revoking sessions — there is no tenant-side event at all, so it is the only trail.
 *
 * <h3>What a row can and cannot contain</h3>
 *
 * It never carries a credential. The platform password reset hands a temporary password to the
 * operator once and it exists nowhere else — not in a log, not in an event, not in the row, and
 * not in this response, which has no field it could occupy.
 *
 * <p>The acting operator's EMAIL is stored at write time rather than resolved at read time,
 * because the SuperAdmin credential is rotated and a trail that re-resolved its own actors would
 * change its own history.
 *
 * <h3>Refusals are shown alongside successes</h3>
 *
 * An operator repeatedly attempting something they are refused is exactly the pattern an abuse
 * review looks for, and a feed of successes cannot show it. So the outcome is a channel of its own
 * on every row rather than an assumed success.
 */
export function UserAuditPanel({ userId, who }: { userId: string; who: string }) {
  const [page, setPage] = React.useState(0);
  const audit = useUserOperatorAudit(userId, page);
  const data = audit.data;
  const records = data?.records ?? [];

  return (
    <ConsoleSection
      anchorId="trail"
      eyebrow="Accountability"
      title="What the platform has done to this account"
      description={`Every platform-tier action taken against ${who}, with the reason its operator gave. Append-only — nothing on this console can edit or remove a row.`}
      data-testid="user-audit"
    >
      <QueryBoundary
        query={audit}
        what="the operator trail for this user"
        loading={
          <div className="flex flex-col gap-(--space-sm)">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        }
        isEmpty={Boolean(data) && records.length === 0}
        empty={
          <ConsoleNote data-testid="user-audit-empty">
            No platform operator has acted on this account. That is the ordinary state — this trail
            records only what platform staff do from this console, not what the tenant&apos;s own
            administrators do inside their restaurant.
          </ConsoleNote>
        }
      >
        {data && records.length > 0 ? (
          <div className="flex flex-col gap-(--space-md)">
            <ActivityFeed label={`Platform actions against ${who}`}>
              {records.map((record) => (
                <AuditRow key={record.id} record={record} />
              ))}
            </ActivityFeed>

            <AuditPager
              page={page}
              totalCount={data.totalCount}
              nextPage={data.nextPage}
              isFetching={audit.isFetching}
              onPage={setPage}
            />
          </div>
        ) : null}
      </QueryBoundary>
    </ConsoleSection>
  );
}

/**
 * One recorded action.
 *
 * <p>The tone is driven by the OUTCOME first and the action second. A refused deactivation is not
 * a deactivation, and painting it in the destructive hue because of its verb would make a review
 * read a wall of red as a wall of things that happened.
 */
function AuditRow({ record }: { record: OperatorAuditRecord }) {
  // `REFUSED` is the enum the table stores, checked by name rather than by "not SUCCEEDED": an
  // outcome this build has never heard of is not evidence that the action failed, and painting it
  // as a refusal would put red on a row nobody can interpret. It is surfaced verbatim instead.
  const refused = record.outcome === "REFUSED";
  const unrecognisedOutcome = record.outcome !== null && record.outcome !== "SUCCEEDED" && !refused;
  const Icon = ACTION_ICONS[record.action ?? ""] ?? ShieldCheck;
  const tone: ActivityTone = refused ? "danger" : (ACTION_TONES[record.action ?? ""] ?? "neutral");

  return (
    <ActivityRow
      icon={<Icon className="size-4" aria-hidden="true" />}
      tone={tone}
      toneLabel={refused ? "Refused" : undefined}
      timeLabel={formatDateTime(record.occurredAt)}
      dateTime={record.occurredAt.toISOString()}
    >
      <span className="flex flex-col gap-0.5">
        <span>
          <span className="font-medium">{operatorActionLabel(record.action)}</span>
          {/*
            The refusal is carried by `ActivityRow`'s own tone label — its channel for "colour is
            not the only signal" — rather than repeated in the sentence. Saying "Refused" twice on
            one row is not twice as clear; it is one more thing to keep in step.
          */}
          {unrecognisedOutcome && (
            <span className="ms-1.5 font-mono text-label text-foreground-tertiary">
              — {record.outcome}
            </span>
          )}
        </span>
        <span className="text-label text-foreground-secondary">
          {/*
            The operator is named from the value stored at WRITE time. A rotated SuperAdmin
            credential therefore cannot rewrite who did this.
          */}
          by{" "}
          <span className="font-mono">
            {record.platformUserEmail ?? record.platformUserId ?? "an unrecorded operator"}
          </span>
          {record.tenantSlug || record.tenantId ? (
            <>
              {" · "}
              {record.tenantId ? (
                <Link href={`/platform/tenants/${record.tenantId}`} className="hover:text-primary">
                  {record.tenantSlug ?? record.tenantId}
                </Link>
              ) : (
                record.tenantSlug
              )}
            </>
          ) : null}
        </span>
        {/*
          The reason is why every one of these endpoints refuses a blank one. An empty reason is
          shown as a stated absence rather than as whitespace — a row nobody can read is one
          somebody has to interpret.
        */}
        <span className="text-label">
          {record.reason ? (
            <span className="text-foreground">“{record.reason}”</span>
          ) : (
            <span className="text-foreground-tertiary">No reason recorded on this row.</span>
          )}
        </span>
        {record.detail && (
          <span className="font-mono text-label text-foreground-tertiary">{record.detail}</span>
        )}
      </span>
    </ActivityRow>
  );
}

/**
 * Icons and tones keyed by the five action names `platform_admin_audit` actually stores — mirrored
 * by a CHECK constraint on the table, so this list cannot silently fall behind a rename.
 *
 * <p>There is no role-grant action here because there is no role-grant capability: the platform
 * tier's RBAC surface is read-only, and the audit enum reflects that rather than reserving a slot
 * for it. An action this build does not recognise still renders — with the neutral tone and the
 * generic glyph — because a row nobody can draw is still a row that happened.
 */
const ACTION_ICONS: Record<string, LucideIcon> = {
  USER_DEACTIVATED: UserX,
  USER_REACTIVATED: UserCheck,
  USER_UNLOCKED: Unlock,
  USER_SESSIONS_REVOKED: LogOut,
  USER_PASSWORD_RESET: KeyRound,
};

const ACTION_TONES: Record<string, ActivityTone> = {
  USER_DEACTIVATED: "warning",
  USER_REACTIVATED: "success",
  USER_UNLOCKED: "info",
  USER_SESSIONS_REVOKED: "warning",
  USER_PASSWORD_RESET: "accent",
};

/**
 * The pager, driven by the envelope's own "last page" signal.
 *
 * `nextCursor` carries the page NUMBER and a null means there is no next page. Without that signal
 * a client can only discover the end by asking for a page and receiving nothing — which is
 * indistinguishable from a failed filter, and on an accountability trail "nothing happened" is a
 * conclusion somebody would act on.
 */
function AuditPager({
  page,
  totalCount,
  nextPage,
  isFetching,
  onPage,
}: {
  page: number;
  totalCount: number;
  nextPage: number | null;
  isFetching: boolean;
  onPage: (page: number) => void;
}) {
  if (page === 0 && nextPage === null) {
    return (
      <p className="text-small text-foreground-secondary" data-testid="user-audit-count">
        {formatNumber(totalCount)} recorded {totalCount === 1 ? "action" : "actions"}, all shown.
      </p>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-(--space-sm)"
      data-testid="user-audit-pager"
    >
      <p className="text-small text-foreground-secondary">
        {formatNumber(totalCount)} recorded {totalCount === 1 ? "action" : "actions"}.
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0 || isFetching}
          onClick={() => onPage(page - 1)}
          data-testid="user-audit-prev"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Newer
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={nextPage === null || isFetching}
          onClick={() => nextPage !== null && onPage(nextPage)}
          data-testid="user-audit-next"
        >
          Older
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
