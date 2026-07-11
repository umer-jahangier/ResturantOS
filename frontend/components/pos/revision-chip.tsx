"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// Shared revision-marker primitives (POS-12 / KDS-03), used identically by the cashier
// terminal (a later plan) and the KDS ticket detail (a later plan) — the UI-SPEC "Status
// System" Revision Marker rules are encoded here ONCE.

interface RevisionBadgeProps {
  /** The line's revisionNo (1, 2, 3…) set at fire time. */
  revisionNo: number;
  className?: string;
}

/**
 * Per-line revision marker. Rev 1 items get NO badge (default treatment — reduces
 * visual noise for the common case). Rev n>1 items get a small "REV {n}" pill using
 * `--accent`/`--accent-foreground` — a channel deliberately distinct from both the
 * pipeline-stage hue (StatusBadge) and the KDS card's aging-border urgency color; the
 * three channels must never be conflated (UI-SPEC "Revision marker").
 */
export function RevisionBadge({ revisionNo, className }: RevisionBadgeProps) {
  if (revisionNo <= 1) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent-foreground",
        className,
      )}
      aria-label={`Revision ${revisionNo}`}
    >
      REV {revisionNo}
    </span>
  );
}

export interface RevisionLogEntry {
  revisionNo: number;
  /** ISO timestamp string or Date — firedAt for this revision. */
  firedAt: string | Date | null;
  itemCount: number;
}

interface RevisionCountChipProps {
  revisions: RevisionLogEntry[];
  className?: string;
}

function formatRevisionTime(value: string | Date | null): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Compact tappable "{n} revisions" chip (ticket header / Order Detail header) that
 * expands to a log of "Rev {n} · {time} · {count} item(s)" entries.
 */
export function RevisionCountChip({ revisions, className }: RevisionCountChipProps) {
  const [expanded, setExpanded] = useState(false);

  if (revisions.length === 0) return null;

  const count = revisions.length;

  return (
    <div className={cn("flex flex-col items-start gap-1", className)}>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted/80"
        aria-expanded={expanded}
        aria-label={`${count} revision${count !== 1 ? "s" : ""}`}
      >
        {count} revision{count !== 1 ? "s" : ""}
      </button>

      {expanded && (
        <ul
          data-testid="revision-log"
          className="flex flex-col gap-0.5 rounded border border-border bg-card p-2 text-xs text-muted-foreground"
        >
          {revisions.map((rev) => (
            <li key={rev.revisionNo}>
              Rev {rev.revisionNo} · {formatRevisionTime(rev.firedAt)} · {rev.itemCount} item
              {rev.itemCount !== 1 ? "s" : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
