import type { ApiCustomerSummary, ApiPromotion } from "@/lib/api-client/schemas/crm.schema";
import type { Customer, LoyaltyTier, Promotion } from "@/lib/models/crm.model";

export function adaptCustomer(raw: ApiCustomerSummary): Customer {
  return {
    id: raw.id,
    phone: raw.phone,
    name: raw.name,
    email: raw.email ?? null,
    birthday: raw.birthday ?? null,
    tier: (raw.tier ?? null) as LoyaltyTier | null,
    pointsBalance: raw.pointsBalance,
    lifetimeSpendPaisa: raw.lifetimeSpendPaisa,
  };
}

export function adaptPromotion(raw: ApiPromotion): Promotion {
  return {
    id: raw.id,
    name: raw.name,
    discountType: raw.discountType,
    discountValue: raw.discountValue,
    startsAt: raw.startsAt ?? null,
    endsAt: raw.endsAt ?? null,
    active: raw.active ?? true,
  };
}
