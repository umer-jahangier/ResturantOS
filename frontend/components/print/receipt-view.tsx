"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";

import { QueryBoundary } from "@/components/ui/query-boundary";
import { ReceiptDocumentView } from "@/components/print/receipt-document";
import { useIssueReceipt } from "@/lib/hooks/pos/use-print-document";
import "@/components/print/receipt-print.css";

/**
 * The printable-bill screen (26-05 task 3).
 *
 * <p>Separated from the route file for the same reason `ChargeSummary` is: the page holds the
 * guards, the component holds the content. It also makes this testable without a Suspense boundary
 * around `use(params)`.
 *
 * <p><b>No success toast, deliberately.</b> `window.print()` has no completion callback, no failure
 * signal and no paper-out status (research §4.1), so the product cannot observe whether anything
 * came out of a printer. Claiming a print succeeded would be the same lie as the Appearance screen
 * that reported saving a setting it had discarded.
 */
export function ReceiptView({ orderId }: { orderId: string }) {
  const router = useRouter();
  const query = useIssueReceipt(orderId);
  const printedRef = useRef(false);

  const document = query.data?.document;

  useEffect(() => {
    // Once, after the document has rendered. The ref guard is not decoration: React re-runs effects
    // on dependency changes and runs them twice in StrictMode, and a print dialog that reopens
    // itself is a dialog a cashier cannot get out of.
    if (!document || printedRef.current) return;
    printedRef.current = true;
    // A frame, so the browser has painted the receipt before the dialog snapshots the page.
    const handle = window.requestAnimationFrame(() => window.print());
    return () => window.cancelAnimationFrame(handle);
  }, [document]);

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
          A manual path as well as the automatic dialog: a browser can block the automatic one, and
          a blocked dialog with no button is a dead end at the counter.
        */}
        <button
          type="button"
          data-testid="print-again-button"
          disabled={!document}
          onClick={() => window.print()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Printer className="size-4" aria-hidden="true" />
          Print
        </button>
      </div>

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
