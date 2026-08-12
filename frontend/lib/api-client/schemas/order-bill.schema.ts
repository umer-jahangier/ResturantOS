import { z } from "zod";

/**
 * Layer-1 (§7.2.5): the RAW wire shape of pos-service's
 * `OrderBillHistoryController.PrintJobIssue` — one row of an order's print history.
 *
 * <p>Deliberately NOT `strictObject`. This endpoint's job is to answer "has a bill been produced
 * for this check, and when", and the answer must survive a later plan adding a field to the row.
 * The one thing that must never be tolerated is a MISSING field, which is what `issuedAt` being
 * required expresses: a bill with no issue time cannot answer the question this exists for.
 */
export const apiPrintJobIssueSchema = z.object({
  printJobId: z.string().uuid(),
  documentType: z.enum(["CUSTOMER_RECEIPT", "KITCHEN_TICKET"]),
  /** `"unassigned"` when the branch has no printer for this document — a supported branch. */
  targetPrinterId: z.string(),
  /** 1 is the original. Anything higher is a reprint of it. */
  issueSeq: z.number().int().positive(),
  status: z.enum(["ISSUED", "QUEUED", "CLAIMED", "PRINTED", "FAILED", "DEAD_LETTERED"]),
  issuedAt: z.string(),
  /** Null on the original; on a reprint, when the original was issued. */
  originalIssuedAt: z.string().nullable().optional(),
});

export const apiOrderPrintHistorySchema = z.array(apiPrintJobIssueSchema);

export type ApiPrintJobIssue = z.infer<typeof apiPrintJobIssueSchema>;
