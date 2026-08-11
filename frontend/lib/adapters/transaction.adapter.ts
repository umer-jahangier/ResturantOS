import type {
  JournalEntryLine,
  LinkedJournalEntry,
  TransactionRegisterPage,
  TransactionRow,
} from "@/lib/models/transaction.model";

// Layer-2b adapter: wire shape -> domain model. Money stays integer paisa the whole way;
// it is converted to a string ONLY at render, through formatPaisa (37-01).

/* eslint-disable @typescript-eslint/no-explicit-any */

export function adaptTransactionRow(raw: any): TransactionRow {
  return {
    eventKind: raw.eventKind,
    eventAt: new Date(raw.eventAt),
    orderId: raw.orderId,
    orderNo: raw.orderNo,
    branchId: raw.branchId ?? null,
    cashierId: raw.cashierId ?? null,
    tillSessionId: raw.tillSessionId ?? null,
    tenderMethod: raw.tenderMethod ?? null,
    eventAmountPaisa: Number(raw.eventAmountPaisa ?? 0),
    reason: raw.reason ?? null,
    orderStatus: raw.orderStatus,
    orderSubtotalPaisa: Number(raw.orderSubtotalPaisa ?? 0),
    orderDiscountPaisa: Number(raw.orderDiscountPaisa ?? 0),
    orderTaxPaisa: Number(raw.orderTaxPaisa ?? 0),
    orderServiceChargePaisa: Number(raw.orderServiceChargePaisa ?? 0),
    orderTotalPaisa: Number(raw.orderTotalPaisa ?? 0),
  };
}

export function adaptTransactionPage(raw: any): TransactionRegisterPage {
  return {
    rows: (raw.rows ?? []).map(adaptTransactionRow),
    page: Number(raw.page ?? 0),
    size: Number(raw.size ?? 0),
    totalRows: Number(raw.totalRows ?? 0),
    netAmountPaisa: Number(raw.netAmountPaisa ?? 0),
    tenderedPaisa: Number(raw.tenderedPaisa ?? 0),
    refundedPaisa: Number(raw.refundedPaisa ?? 0),
    voidedPaisa: Number(raw.voidedPaisa ?? 0),
  };
}

export function adaptLinkedJournalEntry(raw: any): LinkedJournalEntry {
  const lines: JournalEntryLine[] = (raw.lines ?? []).map((l: any) => ({
    accountCode: l.accountCode,
    description: l.description ?? null,
    debitPaisa: Number(l.debitPaisa ?? 0),
    creditPaisa: Number(l.creditPaisa ?? 0),
  }));
  return {
    id: raw.id,
    entryNo: raw.entryNo,
    entryDate: raw.entryDate,
    description: raw.description ?? null,
    sourceType: raw.sourceType ?? null,
    status: raw.status,
    totalDebitPaisa: Number(raw.totalDebitPaisa ?? 0),
    totalCreditPaisa: Number(raw.totalCreditPaisa ?? 0),
    lines,
    // Deliberately preserved as a discriminated state rather than flattened to a string.
    // 37-04: four outcomes, and collapsing them makes one dash mean four different things.
    sourceReference: raw.sourceReference
      ? {
          state: raw.sourceReference.state,
          orderNo: raw.sourceReference.orderNo ?? null,
          reason: raw.sourceReference.reason ?? null,
        }
      : null,
  };
}
