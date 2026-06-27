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

export const apiJournalEntrySchema = z.object({
  id: z.string().uuid(),
  entryNo: z.string().nullable(),
  entryDate: z.string(),
  description: z.string(),
  status: z.enum(["DRAFT", "POSTED"]),
  totalDebitPaisa: z.number().int().nonnegative(),
  totalCreditPaisa: z.number().int().nonnegative(),
  lines: z.array(apiJournalLineSchema),
});

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

export const apiCreateJeSchema = z.object({
  entryDate: z.string(),
  description: z.string(),
  lines: z.array(apiCreateJeLineSchema).min(2),
});

export type ApiAccount = z.infer<typeof apiAccountSchema>;
export type ApiJournalLine = z.infer<typeof apiJournalLineSchema>;
export type ApiJournalEntry = z.infer<typeof apiJournalEntrySchema>;
export type ApiAccountingPeriod = z.infer<typeof apiAccountingPeriodSchema>;
export type ApiGlBalance = z.infer<typeof apiGlBalanceSchema>;
export type ApiCreateJeRequest = z.infer<typeof apiCreateJeSchema>;
