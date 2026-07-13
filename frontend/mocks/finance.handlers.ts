import { http, HttpResponse } from "msw";

// MSW fixtures for FIN-05 (10-14): expense create/approve/reject + AP aging.
// Ids must be well-formed UUIDs (hex only) — apiExpenseSchema/apiApAgingSchema
// validate id-ish fields with z.string().uuid() and FinanceRepository always
// .parse()s before adapting (FE-08). This is the ONLY finance-module mocks
// file this plan owns; purchasing.handlers.ts belongs to 10-12/10-13.

const BRANCH_ID = "b0000001-0000-4000-8000-000000000001";
const REQUESTER_ID = "c0000001-0000-4000-8000-000000000001";
// Mirrors OWNER's approval_limit_paisa in mocks/handlers.ts DEMO_USERS
// ("owner@demo.local" -> 100_000_000). Anything above this simulates the OPA
// approval-limit denial (10-05/10-07), below simulates a clean approve.
const APPROVAL_LIMIT_PAISA = 100_000_000;
const APPROVER_ID = "c0000002-0000-4000-8000-000000000002";

interface MockExpense {
  id: string;
  branchId: string;
  expenseDate: string;
  expenseAccountCode: string;
  description: string | null;
  amountPaisa: number;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  requestedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectReason: string | null;
}

interface CreateExpenseBody {
  branchId: string;
  expenseDate: string;
  expenseAccountCode: string;
  description?: string;
  amountPaisa: number;
}

let seq = 0;
function nextExpenseId(): string {
  seq += 1;
  return `d1000001-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

const expenses: MockExpense[] = [
  {
    id: "d1000001-0000-4000-8000-000000000001",
    branchId: BRANCH_ID,
    expenseDate: "2026-07-01",
    expenseAccountCode: "6100",
    description: "Utility bill",
    amountPaisa: 1_500_000,
    status: "PENDING_APPROVAL",
    requestedBy: REQUESTER_ID,
    approvedBy: null,
    approvedAt: null,
    rejectReason: null,
  },
];

function ok<T>(data: T) {
  return HttpResponse.json({ data, meta: null, warnings: [] });
}

function apiError(code: string, message: string, status: number) {
  return HttpResponse.json(
    { error: { code, message, details: [], traceId: "mock-trace-id" } },
    { status },
  );
}

function findExpense(id: string): MockExpense | undefined {
  return expenses.find((e) => e.id === id);
}

// ── House Accounts / AR (FIN-05 AR half, 10-18) ──────────────────────────

interface MockCustomerAccount {
  id: string;
  branchId: string;
  accountCode: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  creditLimitPaisa: number;
  paymentTermsDays: number;
  status: "ACTIVE" | "SUSPENDED";
  crmCustomerId: string | null;
  balancePaisa: number;
}

interface MockArTransaction {
  id: string;
  customerAccountId: string;
  txnType: "CHARGE" | "SETTLEMENT";
  txnDate: string;
  dueDate: string | null;
  amountPaisa: number;
  sourceType: string;
  sourceId: string | null;
  journalEntryId: string;
  reference: string | null;
  memo: string | null;
  balanceAfterPaisa: number;
}

let customerAccountSeq = 0;
function nextCustomerAccountId(): string {
  customerAccountSeq += 1;
  return `e2000001-0000-4000-8000-${String(customerAccountSeq).padStart(12, "0")}`;
}
let arTxnSeq = 0;
function nextArTxnId(): string {
  arTxnSeq += 1;
  return `e3000001-0000-4000-8000-${String(arTxnSeq).padStart(12, "0")}`;
}

const customerAccounts: MockCustomerAccount[] = [
  {
    id: "e2000001-0000-4000-8000-000000000001",
    branchId: BRANCH_ID,
    accountCode: "HA-001",
    name: "Acme Corp",
    contactName: "Jane Doe",
    contactPhone: "0300-0000000",
    contactEmail: "jane@acme.test",
    creditLimitPaisa: 10_000_000, // PKR 1,00,000
    paymentTermsDays: 30,
    status: "ACTIVE",
    crmCustomerId: null,
    balancePaisa: 0,
  },
];

const arTransactions: MockArTransaction[] = [];

function findCustomerAccount(id: string): MockCustomerAccount | undefined {
  return customerAccounts.find((a) => a.id === id);
}

interface CreateCustomerAccountBody {
  branchId: string;
  accountCode: string;
  name: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  creditLimitPaisa: number;
  paymentTermsDays: number;
  crmCustomerId?: string;
}

interface CreateArChargeBody {
  branchId: string;
  customerAccountId: string;
  txnDate: string;
  amountPaisa: number;
  revenueAccountCode?: string;
  reference?: string;
  memo?: string;
}

interface CreateArSettlementBody {
  branchId: string;
  customerAccountId: string;
  txnDate: string;
  amountPaisa: number;
  reference?: string;
  memo?: string;
}

export const financeHandlers = [
  http.get("*/api/v1/finance/expenses", ({ request }) => {
    const url = new URL(request.url);
    const statuses = url.searchParams.getAll("status");
    const rows =
      statuses.length > 0 ? expenses.filter((e) => statuses.includes(e.status)) : expenses;
    return ok(rows);
  }),

  http.post("*/api/v1/finance/expenses", async ({ request }) => {
    const body = (await request.json()) as CreateExpenseBody;
    if (!body.expenseAccountCode || !body.amountPaisa || body.amountPaisa <= 0) {
      return apiError("VALIDATION_FAILED", "expenseAccountCode and amountPaisa are required", 400);
    }
    const created: MockExpense = {
      id: nextExpenseId(),
      branchId: body.branchId,
      expenseDate: body.expenseDate,
      expenseAccountCode: body.expenseAccountCode,
      description: body.description ?? null,
      amountPaisa: body.amountPaisa,
      status: "PENDING_APPROVAL",
      requestedBy: REQUESTER_ID,
      approvedBy: null,
      approvedAt: null,
      rejectReason: null,
    };
    expenses.unshift(created);
    return ok(created);
  }),

  // 10-05/10-07: OPA approval-limit gate. Over-limit approvals return 403
  // EXPENSE_APPROVAL_LIMIT_EXCEEDED and the expense stays PENDING_APPROVAL —
  // no journal entry is posted in the mock either, mirroring the real service.
  http.post("*/api/v1/finance/expenses/:id/approve", ({ params }) => {
    const expense = findExpense(params.id as string);
    if (!expense) return apiError("NOT_FOUND", "Expense not found", 404);
    if (expense.status !== "PENDING_APPROVAL") {
      return apiError("INVALID_OPERATION", "Expense is not pending approval", 400);
    }
    if (expense.amountPaisa > APPROVAL_LIMIT_PAISA) {
      return apiError(
        "EXPENSE_APPROVAL_LIMIT_EXCEEDED",
        "This expense exceeds your approval limit",
        403,
      );
    }
    expense.status = "APPROVED";
    expense.approvedBy = APPROVER_ID;
    expense.approvedAt = new Date().toISOString();
    return ok(expense);
  }),

  http.post("*/api/v1/finance/expenses/:id/reject", async ({ params, request }) => {
    const expense = findExpense(params.id as string);
    if (!expense) return apiError("NOT_FOUND", "Expense not found", 404);
    if (expense.status !== "PENDING_APPROVAL") {
      return apiError("INVALID_OPERATION", "Expense is not pending approval", 400);
    }
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    if (!body.reason?.trim()) {
      return apiError("VALIDATION_FAILED", "A rejection reason is required", 400);
    }
    expense.status = "REJECTED";
    expense.rejectReason = body.reason.trim();
    return ok(expense);
  }),

  http.get("*/api/v1/finance/ap/aging", () => {
    return ok({
      totalApPaisa: 4_500_000,
      buckets: [
        { label: "Current", minDays: 0, maxDays: 30, amountPaisa: 2_000_000 },
        { label: "31-60", minDays: 31, maxDays: 60, amountPaisa: 1_000_000 },
        { label: "61-90", minDays: 61, maxDays: 90, amountPaisa: 500_000 },
        { label: "Over 90", minDays: 91, maxDays: 999999, amountPaisa: 1_000_000 },
      ],
    });
  }),

  // ── House Accounts / AR (FIN-05 AR half, 10-18) ────────────────────────

  http.get("*/api/v1/finance/ar/customer-accounts", () => {
    return HttpResponse.json({
      data: customerAccounts,
      meta: { page: 0, size: 50, totalElements: customerAccounts.length, totalPages: 1 },
      warnings: [],
    });
  }),

  http.post("*/api/v1/finance/ar/customer-accounts", async ({ request }) => {
    const body = (await request.json()) as CreateCustomerAccountBody;
    if (!body.accountCode || !body.name) {
      return apiError("VALIDATION_FAILED", "accountCode and name are required", 400);
    }
    const created: MockCustomerAccount = {
      id: nextCustomerAccountId(),
      branchId: body.branchId,
      accountCode: body.accountCode,
      name: body.name,
      contactName: body.contactName ?? null,
      contactPhone: body.contactPhone ?? null,
      contactEmail: body.contactEmail ?? null,
      creditLimitPaisa: body.creditLimitPaisa,
      paymentTermsDays: body.paymentTermsDays,
      status: "ACTIVE",
      crmCustomerId: body.crmCustomerId ?? null,
      balancePaisa: 0,
    };
    customerAccounts.unshift(created);
    return ok(created);
  }),

  http.get("*/api/v1/finance/ar/customer-accounts/:id/statement", ({ params }) => {
    const account = findCustomerAccount(params.id as string);
    if (!account) return apiError("CUSTOMER_ACCOUNT_NOT_FOUND", "Customer account not found", 404);
    const transactions = arTransactions.filter((t) => t.customerAccountId === account.id);
    return ok({ account, balancePaisa: account.balancePaisa, transactions });
  }),

  // 10-18: models the credit-limit invariant in the mock — charging past the fixture's
  // limit returns 422 CREDIT_LIMIT_EXCEEDED and posts NEITHER an ar_transaction NOR a JE,
  // mirroring the real service (ArService.postCharge checks BEFORE any write).
  http.post("*/api/v1/finance/ar/charges", async ({ request }) => {
    const body = (await request.json()) as CreateArChargeBody;
    const account = findCustomerAccount(body.customerAccountId);
    if (!account) return apiError("CUSTOMER_ACCOUNT_NOT_FOUND", "Customer account not found", 404);
    if (account.status === "SUSPENDED") {
      return apiError("CUSTOMER_ACCOUNT_SUSPENDED", "Customer account is suspended", 422);
    }
    if (account.balancePaisa + body.amountPaisa > account.creditLimitPaisa) {
      return apiError(
        "CREDIT_LIMIT_EXCEEDED",
        `Charge of ${body.amountPaisa} paisa would exceed credit limit ${account.creditLimitPaisa} paisa (current balance ${account.balancePaisa} paisa) for account ${account.id}`,
        422,
      );
    }
    account.balancePaisa += body.amountPaisa;
    const txn: MockArTransaction = {
      id: nextArTxnId(),
      customerAccountId: account.id,
      txnType: "CHARGE",
      txnDate: body.txnDate,
      dueDate: body.txnDate,
      amountPaisa: body.amountPaisa,
      sourceType: "MANUAL",
      sourceId: null,
      journalEntryId: `f1000001-0000-4000-8000-${String(arTxnSeq).padStart(12, "0")}`,
      reference: body.reference ?? null,
      memo: body.memo ?? null,
      balanceAfterPaisa: account.balancePaisa,
    };
    arTransactions.push(txn);
    return ok(txn);
  }),

  http.post("*/api/v1/finance/ar/settlements", async ({ request }) => {
    const body = (await request.json()) as CreateArSettlementBody;
    const account = findCustomerAccount(body.customerAccountId);
    if (!account) return apiError("CUSTOMER_ACCOUNT_NOT_FOUND", "Customer account not found", 404);
    if (body.amountPaisa > account.balancePaisa) {
      return apiError(
        "AR_SETTLEMENT_EXCEEDS_BALANCE",
        `Settlement of ${body.amountPaisa} paisa exceeds outstanding balance ${account.balancePaisa} paisa`,
        422,
      );
    }
    account.balancePaisa -= body.amountPaisa;
    const txn: MockArTransaction = {
      id: nextArTxnId(),
      customerAccountId: account.id,
      txnType: "SETTLEMENT",
      txnDate: body.txnDate,
      dueDate: null,
      amountPaisa: body.amountPaisa,
      sourceType: "MANUAL",
      sourceId: null,
      journalEntryId: `f2000001-0000-4000-8000-${String(arTxnSeq).padStart(12, "0")}`,
      reference: body.reference ?? null,
      memo: body.memo ?? null,
      balanceAfterPaisa: account.balancePaisa,
    };
    arTransactions.push(txn);
    return ok(txn);
  }),

  http.get("*/api/v1/finance/ar/aging", () => {
    const totalOutstanding = customerAccounts.reduce((sum, a) => sum + a.balancePaisa, 0);
    return ok({
      totalArPaisa: totalOutstanding,
      buckets: [
        { label: "Current", minDays: 0, maxDays: 30, amountPaisa: totalOutstanding },
        { label: "31-60 days", minDays: 31, maxDays: 60, amountPaisa: 0 },
        { label: "61-90 days", minDays: 61, maxDays: 90, amountPaisa: 0 },
        { label: "Over 90 days", minDays: 91, maxDays: 999999, amountPaisa: 0 },
      ],
    });
  }),
];
