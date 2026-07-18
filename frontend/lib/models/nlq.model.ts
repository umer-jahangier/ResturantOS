// Layer-2 domain models for the NLQ module (camelCase, only the shapes Layer-3 hooks and
// Layer-4 components are allowed to see).

/** Every cell value the `nlq_readonly` ClickHouse profile can return. Never `unknown`/`any`. */
export type NlqCellValue = string | number | boolean | null;

/** A single result row — column keys are whatever `NlqResult.columns` names for this question. */
export type NlqRow = Record<string, NlqCellValue>;

export interface NlqResult {
  question: string;
  /** The EXECUTED SQL — post-validation, tenant/branch-scoped. Safe and deliberate to show. */
  sql: string;
  rows: NlqRow[];
  columns: string[];
  rowCount: number;
  /** `null` when Claude Haiku narration failed or was skipped — never fails the whole result. */
  narrative: string | null;
  /** `true` when served from the 60s result cache without a fresh Claude call/ClickHouse hit. */
  cacheHit: boolean;
  /** Wall-clock execution time; 0 on a cache hit. */
  durationMs: number;
}

/**
 * One code per way the 7-stage SQL validation pipeline (12-04) can refuse a query, plus the
 * operational failure codes (quota/timeout/service-unavailable) `NlqGlobalExceptionHandler` maps
 * onto the wire (services/nlq-service .../exception/NlqGlobalExceptionHandler.java). This is the
 * union `ApiError.code` takes for every non-2xx `/api/v1/nlq/query` response.
 */
export type NlqRejectionCode =
  | "SHAPE_INVALID"
  | "PARSE_FAILED"
  | "TABLE_NOT_ALLOWED"
  | "PII_COLUMN_DENIED"
  | "TENANT_FILTER_MISSING"
  | "BRANCH_FILTER_MISSING"
  | "LIMIT_INVALID"
  | "ROW_CAP_EXCEEDED"
  | "QUERY_TIMEOUT"
  | "QUOTA_EXCEEDED_MONTHLY"
  | "QUOTA_EXCEEDED_HOURLY"
  | "QUOTA_SERVICE_UNAVAILABLE"
  | "CLAUDE_UNAVAILABLE";
