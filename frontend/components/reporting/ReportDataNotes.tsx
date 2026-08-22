"use client";

import { Info } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A report's own caveats, on the screen (`ReportResultDto.dataNotes`).
 *
 * <h3>The defect class this phase exists to stop</h3>
 *
 * `dataNotes` is the mechanism by which the backend declares that part of a result is degraded —
 * `ReportService.java:81` attaches one to `sales-by-item` so the reader knows the em-dashes in
 * the COGS column are a missing subsystem and not a missing sale. A report that receives that
 * sentence and does not print it is a report quietly presenting an incomplete answer as a
 * complete one, which is worse than the degradation it is hiding.
 *
 * <h3>Whatever the API sends, verbatim, and nothing else</h3>
 *
 * The previous implementation hardcoded a FALLBACK — if a result carried `cogs_paisa` and the
 * server sent no note, the UI supplied *"COGS and margin require Inventory (Phase 8) and are not
 * yet available."* out of its own pocket. Two things are wrong with that, and the second is the
 * one that matters:
 *
 * 1. It is a **second source of truth for a sentence the backend owns**. That exact string is
 *    being revised server-side right now; the frontend copy would have gone on asserting the old
 *    wording for as long as nobody grepped for it.
 * 2. It makes the UI **claim to know why** a column is null. It does not. It knows the column is
 *    null, which the `—` already says honestly. Inventing the reason is the same defect as
 *    inventing the number.
 *
 * So: no fallback, no suppression, no re-ordering, no truncation. Zero notes renders nothing at
 * all — an empty advisory strip is furniture that teaches readers to stop looking at it.
 *
 * <h3>Loud enough to read, quieter than an error (D-38-19)</h3>
 *
 * This is `info`-toned and **not** an `Alert`: `components/ui/alert.tsx` renders `role="alert"`,
 * an assertive live region. A standing caveat about a deferred subsystem is not an interruption,
 * and announcing it assertively on every run would train a screen-reader user to tune out the
 * role that a failed report actually needs. It is a plain, permanently visible block with an
 * icon, so it survives greyscale — the icon and the border are the channels, the tint is third.
 */
export function ReportDataNotes({
  notes,
  className,
}: {
  notes: readonly string[];
  className?: string;
}) {
  if (notes.length === 0) return null;

  return (
    <div
      data-testid="report-data-notes"
      className={cn(
        "flex items-start gap-(--space-sm) rounded-lg border border-info/30 bg-info/10 p-(--space-md)",
        className,
      )}
    >
      <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className="text-label font-semibold tracking-wide text-info uppercase">
          About this data
        </p>
        <ul className="space-y-1 text-small text-foreground-secondary">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
