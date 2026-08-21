"use client";

import * as React from "react";
import Link from "next/link";
import {
  Banknote,
  BookOpen,
  KeyRound,
  ReceiptText,
  ScrollText,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import {
  ActivityFeed,
  ActivityRow,
  ActivitySubject,
  type ActivityTone,
} from "@/components/ui/activity-row";
import { ELAPSED_ABSOLUTE_BOUND_MS, readElapsed } from "@/lib/format/elapsed";
import { DATE_LOCALE, formatNumber, NO_VALUE } from "@/lib/format/locale";
import type { AuditEvent } from "@/lib/models/audit.model";
import { cn } from "@/lib/utils";

/**
 * The audit digest (N7) — the last five things that happened in this business, as a block small
 * enough to sit beside something else.
 *
 * <h3>What exists, and what this is not</h3>
 *
 * <p>`audit-log.tsx` is the full record: a server-paged `DataGrid` with a date window, an action
 * facet, a resource facet, per-row detail expansion and a stated total. It is the right shape for
 * *"who voided that check on the 14th, and why"* and the wrong shape for *"is anything happening
 * right now"* — a question a reader asks in one glance, from a screen that is mostly about
 * something else. `Docs/NEXUS_ERP_Demo.html:1313-1317` answers the second question in five rows
 * of `event · actor · time` and a link out. This is that, against real events.
 *
 * <p><b>It is a summary and it says so.</b> The link out is not decoration: a five-row window on
 * an append-only compliance record must never be mistakable for the record. The row count is
 * stated, the link is always present when a destination is given, and there is no pager — a
 * digest that could be paged would be a worse copy of the screen it links to.
 *
 * <h3>Two demo columns are NOT rendered, deliberately</h3>
 *
 * <p>The demo's admin screen (`:1288-1292`) also carries **Last Active** (`2h ago`, `Active now`)
 * and **2FA** (`On`/`Off`). Neither has a backing column in this system: there is no
 * last-seen timestamp on a user record and no per-user MFA-enrolment flag exposed to any read
 * this screen can make. Under D-38-16 a number this system cannot compute is rendered as a stated
 * absence and never as a figure — and the honest absence for a column that does not exist is to
 * **not draw the column at all**. `unavailableReason` is for a tile whose slot is real and whose
 * value is missing; inventing the slot first and then apologising inside it would be inventing
 * the fact.
 *
 * <h3>Severity is not claimed, because an audit trail does not triage</h3>
 *
 * <p>Every tone here is CATEGORICAL — `accent` for the trading side, `secondary` for the access
 * side, `neutral` for the rest — and the visible word is the event's own `resourceType`, read
 * off the row. No row is painted `danger`, and that is a decision rather than an omission: a void
 * is a recorded fact, not an alert, and this feed sits beside `ExceptionList`, which is the
 * component that DOES triage. Colouring `ORDER_VOIDED` red here would put a severity claim on a
 * compliance record that nothing in the record supports, and would teach a reader to read the
 * same red on the dashboard as ordinary.
 *
 * <p>This also keeps D-38-13's constraint intact for free: `secondary` (teal) sits ΔE2000 18.68
 * from `--success-600` and must never carry state meaning. Here nothing carries state meaning.
 *
 * <h3>The clock is a parameter</h3>
 *
 * <p>`now` is required and nothing in this file reads `Date.now()`. Relative labels come from
 * `lib/format/elapsed.ts` — the one duration formatter in the product, which takes an explicit
 * clock for exactly this reason: a label derived from a render-time clock renders one string on
 * the server and a different one in the browser milliseconds later, which React reconciles as a
 * text mismatch. `activity-row.tsx` refuses to format time itself for the same reason. No second
 * formatter is added here.
 *
 * <h3>Impersonation is never collapsed</h3>
 *
 * <p>When a row carries an impersonator, the digest says so in the row, in the same words
 * `audit-log.tsx` uses. D-34 recorded every user as their own impersonator, and the account acted
 * AS is not the human who acted. A digest that dropped it to save a line would be the compact
 * view quietly disagreeing with the full one about who did something.
 */

/** `ORDER_VOIDED` → `Order voided`. The same transform the full log applies to the same field. */
function humaniseAction(action: string): string {
  const words = action.replace(/_/g, " ").toLowerCase().trim();
  if (words === "") return "Event recorded";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `ORDER` → `Order`. Falls back to a word, never to a blank chip. */
function humaniseResource(resourceType: string | null): string {
  if (!resourceType || resourceType.trim() === "") return "Event";
  return humaniseAction(resourceType);
}

/**
 * Who did it, in the most specific form available — the same ladder `audit-log.tsx:actorLabel`
 * walks, and for the same reason: the id IS the record and the name is resolved decoration a
 * directory outage can withhold. A blank would read as "nobody did this", which of an audit row
 * is never true.
 */
function actorLabel(event: AuditEvent): string {
  if (event.actorName) return event.actorName;
  if (event.actorId) return `${event.actorId.slice(0, 8)}…`;
  return "Not recorded";
}

/**
 * The categorical hue and the glyph, keyed on the resource the event names.
 *
 * <p>Keyed on `resourceType` rather than on the action because the resource is a closed noun the
 * server derives, while action names grow with every feature. An unknown resource lands on
 * `neutral` + a scroll, which is a correct answer rather than a wrong colour.
 */
const RESOURCE_PRESENTATION: Record<string, { tone: ActivityTone; icon: React.ReactNode }> = {
  ORDER: { tone: "accent", icon: <ReceiptText /> },
  TILL: { tone: "accent", icon: <Banknote /> },
  PAYMENT: { tone: "accent", icon: <Banknote /> },
  INVOICE: { tone: "accent", icon: <ReceiptText /> },
  JOURNAL: { tone: "accent", icon: <BookOpen /> },
  USER: { tone: "secondary", icon: <UserRound /> },
  ROLE: { tone: "secondary", icon: <ShieldCheck /> },
  PERMISSION: { tone: "secondary", icon: <ShieldCheck /> },
  PASSWORD: { tone: "secondary", icon: <KeyRound /> },
  SESSION: { tone: "secondary", icon: <KeyRound /> },
};

const FALLBACK_PRESENTATION = { tone: "neutral" as ActivityTone, icon: <ScrollText /> };

function presentationFor(resourceType: string | null) {
  if (!resourceType) return FALLBACK_PRESENTATION;
  return RESOURCE_PRESENTATION[resourceType.trim().toUpperCase()] ?? FALLBACK_PRESENTATION;
}

/**
 * The right-hand time.
 *
 * <p>`"ago"` is appended only while the reading is still a DURATION. Past
 * {@link ELAPSED_ABSOLUTE_BOUND_MS} the formatter stops counting and returns a date — `7 Aug
 * 2026` — and `"7 Aug 2026 ago"` is not a thing anybody writes. Reading the bound from the
 * module that owns it is the point: a local `> 30 days` check here would be a second copy of a
 * threshold, which is how the KDS ended up with two.
 */
function timeLabelFor(
  event: AuditEvent,
  now: Date,
  timeZone: string | null | undefined,
): { label: string; dateTime?: string; srLabel: string } {
  // The adapter turns an unparseable instant into the epoch precisely so it can be shown as an
  // absence rather than as "Invalid Date" in the middle of a sentence about who did what.
  if (event.occurredAt.getTime() === 0) {
    return { label: NO_VALUE, srLabel: "time not recorded" };
  }
  const reading = readElapsed(event.occurredAt, now, {
    timeZone: timeZone ?? undefined,
    locale: DATE_LOCALE,
  });
  const isDuration = reading.ageMs !== null && reading.ageMs < ELAPSED_ABSOLUTE_BOUND_MS;
  return {
    label: isDuration ? `${reading.long} ago` : reading.long,
    dateTime: event.occurredAt.toISOString(),
    srLabel: isDuration ? `${reading.srLabel} ago` : reading.srLabel,
  };
}

export interface AuditDigestProps {
  /** Newest first, as the endpoint returns them. Nothing here re-sorts. */
  events: AuditEvent[];
  /** The clock. Explicit — see the docblock; this component never reads `Date.now()`. */
  now: Date;
  /** How many rows the block shows. The demo's is 5, which is the default. */
  limit?: number;
  /** The BRANCH's IANA zone, for the absolute stamp past the 30-day bound. Never the browser's. */
  timeZone?: string | null;
  /** Where the full record lives. Omit only when the reader cannot reach it. */
  href?: string;
  /** The block's heading. */
  title?: string;
  className?: string;
}

export function AuditDigest({
  events,
  now,
  limit = 5,
  timeZone,
  href,
  title = "Latest activity",
  className,
}: AuditDigestProps) {
  const headingId = React.useId();
  const shown = events.slice(0, limit);

  return (
    <section
      aria-labelledby={headingId}
      data-testid="audit-digest"
      className={cn("rounded-xl border border-border bg-card text-card-foreground", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-(--space-sm) border-b border-border px-5 py-4">
        <h2
          id={headingId}
          className="text-label font-semibold uppercase tracking-wide text-foreground-secondary"
        >
          {title}
        </h2>
        {href ? (
          <Link
            href={href}
            data-testid="audit-digest-full-log"
            className="inline-flex min-h-11 items-center text-small font-medium text-primary underline-offset-4 hover:underline"
          >
            View full log
          </Link>
        ) : null}
      </div>

      <div className="px-5 py-2">
        {shown.length === 0 ? (
          // Deliberately NOT "nothing has happened". This component is handed rows; whether the
          // read succeeded is the caller's fact to state, and `QueryBoundary` states it. What
          // this can honestly say is that the window it was given is empty.
          <p role="status" className="py-6 text-center text-body text-muted-foreground">
            No events recorded in this window.
          </p>
        ) : (
          <ActivityFeed label={title}>
            {shown.map((event) => {
              const { tone, icon } = presentationFor(event.resourceType);
              const time = timeLabelFor(event, now, timeZone);
              return (
                <ActivityRow
                  key={event.id}
                  icon={icon}
                  tone={tone}
                  toneLabel={humaniseResource(event.resourceType)}
                  timeLabel={time.label}
                  dateTime={time.dateTime}
                >
                  <ActivitySubject>{humaniseAction(event.action)}</ActivitySubject>{" "}
                  <span aria-hidden="true">·</span> {actorLabel(event)}
                  {event.impersonatorId ? (
                    <>
                      {" "}
                      <span aria-hidden="true">·</span> acting as this account:{" "}
                      {event.impersonatorName ?? `${event.impersonatorId.slice(0, 8)}…`}
                    </>
                  ) : null}
                  {event.reason ? <> — {event.reason}</> : null}
                  {/* `07:42`-style labels are announced as clock times; the spelled-out reading
                      is what a screen reader should hear beside the sentence. */}
                  <span className="sr-only"> ({time.srLabel})</span>
                </ActivityRow>
              );
            })}
          </ActivityFeed>
        )}
      </div>

      {shown.length > 0 ? (
        <p
          className="border-t border-border px-5 py-3 text-small text-foreground-tertiary"
          data-testid="audit-digest-caption"
        >
          The{" "}
          {shown.length === 1
            ? "most recent event"
            : `${formatNumber(shown.length)} most recent events`}{" "}
          in this business. This is a summary, not the record.
        </p>
      ) : null}
    </section>
  );
}
