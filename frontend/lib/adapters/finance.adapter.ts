// Layer-2 adapters: raw API shapes → domain models. The adapter layer is the
// only code that touches field name mapping between wire format and domain.

import type {
  ApiAccount,
  ApiJournalEntry,
  ApiJournalLine,
  ApiAccountingPeriod,
  ApiGlBalance,
  ApiFinanceSetupStatus,
  ApiExpense,
  ApiApAging,
  ApiApAgingBucket,
  ApiCustomerAccount,
  ApiArTransaction,
  ApiArAging,
  ApiCustomerAccountStatement,
  ApiProvisioningResult,
} from "@/lib/api-client/schemas/finance.schema";
import type {
  Account,
  AccountType,
  JournalEntry,
  JournalLine,
  AccountingPeriod,
  GlBalance,
  FinanceSetupStatus,
  Expense,
  ExpenseStatus,
  ApAging,
  ApAgingBucket,
  CustomerAccount,
  CustomerAccountStatus,
  ArTransaction,
  ArTxnType,
  ArAging,
  CustomerAccountStatement,
  ProvisioningResult,
} from "@/lib/models/finance.model";

export function adaptAccount(raw: ApiAccount): Account {
  return {
    id: raw.id,
    code: raw.code,
    name: raw.name,
    accountType: raw.accountType as AccountType,
    parentCode: raw.parentCode,
    system: raw.system,
    systemTag: raw.systemTag,
    active: raw.active,
  };
}

export function adaptJournalLine(raw: ApiJournalLine): JournalLine {
  return {
    id: raw.id,
    accountCode: raw.accountCode,
    description: raw.description,
    debitPaisa: raw.debitPaisa,
    creditPaisa: raw.creditPaisa,
  };
}

export function adaptJournalEntry(raw: ApiJournalEntry): JournalEntry {
  return {
    id: raw.id,
    entryNo: raw.entryNo,
    entryDate: raw.entryDate,
    description: raw.description,
    status: raw.status,
    totalDebitPaisa: raw.totalDebitPaisa,
    totalCreditPaisa: raw.totalCreditPaisa,
    lines: raw.lines.map(adaptJournalLine),
  };
}

export function adaptAccountingPeriod(raw: ApiAccountingPeriod): AccountingPeriod {
  return {
    id: raw.id,
    fiscalYear: raw.fiscalYear,
    periodNo: raw.periodNo,
    startDate: raw.startDate,
    endDate: raw.endDate,
    status: raw.status,
    lockedBy: raw.lockedBy,
    lockedAt: raw.lockedAt,
  };
}

export function adaptGlBalance(raw: ApiGlBalance): GlBalance {
  return {
    accountCode: raw.accountCode,
    accountName: raw.accountName,
    debitTotal: raw.debitTotal,
    creditTotal: raw.creditTotal,
    netBalance: raw.netBalance,
  };
}

export function adaptFinanceSetupStatus(raw: ApiFinanceSetupStatus): FinanceSetupStatus {
  return {
    accountCount: raw.accountCount,
    periodCount: raw.periodCount,
    provisioned: raw.provisioned,
  };
}

export function adaptExpense(raw: ApiExpense): Expense {
  return {
    id: raw.id,
    branchId: raw.branchId,
    expenseDate: raw.expenseDate,
    expenseAccountCode: raw.expenseAccountCode,
    description: raw.description,
    amountPaisa: raw.amountPaisa,
    status: raw.status as ExpenseStatus,
    requestedBy: raw.requestedBy,
    approvedBy: raw.approvedBy,
    approvedAt: raw.approvedAt,
    rejectReason: raw.rejectReason,
  };
}

export function adaptApAgingBucket(raw: ApiApAgingBucket): ApAgingBucket {
  return {
    label: raw.label,
    minDays: raw.minDays,
    maxDays: raw.maxDays,
    amountPaisa: raw.amountPaisa,
  };
}

export function adaptApAging(raw: ApiApAging): ApAging {
  return {
    totalApPaisa: raw.totalApPaisa,
    buckets: raw.buckets.map(adaptApAgingBucket),
  };
}

// ── FIN-05 AR half (10-18) ────────────────────────────────────────────────

export function adaptCustomerAccount(raw: ApiCustomerAccount): CustomerAccount {
  return {
    id: raw.id,
    branchId: raw.branchId,
    accountCode: raw.accountCode,
    name: raw.name,
    contactName: raw.contactName,
    contactPhone: raw.contactPhone,
    contactEmail: raw.contactEmail,
    creditLimitPaisa: raw.creditLimitPaisa,
    paymentTermsDays: raw.paymentTermsDays,
    status: raw.status as CustomerAccountStatus,
    crmCustomerId: raw.crmCustomerId,
    balancePaisa: raw.balancePaisa,
  };
}

export function adaptArTransaction(raw: ApiArTransaction): ArTransaction {
  return {
    id: raw.id,
    customerAccountId: raw.customerAccountId,
    txnType: raw.txnType as ArTxnType,
    txnDate: raw.txnDate,
    dueDate: raw.dueDate,
    amountPaisa: raw.amountPaisa,
    sourceType: raw.sourceType,
    sourceId: raw.sourceId,
    journalEntryId: raw.journalEntryId,
    reference: raw.reference,
    memo: raw.memo,
    balanceAfterPaisa: raw.balanceAfterPaisa,
  };
}

export function adaptArAging(raw: ApiArAging): ArAging {
  return {
    totalArPaisa: raw.totalArPaisa,
    buckets: raw.buckets.map(adaptApAgingBucket),
  };
}

export function adaptArStatement(raw: ApiCustomerAccountStatement): CustomerAccountStatement {
  return {
    account: adaptCustomerAccount(raw.account),
    balancePaisa: raw.balancePaisa,
    transactions: raw.transactions.map(adaptArTransaction),
  };
}

export function adaptProvisioningResult(raw: ApiProvisioningResult): ProvisioningResult {
  return {
    accountsSeeded: raw.accountsSeeded,
    periodsSeeded: raw.periodsSeeded,
  };
}
