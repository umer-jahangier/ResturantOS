// Layer-2 domain models for the Reporting module (camelCase, only the shapes Layer-3 hooks and
// Layer-4 components are allowed to see).

export interface ReportDefinition {
  code: string;
  title: string;
  category: string;
  columns: string[];
}

/**
 * A single report result row. Genuinely dynamic per report (mirrors `ReportResultDto.rows`,
 * `List<Map<String,Object>>`) — column keys are whatever `ReportDefinition.columns` names.
 * `cogs_paisa`/`gross_margin_paisa` are the two known Phase-8-deferred columns and are typed
 * nullable (never defaulted to 0 — see reporting.schema.ts).
 */
export interface ReportRow {
  cogs_paisa?: number | null;
  gross_margin_paisa?: number | null;
  [column: string]: unknown;
}

export interface ReportResult {
  code: string;
  title: string;
  columns: string[];
  rows: ReportRow[];
  rowCount: number;
  durationMs: number;
  dataNotes: string[];
}

export interface ReportRunParams {
  branchId?: string | null;
  from: string;
  to: string;
}

export interface FbrTaxSummary {
  branchId: string;
  branchName: string;
  ntn: string | null;
  fbrStrn: string | null;
  periodFrom: string;
  periodTo: string;
  outputTaxPaisa: number;
  taxableSalesPaisa: number;
  inputTaxPaisa: number;
  taxablePurchasesPaisa: number;
  /** MAY be negative — a legitimate refundable input-tax credit, never clamped to zero. */
  netPayablePaisa: number;
  salesOrderCount: number;
  purchaseInvoiceCount: number;
  durationMs: number;
  dataNotes: string[];
}

export interface FbrTaxSummaryParams {
  branchId: string;
  from: string;
  to: string;
}

/** A dashboard tile is either a MONEY value or a COUNT — exactly one of the two is non-null. */
export interface DashboardTile {
  tileId: string;
  title: string;
  valuePaisa: number | null;
  valueNumber: number | null;
  unit: string;
  businessDate: string;
  computedAt: string;
}
