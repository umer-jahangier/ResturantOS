"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, Printer, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { ReceiptDocumentView } from "@/components/print/receipt-document";
import { useIssueReceipt, useReceiptDelivery } from "@/lib/hooks/pos/use-print-document";
import {
  describeLastSeen,
  receiptDeliveryState,
  UNASSIGNED_TARGET,
  type PrintAgentPresence,
  type ReceiptDeliveryState,
} from "@/lib/models/print-agent.model";
import "@/components/print/receipt-print.css";

/**
 * The printable-bill screen (26-05 task 3, repaired by S1-06, made honest by F8).
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
 * addressed to {@link UNASSIGNED_TARGET}, no agent will ever claim it, and the browser's own print
 * dialog is the honest and only path (D-26-01).
 *
 * <h2>What F8 changed, and why it is not cosmetic</h2>
 *
 * <p>This screen used to render <b>"Sent to the receipt printer … the branch print agent will put
 * it on paper"</b> for every routed bill, unconditionally. It said that whether or not any agent
 * existed, and whether or not any agent had polled this century. Measured live on 2026-08-12 with
 * NINE enrolled agents, every one of them reading "Not responding" on the Printers screen two
 * clicks away: the cashier was told paper was coming and no paper was coming.
 *
 * <p>That is this codebase's signature defect — <i>structurally present, behaviourally absent</i> —
 * in its most expensive form, because the person misled is holding a customer's money. The queue,
 * the agent, the transports and the ESC/POS renderer were all real and all worked; the sentence on
 * the screen was the only part that was fiction.
 *
 * <p>So the screen no longer predicts. It reads the row's own status and the branch's live agent
 * presence, both of which ride on the issue response the cashier is already entitled to, and it
 * re-reads the row until the agent's own acknowledgement arrives. Four outcomes, four different
 * sentences, and only one of them claims paper.
 *
 * <p><b>Still no success toast, and still no claim that the customer has their bill.</b>
 * `window.print()` has no completion callback and no paper-out status (research §4.1), and neither
 * a TCP socket nor a spooler reports that paper moved. `PRINTED` here means the agent acknowledged
 * that the BYTES reached the device — the strongest claim this product is ever allowed to make.
 */

/** Copy per delivery outcome. One place, so no two states can drift into saying the same thing. */
function deliveryCopy(
  state: ReceiptDeliveryState,
  printerId: string,
  agent: PrintAgentPresence,
): { title: string; detail: string; tone: string; alert: boolean; Icon: typeof Printer } {
  const who = agent.label ?? "The branch print agent";

  switch (state) {
    case "ON_PAPER":
      return {
        title: `Printed on ${printerId}`,
        detail: `${who} took this bill and reported it delivered to the printer. No browser print dialog was opened. If the paper is blank or jammed, print another copy below — this one is already recorded as issued.`,
        tone: "border-success/40 bg-success/10",
        alert: false,
        Icon: CheckCircle2,
      };
    case "IN_FLIGHT":
      return {
        title: `Printing on ${printerId}…`,
        detail: `${who} is connected and collecting this bill now. This notice will confirm when the agent reports it delivered.`,
        tone: "border-info/40 bg-info/10",
        alert: false,
        Icon: Loader2,
      };
    case "NO_AGENT":
      return {
        title: "This bill has NOT been printed",
        detail:
          agent.enrolled === 0
            ? `No print agent is enrolled on this branch, so nothing will collect the job queued for ${printerId} and no paper will come out. The bill is held and will print if an agent is enrolled and started — meanwhile, use Print a paper copy below. An owner or manager enrols one at Settings → Printers.`
            : `${who} ${describeLastSeen(agent.lastSeenAt)}, so nothing is collecting the job queued for ${printerId} and no paper is coming out. The bill is held, not lost, and will print when that machine is back — meanwhile, use Print a paper copy below. Check the machine at Settings → Printers.`,
        tone: "border-destructive/50 bg-destructive/10",
        alert: true,
        Icon: AlertTriangle,
      };
    case "REFUSED":
      return {
        title: "The print agent could not print this bill",
        detail: `${who} tried to send this bill to ${printerId} and failed. The printer may be out of paper, switched off, or unreachable on the network. Use Print a paper copy below for the customer, then check the printer. Settings → Printers shows what the agent last reported.`,
        tone: "border-destructive/50 bg-destructive/10",
        alert: true,
        Icon: XCircle,
      };
    case "NO_PRINTER":
    default:
      return {
        title: "This branch has no receipt printer",
        detail:
          "The bill was recorded but addressed to no printer, so the browser's print dialog is the only way to get paper. Add a receipt printer at Settings → Printers to print without a dialog.",
        tone: "border-warning/50 bg-warning/10",
        alert: false,
        Icon: Printer,
      };
  }
}

export function ReceiptView({ orderId }: { orderId: string }) {
  const router = useRouter();
  const query = useIssueReceipt(orderId);
  const printedRef = useRef(false);

  const issued = query.data;

  /*
   * The live row, re-read until the agent acknowledges. Only ever started for a bill that IS
   * addressed to a printer: an `unassigned` bill has no agent to wait for, and polling for one
   * would be asking a question with no possible answer.
   */
  const routedToPrinter =
    issued === undefined ? undefined : issued.targetPrinterId !== UNASSIGNED_TARGET;
  const delivery = useReceiptDelivery(issued?.printJobId ?? null, routedToPrinter === true);

  /*
   * The freshest truth available: the polled row when it has arrived, the issue response until
   * then. NOT the other way round — falling back to the issue response after a poll would make the
   * notice flicker back to "printing…" every time a refetch was in flight.
   */
  const live = delivery.data ?? issued;

  const state: ReceiptDeliveryState | undefined =
    live === undefined
      ? undefined
      : receiptDeliveryState({
          targetPrinterId: live.targetPrinterId,
          status: live.status,
          agent: live.agent,
        });

  const document = issued?.document;

  useEffect(() => {
    // Once, after the document has rendered, and ONLY when there is no printer to send it to. The
    // ref guard is not decoration: React re-runs effects on dependency changes and runs them twice
    // in StrictMode, and a print dialog that reopens itself is one a cashier cannot get out of.
    //
    // Deliberately NOT opened for NO_AGENT. The job is queued and will print when the machine is
    // back; opening a dialog on top of that would hand the customer one bill and the kitchen
    // another an hour later. The cashier is told plainly, and presses the button if they need it.
    if (!document || routedToPrinter !== false || printedRef.current) return;
    printedRef.current = true;
    // A frame, so the browser has painted the receipt before the dialog snapshots the page.
    const handle = window.requestAnimationFrame(() => window.print());
    return () => window.cancelAnimationFrame(handle);
  }, [document, routedToPrinter]);

  const copy =
    state === undefined || live === undefined
      ? undefined
      : deliveryCopy(state, live.targetPrinterId, live.agent);

  const needsPaperNow = state === "NO_AGENT" || state === "REFUSED" || state === "NO_PRINTER";

  return (
    <div className="flex flex-col gap-4 p-4">
      {/*
        The route's one <h1>, sr-only, and inside `receipt-no-print` (UI-SPEC §11, plan 38-15
        task 2).

        <p>`/app/pos/orders/[orderId]/receipt` rendered NO heading of any level: the page
        delegates entirely to this component, and this component's own census is
        `<h1> 0, <h2> 0`. That is a fifth zero-`<h1>` route on top of the four the audit named,
        and it was missed for the ordinary reason — the audit probed pages, and this heading is
        owed by a component two files away.

        <p>Visually hidden rather than rendered, because the surface below IS the bill and a page
        title above it would be the app talking over the document. `receipt-no-print` and the
        stylesheet's `body * { visibility: hidden }` both keep it off the paper; belt and braces
        on the one element a customer would most notice on a receipt.
      */}
      <h1 className="receipt-no-print sr-only">Receipt</h1>
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
          The label follows the truth. When the agent has it in hand this button produces a SECOND
          copy and says so; when nothing is going to print it, this is the only way the customer
          leaves with paper, and it is named for that.

          The shared `Button` rather than a hand-rolled one: this screen shipped with its own
          height, radius and type size, which is how a second visual vocabulary starts. It also
          carried two raw palette literals that follow neither theme — replaced below by the
          semantic `success`/`info`/`warning`/`destructive` tokens, which have light AND dark
          values. Conformance gates G1 and G3 measure exactly this.
        */}
        <Button
          type="button"
          variant="outline"
          size="lg"
          data-testid="print-again-button"
          disabled={!document}
          onClick={() => window.print()}
        >
          <Printer className="size-4" aria-hidden="true" />
          {needsPaperNow ? "Print a paper copy" : "Print a browser copy"}
        </Button>
      </div>

      {copy !== undefined && live !== undefined && (
        <div
          className={`receipt-no-print rounded-lg border p-3 text-sm ${copy.tone}`}
          data-testid="delivery-notice"
          data-delivery-state={state}
          data-target-printer={live.targetPrinterId}
          {...(copy.alert ? { role: "alert" as const } : {})}
        >
          <p className="flex items-center gap-1.5 font-medium">
            <copy.Icon
              className={`size-4 ${state === "IN_FLIGHT" ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {copy.title}
          </p>
          <p className="mt-1 text-muted-foreground">{copy.detail}</p>
          {/*
            A failed re-read is NOT a delivery outcome and must never be folded into one. Without
            this line an unreachable gateway would leave "Printing on …" on screen for ever, which
            is the same comforting lie in a new costume.
          */}
          {delivery.isError && (
            <p className="mt-1 font-medium" data-testid="delivery-unconfirmed">
              This screen has lost contact with the server, so it can no longer confirm what
              happened to the paper. Check Settings → Printers, or print a paper copy above.
            </p>
          )}
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
