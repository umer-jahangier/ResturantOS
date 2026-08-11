// Layer-1 domain model for the transaction register (37-08 / 37-11, D-37-01).

/**
 * A row is a MONEY EVENT, not an order — the grain decision made in 37-08.
 * An order settled half in cash and half by card is TWO rows.
 */
export type TransactionEventKind = "TENDER" | "REFUND" | "VOID";

export interface TransactionRow {
  eventKind: TransactionEventKind;
  eventAt: Date;
  orderId: string;
  orderNo: string;
  branchId: string | null;
  cashierId: string | null;
  tillSessionId: string | null;
  /** TENDER rows only. */
  tenderMethod: string | null;
  /**
   * What THIS event moved, in paisa. Negative for a refund or a void.
   * The only summable money on the row.
   */
  eventAmountPaisa: number;
  reason: string | null;

  /**
   * The ORDER's figures, for context. NOT this row's.
   * Summing these across rows double-counts every split-tender order — the `order` prefix is the
   * warning. See 37-08's TransactionRowDto javadoc.
   */
  orderStatus: string;
  orderSubtotalPaisa: number;
  orderDiscountPaisa: number;
  orderTaxPaisa: number;
  orderServiceChargePaisa: number;
  orderTotalPaisa: number;
}

export interface TransactionRegisterPage {
  rows: TransactionRow[];
  page: number;
  size: number;
  totalRows: number;
  /** Aggregates over the WHOLE filtered range, never the page. */
  netAmountPaisa: number;
  tenderedPaisa: number;
  refundedPaisa: number;
  voidedPaisa: number;
}

export interface TransactionFilters {
  from: string;
  to: string;
  branchId?: string;
  cashierId?: string;
  tenderMethod?: string;
  eventKinds?: TransactionEventKind[];
  page?: number;
  size?: number;
}

/** The four states 37-04's SourceReferenceDto can report. */
export type SourceReferenceState =
  | "RESOLVED"
  | "NOT_APPLICABLE"
  | "UNSUPPORTED_SOURCE_TYPE"
  | "LOOKUP_FAILED";

export interface JournalEntryLine {
  accountCode: string;
  description: string | null;
  debitPaisa: number;
  creditPaisa: number;
}

export interface LinkedJournalEntry {
  id: string;
  entryNo: string;
  entryDate: string;
  description: string | null;
  sourceType: string | null;
  status: string;
  totalDebitPaisa: number;
  totalCreditPaisa: number;
  lines: JournalEntryLine[];
  sourceReference: {
    state: SourceReferenceState;
    orderNo: string | null;
    reason: string | null;
  } | null;
}
