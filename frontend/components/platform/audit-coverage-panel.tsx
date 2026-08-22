"use client";

import { CircleCheck, CircleSlash, Lock } from "lucide-react";

import { ConsoleFact, ConsoleSection } from "@/components/platform/console-section";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlatformAuditCoverage } from "@/lib/hooks/use-platform-audit";
import type { CoverageItem } from "@/lib/models/platform-audit.model";

/**
 * What the trail covers, and — the half that matters — what it does not.
 *
 * <h3>Why this is on the screen rather than in a wiki</h3>
 *
 * Because the gaps are exactly the kind a console papers over by omission, and the reader who
 * needs them is looking at the grid right now. The load-bearing example, from the backend's own
 * words: **SuperAdmin logins to the control plane are not in `audit_events` at all** —
 * `audit_events.tenant_id` is NOT NULL and a platform login has no tenant, `platform_users` carries
 * no `last_login_at` column. A "platform operator activity" panel built on this data would be
 * permanently empty, and an empty panel reads as a quiet week rather than as a missing feed.
 *
 * <p>That is the same failure this whole screen is written against, one level up: an absence of
 * data mistaken for a fact about the world.
 *
 * <h3>Why it is fetched rather than written here</h3>
 *
 * A console that restates the backend's caveats in its own words has two copies of them, and the
 * copy nobody re-reads is the one that goes stale. These sentences change when a service starts or
 * stops publishing an event type — a deployment, not a redesign — and the endpoint exists so the
 * screen tracks that without a frontend change.
 */

function CoverageList({
  items,
  tone,
}: {
  items: CoverageItem[];
  tone: "captured" | "notCaptured";
}) {
  const Icon = tone === "captured" ? CircleCheck : CircleSlash;
  return (
    <ul className="flex flex-col gap-(--space-sm)">
      {items.map((item) => (
        <li key={item.subject} className="flex gap-2">
          <Icon
            className={
              tone === "captured"
                ? "mt-0.5 size-4 shrink-0 text-success"
                : "mt-0.5 size-4 shrink-0 text-foreground-tertiary"
            }
            aria-hidden="true"
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-small font-semibold text-foreground">{item.subject}</span>
            <span className="text-small text-foreground-secondary">{item.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AuditCoveragePanel() {
  const coverage = usePlatformAuditCoverage();
  const data = coverage.data;

  return (
    <ConsoleSection
      anchorId="platform-audit-coverage"
      eyebrow="Provenance"
      title="What this trail covers, and what it does not"
      description="Reported by the audit service itself, so a change in what the product records shows up here without a change to this screen."
      data-testid="audit-coverage"
    >
      <QueryBoundary
        query={coverage}
        what="the audit trail's coverage statement"
        moduleLabel="Audit"
        // No retry offered. This is a description of the product, and a reader who cannot get it
        // still has a working grid above; pressing Try again on a caveat while investigating an
        // incident is noise in the wrong direction.
        hideRetry
        loading={
          <div className="grid gap-(--space-md) md:grid-cols-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-40 rounded-lg" />
            ))}
          </div>
        }
      >
        {data ? (
          <div className="flex flex-col gap-(--space-lg)">
            <div className="grid gap-(--space-lg) md:grid-cols-2">
              <div className="flex flex-col gap-(--space-sm)">
                <span className="text-label font-semibold tracking-eyebrow text-foreground-tertiary uppercase">
                  Captured
                </span>
                <CoverageList items={data.captured} tone="captured" />
              </div>
              <div className="flex flex-col gap-(--space-sm)">
                <span className="text-label font-semibold tracking-eyebrow text-foreground-tertiary uppercase">
                  Not captured
                </span>
                <CoverageList items={data.notCaptured} tone="notCaptured" />
              </div>
            </div>

            <dl className="grid gap-(--space-md) border-t pt-(--space-md) md:grid-cols-2">
              <ConsoleFact label="Retention" value={data.retention} absence="Not stated" />
              <ConsoleFact
                label="Immutability"
                value={
                  <span className="flex items-start gap-1.5">
                    <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    {data.immutability}
                  </span>
                }
                absence="Not stated"
              />
            </dl>
          </div>
        ) : null}
      </QueryBoundary>
    </ConsoleSection>
  );
}
