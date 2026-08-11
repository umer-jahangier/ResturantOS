import { z } from "zod";

// Layer-1 (§7.2.5): the RAW wire shape of `io.restaurantos.shared.print.PrintDocument`.
// This module is the ONLY place that knows it. The single source of truth for whether this
// mirror is still correct is `contracts/print/golden-receipt-document.json` at the repository
// root — produced by shared-lib's PrintDocumentContractTest and read from disk by the adapter
// test. There is exactly one copy of that file and it is not in this tree.

/**
 * Parse a rendered print amount back to its minor unit (paisa).
 *
 * <p>The TypeScript mirror of `ReceiptMoneyFormatter.parse`. Prefix-agnostic on purpose: it
 * discards everything that is not a digit, a decimal point or a leading sign, so it accepts any
 * currency prefix and any grouping separator.
 *
 * Returns `null` when the string carries no parsable amount — the caller turns that into a
 * validation issue rather than a thrown error.
 */
export function parsePrintedAmountToPaisa(rendered: string): number | null {
  let digits = "";
  let negative = false;
  let seenDigit = false;

  for (const c of rendered) {
    if (c === "-" && !seenDigit) {
      negative = true;
    } else if (c >= "0" && c <= "9") {
      seenDigit = true;
      digits += c;
    } else if (c === ".") {
      digits += c;
    }
    // Everything else — the currency prefix, grouping separators, whitespace — is noise.
  }
  if (!seenDigit) return null;

  const dot = digits.indexOf(".");
  const major = dot === -1 ? digits : digits.slice(0, dot);
  const minor = dot === -1 ? "" : digits.slice(dot + 1);
  if (minor.length !== 2 && dot !== -1) return null;

  const paisa = Number(major) * 100 + Number(minor === "" ? "0" : minor);
  if (!Number.isSafeInteger(paisa)) return null;
  return negative ? -paisa : paisa;
}

/**
 * `{ paisa, formatted }` — the integer AND the string the server already rendered from it.
 *
 * The refinement below re-parses `formatted` and compares it to `paisa`. It is DELIBERATELY
 * redundant with the assertions on the Java side: the failure it guards against is a receipt that
 * is wrong by a factor of a hundred, and this codebase has already shipped that exact defect once
 * (the journal-entry detail screen rendered raw paisa, making every total 100x too large). A
 * receipt is the worse place for it, because the customer keeps the paper.
 *
 * A component MUST render `formatted` verbatim. Never divide `paisa` by 100.
 */
export const apiReceiptAmountSchema = z
  .strictObject({
    // A JS number is exact to 2^53 paisa (≈ Rs 90 trillion). Beyond that the refinement below
    // rejects rather than silently rounding — an unsafe integer is not a receipt total.
    paisa: z.number().int(),
    formatted: z.string(),
  })
  .superRefine((amount, ctx) => {
    const reparsed = parsePrintedAmountToPaisa(amount.formatted);
    if (reparsed === null) {
      ctx.addIssue({
        code: "custom",
        message: `amount "${amount.formatted}" is not a parsable rendered amount`,
      });
      return;
    }
    if (reparsed !== amount.paisa) {
      ctx.addIssue({
        code: "custom",
        message:
          `amount disagrees with itself: formatted "${amount.formatted}" re-parses to ` +
          `${reparsed} paisa but the document says ${amount.paisa}`,
      });
    }
  });

export const apiPrintIssueSchema = z.strictObject({
  sequenceNumber: z.number().int(),
  reprint: z.boolean(),
  issuedAt: z.string(),
  originalIssuedAt: z.string().nullable(),
});

export const apiPrintHeaderSchema = z.strictObject({
  branchName: z.string().nullable(),
  addressLines: z.array(z.string()),
  phone: z.string().nullable(),
  ntn: z.string().nullable(),
  strn: z.string().nullable(),
  logoFileId: z.string().uuid().nullable(),
});

export const apiPrintLineSchema = z.strictObject({
  name: z.string().nullable(),
  quantity: z.number().int(),
  unitPrice: apiReceiptAmountSchema,
  lineTotal: apiReceiptAmountSchema,
  modifiers: z.array(z.string()),
  note: z.string().nullable(),
  stationCode: z.string().nullable(),
});

export const apiPrintTotalsSchema = z.strictObject({
  subtotal: apiReceiptAmountSchema,
  discount: apiReceiptAmountSchema,
  serviceCharge: apiReceiptAmountSchema,
  tax: apiReceiptAmountSchema,
  grandTotal: apiReceiptAmountSchema,
});

export const apiPrintTaxLineSchema = z.strictObject({
  rateCode: z.string().nullable(),
  label: z.string().nullable(),
  // A STRING on the wire, exactly as on the Java record — a tax rate is printed, not computed
  // with, and no floating-point type belongs in a print document.
  ratePercent: z.string().nullable(),
  amount: apiReceiptAmountSchema,
});

export const apiPrintTenderSchema = z.strictObject({
  method: z.string().nullable(),
  amountApplied: apiReceiptAmountSchema,
  amountTendered: apiReceiptAmountSchema,
  change: apiReceiptAmountSchema,
  referenceNo: z.string().nullable(),
});

/**
 * The FBR region (D-26-03). Every field is nullable and stays that way until Phase 27 populates
 * it. An absent fiscal field is a null in a declared shape, never a missing shape.
 */
export const apiPrintFiscalSchema = z.strictObject({
  fbrInvoiceNumber: z.string().nullable(),
  qrPayload: z.string().nullable(),
  qrSizeMm: z.number().nullable(),
  logoAssetId: z.string().uuid().nullable(),
  noticeLine: z.string().nullable(),
});

export const apiPrintDrawerSchema = z.strictObject({
  kick: z.boolean(),
  connectorPin: z.number().int().nullable(),
  pulseMs: z.number().int().nullable(),
});

export const apiPrintCutSchema = z.strictObject({
  mode: z.enum(["NONE", "PARTIAL", "FULL"]),
});

export const apiPrintFooterSchema = z.strictObject({
  lines: z.array(z.string()),
});

/**
 * The whole document. `strictObject` throughout: an unknown key is NOT stripped, it is an error.
 * A field the server started sending that this mirror does not know about is drift, and drift in
 * a printed receipt is a customer-visible defect — better a loud parse failure at the boundary
 * than a silently missing line on the paper.
 *
 * No `z.coerce` anywhere: the wire types are the wire types.
 */
export const apiPrintDocumentSchema = z.strictObject({
  schemaVersion: z.string(),
  type: z.enum(["CUSTOMER_RECEIPT", "KITCHEN_TICKET"]),
  provenance: z.enum(["SERVER", "CLIENT_OFFLINE"]),
  tenantId: z.string().uuid(),
  branchId: z.string().uuid(),
  orderId: z.string().uuid(),
  orderNo: z.string().nullish(),
  issue: apiPrintIssueSchema,
  header: apiPrintHeaderSchema.nullish(),
  lines: z.array(apiPrintLineSchema),
  // Null on a kitchen ticket — the kitchen does not see what the customer paid.
  totals: apiPrintTotalsSchema.nullish(),
  taxBreakdown: z.array(apiPrintTaxLineSchema),
  tenders: z.array(apiPrintTenderSchema),
  fiscal: apiPrintFiscalSchema.nullish(),
  drawer: apiPrintDrawerSchema.nullish(),
  cut: apiPrintCutSchema,
  footer: apiPrintFooterSchema.nullish(),
});

export type ApiReceiptAmount = z.infer<typeof apiReceiptAmountSchema>;
export type ApiPrintIssue = z.infer<typeof apiPrintIssueSchema>;
export type ApiPrintHeader = z.infer<typeof apiPrintHeaderSchema>;
export type ApiPrintLine = z.infer<typeof apiPrintLineSchema>;
export type ApiPrintTotals = z.infer<typeof apiPrintTotalsSchema>;
export type ApiPrintTaxLine = z.infer<typeof apiPrintTaxLineSchema>;
export type ApiPrintTender = z.infer<typeof apiPrintTenderSchema>;
export type ApiPrintFiscal = z.infer<typeof apiPrintFiscalSchema>;
export type ApiPrintDrawer = z.infer<typeof apiPrintDrawerSchema>;
export type ApiPrintCut = z.infer<typeof apiPrintCutSchema>;
export type ApiPrintFooter = z.infer<typeof apiPrintFooterSchema>;
export type ApiPrintDocument = z.infer<typeof apiPrintDocumentSchema>;
