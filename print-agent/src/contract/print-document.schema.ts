/**
 * The agent's OWN definition of the print document, and its validator.
 *
 * <h2>Why the agent validates rather than trusting a shared type</h2>
 *
 * This package is a separately deployed artefact with its own build and its own release cadence.
 * It runs on a till in a restaurant and is fed JSON over HTTP by a cloud service that may be newer
 * or older than it is. A TypeScript type would be erased at runtime and prove nothing about what
 * actually arrived. So the shape is checked, and the check is tested against
 * `contracts/print/golden-receipt-document.json` — the SAME single file shared-lib's contract test
 * and the frontend's adapter test read. That one fixture is what keeps three definitions honest.
 *
 * <h2>Why this is hand-rolled and not zod</h2>
 *
 * Plan 26-04 task 3 says "create a zod schema". Zod is not in this package's manifest, and task 2's
 * acceptance criterion is that `package.json` declares EXACTLY ONE runtime dependency — the encoder,
 * which a human verified on npm and GitHub before it was installed. Adding a second dependency to
 * satisfy the letter of one instruction would break the other and would bypass the
 * package-legitimacy checkpoint this phase put in place on purpose. Structural validation of a
 * known schema is a hundred lines; a supply-chain decision made unilaterally by an agent is not
 * worth saving them.
 */

export type DocumentType = "CUSTOMER_RECEIPT" | "KITCHEN_TICKET";
export type Provenance = "SERVER" | "CLIENT_OFFLINE";
export type CutMode = "NONE" | "PARTIAL" | "FULL";

export interface ReceiptAmount {
  paisa: number;
  formatted: string;
}

export interface PrintIssue {
  sequenceNumber: number;
  reprint: boolean;
  issuedAt: string;
  originalIssuedAt: string | null;
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
  unitPrice: ReceiptAmount;
  lineTotal: ReceiptAmount;
  modifiers: string[];
  note: string | null;
  stationCode: string | null;
}

export interface PrintTotals {
  subtotal: ReceiptAmount;
  discount: ReceiptAmount;
  serviceCharge: ReceiptAmount;
  /**
   * F20 — the branch's own wording for its service charge, and the rate the check was charged at.
   * BOTH null when the branch takes no service charge, and the renderer then prints no
   * service-charge row at all: `Service charge Rs 0.00` came out of this printer on every bill
   * this product ever produced, for a charge no restaurant could set.
   */
  serviceChargeLabel: string | null;
  /** A string, e.g. `"5.00"` — printed, never computed with. */
  serviceChargeRatePercent: string | null;
  tax: ReceiptAmount;
  grandTotal: ReceiptAmount;
}

export interface PrintTaxLine {
  rateCode: string | null;
  label: string | null;
  ratePercent: string | null;
  amount: ReceiptAmount;
}

export interface PrintTender {
  method: string | null;
  amountApplied: ReceiptAmount;
  /** F20 — money taken on top of the bill for the staff. Zero on almost every tender. */
  tip: ReceiptAmount;
  amountTendered: ReceiptAmount;
  change: ReceiptAmount;
  referenceNo: string | null;
}

export interface PrintFiscal {
  fbrInvoiceNumber: string | null;
  qrPayload: string | null;
  qrSizeMm: number | null;
  logoAssetId: string | null;
  noticeLine: string | null;
}

export interface PrintDrawer {
  kick: boolean;
  connectorPin: number | null;
  pulseMs: number | null;
}

export interface PrintFooter {
  lines: string[];
}

/**
 * The kitchen routing block (26-07). Null on a customer receipt, and REFUSED there — the station,
 * the cover count and the server's identity are back-of-house data, and this package is the thing
 * that would actually put them on the paper a customer is handed.
 */
export interface PrintTicket {
  stationCode: string | null;
  stationName: string | null;
  orderTypeLabel: string | null;
  tableLabel: string | null;
  coverCount: number | null;
  revisionNo: number | null;
  firedAt: string | null;
  serverName: string | null;
  serverRef: string | null;
  orderInstructions: string[];
}

export interface PrintDocument {
  schemaVersion: string;
  type: DocumentType;
  provenance: Provenance;
  tenantId: string;
  branchId: string;
  orderId: string;
  orderNo: string | null;
  issue: PrintIssue;
  header: PrintHeader | null;
  ticket: PrintTicket | null;
  lines: PrintLine[];
  totals: PrintTotals | null;
  taxBreakdown: PrintTaxLine[];
  tenders: PrintTender[];
  fiscal: PrintFiscal | null;
  drawer: PrintDrawer | null;
  cut: { mode: CutMode };
  footer: PrintFooter | null;
}

/** Thrown with the JSON path of the offending field, never a bare "invalid document". */
export class PrintDocumentError extends Error {
  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(`${path}: ${detail}`);
    this.name = "PrintDocumentError";
  }
}

// ── Primitive readers. Each names its own path so the error points at a field. ────────────────

function obj(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PrintDocumentError(path, `expected an object, received ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

function str(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new PrintDocumentError(path, `expected a string, received ${describe(value)}`);
  }
  return value;
}

function nullableStr(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  return str(value, path);
}

function int(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new PrintDocumentError(path, `expected an integer, received ${describe(value)}`);
  }
  return value;
}

function nullableNum(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number") {
    throw new PrintDocumentError(path, `expected a number, received ${describe(value)}`);
  }
  return value;
}

function nullableInt(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null;
  return int(value, path);
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new PrintDocumentError(path, `expected a boolean, received ${describe(value)}`);
  }
  return value;
}

function arr(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new PrintDocumentError(path, `expected an array, received ${describe(value)}`);
  }
  return value;
}

function strArray(value: unknown, path: string): string[] {
  return arr(value, path).map((v, i) => str(v, `${path}[${i}]`));
}

function oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  const s = str(value, path);
  if (!(allowed as readonly string[]).includes(s)) {
    throw new PrintDocumentError(path, `must be one of ${allowed.join(" | ")}, received "${s}"`);
  }
  return s as T;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

/**
 * An amount, with the SAME guard the frontend's zod refinement and the Java assembler both make:
 * the rendered string must re-parse to the paisa it travels with.
 *
 * <p>Three independent checks of one invariant, on three sides of two wire boundaries. That is
 * deliberate — the defect it guards against is a receipt wrong by a factor of a hundred, and this
 * codebase shipped exactly that once.
 */
function amount(value: unknown, path: string): ReceiptAmount {
  const o = obj(value, path);
  const paisa = int(o.paisa, `${path}.paisa`);
  const formatted = str(o.formatted, `${path}.formatted`);
  const reparsed = parseFormattedAmount(formatted);
  if (reparsed === null) {
    throw new PrintDocumentError(`${path}.formatted`, `"${formatted}" is not a parsable amount`);
  }
  if (reparsed !== paisa) {
    throw new PrintDocumentError(
      path,
      `amount disagrees with itself: "${formatted}" re-parses to ${reparsed} paisa ` +
        `but the document says ${paisa}`,
    );
  }
  return { paisa, formatted };
}

/** The agent's copy of `ReceiptMoneyFormatter.parse` — prefix- and grouping-agnostic. */
export function parseFormattedAmount(rendered: string): number | null {
  let digits = "";
  let negative = false;
  let seenDigit = false;
  for (const c of rendered) {
    if (c === "-" && !seenDigit) negative = true;
    else if (c >= "0" && c <= "9") {
      seenDigit = true;
      digits += c;
    } else if (c === ".") digits += c;
  }
  if (!seenDigit) return null;
  const dot = digits.indexOf(".");
  const major = dot === -1 ? digits : digits.slice(0, dot);
  const minor = dot === -1 ? "" : digits.slice(dot + 1);
  if (dot !== -1 && minor.length !== 2) return null;
  const paisa = Number(major) * 100 + Number(minor === "" ? "0" : minor);
  if (!Number.isSafeInteger(paisa)) return null;
  return negative ? -paisa : paisa;
}

// ── The document ──────────────────────────────────────────────────────────────────────────────

export function parsePrintDocument(raw: unknown): PrintDocument {
  const d = obj(raw, "$");

  const type = oneOf(d.type, "$.type", ["CUSTOMER_RECEIPT", "KITCHEN_TICKET"] as const);

  const issueRaw = obj(d.issue, "$.issue");
  const issue: PrintIssue = {
    sequenceNumber: int(issueRaw.sequenceNumber, "$.issue.sequenceNumber"),
    reprint: bool(issueRaw.reprint, "$.issue.reprint"),
    issuedAt: str(issueRaw.issuedAt, "$.issue.issuedAt"),
    originalIssuedAt: nullableStr(issueRaw.originalIssuedAt, "$.issue.originalIssuedAt"),
  };
  if (issue.reprint && issue.originalIssuedAt === null) {
    throw new PrintDocumentError(
      "$.issue.originalIssuedAt",
      "a reprint must carry the original issue timestamp, or the paper cannot be told from an original",
    );
  }

  const document: PrintDocument = {
    schemaVersion: str(d.schemaVersion, "$.schemaVersion"),
    type,
    provenance: oneOf(d.provenance, "$.provenance", ["SERVER", "CLIENT_OFFLINE"] as const),
    tenantId: str(d.tenantId, "$.tenantId"),
    branchId: str(d.branchId, "$.branchId"),
    orderId: str(d.orderId, "$.orderId"),
    orderNo: nullableStr(d.orderNo, "$.orderNo"),
    issue,
    header: d.header == null ? null : parseHeader(d.header),
    ticket: d.ticket == null ? null : parseTicket(d.ticket),
    lines: arr(d.lines, "$.lines").map((l, i) => parseLine(l, `$.lines[${i}]`)),
    totals: d.totals == null ? null : parseTotals(d.totals),
    taxBreakdown: arr(d.taxBreakdown, "$.taxBreakdown").map((t, i) =>
      parseTaxLine(t, `$.taxBreakdown[${i}]`),
    ),
    tenders: arr(d.tenders, "$.tenders").map((t, i) => parseTender(t, `$.tenders[${i}]`)),
    fiscal: d.fiscal == null ? null : parseFiscal(d.fiscal),
    drawer: d.drawer == null ? null : parseDrawer(d.drawer),
    cut: { mode: oneOf(obj(d.cut, "$.cut").mode, "$.cut.mode", ["NONE", "PARTIAL", "FULL"] as const) },
    footer: d.footer == null ? null : { lines: strArray(obj(d.footer, "$.footer").lines, "$.footer.lines") },
  };

  // The same restriction shared-lib enforces in its compact constructor. Re-checked here rather
  // than assumed: a kitchen ticket carrying the customer's tenders is a privacy defect, and this
  // package is the thing that would actually print it.
  if (document.type === "KITCHEN_TICKET") {
    if (document.totals !== null) rejectKitchen("$.totals", "totals");
    if (document.taxBreakdown.length > 0) rejectKitchen("$.taxBreakdown", "a tax breakdown");
    if (document.tenders.length > 0) rejectKitchen("$.tenders", "tenders");
    if (document.fiscal !== null) rejectKitchen("$.fiscal", "a fiscal region");
    if (document.drawer !== null) rejectKitchen("$.drawer", "a drawer instruction");
  } else if (document.ticket !== null) {
    // The symmetric restriction shared-lib added in 26-07. A receipt carrying the routing block
    // would print the station, the cover count and the server's identity on the customer's copy.
    throw new PrintDocumentError(
      "$.ticket",
      "a CUSTOMER_RECEIPT must not carry a kitchen ticket block — the station, the cover count " +
        "and the server's identity are back-of-house routing, not something a customer is handed",
    );
  }

  return document;
}

function parseTicket(raw: unknown): PrintTicket {
  const o = obj(raw, "$.ticket");
  return {
    stationCode: nullableStr(o.stationCode, "$.ticket.stationCode"),
    stationName: nullableStr(o.stationName, "$.ticket.stationName"),
    orderTypeLabel: nullableStr(o.orderTypeLabel, "$.ticket.orderTypeLabel"),
    tableLabel: nullableStr(o.tableLabel, "$.ticket.tableLabel"),
    coverCount: nullableInt(o.coverCount, "$.ticket.coverCount"),
    revisionNo: nullableInt(o.revisionNo, "$.ticket.revisionNo"),
    firedAt: nullableStr(o.firedAt, "$.ticket.firedAt"),
    serverName: nullableStr(o.serverName, "$.ticket.serverName"),
    serverRef: nullableStr(o.serverRef, "$.ticket.serverRef"),
    orderInstructions:
      o.orderInstructions == null
        ? []
        : strArray(o.orderInstructions, "$.ticket.orderInstructions"),
  };
}

function rejectKitchen(path: string, what: string): never {
  throw new PrintDocumentError(
    path,
    `a KITCHEN_TICKET must not carry ${what} — the kitchen does not see what the customer paid, ` +
      "and a kitchen printer does not open the till",
  );
}

function parseHeader(raw: unknown): PrintHeader {
  const o = obj(raw, "$.header");
  return {
    branchName: nullableStr(o.branchName, "$.header.branchName"),
    addressLines: strArray(o.addressLines, "$.header.addressLines"),
    phone: nullableStr(o.phone, "$.header.phone"),
    ntn: nullableStr(o.ntn, "$.header.ntn"),
    strn: nullableStr(o.strn, "$.header.strn"),
    logoFileId: nullableStr(o.logoFileId, "$.header.logoFileId"),
  };
}

function parseLine(raw: unknown, path: string): PrintLine {
  const o = obj(raw, path);
  return {
    name: nullableStr(o.name, `${path}.name`),
    quantity: int(o.quantity, `${path}.quantity`),
    unitPrice: amount(o.unitPrice, `${path}.unitPrice`),
    lineTotal: amount(o.lineTotal, `${path}.lineTotal`),
    modifiers: strArray(o.modifiers, `${path}.modifiers`),
    note: nullableStr(o.note, `${path}.note`),
    stationCode: nullableStr(o.stationCode, `${path}.stationCode`),
  };
}

function parseTotals(raw: unknown): PrintTotals {
  const o = obj(raw, "$.totals");
  return {
    subtotal: amount(o.subtotal, "$.totals.subtotal"),
    discount: amount(o.discount, "$.totals.discount"),
    serviceCharge: amount(o.serviceCharge, "$.totals.serviceCharge"),
    // F20. `?? null` before the strict reader: a pos-service that predates the field omits the
    // key entirely, and this parser is the thing standing between a stale server and a printer
    // that produces nothing at all. Absent and null both mean "no service charge on this bill".
    serviceChargeLabel: nullableStr(o.serviceChargeLabel ?? null, "$.totals.serviceChargeLabel"),
    serviceChargeRatePercent: nullableStr(
      o.serviceChargeRatePercent ?? null,
      "$.totals.serviceChargeRatePercent",
    ),
    tax: amount(o.tax, "$.totals.tax"),
    grandTotal: amount(o.grandTotal, "$.totals.grandTotal"),
  };
}

function parseTaxLine(raw: unknown, path: string): PrintTaxLine {
  const o = obj(raw, path);
  return {
    rateCode: nullableStr(o.rateCode, `${path}.rateCode`),
    label: nullableStr(o.label, `${path}.label`),
    ratePercent: nullableStr(o.ratePercent, `${path}.ratePercent`),
    amount: amount(o.amount, `${path}.amount`),
  };
}

function parseTender(raw: unknown, path: string): PrintTender {
  const o = obj(raw, path);
  return {
    method: nullableStr(o.method, `${path}.method`),
    amountApplied: amount(o.amountApplied, `${path}.amountApplied`),
    // F20. A pre-F20 tender carried no tip, which is a real zero and not an unknown.
    tip:
      o.tip === undefined || o.tip === null
        ? { paisa: 0, formatted: "Rs 0.00" }
        : amount(o.tip, `${path}.tip`),
    amountTendered: amount(o.amountTendered, `${path}.amountTendered`),
    change: amount(o.change, `${path}.change`),
    referenceNo: nullableStr(o.referenceNo, `${path}.referenceNo`),
  };
}

function parseFiscal(raw: unknown): PrintFiscal {
  const o = obj(raw, "$.fiscal");
  return {
    fbrInvoiceNumber: nullableStr(o.fbrInvoiceNumber, "$.fiscal.fbrInvoiceNumber"),
    qrPayload: nullableStr(o.qrPayload, "$.fiscal.qrPayload"),
    qrSizeMm: nullableNum(o.qrSizeMm, "$.fiscal.qrSizeMm"),
    logoAssetId: nullableStr(o.logoAssetId, "$.fiscal.logoAssetId"),
    noticeLine: nullableStr(o.noticeLine, "$.fiscal.noticeLine"),
  };
}

function parseDrawer(raw: unknown): PrintDrawer {
  const o = obj(raw, "$.drawer");
  return {
    kick: bool(o.kick, "$.drawer.kick"),
    connectorPin: nullableInt(o.connectorPin, "$.drawer.connectorPin"),
    pulseMs: nullableInt(o.pulseMs, "$.drawer.pulseMs"),
  };
}
