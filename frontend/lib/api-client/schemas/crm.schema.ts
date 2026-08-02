import { z } from "zod";

/**
 * crm-service wire schemas (Phase 9).
 *
 * <p>Every CRM endpoint returned 403 for every user until changeset 047 seeded the `crm.*`
 * permission codes its `@PreAuthorize` annotations had always named — so this is the module's
 * first frontend consumer, not a rewrite of one.
 */

export const apiCustomerSummarySchema = z.object({
  id: z.string().uuid(),
  phone: z.string(),
  name: z.string(),
  email: z.string().nullable().optional(),
  birthday: z.string().nullable().optional(),
  // Null until the customer's first accrual creates their loyalty account.
  tier: z.enum(["BRONZE", "SILVER", "GOLD"]).nullable().optional(),
  pointsBalance: z.number().int().nonnegative(),
  lifetimeSpendPaisa: z.number().int().nonnegative(),
});

export type ApiCustomerSummary = z.infer<typeof apiCustomerSummarySchema>;

export const apiCustomerPageSchema = z.object({
  content: z.array(apiCustomerSummarySchema),
  totalElements: z.number().int().nonnegative(),
  number: z.number().int().nonnegative(),
  size: z.number().int().positive(),
});

export const apiCreateCustomerSchema = z.object({
  phone: z.string().min(1).max(30),
  name: z.string().min(1).max(200),
  email: z.string().email().nullable().optional(),
  birthday: z.string().nullable().optional(),
});

export const apiPromotionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  discountType: z.string(),
  discountValue: z.number(),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  active: z.boolean().nullable().optional(),
});

export type ApiPromotion = z.infer<typeof apiPromotionSchema>;
