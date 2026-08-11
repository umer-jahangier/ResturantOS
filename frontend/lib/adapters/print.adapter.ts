// Layer-2 adapter: the raw print-document wire shape → the domain model.
//
// This file performs NO arithmetic on any money field. It moves strings and integers. The server
// already rendered every amount, once, in the one place D-26-04 names; a second conversion here
// would be a second opinion about what the customer owes.

import type {
  ApiPrintCut,
  ApiPrintDocument,
  ApiPrintDrawer,
  ApiPrintFiscal,
  ApiPrintFooter,
  ApiPrintHeader,
  ApiPrintIssue,
  ApiPrintLine,
  ApiPrintTaxLine,
  ApiPrintTender,
  ApiPrintTotals,
  ApiReceiptAmount,
} from "@/lib/api-client/schemas/print.schema";
import type {
  PrintAmount,
  PrintCut,
  PrintDocument,
  PrintDrawer,
  PrintFiscal,
  PrintFooter,
  PrintHeader,
  PrintIssue,
  PrintLine,
  PrintTaxLine,
  PrintTender,
  PrintTotals,
} from "@/lib/models/print.model";
import { toInstant } from "@/lib/adapters/shared";

export function adaptPrintAmount(raw: ApiReceiptAmount): PrintAmount {
  // Two field moves. No division, no Intl, no re-formatting.
  return { paisa: raw.paisa, formatted: raw.formatted };
}

export function adaptPrintIssue(raw: ApiPrintIssue): PrintIssue {
  return {
    sequenceNumber: raw.sequenceNumber,
    reprint: raw.reprint,
    issuedAt: toInstant(raw.issuedAt),
    originalIssuedAt: raw.originalIssuedAt === null ? null : toInstant(raw.originalIssuedAt),
  };
}

export function adaptPrintHeader(raw: ApiPrintHeader): PrintHeader {
  return {
    branchName: raw.branchName,
    addressLines: raw.addressLines,
    phone: raw.phone,
    ntn: raw.ntn,
    strn: raw.strn,
    logoFileId: raw.logoFileId,
  };
}

export function adaptPrintLine(raw: ApiPrintLine): PrintLine {
  return {
    name: raw.name,
    quantity: raw.quantity,
    unitPrice: adaptPrintAmount(raw.unitPrice),
    lineTotal: adaptPrintAmount(raw.lineTotal),
    modifiers: raw.modifiers,
    note: raw.note,
    stationCode: raw.stationCode,
  };
}

export function adaptPrintTotals(raw: ApiPrintTotals): PrintTotals {
  return {
    subtotal: adaptPrintAmount(raw.subtotal),
    discount: adaptPrintAmount(raw.discount),
    serviceCharge: adaptPrintAmount(raw.serviceCharge),
    tax: adaptPrintAmount(raw.tax),
    grandTotal: adaptPrintAmount(raw.grandTotal),
  };
}

export function adaptPrintTaxLine(raw: ApiPrintTaxLine): PrintTaxLine {
  return {
    rateCode: raw.rateCode,
    label: raw.label,
    ratePercent: raw.ratePercent,
    amount: adaptPrintAmount(raw.amount),
  };
}

export function adaptPrintTender(raw: ApiPrintTender): PrintTender {
  return {
    method: raw.method,
    amountApplied: adaptPrintAmount(raw.amountApplied),
    amountTendered: adaptPrintAmount(raw.amountTendered),
    change: adaptPrintAmount(raw.change),
    referenceNo: raw.referenceNo,
  };
}

export function adaptPrintFiscal(raw: ApiPrintFiscal): PrintFiscal {
  return {
    fbrInvoiceNumber: raw.fbrInvoiceNumber,
    qrPayload: raw.qrPayload,
    qrSizeMm: raw.qrSizeMm,
    logoAssetId: raw.logoAssetId,
    noticeLine: raw.noticeLine,
  };
}

export function adaptPrintDrawer(raw: ApiPrintDrawer): PrintDrawer {
  return { kick: raw.kick, connectorPin: raw.connectorPin, pulseMs: raw.pulseMs };
}

export function adaptPrintCut(raw: ApiPrintCut): PrintCut {
  return { mode: raw.mode };
}

export function adaptPrintFooter(raw: ApiPrintFooter): PrintFooter {
  return { lines: raw.lines };
}

/**
 * The absent regions become `null`, never `{}`. A kitchen ticket has no totals; a receipt issued
 * before Phase 27 has no fiscal data. Both are normal, and both must be distinguishable from an
 * empty object, or a renderer will draw an empty totals block on a kitchen ticket.
 */
export function adaptPrintDocument(raw: ApiPrintDocument): PrintDocument {
  return {
    schemaVersion: raw.schemaVersion,
    type: raw.type,
    provenance: raw.provenance,
    tenantId: raw.tenantId,
    branchId: raw.branchId,
    orderId: raw.orderId,
    orderNo: raw.orderNo ?? null,
    issue: adaptPrintIssue(raw.issue),
    header: raw.header == null ? null : adaptPrintHeader(raw.header),
    lines: raw.lines.map(adaptPrintLine),
    totals: raw.totals == null ? null : adaptPrintTotals(raw.totals),
    taxBreakdown: raw.taxBreakdown.map(adaptPrintTaxLine),
    tenders: raw.tenders.map(adaptPrintTender),
    fiscal: raw.fiscal == null ? null : adaptPrintFiscal(raw.fiscal),
    drawer: raw.drawer == null ? null : adaptPrintDrawer(raw.drawer),
    cut: adaptPrintCut(raw.cut),
    footer: raw.footer == null ? null : adaptPrintFooter(raw.footer),
  };
}
