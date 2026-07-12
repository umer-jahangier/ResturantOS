import { z } from "zod";

// RAW API field names (camelCase, per the finance-service contract Phase 6).
// This module is the ONLY place that knows the wire shape — repositories
// `.parse()` here and adapters convert to domain models.

export const apiAccountSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  accountType: z.string(),
  parentCode: z.string().nullable(),
  system: z.boolean(),
  systemTag: z.string().nullable(),
  active: z.boolean(),
});

export const apiJournalLineSchema = z.object({
  id: z.string().uuid(),
  accountCode: z.string(),
  description: z.string(),
  debitPaisa: z.number().int().nonnegative(),
  creditPaisa: z.number().int().nonnegative(),
});

const apiJournalEntryBaseSchema = z.object({
  id: z.string().uuid(),
  entryNo: z.string().nullable(),
  entryDate: z.string(),
  description: z.string(),
  status: z.enum(["DRAFT", "POSTED"]),
  totalDebitPaisa: z.number().int().nonnegative().optional(),
  totalCreditPaisa: z.number().int().nonnegative().optional(),
  lines: z.array(apiJournalLineSchema),
});

/** Totals may be omitted by older API responses — derive from lines when missing. */
export const apiJournalEntrySchema = apiJournalEntryBaseSchema.transform((raw) => ({
  ...raw,
  totalDebitPaisa:
    raw.totalDebitPaisa ??
    raw.lines.reduce((sum, line) => sum + line.debitPaisa, 0),
  totalCreditPaisa:
    raw.totalCreditPaisa ??
    raw.lines.reduce((sum, line) => sum + line.creditPaisa, 0),
}));

export const apiAccountingPeriodSchema = z.object({
  id: z.string().uuid(),
  fiscalYear: z.number().int(),
  periodNo: z.number().int(),
  startDate: z.string(),
  endDate: z.string(),
  status: z.enum(["OPEN", "LOCKED"]),
  lockedBy: z.string().uuid().nullable(),
  lockedAt: z.string().nullable(),
});

export const apiGlBalanceSchema = z.object({
  accountCode: z.string(),
  accountName: z.string(),
  debitTotal: z.number().int().nonnegative(),
  creditTotal: z.number().int().nonnegative(),
  netBalance: z.number().int(),
});

export const apiCreateJeLineSchema = z.object({
  accountCode: z.string(),
  description: z.string(),
  debitPaisa: z.number().int().nonnegative(),
  creditPaisa: z.number().int().nonnegative(),
});

export const apiFinanceSetupStatusSchema = z.object({
  accountCount: z.number().int().nonnegative(),
  periodCount: z.number().int().nonnegative(),
  provisioned: z.boolean(),
});

export const apiCreateJeSchema = z.object({
  entryDate: z.string(),
  description: z.string(),
  lines: z.array(apiCreateJeLineSchema).min(2),
});

// ── FIN-05: Expenses + AP Aging (10-14) ─────────────────────────────────────
// Mirrors finance-service's ExpenseDto/CreateExpenseRequest/ApAgingReportDto
// EXACTLY (read off the Java source, not plan prose — see 10-14-SUMMARY.md).
// List endpoint (`GET /api/v1/finance/expenses`) returns a plain
// `ApiResponse<List<ExpenseDto>>` per the 10-10 contract: NO PageMeta/pagination.

export const EXPENSE_STATUSES = [
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
] as const;

export const apiExpenseSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  expenseDate: z.string(),
  expenseAccountCode: z.string(),
  description: z.string().nullable(),
  amountPaisa: z.number().int().nonnegative(),
  status: z.enum(EXPENSE_STATUSES),
  requestedBy: z.string().uuid(),
  approvedBy: z.string().uuid().nullable(),
  approvedAt: z.string().nullable(),
  // Wire field is `rejectReason` (NOT `rejectionReason`) — confirmed against
  // ExpenseDto.java; do not "fix" this to match earlier plan prose.
  rejectReason: z.string().nullable(),
});

export const apiExpenseListSchema = z.array(apiExpenseSchema);

/** Wire body for `POST /api/v1/finance/expenses` — mirrors CreateExpenseRequest.java. */
export const apiCreateExpenseSchema = z.object({
  branchId: z.string().uuid(),
  expenseDate: z.string().min(1, "Expense date is required"),
  expenseAccountCode: z.string().min(1, "Expense account is required").max(20),
  description: z.string().max(500).optional(),
  amountPaisa: z.number().int().positive("Amount must be greater than zero"),
});

/** `POST /{id}/reject` body — reason is mandatory client-side AND server-side. */
export const rejectExpenseInputSchema = z.object({
  reason: z.string().trim().min(1, "A rejection reason is required"),
});

// ApAgingBucketDto.java carries NO invoice count field (label/minDays/maxDays/
// amountPaisa only) — earlier plan prose assumed invoice counts; the DTO wins.
export const apiApAgingBucketSchema = z.object({
  label: z.string(),
  minDays: z.number().int(),
  maxDays: z.number().int(),
  amountPaisa: z.number().int().nonnegative(),
});

export const apiApAgingSchema = z.object({
  totalApPaisa: z.number().int().nonnegative(),
  buckets: z.array(apiApAgingBucketSchema),
});

// ── FIN-05 AR half: House Accounts + AR Aging (10-18) ───────────────────────
// Mirrors finance-service's CustomerAccountDto/ArTransactionDto/ArAgingReportDto
// EXACTLY (read off the Java source — see 10-18-SUMMARY.md), following 10-14-A's
// precedent of trusting the DTO over plan prose.

export const CUSTOMER_ACCOUNT_STATUSES = ["ACTIVE", "SUSPENDED"] as const;

export const apiCustomerAccountSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  accountCode: z.string(),
  name: z.string(),
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  creditLimitPaisa: z.number().int().nonnegative(),
  paymentTermsDays: z.number().int().nonnegative(),
  status: z.enum(CUSTOMER_ACCOUNT_STATUSES),
  crmCustomerId: z.string().uuid().nullable(),
  balancePaisa: z.number().int(),
});

// GET /api/v1/finance/ar/customer-accounts is PAGINATED (matches AccountController's
// ApiResponse.paginated shape, NOT 10-10's PO/invoice/expense non-paginated decision —
// see 10-18-SUMMARY.md for why). Parsed per-row via getPaginated, same as listAccounts.

export const createCustomerAccountInputSchema = z.object({
  branchId: z.string().uuid(),
  accountCode: z.string().min(2, "Account code is required").max(30),
  name: z.string().min(2, "Name is required").max(200),
  contactName: z.string().max(200).optional(),
  contactPhone: z.string().max(30).optional(),
  contactEmail: z.string().max(200).optional(),
  creditLimitPaisa: z.number().int().nonnegative(),
  paymentTermsDays: z.number().int().nonnegative(),
  crmCustomerId: z.string().uuid().optional(),
});

export const AR_TXN_TYPES = ["CHARGE", "SETTLEMENT"] as const;

export const apiArTransactionSchema = z.object({
  id: z.string().uuid(),
  customerAccountId: z.string().uuid(),
  txnType: z.enum(AR_TXN_TYPES),
  txnDate: z.string(),
  dueDate: z.string().nullable(),
  amountPaisa: z.number().int().positive(),
  sourceType: z.string(),
  sourceId: z.string().uuid().nullable(),
  journalEntryId: z.string().uuid(),
  reference: z.string().nullable(),
  memo: z.string().nullable(),
  balanceAfterPaisa: z.number().int(),
});

export const createArChargeInputSchema = z.object({
  branchId: z.string().uuid(),
  customerAccountId: z.string().uuid(),
  txnDate: z.string().min(1, "Charge date is required"),
  amountPaisa: z.number().int().positive("Amount must be greater than zero"),
  revenueAccountCode: z.string().max(20).optional(),
  reference: z.string().max(200).optional(),
  memo: z.string().max(500).optional(),
});

export const createArSettlementInputSchema = z.object({
  branchId: z.string().uuid(),
  customerAccountId: z.string().uuid(),
  txnDate: z.string().min(1, "Settlement date is required"),
  amountPaisa: z.number().int().positive("Amount must be greater than zero"),
  reference: z.string().max(200).optional(),
  memo: z.string().max(500).optional(),
});

// Same bucket shape as ApAgingBucketDto/ApAgingReportDto (10-18-A) — reuses
// apiApAgingBucketSchema's shape rather than declaring a second, drifting one.
export const apiArAgingSchema = z.object({
  totalArPaisa: z.number().int().nonnegative(),
  buckets: z.array(apiApAgingBucketSchema),
});

export const apiCustomerAccountStatementSchema = z.object({
  account: apiCustomerAccountSchema,
  balancePaisa: z.number().int(),
  transactions: z.array(apiArTransactionSchema),
});

export type ApiCustomerAccount = z.infer<typeof apiCustomerAccountSchema>;
export type ApiCreateCustomerAccountRequest = z.infer<typeof createCustomerAccountInputSchema>;
export type ApiArTransaction = z.infer<typeof apiArTransactionSchema>;
export type ApiCreateArChargeRequest = z.infer<typeof createArChargeInputSchema>;
export type ApiCreateArSettlementRequest = z.infer<typeof createArSettlementInputSchema>;
export type ApiArAging = z.infer<typeof apiArAgingSchema>;
export type ApiCustomerAccountStatement = z.infer<typeof apiCustomerAccountStatementSchema>;

export type ApiAccount = z.infer<typeof apiAccountSchema>;
export type ApiJournalLine = z.infer<typeof apiJournalLineSchema>;
export type ApiJournalEntry = z.infer<typeof apiJournalEntrySchema>;
export type ApiAccountingPeriod = z.infer<typeof apiAccountingPeriodSchema>;
export type ApiGlBalance = z.infer<typeof apiGlBalanceSchema>;
export type ApiFinanceSetupStatus = z.infer<typeof apiFinanceSetupStatusSchema>;
export type ApiCreateJeRequest = z.infer<typeof apiCreateJeSchema>;
export type ApiExpense = z.infer<typeof apiExpenseSchema>;
export type ApiCreateExpenseRequest = z.infer<typeof apiCreateExpenseSchema>;
export type ApiApAgingBucket = z.infer<typeof apiApAgingBucketSchema>;
export type ApiApAging = z.infer<typeof apiApAgingSchema>;
