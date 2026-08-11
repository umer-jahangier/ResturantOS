import { apiClient } from "@/lib/api-client/client";
import { get } from "@/lib/api-client/request";
import { apiIssuedPrintDocumentSchema } from "@/lib/api-client/schemas/print.schema";
import { adaptPrintDocument } from "@/lib/adapters/print.adapter";
import type { PrintDocument } from "@/lib/models/print.model";

/** An issue of a printable document, with the row it was recorded on. */
export interface IssuedPrintDocument {
  printJobId: string;
  /** `"unassigned"` when the branch has no printer configured — a supported branch, not an error. */
  targetPrinterId: string;
  document: PrintDocument;
}

function adaptIssued(raw: unknown): IssuedPrintDocument {
  const parsed = apiIssuedPrintDocumentSchema.parse(raw);
  return {
    printJobId: parsed.printJobId,
    targetPrinterId: parsed.targetPrinterId,
    document: adaptPrintDocument(parsed.document),
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

  /** `GET /api/v1/pos/print-jobs/{printJobId}` — re-serve a stored document. Allocates nothing. */
  async getPrintJob(printJobId: string): Promise<IssuedPrintDocument> {
    const raw = await get<unknown>(`/api/v1/pos/print-jobs/${printJobId}`);
    return adaptIssued(raw);
  },
};
