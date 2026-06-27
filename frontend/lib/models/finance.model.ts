// Layer-2 domain models for the Finance module (camelCase). These are the ONLY
// finance shapes that Layer-3 hooks and Layer-4 components are allowed to see.

export type AccountType =
  | "ASSET"
  | "LIABILITY"
  | "EQUITY"
  | "REVENUE"
  | "EXPENSE";

export interface Account {
  id: string;
  code: string;
  name: string;
  accountType: AccountType;
  parentCode: string | null;
  system: boolean;
  systemTag: string | null;
  active: boolean;
}

export interface JournalLine {
  id: string;
  accountCode: string;
  description: string;
  debitPaisa: number;
  creditPaisa: number;
}

export type JeStatus = "DRAFT" | "POSTED";

export interface JournalEntry {
  id: string;
  entryNo: string | null;
  entryDate: string;
  description: string;
  status: JeStatus;
  totalDebitPaisa: number;
  totalCreditPaisa: number;
  lines: JournalLine[];
}

export type PeriodStatus = "OPEN" | "LOCKED";

export interface AccountingPeriod {
  id: string;
  fiscalYear: number;
  periodNo: number;
  startDate: string;
  endDate: string;
  status: PeriodStatus;
  lockedBy: string | null;
  lockedAt: string | null;
}

export interface GlBalance {
  accountCode: string;
  accountName: string;
  debitTotal: number;
  creditTotal: number;
  netBalance: number;
}

export interface CreateJeLineRequest {
  accountCode: string;
  description: string;
  debitPaisa: number;
  creditPaisa: number;
}

export interface CreateJeRequest {
  entryDate: string;
  description: string;
  lines: CreateJeLineRequest[];
}

export interface AccountFilters {
  type?: string;
  active?: boolean;
  page?: number;
  size?: number;
}

export interface JeFilters {
  periodId?: string;
  status?: JeStatus;
  fromDate?: string;
  toDate?: string;
  page?: number;
  size?: number;
}
