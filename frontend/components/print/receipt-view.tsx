"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";

import { QueryBoundary } from "@/components/ui/query-boundary";
import { ReceiptDocumentView } from "@/components/print/receipt-document";
import { useIssueReceipt } from "@/lib/hooks/pos/use-print-document";
import "@/components/print/receipt-print.css";

/**
 * The sentinel pos-service stores on a print job when the branch has no printer configured. Not
 * null and not the empty string — it is half of a unique key. Mirrored here because it is the one
 * value that decides which of the two printing paths this screen is on.
 */
const UNASSIGNED_TARGET = "unassigned";

/**
 * The printable-bill screen (26-05 task 3, repaired by S1-06).
 *
 * <p>Separated from the route file for the same reason `ChargeSummary` is: the page holds the
 * guards, the component holds the content. It also makes this testable without a Suspense boundary
 * around `use(params)`.
 *
 * <h2>Two paths, and the screen must know which one it is on</h2>
 *
 * <p>Issuing a receipt writes a `print_jobs` row addressed to a printer. When the branch HAS a
 * receipt printer, that row is queued and the branch's print agent collects and prints it — on
 * paper, with a cut and a drawer kick, without a dialog. When the branch has no printer, the row is
 * addressed to {@link #UNASSIGNED_TARGET}, no agent will ever claim it, and the browser's own print
 * dialog is the honest and only path (D-26-01).
 *
 * <p>This component shipped calling `window.print()` unconditionally, which meant a branch that had
 * bought, wired and configured a thermal printer still got a Ctrl-P dialog on every bill — the
 * measured "window.print() count 2, agent calls 0". The dialog is now opened only on the path where
 * it is the truth.
 *
 * <p><b>No success toast on either path, deliberately.</b> `window.print()` has no completion
 * callback and no paper-out status (research §4.1), and neither a TCP socket nor a spooler reports
 * that paper moved. Claiming a print succeeded would be the same lie as the Appearance screen that
 * reported saving a setting it had discarded.
 */
export function ReceiptView({ orderId }: { orderId: string }) {
  const router = useRouter();
  const query = useIssueReceipt(orderId);
  const printedRef = useRef(false);

  const issued = query.data;
  const document = issued?.document;
  // `undefined` while loading — deliberately NOT collapsed into "no printer". Until the response
  // arrives the screen does not know which path it is on, and guessing would open a dialog over a
  // branch that has a printer.
  const routedToPrinter =
    issued === undefined ? undefined : issued.targetPrinterId !== UNASSIGNED_TARGET;

  useEffect(() => {
    // Once, after the document has rendered, and ONLY when there is no printer to send it to. The
    // ref guard is not decoration: React re-runs effects on dependency changes and runs them twice
    // in StrictMode, and a print dialog that reopens itself is one a cashier cannot get out of.
    if (!document || routedToPrinter !== false || printedRef.current) return;
    printedRef.current = true;
    // A frame, so the browser has painted the receipt before the dialog snapshots the page.
    const handle = window.requestAnimationFrame(() => window.print());
    return () => window.cancelAnimationFrame(handle);
  }, [document, routedToPrinter]);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/*
        `receipt-no-print` removes this strip from the paper. Everything outside `.receipt-root` is
        hidden by the print stylesheet anyway; this is belt and braces on the one element a reader
        would most notice on a bill.
      */}
      <div className="receipt-no-print flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Back
        </button>

        {/*
          On the thermal path this is NOT the primary action — the paper is already coming out of
          the printer — so it is labelled for what it actually does, which is produce a second copy
          through the browser. On the no-printer path it is the manual retry for a dialog the
          browser may have blocked, and a blocked dialog with no button is a dead end at the counter.
        */}
        <button
          type="button"
          data-testid="print-again-button"
          disabled={!document}
          onClick={() => window.print()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Printer className="size-4" aria-hidden="true" />
          {routedToPrinter ? "Print a browser copy" : "Print"}
        </button>
      </div>

      {routedToPrinter && (
        <div
          className="receipt-no-print rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm"
          data-testid="thermal-print-notice"
          data-target-printer={issued?.targetPrinterId}
        >
          <p className="font-medium">Sent to the receipt printer</p>
          <p className="text-muted-foreground">
            This bill was queued for <strong>{issued?.targetPrinterId}</strong> and the branch print
            agent will put it on paper. No browser print dialog is opened. If nothing comes out,
            check the agent on Settings → Printers — the job is kept and retried, not lost.
          </p>
        </div>
      )}

      <QueryBoundary query={query} what="the printable bill">
        {document ? (
          <div className="mx-auto border bg-white shadow-sm">
            <ReceiptDocumentView document={document} />
          </div>
        ) : null}
      </QueryBoundary>
    </div>
  );
}
