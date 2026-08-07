// Purchasing status vocabularies — the neutral home for two lists that every layer needs.
//
// These are domain vocabulary, not wire format: the same eight PO states appear in a route
// file's filter dropdown, in a repository's query string, and in a zod schema. They used to
// live in `lib/api-client/schemas/purchasing.schema.ts`, which meant a page that wanted to
// render a status filter had to reach into Layer 1 to get them — and two purchasing pages
// did exactly that, invisibly, because the FE-08 boundary rule only covered `components/**`.
//
// Same escape-hatch pattern as `@/lib/errors` (see `docs/finance-eslint-backlog.md`, Issue 1):
// the transport-agnostic value moves to a barrel any layer may import, and the Layer-1 module
// re-exports it so every existing Layer-1/2/3 import keeps resolving unchanged.
//
// This file imports nothing. That is deliberate — it is the leaf every layer can depend on.

/**
 * PoStatus (backend enum, `PoStatus.java`) — canonical order matches the domain lifecycle.
 * DRAFT -> PENDING_APPROVAL -> APPROVED -> SENT -> PARTIALLY_RECEIVED -> FULLY_RECEIVED -> CLOSED,
 * with REJECTED as an alternate terminal-ish state off PENDING_APPROVAL.
 */
export const PO_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "SENT",
  "PARTIALLY_RECEIVED",
  "FULLY_RECEIVED",
  "CLOSED",
] as const;

export type PoStatus = (typeof PO_STATUSES)[number];

/**
 * InvoiceStatus (backend enum, `InvoiceStatus.java`) — PENDING_MATCH is the theoretical
 * pre-match state; in practice `VendorInvoiceService.create` always runs the 3-way match
 * synchronously, so an invoice is created straight into MATCHED or MISMATCHED.
 */
export const INVOICE_STATUSES = [
  "PENDING_MATCH",
  "MATCHED",
  "MISMATCHED",
  "APPROVED_FOR_PAYMENT",
  "PAID",
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
