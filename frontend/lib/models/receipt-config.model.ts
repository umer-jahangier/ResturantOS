// Layer-3 domain models for a branch's printer registry (Phase 26, plan 26-02, D-26-05).

export type PrinterRole = "RECEIPT" | "KITCHEN";
export type PrinterTransport = "TCP" | "SYSTEM";
export type PrinterCutMode = "NONE" | "PARTIAL" | "FULL";

export interface AgentEndpoint {
  /** The loopback address the POS tab posts print documents to. */
  baseUrl: string;
  /** The same agent reachable from other tills on the branch LAN. */
  lanUrl: string | null;
}

export interface PrinterEntry {
  id: string;
  /** Null means this is the branch default for its role (D-26-05). */
  terminalId: string | null;
  role: PrinterRole;
  /** Meaningful only for a KITCHEN printer. */
  stationCode: string | null;
  transport: PrinterTransport;
  host: string | null;
  port: number | null;
  systemPrinterName: string | null;
  widthMm: number;
  columns: number;
  /** False until the calibration print has confirmed `columns` against the hardware. */
  columnsMeasured: boolean;
  codepage: string;
  cut: PrinterCutMode;
  /** ESC/POS connector pin, 2 or 5. Receipt printers only. */
  drawerPin: number | null;
  drawerPulseMs: number | null;
}

export interface ReceiptHeaderConfig {
  logoFileId: string | null;
  lines: string[];
}

export interface ReceiptFooterConfig {
  lines: string[];
}

export interface FbrPrintPreferences {
  printLogo: boolean;
  /** Physical QR size in millimetres; the DI spec's 1.0 inch is 25.4. */
  qrSizeMm: number | null;
}

export interface ReceiptConfig {
  agent: AgentEndpoint | null;
  printers: PrinterEntry[];
  header: ReceiptHeaderConfig | null;
  footer: ReceiptFooterConfig | null;
  fbr: FbrPrintPreferences | null;
  /** The station codes this branch operates, whether or not a printer routes them. */
  kitchenStations: string[];
}

export interface CompletenessReport {
  complete: boolean;
  /**
   * Declared kitchen stations that no printer routes. A configuration in this state is SAVED and
   * legitimate — it is where a branch sits halfway through onboarding — but a UI that does not
   * surface this list is a UI that lets a kitchen go live with nowhere for its tickets to go.
   */
  unroutedStations: string[];
  warnings: string[];
}

export interface ReceiptConfigView {
  config: ReceiptConfig;
  completeness: CompletenessReport;
}

/**
 * The configuration of a branch nobody has configured.
 *
 * <p>Exported for FORM INITIALISATION only. It must never be used as a fallback for a failed read
 * — see the rule on `useReceiptConfig`. A settings screen that renders this because the request
 * failed will have a manager entering a configuration that already exists, and then two
 * configurations disagree.
 */
export const EMPTY_RECEIPT_CONFIG: ReceiptConfig = {
  agent: null,
  printers: [],
  header: null,
  footer: null,
  fbr: null,
  kitchenStations: [],
};
