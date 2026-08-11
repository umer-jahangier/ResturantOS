/**
 * Domain model for a POS terminal profile (D-28-03).
 *
 * <p>A terminal is a named till: a code a device remembers itself by, the menu it offers, and the
 * stations it fires to. In a cloud deployment reached from browsers, "a dedicated POS" is a browser
 * session bound to one of these profiles rather than a machine-specific install — which is why the
 * profile is a row, not a config file.
 */

export type ServiceModel = "COUNTER" | "TABLE_SERVICE" | "SELF_SERVE";

export type TerminalOrderType = "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "PICKUP";

export interface PosTerminal {
  id: string;
  branchId: string;
  /** Immutable. A device remembers which terminal it is by this. */
  code: string;
  name: string;
  serviceModel: ServiceModel;
  defaultOrderType: TerminalOrderType;
  printerRef: string | null;
  active: boolean;
  categoryIds: string[];
  stationIds: string[];
  /**
   * TRUE when no category is scoped. Read THIS, not `categoryIds.length === 0`.
   *
   * <p>Empty means everything, and the encoding has no flag behind it in the database on purpose
   * (28-04 has a test forbidding one). Naming the property here is the client's half of the same
   * discipline: a caller reading a bare empty array will eventually render "offers nothing", which
   * is the exact opposite of what it means.
   */
  offersWholeMenu: boolean;
  /** TRUE when no station is scoped — the terminal fires to every station at its branch. */
  firesToAllStations: boolean;
}

export interface CreateTerminalPayload {
  code: string;
  name: string;
  serviceModel: ServiceModel;
  defaultOrderType: TerminalOrderType;
  categoryIds: string[];
  stationIds: string[];
}
