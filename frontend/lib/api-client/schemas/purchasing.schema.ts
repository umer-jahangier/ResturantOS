import { z } from "zod";

export const apiVendorSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  contactPerson: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  paymentTerms: z.string(),
  bankAccountLast4: z.string().nullable().optional(),
  active: z.boolean(),
});

export const apiPoLineSchema = z.object({
  id: z.string().uuid(),
  ingredientId: z.string().uuid(),
  qty: z.string(),
  uom: z.string(),
  unitPricePaisa: z.number().int(),
  lineTotalPaisa: z.number().int(),
});

export const apiPurchaseOrderSchema = z.object({
  id: z.string().uuid(),
  vendorId: z.string().uuid(),
  branchId: z.string().uuid(),
  status: z.string(),
  expectedDeliveryDate: z.string().nullable().optional(),
  totalPaisa: z.number().int(),
  lines: z.array(apiPoLineSchema),
});

export const apiInvoiceLineSchema = z.object({
  id: z.string(),
  poLineId: z.string().uuid(),
  qty: z.string(),
  unitPricePaisa: z.number().int(),
  lineTotalPaisa: z.number().int(),
  matchStatus: z.string(),
  grnQty: z.string().optional(),
  poQty: z.string().optional(),
  poUnitPricePaisa: z.number().int().optional(),
});

export const apiVendorInvoiceSchema = z.object({
  id: z.string(),
  vendorId: z.string().uuid(),
  purchaseOrderId: z.string().uuid(),
  branchId: z.string().uuid(),
  invoiceNo: z.string(),
  invoiceDate: z.string(),
  status: z.string(),
  totalPaisa: z.number().int(),
  inputTaxPaisa: z.number().int(),
  matchOverrideReason: z.string().nullable().optional(),
  lines: z.array(apiInvoiceLineSchema),
});
