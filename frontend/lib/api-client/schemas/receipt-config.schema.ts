import { z } from "zod";

// Layer-1 (§7.2.5): the wire shape of user-service's `ReceiptConfigDtos.ReceiptConfig`, stored in
// `branches.receipt_config`. This module is the ONLY place that knows it.
//
// Not `strictObject`, unlike print.schema.ts: this blob is a settings document that the server may
// legitimately grow a field on before the UI learns to render it, and a settings screen that
// refuses to open because the server added a key is worse than one that ignores the key. The print
// DOCUMENT is the opposite case — a field the renderer silently drops is a missing line on a
// customer's receipt — which is why the two files make opposite choices on purpose.

export const printerRoleSchema = z.enum(["RECEIPT", "KITCHEN"]);
export const printerTransportSchema = z.enum(["TCP", "SYSTEM"]);
export const printerCutModeSchema = z.enum(["NONE", "PARTIAL", "FULL"]);

export const apiAgentEndpointSchema = z.object({
  baseUrl: z.string(),
  lanUrl: z.string().nullish(),
});

export const apiPrinterEntrySchema = z.object({
  id: z.string(),
  /** Null means "the branch default for this role" (D-26-05). */
  terminalId: z.string().uuid().nullish(),
  role: printerRoleSchema,
  stationCode: z.string().nullish(),
  transport: printerTransportSchema,
  host: z.string().nullish(),
  port: z.number().int().nullish(),
  systemPrinterName: z.string().nullish(),
  widthMm: z.number().int(),
  columns: z.number().int(),
  /**
   * False until somebody has run the calibration print against this printer. Research §7.5 could
   * not establish a canonical column count for any model, so a stored value that nobody measured
   * is a DIFFERENT thing from one that somebody did, and the UI has to be able to say which.
   */
  columnsMeasured: z.boolean(),
  codepage: z.string(),
  cut: printerCutModeSchema,
  drawerPin: z.number().int().nullish(),
  drawerPulseMs: z.number().int().nullish(),
});

export const apiReceiptHeaderConfigSchema = z.object({
  logoFileId: z.string().uuid().nullish(),
  lines: z.array(z.string()),
});

export const apiReceiptFooterConfigSchema = z.object({
  lines: z.array(z.string()),
});

export const apiFbrPrintPreferencesSchema = z.object({
  printLogo: z.boolean(),
  qrSizeMm: z.number().nullish(),
});

export const apiReceiptConfigSchema = z.object({
  agent: apiAgentEndpointSchema.nullish(),
  printers: z.array(apiPrinterEntrySchema),
  header: apiReceiptHeaderConfigSchema.nullish(),
  footer: apiReceiptFooterConfigSchema.nullish(),
  fbr: apiFbrPrintPreferencesSchema.nullish(),
  kitchenStations: z.array(z.string()),
});

/**
 * What is still missing after a save. `unroutedStations` is the load-bearing field: a declared
 * kitchen station that no printer routes means tickets will be enqueued for a destination that
 * does not exist, and that failure presents as a kitchen that simply never prints.
 */
export const apiCompletenessReportSchema = z.object({
  complete: z.boolean(),
  unroutedStations: z.array(z.string()),
  warnings: z.array(z.string()),
});

export const apiReceiptConfigResponseSchema = z.object({
  config: apiReceiptConfigSchema.nullish(),
  completeness: apiCompletenessReportSchema,
});

export type ApiAgentEndpoint = z.infer<typeof apiAgentEndpointSchema>;
export type ApiPrinterEntry = z.infer<typeof apiPrinterEntrySchema>;
export type ApiReceiptHeaderConfig = z.infer<typeof apiReceiptHeaderConfigSchema>;
export type ApiReceiptFooterConfig = z.infer<typeof apiReceiptFooterConfigSchema>;
export type ApiFbrPrintPreferences = z.infer<typeof apiFbrPrintPreferencesSchema>;
export type ApiReceiptConfig = z.infer<typeof apiReceiptConfigSchema>;
export type ApiCompletenessReport = z.infer<typeof apiCompletenessReportSchema>;
export type ApiReceiptConfigResponse = z.infer<typeof apiReceiptConfigResponseSchema>;
