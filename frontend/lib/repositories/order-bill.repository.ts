import { get } from "@/lib/api-client/request";
import { apiOrderPrintHistorySchema } from "@/lib/api-client/schemas/order-bill.schema";
import type { PrintJobIssue } from "@/lib/models/order-bill.model";

/**
 * What paper an order has produced (Layer 2).
 *
 * <p>A pure READ. It allocates no sequence and writes no row — which is exactly why it is separate
 * from `PrintRepository.issueReceipt`, whose POST is a deliberate act of handing somebody a piece
 * of paper. A screen that wants to SAY whether a bill exists must not create one to find out.
 */
export const OrderBillRepository = {
  /** `GET /api/v1/pos/orders/{orderId}/print-jobs` — every issue for the order, oldest first. */
  async history(orderId: string): Promise<PrintJobIssue[]> {
    const raw = await get<unknown>(`/api/v1/pos/orders/${orderId}/print-jobs`);
    return apiOrderPrintHistorySchema.parse(raw).map((row) => ({
      printJobId: row.printJobId,
      documentType: row.documentType,
      targetPrinterId: row.targetPrinterId,
      issueSeq: row.issueSeq,
      status: row.status,
      issuedAt: row.issuedAt,
      originalIssuedAt: row.originalIssuedAt ?? null,
    }));
  },
};
