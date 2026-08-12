"use client";

import { UNASSIGNED_PRINT_TARGET, type PrintJobIssue } from "@/lib/models/order-bill.model";

export interface BillIssuedStripProps {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** The ORIGINAL bill for this order, or null when the check has produced no paper. */
  bill: PrintJobIssue | null;
  /** How many further copies have been issued since. */
  reprintCount: number;
}

function formatIssueTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/**
 * <h3>§3-3 — the cashier must be able to SEE that the guest's bill exists</h3>
 *
 * <p>The receipt used to be dispatched off the ORDER CLOSE and nothing on any screen said so. A
 * cashier took cash, counted out change, and the charge page looked exactly the same whether a bill
 * had been produced or not: the measured case was a check paid at 02:59 whose receipt was stamped
 * 03:15, when somebody finally pressed <i>Mark served &amp; close order</i>. The only way to find
 * that out was to read `print_jobs` in psql.
 *
 * <p>The bill is now issued at the tender. This strip is the half of that fix a person can see — it
 * reports what the server did, at the moment it did it, on the screen the money was taken on.
 *
 * <p><b>It never claims paper came out.</b> Nothing here can know that: a QUEUED job is one the
 * branch agent has yet to collect, and Settings → Printers is where delivery is answered. The
 * honest sentence is "issued at 09:41, sent to audit-receipt", not "printed".
 */
export function BillIssuedStrip({
  isLoading,
  isError,
  onRetry,
  bill,
  reprintCount,
}: BillIssuedStripProps) {
  if (isLoading) {
    return (
      <p className="mt-2 text-xs text-muted-foreground" data-testid="bill-issued-loading">
        Checking for this order&rsquo;s bill&hellip;
      </p>
    );
  }

  if (isError) {
    return (
      <div
        className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2"
        data-testid="bill-issued-error"
        role="alert"
      >
        <span className="text-xs text-destructive">
          Couldn&rsquo;t check whether a bill was issued for this order.
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="h-7 rounded-md border px-2 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!bill) {
    // A real answer, not an empty box: no paper has been produced for this check. On a branch with
    // a receipt printer that means something went wrong and Settings → Printers will say what; on a
    // branch with none it is simply how that branch works (D-26-01) and Print bill is the bill.
    return (
      <p
        className="mt-2 text-xs text-muted-foreground"
        data-testid="bill-issued-strip"
        data-bill-issued="false"
      >
        No bill has been produced for this order yet. Print bill makes one.
      </p>
    );
  }

  const routed = bill.targetPrinterId !== UNASSIGNED_PRINT_TARGET;
  return (
    <div
      className="mt-2 rounded-lg border border-success/40 bg-success/5 p-2"
      data-testid="bill-issued-strip"
      data-bill-issued="true"
      data-bill-issued-at={bill.issuedAt}
      data-bill-target={bill.targetPrinterId}
    >
      <p className="text-xs font-medium">Bill issued {formatIssueTime(bill.issuedAt)}</p>
      <p className="text-xs text-muted-foreground">
        {routed
          ? `Sent to ${bill.targetPrinterId}. Check Settings → Printers if no paper appears — the job is kept and retried, not lost.`
          : "This branch has no receipt printer configured, so the bill prints through the browser."}
        {reprintCount > 0
          ? ` · ${reprintCount} ${reprintCount === 1 ? "copy" : "copies"} reprinted since.`
          : ""}
      </p>
    </div>
  );
}
