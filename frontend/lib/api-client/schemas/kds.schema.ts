import { z } from "zod";

// RAW API field names from kitchen-service contract.
// This module is the ONLY place that knows the wire shape — repositories
// .parse() here and adapters convert to domain models.

// Kitchen-owned per-item lifecycle subset (TicketItemStatus, kitchen-service): COOKING is
// a retained legacy value (pre-Phase-7.1 rows/existing bump flow), treated as equivalent
// to PREPARING downstream. SENT/SERVED/CANCELLED are pos-service-owned (OrderItemStatus)
// and are not represented here — see kitchen-service TicketItemStatus javadoc.
export const apiKdsTicketItemSchema = z.object({
  id: z.string().uuid(),
  orderItemId: z.string().uuid(),
  name: z.string(),
  qty: z.number().int().positive(),
  modifiers: z.array(z.string()).nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(["PENDING", "ACCEPTED", "PREPARING", "COOKING", "READY", "CANCELLED"]),
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
  status: z.enum(["PENDING", "COOKING", "READY", "SERVED", "CANCELLED"]),
  priority: z.boolean(),
  receivedAt: z.string().datetime({ offset: true }),
  startedAt: z.string().datetime({ offset: true }).nullable().optional(),
  readyAt: z.string().datetime({ offset: true }).nullable().optional(),
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
