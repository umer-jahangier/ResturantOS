"use client";

import * as React from "react";
import Link from "next/link";
import { KeyRound } from "lucide-react";

import { ImpersonationResults } from "@/components/platform/impersonation-log";
import { ConsoleSection } from "@/components/platform/console-section";
import { formatNumber } from "@/lib/format/locale";
import { useTenantImpersonations } from "@/lib/hooks/use-platform-impersonations";

/**
 * "Who from the platform has been inside this restaurant?" — on the tenant's own screen.
 *
 * <h3>Why this panel opens with four paragraphs instead of a table</h3>
 *
 * Impersonation is the single most sensitive capability in this product. It does not grant a
 * platform operator a view of a tenant's data; it issues a token that AUTHENTICATES AS one of that
 * tenant's people. Everything done with it is done under their name — an order voided during an
 * impersonation is voided by them, in their tenant's own audit trail, and the person whose identity
 * was borrowed has no way to tell from inside their own product that it happened.
 *
 * <p>A console that renders that as a quiet table with a "Start session" button beside it has made
 * the most consequential action on the platform the most convenient one. So the consequences are
 * stated where the capability is, in words, before the log: who can do it, whose identity is taken,
 * for how long the credential lives, and where the record of it can be read afterwards.
 *
 * <h3>Why this is not the tenant's own audit log</h3>
 *
 * The tenant's OWNER can already read `IMPERSONATION_STARTED` from their audit trail, correctly
 * scoped to their tenant. That path works and is not duplicated here. This panel reads
 * `impersonation_log` in platform_db — the row written in the SAME transaction that minted the
 * token — so it is still correct if the outbox delivery that feeds the tenant's audit trail ever
 * failed, and it is the only view a SuperAdmin, who holds no tenant token, can reach at all.
 *
 * <h3>The empty state is a real answer here</h3>
 *
 * The API returns 404 for an unknown tenant, so an empty list on this panel means exactly one
 * thing: this tenant exists and nobody has ever impersonated into it. That is why the repository
 * does not soften the 404 — `QueryBoundary` renders the failure, never "no sessions".
 */
export function TenantImpersonationPanel({
  tenantId,
  tenantName,
}: {
  tenantId: string;
  tenantName: string;
}) {
  const [page, setPage] = React.useState(0);
  const impersonations = useTenantImpersonations(tenantId, page);

  const records = impersonations.data?.records ?? [];
  const live = records.filter((record) => record.status === "ACTIVE").length;
  const unknownExpiry = records.filter((record) => record.status === "UNKNOWN").length;

  return (
    <ConsoleSection
      anchorId="access"
      eyebrow="Platform access"
      title="Impersonation into this tenant"
      description={`Every time platform staff signed in as one of ${tenantName}'s own users.`}
      data-testid="tenant-impersonation"
    >
      <div className="flex flex-col gap-(--space-md)">
        {/*
          The weight. Every clause here is a property of the implementation, not a warning written
          to sound serious: the acting id is the `sub` of the RS256-verified control-plane token and
          is refused rather than defaulted when absent; the log row and the token are written in one
          transaction; and there is no update or delete path to the table from anywhere in this
          product.
        */}
        <div className="flex gap-(--space-md) rounded-lg border border-warning/40 bg-warning/10 p-(--space-md)">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-2 text-small">
            <p>
              <span className="font-semibold">What it does.</span> An impersonation issues a token
              that authenticates as a named user of {tenantName}. Actions taken with it are recorded
              against that person, inside their tenant, exactly as if they had performed them.
            </p>
            <p>
              <span className="font-semibold">Who it names.</span> The acting administrator is taken
              from the verified platform token and can never be supplied by the caller. An
              impersonation with no resolvable platform principal is refused outright rather than
              attributed to a placeholder — an audit row naming somebody who did not do it is worse
              than no row at all.
            </p>
            <p>
              <span className="font-semibold">How long it lasts.</span> Each session below shows the
              expiry of the credential that was issued. The status is derived from that expiry by
              the server and is never recomputed here: a browser judging &ldquo;is this still
              live?&rdquo; against its own clock would disagree with the server on any machine whose
              time is off, on the one screen where that question is the point.
            </p>
            <p>
              <span className="font-semibold">Where the trail is.</span> This list, which is
              append-only and has no edit or delete path from anywhere in the product — including
              for the administrators it names. The same rows appear across every tenant on the{" "}
              <Link href="/platform/impersonations" className="font-medium text-primary underline">
                platform-wide impersonation log
              </Link>
              , and the tenant&apos;s own owner sees each session as an{" "}
              <span className="font-mono">IMPERSONATION_STARTED</span> event in their audit trail.
              The issued token itself is never stored: the table has no column for it.
            </p>
          </div>
        </div>

        {records.length > 0 && (
          <p className="text-small text-foreground-secondary" data-testid="impersonation-summary">
            <span className="font-medium text-foreground">
              {formatNumber(records.length)} session{records.length === 1 ? "" : "s"} on this page
            </span>
            {": "}
            {live === 0
              ? "none with a credential still inside its validity window"
              : `${formatNumber(live)} still inside the issued credential's validity window`}
            {unknownExpiry > 0
              ? `, ${formatNumber(unknownExpiry)} with no recorded expiry at all`
              : ""}
            .
          </p>
        )}

        <ImpersonationResults
          query={impersonations}
          page={page}
          onPageChange={setPage}
          showTenant={false}
          what="this tenant's impersonation history"
          emptyTitle="No platform access recorded"
          emptyDescription={`No platform administrator has ever signed in as a user of ${tenantName}.`}
        />
      </div>
    </ConsoleSection>
  );
}
