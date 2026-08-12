import {
  align,
  cut as cutCommand,
  emphasis,
  feedAndCut,
  initialize,
  openDrawerAfterPrinting,
  textSize,
  type CutMode as CommandCutMode,
  type DrawerPin,
} from "./escpos-commands.js";
import { amountRow, centre, divider, quantityLabel } from "./layout.js";
import type { PrintDocument } from "../contract/print-document.schema.js";

/**
 * `PrintDocument` in, ESC/POS bytes out. A pure function: same inputs, same bytes, no clock, no
 * randomness, no I/O.
 *
 * <p>This is the ONLY place in the entire system that turns a document into bytes — research §9.3
 * decision 1. The browser never does it and neither does the cloud.
 */

/** The subset of a `PrinterEntry` (plan 26-02) this renderer reads. */
export interface PrinterProfile {
  /** MEASURED on the hardware during onboarding, never assumed. See layout.ts. */
  columns: number;
  codepage: string;
  cut: CommandCutMode;
  drawerPin: DrawerPin | null;
  drawerPulseMs: number | null;
}

export class RenderError extends Error {
  constructor(
    readonly field: string,
    detail: string,
  ) {
    super(`${field}: ${detail}`);
    this.name = "RenderError";
  }
}

const ESC = 0x1b;
const LF = 0x0a;

/**
 * `ESC t n` — select character code table.
 *
 * <p>A deliberately SHORT table, and an unknown codepage THROWS rather than falling back to a
 * default. A silent fallback to CP437 on a branch configured for Arabic prints a receipt of
 * question marks, and nothing would say so. Widening this table is the encoder library's job
 * (research §6.4 names Urdu/Arabic codepage handling as the genuinely hard part) and belongs with
 * the agent's transport work, not here.
 */
const CODEPAGES: Readonly<Record<string, number>> = {
  CP437: 0,
  CP850: 2,
  CP860: 3,
  CP863: 4,
  CP865: 5,
  CP1252: 16,
};

/**
 * Characters this renderer will substitute rather than refuse.
 *
 * <p>Every one is a typographic nicety with an unambiguous ASCII equivalent, so the substitution
 * cannot change what a customer understands the bill to say. Anything NOT in this table and not
 * ASCII throws — a receipt silently full of `?` is a receipt nobody can read, and the failure
 * would first be noticed by a customer.
 */
const TRANSLITERATIONS: Readonly<Record<string, string>> = {
  "—": "-", // em dash
  "–": "-", // en dash
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  " ": " ", // non-breaking space
  "…": "...",
};

export function renderReceipt(document: PrintDocument, printer: PrinterProfile): Uint8Array {
  if (document.type !== "CUSTOMER_RECEIPT" && document.type !== "KITCHEN_TICKET") {
    throw new RenderError("type", `unknown document type "${String(document.type)}"`);
  }
  if (!Number.isInteger(printer.columns) || printer.columns < 1) {
    throw new RenderError("printer.columns", `must be a positive integer; received ${printer.columns}`);
  }
  const codepage = CODEPAGES[printer.codepage];
  if (codepage === undefined) {
    throw new RenderError(
      "printer.codepage",
      `"${printer.codepage}" is not a codepage this renderer can select. Known: ` +
        `${Object.keys(CODEPAGES).join(", ")}. Refusing rather than defaulting, because a wrong ` +
        "code table prints a receipt of question marks and nothing reports it.",
    );
  }

  const out = new ByteStream();
  out.push(initialize());
  out.push(Uint8Array.from([ESC, 0x74, codepage]));

  if (document.type === "KITCHEN_TICKET") {
    renderKitchenTicket(document, printer, out);
  } else {
    renderCustomerReceipt(document, printer, out);
  }

  // Research §7.3: feed the printed area past the cutter, THEN cut, THEN kick the drawer. The
  // order is not cosmetic — a drawer solenoid firing mid-print can brown out an under-powered
  // supply (marked HEARSAY in the research and repeated as such here).
  out.push(feedLines(FEED_LINES_BEFORE_CUT));
  out.push(cutFor(printer.cut));

  const drawer = document.drawer;
  if (drawer !== null && drawer.kick) {
    if (drawer.connectorPin === null) {
      throw new RenderError("drawer.connectorPin", "a drawer kick was requested with no connector pin");
    }
    if (drawer.pulseMs === null) {
      throw new RenderError("drawer.pulseMs", "a drawer kick was requested with no pulse duration");
    }
    if (drawer.connectorPin !== 2 && drawer.connectorPin !== 5) {
      throw new RenderError("drawer.connectorPin", `must be 2 or 5; received ${drawer.connectorPin}`);
    }
    out.push(openDrawerAfterPrinting(drawer.connectorPin, drawer.pulseMs, drawer.pulseMs));
  }

  return out.bytes();
}

/** Lines of blank feed before the cut, so the printed area clears the blade. */
const FEED_LINES_BEFORE_CUT = 3;

function cutFor(mode: CommandCutMode): Uint8Array {
  // NONE emits nothing at all, which is the honest encoding for a continuous roll and for a branch
  // whose printer configuration could not be read (D-26-01).
  return mode === "NONE" ? new Uint8Array(0) : feedAndCut(mode, 0);
}

function renderCustomerReceipt(
  document: PrintDocument,
  printer: PrinterProfile,
  out: ByteStream,
): void {
  const cols = printer.columns;

  if (document.issue.reprint) {
    out.push(align("CENTER"));
    out.push(emphasis(true));
    writeLines(out, centre(`*** REPRINT #${document.issue.sequenceNumber} ***`, cols));
    if (document.issue.originalIssuedAt !== null) {
      writeLines(out, centre(`Original ${document.issue.originalIssuedAt}`, cols));
    }
    out.push(emphasis(false));
    out.push(align("LEFT"));
  }

  const header = document.header;
  if (header !== null) {
    out.push(align("CENTER"));
    if (header.branchName !== null) writeLines(out, centre(header.branchName, cols));
    for (const line of header.addressLines) writeLines(out, centre(line, cols));
    if (header.phone !== null) writeLines(out, centre(header.phone, cols));
    if (header.ntn !== null) writeLines(out, centre(`NTN: ${header.ntn}`, cols));
    if (header.strn !== null) writeLines(out, centre(`STRN: ${header.strn}`, cols));
    out.push(align("LEFT"));
  }

  writeLine(out, divider(cols));
  if (document.orderNo !== null) writeLines(out, amountRow("Order", document.orderNo, cols));
  writeLines(out, amountRow("Issued", document.issue.issuedAt, cols));
  writeLine(out, divider(cols));

  for (const line of document.lines) {
    writeLines(out, amountRow(quantityLabel(line.quantity, line.name), line.lineTotal.formatted, cols));
    for (const modifier of line.modifiers) writeLines(out, wrapIndented(`+ ${modifier}`, cols));
    if (line.note !== null) writeLines(out, wrapIndented(`! ${line.note}`, cols));
  }

  const totals = document.totals;
  if (totals !== null) {
    writeLine(out, divider(cols));
    writeLines(out, amountRow("Subtotal", totals.subtotal.formatted, cols));
    // 26-12 will suppress zero rows; the decision and the fiscal caveat live in that plan.
    writeLines(out, amountRow("Discount", totals.discount.formatted, cols));
    // F20. "Label OR money", and each half earns its place: a non-null label means this branch
    // HAS a service charge on this check, so a fully-comped 5% check still prints the Rs 0.00 line
    // that explains itself; a non-zero amount prints regardless, so money can never vanish off a
    // bill (a pre-F20 document carries an amount and no caption). What is gone is the third case,
    // which was every bill this printer ever produced: no label AND no money.
    if (totals.serviceChargeLabel !== null || totals.serviceCharge.paisa !== 0) {
      const scName = totals.serviceChargeLabel ?? "Service charge";
      const scLabel =
        totals.serviceChargeRatePercent !== null
          ? `${scName} (${totals.serviceChargeRatePercent}%)`
          : scName;
      writeLines(out, amountRow(scLabel, totals.serviceCharge.formatted, cols));
    }
    for (const tax of document.taxBreakdown) {
      writeLines(out, amountRow(taxLabel(tax), tax.amount.formatted, cols));
    }
    // D-4 — the summary row, and ONLY when it is not a second printing of the line above it.
    //
    // This renderer produces the paper the guest actually walks out with, and it printed:
    //
    //   Sales Tax (16.00%)          Rs   230.67
    //   Tax                         Rs   230.67
    //
    // Two lines, one amount, adjacent, on a customer-facing document. The total was right, so no
    // money was wrong — but a guest counting their own bill finds Rs 230.67 charged twice.
    //
    // The breakdown already states the tax. On ONE line that line IS the total and repeating it
    // is the defect; on several a summing row does real work; with none the row is the only place
    // the tax is named and must stay, because silence there reads as "no tax was charged".
    //
    // Kept deliberately identical to receipt-document.tsx: the browser preview and the paper are
    // two renderings of one document, and a guest comparing them must not find two bills.
    if (document.taxBreakdown.length !== 1) {
      writeLines(out, amountRow("Tax", totals.tax.formatted, cols));
    }
    writeLine(out, divider(cols));
    out.push(emphasis(true));
    out.push(textSize(SIZE_DOUBLE, SIZE_DOUBLE));
    writeLines(out, amountRow("TOTAL", totals.grandTotal.formatted, cols));
    out.push(textSize(SIZE_NORMAL, SIZE_NORMAL));
    out.push(emphasis(false));
  }

  if (document.tenders.length > 0) {
    writeLine(out, divider(cols));
    for (const tender of document.tenders) {
      writeLines(out, amountRow(tender.method ?? "TENDER", tender.amountApplied.formatted, cols));
      // F20. On its own line, never folded into the amount above: that figure settles the bill
      // and must keep summing to the grand total. A guest holding a Rs 998 bill and a Rs 1,048
      // card slip is owed the line that explains the difference.
      if (tender.tip.paisa > 0) {
        writeLines(out, amountRow("Tip", tender.tip.formatted, cols));
      }
      if (tender.change.paisa > 0) {
        writeLines(out, amountRow("Tendered", tender.amountTendered.formatted, cols));
        writeLines(out, amountRow("Change", tender.change.formatted, cols));
      }
      if (tender.referenceNo !== null) writeLines(out, amountRow("Ref", tender.referenceNo, cols));
    }
  }

  renderFiscal(document, printer, out);

  const footer = document.footer;
  if (footer !== null && footer.lines.length > 0) {
    writeLine(out, divider(cols));
    out.push(align("CENTER"));
    for (const line of footer.lines) writeLines(out, centre(line, cols));
    out.push(align("LEFT"));
  }
}

/**
 * The FBR region.
 *
 * <p>When a QR payload is present this THROWS a clearly named not-yet-implemented error. It does
 * not skip the region. The DI specification requires the symbol on every invoice, so a receipt
 * printed without it is not merely incomplete — it is missing something a tax regime demands, and
 * skipping it quietly would ship exactly that with nothing to say so. Phase 27 implements the
 * raster path (research §9.6: a raster image, not the printer's native QR command, because the
 * physical size is fixed at one inch).
 */
function renderFiscal(document: PrintDocument, printer: PrinterProfile, out: ByteStream): void {
  const fiscal = document.fiscal;
  if (fiscal === null) return;
  const cols = printer.columns;

  if (fiscal.qrPayload !== null) {
    throw new RenderError(
      "fiscal.qrPayload",
      "QR rasterisation is not implemented in this phase (Phase 27 owns FBR). Refusing to print " +
        "a fiscal receipt with the QR silently omitted — the DI specification requires the symbol " +
        "on every invoice.",
    );
  }

  if (fiscal.fbrInvoiceNumber === null && fiscal.noticeLine === null) {
    return; // declared but empty — prints as nothing, exactly like an absent region
  }

  writeLine(out, divider(cols));
  out.push(align("CENTER"));
  if (fiscal.fbrInvoiceNumber !== null) {
    writeLines(out, centre("FBR Invoice No.", cols));
    writeLines(out, centre(fiscal.fbrInvoiceNumber, cols));
  }
  if (fiscal.noticeLine !== null) writeLines(out, centre(fiscal.noticeLine, cols));
  out.push(align("LEFT"));
}

function renderKitchenTicket(
  document: PrintDocument,
  printer: PrinterProfile,
  out: ByteStream,
): void {
  const cols = printer.columns;
  const ticket = document.ticket;

  out.push(align("CENTER"));
  out.push(emphasis(true));
  out.push(textSize(SIZE_DOUBLE, SIZE_DOUBLE));
  // The station banner goes ABOVE the order number and at double size. A cook standing at a hot
  // pass needs to know in one glance whether this ticket is theirs; the order number is what they
  // read second, to call the plate back to a table.
  if (ticket !== null && ticket.stationCode !== null) {
    writeLines(out, centre(ticket.stationName ?? ticket.stationCode, cols));
  }
  if (document.orderNo !== null) writeLines(out, centre(document.orderNo, cols));
  out.push(textSize(SIZE_NORMAL, SIZE_NORMAL));
  if (document.issue.reprint) writeLines(out, centre(`*** REPRINT #${document.issue.sequenceNumber} ***`, cols));
  out.push(emphasis(false));
  out.push(align("LEFT"));
  writeLine(out, divider(cols));

  if (ticket !== null) {
    // Two per row where they pair naturally, because vertical space on an 80 mm roll is the
    // thing a kitchen printer is short of.
    const where = [ticket.orderTypeLabel, ticket.tableLabel === null ? null : `Table ${ticket.tableLabel}`]
      .filter((v): v is string => v !== null)
      .join("  ");
    const who = [
      ticket.coverCount === null ? null : `${ticket.coverCount} cover${ticket.coverCount === 1 ? "" : "s"}`,
      ticket.serverName ?? (ticket.serverRef === null ? null : `Srv ${ticket.serverRef.slice(0, 8)}`),
    ]
      .filter((v): v is string => v !== null)
      .join("  ");
    if (where.length > 0 || who.length > 0) writeLines(out, amountRow(where, who, cols));

    const fire = ticket.revisionNo === null ? "" : `Fire #${ticket.revisionNo}`;
    const firedAt = ticket.firedAt ?? "";
    if (fire.length > 0 || firedAt.length > 0) writeLines(out, amountRow(fire, firedAt, cols));

    // Order-level instructions, emphasised, on EVERY station's ticket. "No nuts on this table"
    // applies to the whole order; a station that does not see it plates the allergen.
    if (ticket.orderInstructions.length > 0) {
      out.push(emphasis(true));
      for (const note of ticket.orderInstructions) writeLines(out, wrap0(`** ${note}`, cols));
      out.push(emphasis(false));
    }
    writeLine(out, divider(cols));
  }

  // Grouped by station, in first-appearance order, so a station's lines are contiguous on the
  // paper the cook is holding.
  const byStation = new Map<string, typeof document.lines>();
  for (const line of document.lines) {
    const station = line.stationCode ?? "";
    const bucket = byStation.get(station);
    if (bucket) bucket.push(line);
    else byStation.set(station, [line]);
  }

  for (const [station, lines] of byStation) {
    if (station.length > 0) {
      out.push(emphasis(true));
      writeLines(out, wrap0(`[${station}]`, cols));
      out.push(emphasis(false));
    }
    for (const line of lines) {
      // NO amounts. A kitchen ticket carries what to cook and nothing about money.
      writeLines(out, wrap0(quantityLabel(line.quantity, line.name), cols));
      for (const modifier of line.modifiers) writeLines(out, wrapIndented(`+ ${modifier}`, cols));
      if (line.note !== null) writeLines(out, wrapIndented(`! ${line.note}`, cols));
    }
  }

  const footer = document.footer;
  if (footer !== null && footer.lines.length > 0) {
    writeLine(out, divider(cols));
    for (const line of footer.lines) writeLines(out, wrap0(line, cols));
  }
}

const SIZE_NORMAL = 1;
const SIZE_DOUBLE = 2;

/**
 * The phrase and the percentage a guest can check — and nothing else.
 *
 * <p>F6: this used to append the bucket's `rateCode` in brackets, and the paper read
 * `SR-STD-17 (17.00%) [SR-STD-17]` — a ledger classification, printed twice, wrapping onto a
 * second line at 42 columns. The parameter type is narrowed to the two fields that belong on
 * paper on purpose: the document still CARRIES `rateCode` (it is the bucket's machine identity,
 * and a stored print job is what a support engineer reads six weeks later), and a narrow
 * parameter is what stops a later edit from reaching for it again.
 */
function taxLabel(tax: { label: string | null; ratePercent: string | null }): string {
  const parts = [tax.label ?? "Tax"];
  if (tax.ratePercent !== null) parts.push(`(${tax.ratePercent}%)`);
  return parts.join(" ");
}

function wrap0(text: string, columns: number): string[] {
  return amountRow(text, "", columns).map((l) => l.trimEnd());
}

function wrapIndented(text: string, columns: number): string[] {
  return wrap0(text, columns).map((l) => `  ${l}`.slice(0, columns));
}

function writeLine(out: ByteStream, text: string): void {
  out.push(encodeText(text));
  out.push(Uint8Array.from([LF]));
}

function writeLines(out: ByteStream, lines: string[]): void {
  for (const line of lines) writeLine(out, line);
}

/**
 * Text to bytes, one byte per character.
 *
 * <p>Transliterates the typographic characters in {@link TRANSLITERATIONS} and THROWS on anything
 * else outside ASCII, naming the character. A receipt full of `?` is unreadable and the first
 * person to notice would be a customer.
 */
export function encodeText(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text) {
    const replacement = TRANSLITERATIONS[ch];
    const effective = replacement ?? ch;
    for (const c of effective) {
      const code = c.codePointAt(0)!;
      if (code < 0x20 || code > 0x7e) {
        throw new RenderError(
          "text",
          `cannot encode U+${code.toString(16).toUpperCase().padStart(4, "0")} ("${c}") in this ` +
            "renderer's ASCII range. Add a transliteration if it has an unambiguous equivalent, " +
            "or route this branch through the codepage encoder — refusing rather than printing " +
            "a character the customer cannot read.",
        );
      }
      bytes.push(code);
    }
  }
  return Uint8Array.from(bytes);
}

function feedLines(count: number): Uint8Array {
  return Uint8Array.from(new Array<number>(count).fill(LF));
}

/** A growable byte buffer, so the renderer reads as a sequence of emissions. */
class ByteStream {
  private readonly chunks: Uint8Array[] = [];

  push(chunk: Uint8Array): void {
    if (chunk.length > 0) this.chunks.push(chunk);
  }

  bytes(): Uint8Array {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

export { cutCommand };
