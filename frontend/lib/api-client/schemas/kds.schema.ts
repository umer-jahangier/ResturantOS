import { z } from "zod";

// RAW API field names from kitchen-service contract.
// This module is the ONLY place that knows the wire shape — repositories
// .parse() here and adapters convert to domain models.

export const apiKdsTicketItemSchema = z.object({
  id: z.string().uuid(),
  orderItemId: z.string().uuid(),
  name: z.string(),
  qty: z.number().int().positive(),
  modifiers: z.array(z.string()).nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(["PENDING", "COOKING", "READY"]),
});

export type ApiKdsTicketItem = z.infer<typeof apiKdsTicketItemSchema>;

export const apiKdsTicketSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  orderNo: z.string().nullable().optional(),
  stationCode: z.string(),
  status: z.enum(["PENDING", "COOKING", "READY", "CANCELLED"]),
  priority: z.boolean(),
  receivedAt: z.string().datetime({ offset: true }),
  startedAt: z.string().datetime({ offset: true }).nullable().optional(),
  readyAt: z.string().datetime({ offset: true }).nullable().optional(),
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
