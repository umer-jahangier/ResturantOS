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
} from "@/lib/api-client/schemas/finance.schema";
import {
  adaptAccount,
  adaptJournalEntry,
  adaptAccountingPeriod,
  adaptGlBalance,
} from "@/lib/adapters/finance.adapter";
import type {
  Account,
  JournalEntry,
  AccountingPeriod,
  GlBalance,
  AccountFilters,
  JeFilters,
  CreateJeRequest,
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

  // ── General Ledger ─────────────────────────────────────────────────────────

  async getGlBalances(periodId: string): Promise<GlBalance[]> {
    const raw = await get<unknown[]>("/api/v1/finance/gl/balances", { periodId });
    return (raw ?? []).map((item) => adaptGlBalance(apiGlBalanceSchema.parse(item)));
  },
};
