// Layer-2 adapter: the receipt-config wire shape → the domain model.

import type {
  ApiAgentEndpoint,
  ApiCompletenessReport,
  ApiFbrPrintPreferences,
  ApiPrinterEntry,
  ApiReceiptConfig,
  ApiReceiptConfigResponse,
  ApiReceiptFooterConfig,
  ApiReceiptHeaderConfig,
} from "@/lib/api-client/schemas/receipt-config.schema";
import type {
  AgentEndpoint,
  CompletenessReport,
  FbrPrintPreferences,
  PrinterEntry,
  ReceiptConfig,
  ReceiptConfigView,
  ReceiptFooterConfig,
  ReceiptHeaderConfig,
} from "@/lib/models/receipt-config.model";

export function adaptAgentEndpoint(raw: ApiAgentEndpoint): AgentEndpoint {
  return { baseUrl: raw.baseUrl, lanUrl: raw.lanUrl ?? null };
}

export function adaptPrinterEntry(raw: ApiPrinterEntry): PrinterEntry {
  return {
    id: raw.id,
    terminalId: raw.terminalId ?? null,
    role: raw.role,
    stationCode: raw.stationCode ?? null,
    transport: raw.transport,
    host: raw.host ?? null,
    port: raw.port ?? null,
    systemPrinterName: raw.systemPrinterName ?? null,
    widthMm: raw.widthMm,
    columns: raw.columns,
    // NOT defaulted to true. An unmeasured column count that presents as measured is the one
    // thing this flag exists to prevent.
    columnsMeasured: raw.columnsMeasured,
    codepage: raw.codepage,
    cut: raw.cut,
    drawerPin: raw.drawerPin ?? null,
    drawerPulseMs: raw.drawerPulseMs ?? null,
  };
}

export function adaptReceiptHeaderConfig(raw: ApiReceiptHeaderConfig): ReceiptHeaderConfig {
  return { logoFileId: raw.logoFileId ?? null, lines: raw.lines };
}

export function adaptReceiptFooterConfig(raw: ApiReceiptFooterConfig): ReceiptFooterConfig {
  return { lines: raw.lines };
}

export function adaptFbrPrintPreferences(raw: ApiFbrPrintPreferences): FbrPrintPreferences {
  return { printLogo: raw.printLogo, qrSizeMm: raw.qrSizeMm ?? null };
}

/**
 * A branch nobody has configured comes back with an empty printer array, not a null config — but
 * this adapter tolerates both, because "no printers here" must be a value the UI can render and
 * never an `undefined` it has to guess about.
 */
export function adaptReceiptConfig(raw: ApiReceiptConfig | null | undefined): ReceiptConfig {
  if (raw == null) {
    return {
      agent: null,
      printers: [],
      header: null,
      footer: null,
      fbr: null,
      kitchenStations: [],
    };
  }
  return {
    agent: raw.agent == null ? null : adaptAgentEndpoint(raw.agent),
    printers: raw.printers.map(adaptPrinterEntry),
    header: raw.header == null ? null : adaptReceiptHeaderConfig(raw.header),
    footer: raw.footer == null ? null : adaptReceiptFooterConfig(raw.footer),
    fbr: raw.fbr == null ? null : adaptFbrPrintPreferences(raw.fbr),
    kitchenStations: raw.kitchenStations,
  };
}

export function adaptCompletenessReport(raw: ApiCompletenessReport): CompletenessReport {
  return {
    complete: raw.complete,
    // Carried through verbatim. This list is the whole reason the endpoint returns a report at
    // all; dropping it here would put the silence back.
    unroutedStations: raw.unroutedStations,
    warnings: raw.warnings,
  };
}

export function adaptReceiptConfigResponse(raw: ApiReceiptConfigResponse): ReceiptConfigView {
  return {
    config: adaptReceiptConfig(raw.config),
    completeness: adaptCompletenessReport(raw.completeness),
  };
}

/** The domain model back onto the wire. Field names are identical by design; nulls stay nulls. */
export function toReceiptConfigWire(config: ReceiptConfig): ApiReceiptConfig {
  return {
    agent: config.agent,
    printers: config.printers,
    header: config.header,
    footer: config.footer,
    fbr: config.fbr,
    kitchenStations: config.kitchenStations,
  };
}
