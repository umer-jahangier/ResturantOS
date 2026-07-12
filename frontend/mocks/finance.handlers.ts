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
];
