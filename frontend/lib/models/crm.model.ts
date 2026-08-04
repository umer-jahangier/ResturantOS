/** Domain models for crm-service (Phase 9). */

export type LoyaltyTier = "BRONZE" | "SILVER" | "GOLD";

export interface Customer {
  id: string;
  phone: string;
  name: string;
  email: string | null;
  birthday: string | null;
  /** Null until the customer's first accrual creates their loyalty account. */
  tier: LoyaltyTier | null;
  pointsBalance: number;
  lifetimeSpendPaisa: number;
}

export interface CreateCustomerPayload {
  phone: string;
  name: string;
  email?: string | null;
  birthday?: string | null;
}

export interface Promotion {
  id: string;
  name: string;
  discountType: string;
  discountValue: number;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
}
