/** The sentinel pos-service stores when a branch has no printer for a document. */
export const UNASSIGNED_PRINT_TARGET = "unassigned";

export type PrintJobDocumentType = "CUSTOMER_RECEIPT" | "KITCHEN_TICKET";

export type PrintJobIssueStatus =
  | "ISSUED"
  | "QUEUED"
  | "CLAIMED"
  | "PRINTED"
  | "FAILED"
  | "DEAD_LETTERED";

/**
 * One issue of one printable document for an order.
 *
 * <p>`issueSeq === 1` is the ORIGINAL — the paper the guest was handed. Everything above it is a
 * reprint of that same original, and `originalIssuedAt` says which moment it is a copy of. That
 * distinction is the whole of walkthrough §3-3: a bill whose original is stamped at the close
 * rather than at the tender is a bill the paying guest never saw.
 */
export interface PrintJobIssue {
  printJobId: string;
  documentType: PrintJobDocumentType;
  targetPrinterId: string;
  issueSeq: number;
  status: PrintJobIssueStatus;
  /** When THIS issue was stamped. */
  issuedAt: string;
  /** Null on the original. */
  originalIssuedAt: string | null;
}

/** The order's bill (customer receipt) issues, oldest first. Kitchen tickets are not bills. */
export function billIssues(issues: PrintJobIssue[]): PrintJobIssue[] {
  return issues.filter((i) => i.documentType === "CUSTOMER_RECEIPT");
}

/** The ORIGINAL bill, if one has been produced. */
export function originalBill(issues: PrintJobIssue[]): PrintJobIssue | null {
  return billIssues(issues).find((i) => i.issueSeq === 1) ?? null;
}
