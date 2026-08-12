// Layer-3 domain models for the print document (Phase 26, plan 26-01).
//
// One schema describes the customer receipt and the kitchen ticket; they are two VALUES of
// `PrintDocument`, distinguished by `type`. A kitchen ticket carries no totals, no tax breakdown,
// no tenders, no fiscal region and no drawer instruction — the server rejects such a document at
// construction, so a renderer may treat those nulls as a guarantee rather than a hope.

export type PrintDocumentType = "CUSTOMER_RECEIPT" | "KITCHEN_TICKET";

/** SERVER documents are authoritative and may carry FBR data; CLIENT_OFFLINE ones are provisional. */
export type PrintProvenance = "SERVER" | "CLIENT_OFFLINE";

export type PrintCutMode = "NONE" | "PARTIAL" | "FULL";

/**
 * The integer paisa AND the string already rendered from it by the server's one print formatter.
 *
 * Render `formatted` verbatim. NEVER divide `paisa` by 100 in a component, and never re-format —
 * the document has already done it, once, in the one place D-26-04 names. `paisa` is here so a
 * test (and the zod refinement at the boundary) can prove the two never disagree.
 */
export interface PrintAmount {
  paisa: number;
  formatted: string;
}

export interface PrintIssue {
  sequenceNumber: number;
  /** True when this is not the first issue of this document. */
  reprint: boolean;
  issuedAt: Date;
  /** Non-null if and only if `reprint` — a reprint says what it is a reprint of. */
  originalIssuedAt: Date | null;
}

export interface PrintHeader {
  branchName: string | null;
  addressLines: string[];
  phone: string | null;
  ntn: string | null;
  strn: string | null;
  logoFileId: string | null;
}

export interface PrintLine {
  name: string | null;
  quantity: number;
  unitPrice: PrintAmount;
  lineTotal: PrintAmount;
  /** Human-readable modifier descriptions, already resolved server-side. */
  modifiers: string[];
  note: string | null;
  stationCode: string | null;
}

/** `subtotal - discount + serviceCharge + tax === grandTotal`, guaranteed by the server. */
export interface PrintTotals {
  subtotal: PrintAmount;
  discount: PrintAmount;
  serviceCharge: PrintAmount;
  /**
   * F20 — the branch's own wording, and the rate. BOTH null when the branch takes no service
   * charge, and the renderer must then print no service-charge row at all.
   */
  serviceChargeLabel: string | null;
  /** A string, e.g. `"5.00"` — printed, never computed with. */
  serviceChargeRatePercent: string | null;
  tax: PrintAmount;
  grandTotal: PrintAmount;
}

export interface PrintTaxLine {
  rateCode: string | null;
  label: string | null;
  /** A string, e.g. `"16.00"` — printed, never computed with. */
  ratePercent: string | null;
  amount: PrintAmount;
}

export interface PrintTender {
  method: string | null;
  /** What settled the bill. The tenders applied sum to the grand total. */
  amountApplied: PrintAmount;
  /** F20 — money taken on top of the bill for the staff. Zero on almost every tender. */
  tip: PrintAmount;
  /** What the customer handed over — `amountApplied + tip + change`. */
  amountTendered: PrintAmount;
  change: PrintAmount;
  referenceNo: string | null;
}

/**
 * The FBR region (D-26-03), declared before FBR integration exists. Phase 27 populates these
 * fields; it does not redesign the document. Every field is nullable and a receipt with no fiscal
 * data is a normal receipt, not an error.
 */
export interface PrintFiscal {
  fbrInvoiceNumber: string | null;
  /** Opaque — the DI spec fixes the symbol version and size and never says what it encodes. */
  qrPayload: string | null;
  /** Physical size in millimetres; the spec's 1.0 inch is 25.4. */
  qrSizeMm: number | null;
  logoAssetId: string | null;
  noticeLine: string | null;
}

/** An instruction, never a byte sequence — the print agent owns the mapping to the wire. */
export interface PrintDrawer {
  kick: boolean;
  connectorPin: number | null;
  pulseMs: number | null;
}

export interface PrintCut {
  mode: PrintCutMode;
}

export interface PrintFooter {
  lines: string[];
}

export interface PrintDocument {
  schemaVersion: string;
  type: PrintDocumentType;
  provenance: PrintProvenance;
  tenantId: string;
  branchId: string;
  orderId: string;
  orderNo: string | null;
  issue: PrintIssue;
  header: PrintHeader | null;
  lines: PrintLine[];
  /** Null on a kitchen ticket. */
  totals: PrintTotals | null;
  /** Empty on a kitchen ticket. */
  taxBreakdown: PrintTaxLine[];
  /** Empty on a kitchen ticket. */
  tenders: PrintTender[];
  /** Null on a kitchen ticket, and null on any receipt with no fiscal data yet. */
  fiscal: PrintFiscal | null;
  /** Null on a kitchen ticket — a kitchen printer does not open the till. */
  drawer: PrintDrawer | null;
  cut: PrintCut;
  footer: PrintFooter | null;
}
