// Layer-2 adapters: raw API shapes → domain models.

import type { z } from "zod";
import type {
  apiDashboardTileSchema,
  apiFbrTaxSummarySchema,
  apiReportDefinitionSchema,
  apiReportResultSchema,
  apiReportRowSchema,
} from "@/lib/api-client/schemas/reporting.schema";
import type {
  DashboardTile,
  FbrTaxSummary,
  ReportDefinition,
  ReportResult,
  ReportRow,
} from "@/lib/models/reporting.model";

export type ApiReportDefinition = z.infer<typeof apiReportDefinitionSchema>;
export type ApiReportRow = z.infer<typeof apiReportRowSchema>;
export type ApiReportResult = z.infer<typeof apiReportResultSchema>;
export type ApiFbrTaxSummary = z.infer<typeof apiFbrTaxSummarySchema>;
export type ApiDashboardTile = z.infer<typeof apiDashboardTileSchema>;

export function adaptReportDefinition(raw: ApiReportDefinition): ReportDefinition {
  return {
    code: raw.code,
    title: raw.title,
    category: raw.category,
    columns: raw.columns,
  };
}

/** Passes the row through as-is — the shape is dynamic per report, already Zod-validated. */
export function adaptReportRow(raw: ApiReportRow): ReportRow {
  return raw;
}

export function adaptReportResult(raw: ApiReportResult): ReportResult {
  return {
    code: raw.code,
    title: raw.title,
    columns: raw.columns,
    rows: raw.rows.map(adaptReportRow),
    rowCount: raw.rowCount,
    durationMs: raw.durationMs,
    dataNotes: raw.dataNotes,
  };
}

export function adaptFbrTaxSummary(raw: ApiFbrTaxSummary): FbrTaxSummary {
  return {
    branchId: raw.branchId,
    branchName: raw.branchName,
    ntn: raw.ntn,
    fbrStrn: raw.fbrStrn,
    periodFrom: raw.periodFrom,
    periodTo: raw.periodTo,
    outputTaxPaisa: raw.outputTaxPaisa,
    taxableSalesPaisa: raw.taxableSalesPaisa,
    inputTaxPaisa: raw.inputTaxPaisa,
    taxablePurchasesPaisa: raw.taxablePurchasesPaisa,
    netPayablePaisa: raw.netPayablePaisa,
    salesOrderCount: raw.salesOrderCount,
    purchaseInvoiceCount: raw.purchaseInvoiceCount,
    durationMs: raw.durationMs,
    dataNotes: raw.dataNotes,
  };
}

export function adaptDashboardTile(raw: ApiDashboardTile): DashboardTile {
  return {
    tileId: raw.tileId,
    title: raw.title,
    valuePaisa: raw.valuePaisa,
    valueNumber: raw.valueNumber,
    unit: raw.unit,
    businessDate: raw.businessDate,
    computedAt: raw.computedAt,
  };
}
