import { apiClient } from "@/lib/api-client/client";
import { get } from "@/lib/api-client/request";
import { apiIssuedPrintDocumentSchema } from "@/lib/api-client/schemas/print.schema";
import { adaptPrintDocument } from "@/lib/adapters/print.adapter";
import type { PrintDocument } from "@/lib/models/print.model";
import type { PrintAgentPresence, PrintJobStatus } from "@/lib/models/print-agent.model";

/** An issue of a printable document, with the row it was recorded on. */
export interface IssuedPrintDocument {
  printJobId: string;
  /** `"unassigned"` when the branch has no printer configured — a supported branch, not an error. */
  targetPrinterId: string;
  document: PrintDocument;
  /**
   * The row's status at the moment of the read. `PRINTED` is the agent's acknowledgement that the
   * bytes reached the device; every other value means no paper has come out yet.
   */
  status: PrintJobStatus;
  /** Whether anything on this branch is in a position to collect the job, and which machine. */
  agent: PrintAgentPresence;
}

function adaptIssued(raw: unknown): IssuedPrintDocument {
  const parsed = apiIssuedPrintDocumentSchema.parse(raw);
  return {
    printJobId: parsed.printJobId,
    targetPrinterId: parsed.targetPrinterId,
    document: adaptPrintDocument(parsed.document),
    status: parsed.status,
    agent: {
      enrolled: parsed.agent.enrolled,
      label: parsed.agent.label,
      lastSeenAt: parsed.agent.lastSeenAt,
    },
  };
}

/**
 * The printable document for an order (Phase 26, plan 26-03).
 *
 * <p><b>Issuing is a POST because it WRITES.</b> It allocates a sequence number and inserts a
 * `print_jobs` row. That is why there is no `getOrIssue` convenience here: a GET-shaped call that
 * mutates gets replayed by every prefetch, retry and reload, and the reprint count — the only
 * record of how many pieces of paper a customer was handed — becomes fiction.
 *
 * <p><b>The document is never assembled here.</b> The browser receives one the server built from
 * persisted order rows. A client-assembled bill could not carry an FBR number and would drift from
 * the ledger the moment pricing changed.
 */
export const PrintRepository = {
  /**
   * `POST /api/v1/pos/orders/{orderId}/print-jobs` — issue (or re-issue) the customer receipt.
   *
   * @param idempotencyKey sent as `Idempotency-Key`, mirroring `createOrder`/`sendToKds`. A retry
   *   returns the SAME issue rather than inflating the reprint count.
   */
  async issueReceipt(
    orderId: string,
    branchId: string,
    idempotencyKey: string,
  ): Promise<IssuedPrintDocument> {
    const raw = await apiClient.post<{ data: unknown }>(
      `/api/v1/pos/orders/${orderId}/print-jobs`,
      undefined,
      {
        params: { branchId },
        headers: { "Idempotency-Key": idempotencyKey },
      },
    );
    return adaptIssued(raw.data.data);
  },

  /**
   * `POST /api/v1/pos/orders/{orderId}/kitchen-tickets/reprint` — the lost-KOT path (S1-06).
   *
   * <p>A kitchen ticket is a piece of paper on a spike in a hot room; it gets knocked off and it
   * gets wet. Until this endpoint existed the product had no way to produce another one, because
   * the only reprint path issues a CUSTOMER receipt and nothing ever addressed a kitchen printer
   * twice.
   *
   * <p>One reprint per station, re-serving the bytes the kitchen was originally given so a ticket
   * reprinted after the guest added a course still shows what the cooks were told. Deliberately NOT
   * idempotency-keyed: asking twice is asking for two pieces of paper, which is exactly what a
   * cook who lost the first one wants.
   *
   * @returns one entry per station reprinted. An EMPTY array is a real answer — nothing was ever
   *   fired, or every station was unrouted when it was — and the caller must say so out loud
   *   rather than showing a success it did not get.
   */
  async reprintKitchenTickets(orderId: string, branchId: string): Promise<IssuedPrintDocument[]> {
    const raw = await apiClient.post<{ data: unknown }>(
      `/api/v1/pos/orders/${orderId}/kitchen-tickets/reprint`,
      undefined,
      { params: { branchId } },
    );
    const list = raw.data.data;
    return (Array.isArray(list) ? list : []).map(adaptIssued);
  },

  /** `GET /api/v1/pos/print-jobs/{printJobId}` — re-serve a stored document. Allocates nothing. */
  async getPrintJob(printJobId: string): Promise<IssuedPrintDocument> {
    const raw = await get<unknown>(`/api/v1/pos/print-jobs/${printJobId}`);
    return adaptIssued(raw);
  },
};
