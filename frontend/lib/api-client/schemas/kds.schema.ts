import { z } from "zod";

// RAW API field names from kitchen-service contract.
// This module is the ONLY place that knows the wire shape — repositories
// .parse() here and adapters convert to domain models.

// Kitchen-owned per-item lifecycle subset (TicketItemStatus, kitchen-service): COOKING is
// a retained legacy value (pre-Phase-7.1 rows/existing bump flow), treated as equivalent
// to PREPARING downstream. CANCELLED and SERVED are terminal states mirrored on the KDS
// side (set by the ORDER_ITEM_CANCELLED / ORDER_ITEM_SERVED consumers) — a fetched active
// ticket can still carry a SERVED/CANCELLED line, so BOTH must be accepted here or the whole
// ticket list fails validation and the board blanks. They map to no board column (dropped).
export const apiKdsTicketItemSchema = z.object({
  id: z.string().uuid(),
  orderItemId: z.string().uuid(),
  name: z.string(),
  qty: z.number().int().positive(),
  modifiers: z.array(z.string()).nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(["PENDING", "ACCEPTED", "PREPARING", "COOKING", "READY", "CANCELLED", "SERVED"]),
  revisionNo: z.number().int().nonnegative(),
  firedAt: z.string().nullable().optional(),
});

export type ApiKdsTicketItem = z.infer<typeof apiKdsTicketItemSchema>;

// orderNotes is a forward-declared field for the order-level "Kitchen Notes" callout
// (UI-SPEC §6, KDS-03 ticket detail). KdsTicketDto does not emit it yet as of 07.1-04 —
// kept optional/nullable so parse() never fails against the current live backend; a
// future plan must add it server-side before the ticket-detail callout has real data
// (see this plan's SUMMARY "Known Gaps").
export const apiKdsTicketSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  orderNo: z.string().nullable().optional(),
  stationCode: z.string(),
  // CLEARED (F17): a cook took this ticket off the board because the business day it was
  // received on had already closed. Terminal for the ACTIVE board — which asks the server for
  // PENDING,COOKING,READY — but a distinct fact from SERVED (nobody handed the food over) and
  // from CANCELLED (the order was not voided). It MUST be listed here: the cleared list reads
  // these tickets back, and an unknown enum value fails the whole page's parse, not one row.
  status: z.enum(["PENDING", "COOKING", "READY", "SERVED", "CANCELLED", "CLEARED"]),
  priority: z.boolean(),
  receivedAt: z.string().datetime({ offset: true }),
  startedAt: z.string().datetime({ offset: true }).nullable().optional(),
  readyAt: z.string().datetime({ offset: true }).nullable().optional(),
  // When a person cleared it (F17). Null on every ticket that left the board any other way.
  clearedAt: z.string().datetime({ offset: true }).nullable().optional(),
  orderNotes: z.string().nullable().optional(),
  // Table number, propagated order->event->KdsTicket->KdsTicketDto (07.3-05, KDS-04).
  // Optional/nullable defensively (same convention as orderNotes above) even though
  // kitchen-service now always emits the field.
  tableNumber: z.string().nullable().optional(),
  // Service type propagated order->event->KdsTicket->KdsTicketDto: OrderType enum name
  // (DINE_IN/TAKEAWAY/DELIVERY/PICKUP). Optional/nullable defensively — legacy tickets
  // created before this field keep null.
  orderType: z.string().nullable().optional(),
  items: z.array(apiKdsTicketItemSchema),
});

export type ApiKdsTicket = z.infer<typeof apiKdsTicketSchema>;

export const apiKdsStationSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
  escalationThresholdSeconds: z.number().int(),
});

export type ApiKdsStation = z.infer<typeof apiKdsStationSchema>;

export const apiKdsTicketPageSchema = z.object({
  content: z.array(apiKdsTicketSchema),
  totalElements: z.number().int(),
  totalPages: z.number().int(),
  number: z.number().int(),
  size: z.number().int(),
});

export type ApiKdsTicketPage = z.infer<typeof apiKdsTicketPageSchema>;

// ── F17: what is on this board from a business day that has already closed ────
//
// `currentBusinessDayStartedAt` and `branchTimezone` are on the wire because the screen
// PRINTS them. A boundary the cook cannot see is a boundary they cannot check, and this
// product has already shipped one trading day cut in UTC while the settings screen promised
// the branch's own zone — the failure was invisible precisely because no screen said which
// boundary it had used.

export const apiStaleTicketSchema = z.object({
  id: z.string().uuid(),
  orderNo: z.string().nullable().optional(),
  stationCode: z.string(),
  tableNumber: z.string().nullable().optional(),
  orderType: z.string().nullable().optional(),
  status: z.enum(["PENDING", "COOKING", "READY", "SERVED", "CANCELLED", "CLEARED"]),
  receivedAt: z.string().datetime({ offset: true }),
  businessDate: z.string(),
  itemCount: z.number().int().nonnegative(),
});

export const apiStaleBoardSummarySchema = z.object({
  branchId: z.string().uuid(),
  stationCode: z.string().nullable().optional(),
  branchTimezone: z.string(),
  businessDayOffsetHours: z.number().int(),
  currentBusinessDate: z.string(),
  currentBusinessDayStartedAt: z.string().datetime({ offset: true }),
  ticketCount: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  finishedTicketCount: z.number().int().nonnegative(),
  oldestReceivedAt: z.string().datetime({ offset: true }).nullable().optional(),
  days: z.array(
    z.object({ businessDate: z.string(), ticketCount: z.number().int().nonnegative() }),
  ),
  tickets: z.array(apiStaleTicketSchema),
});

export type ApiStaleBoardSummary = z.infer<typeof apiStaleBoardSummarySchema>;

export const apiClearStaleResultSchema = z.object({
  branchId: z.string().uuid(),
  stationCode: z.string().nullable().optional(),
  branchTimezone: z.string(),
  currentBusinessDate: z.string(),
  currentBusinessDayStartedAt: z.string().datetime({ offset: true }),
  clearedTicketCount: z.number().int().nonnegative(),
  clearedItemCount: z.number().int().nonnegative(),
  oldestClearedReceivedAt: z.string().datetime({ offset: true }).nullable().optional(),
  clearedAt: z.string().datetime({ offset: true }),
  clearedTicketIds: z.array(z.string().uuid()),
});

export type ApiClearStaleResult = z.infer<typeof apiClearStaleResultSchema>;
