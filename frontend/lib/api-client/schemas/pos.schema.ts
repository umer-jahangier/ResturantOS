import { z } from "zod";

// RAW API field names from pos-service contract (Phase 7).
// This module is the ONLY place that knows the wire shape — repositories
// `.parse()` here and adapters convert to domain models.

export const apiMenuItemSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid().nullable().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  basePricePaisa: z.number().int().nonnegative(),
  taxRatePct: z.string().or(z.number()).transform(Number),
  kdsStation: z.string().nullable().optional(),
  active: z.boolean(),
});

export type ApiMenuItem = z.infer<typeof apiMenuItemSchema>;

export const apiMenuCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int(),
  active: z.boolean(),
});

export type ApiMenuCategory = z.infer<typeof apiMenuCategorySchema>;

export const apiDiningTableSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  tableName: z.string(),
  capacity: z.number().int(),
  status: z.enum(["AVAILABLE", "OCCUPIED"]),
  floorPlanX: z.number().nullable().optional(),
  floorPlanY: z.number().nullable().optional(),
  floorPlanShape: z.string().nullable().optional(),
});

export type ApiDiningTable = z.infer<typeof apiDiningTableSchema>;

export const apiOrderItemModifierSchema = z.object({
  id: z.string().uuid(),
  modifierId: z.string().uuid().nullable().optional(),
  modifierNameSnapshot: z.string(),
  priceDeltaPaisa: z.number().int(),
});

export const apiOrderItemSchema = z.object({
  id: z.string().uuid(),
  menuItemId: z.string().uuid(),
  itemNameSnapshot: z.string(),
  unitPriceSnapshot: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
  kdsStation: z.string().nullable().optional(),
  kdsStatus: z.enum(["PENDING", "COOKING", "READY"]),
  discountPaisa: z.number().int().nonnegative(),
  taxPaisa: z.number().int().nonnegative(),
  lineTotalPaisa: z.number().int().nonnegative(),
  notes: z.string().nullable().optional(),
  modifiers: z.array(apiOrderItemModifierSchema).default([]),
});

export type ApiOrderItem = z.infer<typeof apiOrderItemSchema>;

export const apiOrderSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  orderNo: z.string().nullable().optional(),
  type: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY"]),
  status: z.enum(["DRAFT", "OPEN", "SENT_TO_KDS", "PARTIAL_READY", "READY", "SERVED", "CLOSED", "VOIDED", "REFUNDED"]),
  tableId: z.string().uuid().nullable().optional(),
  coverCount: z.number().int(),
  cashierId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  subtotalPaisa: z.number().int().nonnegative(),
  taxPaisa: z.number().int().nonnegative(),
  discountPaisa: z.number().int().nonnegative(),
  serviceChargePaisa: z.number().int().nonnegative(),
  totalPaisa: z.number().int().nonnegative(),
  notes: z.string().nullable().optional(),
  openedAt: z.string().nullable().optional(),
  sentToKdsAt: z.string().nullable().optional(),
  clientOrderId: z.string().uuid(),
  version: z.number().int(),
  items: z.array(apiOrderItemSchema).default([]),
});

export type ApiOrder = z.infer<typeof apiOrderSchema>;

export const apiTillSessionSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  cashierId: z.string().uuid(),
  openingFloatPaisa: z.number().int().nonnegative(),
  expectedClosingPaisa: z.number().int().nullable().optional(),
  declaredClosingPaisa: z.number().int().nullable().optional(),
  variancePaisa: z.number().int().nullable().optional(),
  openedAt: z.string().nullable().optional(),
  closedAt: z.string().nullable().optional(),
  status: z.enum(["OPEN", "CLOSED"]),
});

export type ApiTillSession = z.infer<typeof apiTillSessionSchema>;

export const apiOrderPaymentSchema = z.object({
  method: z.enum(["CASH", "CARD", "LOYALTY_POINTS", "BANK_TRANSFER", "VOUCHER"]),
  amountPaisa: z.number().int().nonnegative(),
  referenceNo: z.string().nullable().optional(),
});

export type ApiOrderPayment = z.infer<typeof apiOrderPaymentSchema>;

export const apiCloseOrderSchema = z.object({
  payments: z.array(apiOrderPaymentSchema),
});
