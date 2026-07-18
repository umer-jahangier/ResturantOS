import { get, post } from "@/lib/api-client/request";
import {
  apiDashboardTileSchema,
  apiFbrTaxSummarySchema,
  apiReportDefinitionSchema,
  apiReportResultSchema,
  reportRunInputSchema,
} from "@/lib/api-client/schemas/reporting.schema";
import {
  adaptDashboardTile,
  adaptFbrTaxSummary,
  adaptReportDefinition,
  adaptReportResult,
} from "@/lib/adapters/reporting.adapter";
import type {
  DashboardTile,
  FbrTaxSummary,
  FbrTaxSummaryParams,
  ReportDefinition,
  ReportResult,
  ReportRunParams,
} from "@/lib/models/reporting.model";

export const ReportingRepository = {
  /** GET /api/v1/reporting/reports — the named-report catalog (12-05). */
  async listReports(): Promise<ReportDefinition[]> {
    const raw = await get<unknown[]>("/api/v1/reporting/reports");
    return (raw ?? []).map((r) => adaptReportDefinition(apiReportDefinitionSchema.parse(r)));
  },

  /**
   * POST /api/v1/reporting/reports/{code}/run — tenantId is always server-resolved (never a
   * request field, 10-10-B precedent); `branchId` omitted/null means "all my branches" for an
   * OWNER caller.
   */
  async runReport(code: string, params: ReportRunParams): Promise<ReportResult> {
    const body = reportRunInputSchema.parse({
      branchId: params.branchId ?? null,
      from: params.from,
      to: params.to,
      params: {},
    });
    const raw = await post(`/api/v1/reporting/reports/${code}/run`, body);
    return adaptReportResult(apiReportResultSchema.parse(raw));
  },

  /** GET /api/v1/reporting/reports/fbr-tax-summary?branchId=&from=&to= (12-05). */
  async fbrTaxSummary(params: FbrTaxSummaryParams): Promise<FbrTaxSummary> {
    const raw = await get("/api/v1/reporting/reports/fbr-tax-summary", {
      branchId: params.branchId,
      from: params.from,
      to: params.to,
    });
    return adaptFbrTaxSummary(apiFbrTaxSummarySchema.parse(raw));
  },

  /**
   * GET /api/v1/reporting/dashboard/{branchId}/tiles — the REST snapshot (12-06) used for the
   * initial paint before the WebSocket takes over.
   */
  async dashboardTiles(branchId: string): Promise<DashboardTile[]> {
    const raw = await get<unknown[]>(`/api/v1/reporting/dashboard/${branchId}/tiles`);
    return (raw ?? []).map((t) => adaptDashboardTile(apiDashboardTileSchema.parse(t)));
  },
};
