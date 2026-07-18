import { z } from "zod";

// Mirrors ReportDefinition (services/reporting-service .../report/ReportDefinition.java). The
// `sqlBranchScoped`/`sqlTenantWide` fields are backend-internal SQL text — the real controller
// (`ReportController.list`) serializes the whole record, so they MAY be present on the wire, but
// the frontend has no use for them and they are intentionally left out of the domain model
// (adapter drops them). Modeled optional here so extra/missing fields never fail `.parse()`.
export const apiReportDefinitionSchema = z.object({
  code: z.string(),
  title: z.string(),
  category: z.string(),
  columns: z.array(z.string()),
  sqlBranchScoped: z.string().optional(),
  sqlTenantWide: z.string().optional(),
});

/**
 * A single report result row. `ReportResultDto.rows` is `List<Map<String,Object>>` on the Java
 * side — genuinely dynamic, a different shape per report — so this is a catchall record.
 * `cogs_paisa`/`gross_margin_paisa` are the two known column names (see `ReportCatalog.
 * salesByItem()` — the ClickHouse SQL aliases them exactly this way, snake_case, because they are
 * raw ClickHouse column aliases, NOT camelCase DTO fields) that MAY appear on a report row, and
 * they are Phase-8-deferred NULLs (12-05's honest-NULL contract: `if(countIf(... IS NOT NULL) = 0,
 * NULL, sum(...))` forces a real NULL rather than a misleading 0 sum over an all-NULL group).
 * Modeled `z.number().nullable()` — NEVER `.default(0)` — so a null survives the parse instead of
 * being manufactured into a false "zero cost".
 */
export const apiReportRowSchema = z
  .object({
    cogs_paisa: z.number().nullable().optional(),
    gross_margin_paisa: z.number().nullable().optional(),
  })
  .catchall(z.unknown());

// Mirrors ReportResultDto exactly (services/reporting-service .../dto/ReportResultDto.java).
export const apiReportResultSchema = z.object({
  code: z.string(),
  title: z.string(),
  columns: z.array(z.string()),
  rows: z.array(apiReportRowSchema),
  rowCount: z.number().int(),
  durationMs: z.number(),
  dataNotes: z.array(z.string()),
});

// Write payload for `POST /api/v1/reporting/reports/{code}/run` — mirrors ReportRequest.java.
// Deliberately NO tenantId field (server-derived — 10-10-B precedent). `branchId` is nullable/
// optional: an OWNER may omit it to mean "all my branches".
export const reportRunInputSchema = z.object({
  branchId: z.string().uuid().nullable().optional(),
  from: z.string(),
  to: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Mirrors FbrTaxSummaryDto exactly (services/reporting-service .../dto/FbrTaxSummaryDto.java).
 * All money fields are `long` paisa on the Java side, serialized as plain JSON numbers (no
 * BigDecimal involved, unlike the purchasing `qty` gotcha — 10-12-A). `netPayablePaisa` is
 * INTENTIONALLY not `.nonnegative()` — a negative value is a legitimate refundable input-tax
 * credit (12-05's "never clamped" contract) and must survive the parse unmodified.
 * `ntn`/`fbrStrn` are nullable (user-service lookup can fail; the tax figures are the point of
 * this report, not the header).
 */
export const apiFbrTaxSummarySchema = z.object({
  branchId: z.string().uuid(),
  branchName: z.string(),
  ntn: z.string().nullable(),
  fbrStrn: z.string().nullable(),
  periodFrom: z.string(),
  periodTo: z.string(),
  outputTaxPaisa: z.number().int(),
  taxableSalesPaisa: z.number().int(),
  inputTaxPaisa: z.number().int(),
  taxablePurchasesPaisa: z.number().int(),
  netPayablePaisa: z.number().int(),
  salesOrderCount: z.number().int(),
  purchaseInvoiceCount: z.number().int(),
  durationMs: z.number(),
  dataNotes: z.array(z.string()),
});

/**
 * Mirrors DashboardTileDto exactly (12-06-SUMMARY.md's pinned contract). Exactly one of
 * `valuePaisa`/`valueNumber` is populated per tile; the other is `null` — never 0 (0 is a real
 * value; `null` means "not applicable", e.g. `average-order-value` when `todays-orders` is 0).
 */
export const apiDashboardTileSchema = z.object({
  tileId: z.string(),
  title: z.string(),
  valuePaisa: z.number().int().nullable(),
  valueNumber: z.number().int().nullable(),
  unit: z.string(),
  businessDate: z.string(),
  computedAt: z.string(),
});
