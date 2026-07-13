import { apiClient } from "@/lib/api-client/client";
import {
  get,
  getPaginated,
  post,
  type PaginatedResult,
} from "@/lib/api-client/request";
import type { ApiResponse } from "@/lib/api-client/types";
import {
  apiAccountSchema,
  apiJournalEntrySchema,
  apiAccountingPeriodSchema,
  apiGlBalanceSchema,
  apiFinanceSetupStatusSchema,
  apiExpenseSchema,
  apiExpenseListSchema,
  apiCreateExpenseSchema,
  rejectExpenseInputSchema,
  apiApAgingSchema,
  apiCustomerAccountSchema,
  createCustomerAccountInputSchema,
  apiArTransactionSchema,
  createArChargeInputSchema,
  createArSettlementInputSchema,
  apiArAgingSchema,
  apiCustomerAccountStatementSchema,
  apiProvisioningResultSchema,
  type ApiCreateExpenseRequest,
  type ApiCreateCustomerAccountRequest,
  type ApiCreateArChargeRequest,
  type ApiCreateArSettlementRequest,
} from "@/lib/api-client/schemas/finance.schema";
import {
  adaptAccount,
  adaptJournalEntry,
  adaptAccountingPeriod,
  adaptGlBalance,
  adaptFinanceSetupStatus,
  adaptExpense,
  adaptApAging,
  adaptCustomerAccount,
  adaptArTransaction,
  adaptArAging,
  adaptArStatement,
  adaptProvisioningResult,
} from "@/lib/adapters/finance.adapter";
import type {
  Account,
  JournalEntry,
  AccountingPeriod,
  GlBalance,
  AccountFilters,
  JeFilters,
  CreateJeRequest,
  FinanceSetupStatus,
  Expense,
  ExpenseStatus,
  CreateExpenseInput,
  ApAging,
  CustomerAccount,
  CreateCustomerAccountInput,
  ArTransaction,
  CreateArChargeInput,
  CreateArSettlementInput,
  ArAging,
  CustomerAccountStatement,
  ProvisioningResult,
} from "@/lib/models/finance.model";

// Layer-2 Finance repository. Calls Layer-1 request helpers, parses via Zod,
// adapts to domain models. Never exposes raw API types to Layer-3 or above.

export const FinanceRepository = {
  // ── Chart of Accounts ─────────────────────────────────────────────────────

  async listAccounts(filters?: AccountFilters): Promise<PaginatedResult<Account>> {
    const params: Record<string, unknown> = {};
    if (filters?.type) params.type = filters.type;
    if (filters?.active !== undefined) params.active = filters.active;
    if (filters?.page !== undefined) params.page = filters.page;
    if (filters?.size !== undefined) params.size = filters.size;
    const result = await getPaginated<unknown>("/api/v1/finance/accounts", params);
    return {
      data: result.data.map((raw) => adaptAccount(apiAccountSchema.parse(raw))),
      meta: result.meta,
    };
  },

  async getAccount(code: string): Promise<Account> {
    const raw = await get(`/api/v1/finance/accounts/${code}`);
    return adaptAccount(apiAccountSchema.parse(raw));
  },

  async searchAccounts(query: string): Promise<Account[]> {
    const result = await getPaginated<unknown>("/api/v1/finance/accounts/search", {
      q: query,
      size: 20,
    });
    return result.data.map((raw) => adaptAccount(apiAccountSchema.parse(raw)));
  },

  async getSetupStatus(): Promise<FinanceSetupStatus> {
    const raw = await get<unknown>("/api/v1/finance/accounts/setup/status");
    return adaptFinanceSetupStatus(apiFinanceSetupStatusSchema.parse(raw));
  },

  // ── Journal Entries ────────────────────────────────────────────────────────

  async listJournalEntries(filters?: JeFilters): Promise<PaginatedResult<JournalEntry>> {
    const params: Record<string, unknown> = {};
    if (filters?.periodId) params.periodId = filters.periodId;
    if (filters?.status) params.status = filters.status;
    if (filters?.fromDate) params.fromDate = filters.fromDate;
    if (filters?.toDate) params.toDate = filters.toDate;
    if (filters?.page !== undefined) params.page = filters.page;
    if (filters?.size !== undefined) params.size = filters.size;
    const result = await getPaginated<unknown>("/api/v1/finance/journal-entries", params);
    return {
      data: result.data.map((raw) => adaptJournalEntry(apiJournalEntrySchema.parse(raw))),
      meta: result.meta,
    };
  },

  async getJournalEntry(id: string): Promise<JournalEntry> {
    const raw = await get(`/api/v1/finance/journal-entries/${id}`);
    return adaptJournalEntry(apiJournalEntrySchema.parse(raw));
  },

  async createJournalEntry(req: CreateJeRequest): Promise<JournalEntry> {
    const raw = await post<CreateJeRequest, unknown>("/api/v1/finance/journal-entries", req);
    return adaptJournalEntry(apiJournalEntrySchema.parse(raw));
  },

  async postJournalEntry(id: string): Promise<JournalEntry> {
    const raw = await post<undefined, unknown>(`/api/v1/finance/journal-entries/${id}/post`);
    return adaptJournalEntry(apiJournalEntrySchema.parse(raw));
  },

  async reverseJournalEntry(id: string): Promise<JournalEntry> {
    const raw = await post<undefined, unknown>(`/api/v1/finance/journal-entries/${id}/reverse`);
    return adaptJournalEntry(apiJournalEntrySchema.parse(raw));
  },

  // ── Accounting Periods ─────────────────────────────────────────────────────

  async listPeriods(fiscalYear?: number): Promise<AccountingPeriod[]> {
    const params: Record<string, unknown> = {};
    if (fiscalYear) params.fiscalYear = fiscalYear;
    const raw = await get<unknown[]>("/api/v1/finance/periods", params);
    return (raw ?? []).map((item) => adaptAccountingPeriod(apiAccountingPeriodSchema.parse(item)));
  },

  async listOpenPeriods(): Promise<AccountingPeriod[]> {
    const raw = await get<unknown[]>("/api/v1/finance/periods/open");
    return (raw ?? []).map((item) => adaptAccountingPeriod(apiAccountingPeriodSchema.parse(item)));
  },

  async closePeriod(id: string, totpCode: string): Promise<AccountingPeriod> {
    void totpCode; // Phase 6: stub — TOTP code forwarded as header only
    // Pass X-TOTP-Verified header directly via apiClient (TOTP gate, Phase 6 stub).
    const response = await apiClient.post<ApiResponse<unknown>>(
      `/api/v1/finance/periods/${id}/close`,
      null,
      { headers: { "X-TOTP-Verified": "true" } },
    );
    return adaptAccountingPeriod(apiAccountingPeriodSchema.parse(response.data.data));
  },

  async provisionPeriods(fiscalYear: number): Promise<ProvisioningResult> {
    const raw = await post<{ fiscalYear: number }, unknown>(
      "/api/v1/finance/periods/provision",
      { fiscalYear },
    );
    return adaptProvisioningResult(apiProvisioningResultSchema.parse(raw));
  },

  // ── General Ledger ─────────────────────────────────────────────────────────

  async getGlBalances(periodId: string): Promise<GlBalance[]> {
    const raw = await get<unknown[]>("/api/v1/finance/gl/balances", { periodId });
    return (raw ?? []).map((item) => adaptGlBalance(apiGlBalanceSchema.parse(item)));
  },

  // ── Expenses (FIN-05) ────────────────────────────────────────────────────
  // GET /api/v1/finance/expenses returns a plain ApiResponse<List<ExpenseDto>>
  // (no pagination) — per 10-10's contract. branchId is required; tenant is
  // resolved server-side.

  async listExpenses(branchId: string, status?: ExpenseStatus[]): Promise<Expense[]> {
    const params: Record<string, unknown> = { branchId };
    if (status && status.length > 0) params.status = status;
    const raw = await get<unknown[]>("/api/v1/finance/expenses", params);
    return apiExpenseListSchema.parse(raw ?? []).map(adaptExpense);
  },

  async createExpense(input: CreateExpenseInput): Promise<Expense> {
    const body: ApiCreateExpenseRequest = apiCreateExpenseSchema.parse(input);
    const raw = await post<ApiCreateExpenseRequest, unknown>("/api/v1/finance/expenses", body);
    return adaptExpense(apiExpenseSchema.parse(raw));
  },

  async approveExpense(id: string): Promise<Expense> {
    const raw = await post<undefined, unknown>(`/api/v1/finance/expenses/${id}/approve`);
    return adaptExpense(apiExpenseSchema.parse(raw));
  },

  // reason is validated client-side (mandatory, non-blank) before the request
  // fires, mirroring server-side enforcement in ExpenseService.reject.
  async rejectExpense(id: string, reason: string): Promise<Expense> {
    const body = rejectExpenseInputSchema.parse({ reason });
    const raw = await post<{ reason: string }, unknown>(
      `/api/v1/finance/expenses/${id}/reject`,
      body,
    );
    return adaptExpense(apiExpenseSchema.parse(raw));
  },

  // ── AP Aging (FIN-05) ────────────────────────────────────────────────────

  async getApAging(branchId: string, asOf?: string): Promise<ApAging> {
    const params: Record<string, unknown> = { branchId };
    if (asOf) params.asOf = asOf;
    const raw = await get<unknown>("/api/v1/finance/ap/aging", params);
    return adaptApAging(apiApAgingSchema.parse(raw));
  },

  // ── House Accounts / AR (FIN-05 AR half, 10-18) ──────────────────────────
  // GET /api/v1/finance/ar/customer-accounts IS paginated — matches
  // AccountController's ApiResponse.paginated shape (see 10-18-SUMMARY.md).

  async listCustomerAccounts(page?: number): Promise<PaginatedResult<CustomerAccount>> {
    const params: Record<string, unknown> = {};
    if (page !== undefined) params.page = page;
    const result = await getPaginated<unknown>("/api/v1/finance/ar/customer-accounts", params);
    return {
      data: result.data.map((raw) => adaptCustomerAccount(apiCustomerAccountSchema.parse(raw))),
      meta: result.meta,
    };
  },

  async createCustomerAccount(input: CreateCustomerAccountInput): Promise<CustomerAccount> {
    const body: ApiCreateCustomerAccountRequest = createCustomerAccountInputSchema.parse(input);
    const raw = await post<ApiCreateCustomerAccountRequest, unknown>(
      "/api/v1/finance/ar/customer-accounts",
      body,
    );
    return adaptCustomerAccount(apiCustomerAccountSchema.parse(raw));
  },

  async getCustomerAccountStatement(id: string): Promise<CustomerAccountStatement> {
    const raw = await get<unknown>(`/api/v1/finance/ar/customer-accounts/${id}/statement`);
    return adaptArStatement(apiCustomerAccountStatementSchema.parse(raw));
  },

  async createArCharge(input: CreateArChargeInput): Promise<ArTransaction> {
    const body: ApiCreateArChargeRequest = createArChargeInputSchema.parse(input);
    const raw = await post<ApiCreateArChargeRequest, unknown>("/api/v1/finance/ar/charges", body);
    return adaptArTransaction(apiArTransactionSchema.parse(raw));
  },

  async createArSettlement(input: CreateArSettlementInput): Promise<ArTransaction> {
    const body: ApiCreateArSettlementRequest = createArSettlementInputSchema.parse(input);
    const raw = await post<ApiCreateArSettlementRequest, unknown>(
      "/api/v1/finance/ar/settlements",
      body,
    );
    return adaptArTransaction(apiArTransactionSchema.parse(raw));
  },

  async getArAging(branchId: string, asOf?: string): Promise<ArAging> {
    const params: Record<string, unknown> = { branchId };
    if (asOf) params.asOf = asOf;
    const raw = await get<unknown>("/api/v1/finance/ar/aging", params);
    return adaptArAging(apiArAgingSchema.parse(raw));
  },
};
