import { describe, expect, it } from "vitest";
import {
  addLine,
  cartTaxPaisa,
  cartTotalPaisa,
  cartServiceChargePaisa,
  serviceChargeAppliesTo,
  decrementLine,
  incrementLine,
  cartLineKey,
  type CartLine,
} from "@/components/pos/cart-reducer";

const burger = { menuItemId: "m1", name: "Burger", unitPricePaisa: 50000, taxRatePct: 16 };
const water = { menuItemId: "m2", name: "Water", unitPricePaisa: 10000, taxRatePct: 0 };

describe("cart-reducer", () => {
  it("merges identical taps into one line and preserves taxRatePct", () => {
    let cart: CartLine[] = [];
    cart = addLine(cart, burger);
    cart = addLine(cart, burger);
    expect(cart).toHaveLength(1);
    expect(cart[0]!.quantity).toBe(2);
    expect(cart[0]!.taxRatePct).toBe(16);
  });

  it("keeps taxRatePct across increment/decrement", () => {
    let cart = addLine([], burger);
    const key = cartLineKey("m1", [], null);
    cart = incrementLine(cart, key);
    expect(cart[0]!.quantity).toBe(2);
    expect(cart[0]!.taxRatePct).toBe(16);
    cart = decrementLine(cart, key);
    expect(cart[0]!.quantity).toBe(1);
  });

  describe("cartTaxPaisa (server per-line parity)", () => {
    it("returns 0 for an empty cart", () => {
      expect(cartTaxPaisa([])).toBe(0);
    });

    it("computes per-line tax = round(lineNet * rate/100), summed", () => {
      const cart = addLine(addLine([], burger), water); // 2 lines
      // Burger: 50000 * 16/100 = 8000; Water: 0% = 0
      expect(cartTaxPaisa(cart)).toBe(8000);
      expect(cartTotalPaisa(cart)).toBe(60000);
    });

    it("multiplies by quantity before taxing (per-line net)", () => {
      let cart = addLine([], burger);
      cart = incrementLine(cart, cartLineKey("m1", [], null)); // qty 2
      // net = 100000, tax = 16000
      expect(cartTaxPaisa(cart)).toBe(16000);
    });

    it("rounds HALF_UP to the nearest paisa like the server", () => {
      // net 999, rate 17.5% -> 174.825 -> 175
      const odd = { menuItemId: "m3", name: "Odd", unitPricePaisa: 999, taxRatePct: 17.5 };
      expect(cartTaxPaisa(addLine([], odd))).toBe(175);
    });
  });
});

/**
 * D-3 — the service charge the pre-send cart never knew about.
 *
 * Measured on table AUD3547: the cart read Subtotal Rs 2,259.00, Tax Rs 257.60,
 * Total Rs 2,516.60. The check created one tap later was Rs 2,629.55, carrying
 * `serviceChargePaisa 11295` at 5%. Every dine-in guest was quoted 5% low.
 *
 * These pin the arithmetic against `OrderPricingCalculator.serviceCharge`, which is the only
 * thing that makes a second implementation of the rule tolerable. See the function's own comment
 * for why it is computed client-side at all (there is no server-side order to ask, pre-send).
 */
describe("cartServiceChargePaisa (server parity)", () => {
  it("reproduces the live check exactly: 5% of Rs 2,259.00 is Rs 112.95", () => {
    const subtotal = 225900;
    expect(cartServiceChargePaisa(subtotal, 5)).toBe(11295);
    // And the whole quote reconciles to the check that was actually created.
    expect(subtotal + 25760 + cartServiceChargePaisa(subtotal, 5)).toBe(262955);
  });

  it("is HALF_UP, not floor, on a half-paisa boundary", () => {
    // 10.005 rupees of charge: 1 paisa * 100.5 basis... concretely, 201 paisa at 2.50% is
    // 5.025 paisa. HALF_UP gives 5; floor would too, so use a true .5 case:
    // 10 paisa at 5.00% = 0.5 paisa exactly. HALF_UP -> 1, truncation -> 0.
    expect(cartServiceChargePaisa(10, 5)).toBe(1);
    // 30 paisa at 5.00% = 1.5 paisa exactly. HALF_UP -> 2.
    expect(cartServiceChargePaisa(30, 5)).toBe(2);
  });

  it("survives a two-decimal rate that binary floating point cannot represent", () => {
    // 17.10% of Rs 944.44. Computed on integers via basis points, so no double noise can move
    // the boundary — the trick cartTaxPaisa documents at length.
    expect(cartServiceChargePaisa(94444, 17.1)).toBe(Math.floor((94444 * 1710 + 5000) / 10000));
    expect(cartServiceChargePaisa(94444, 17.1)).toBe(16150);
  });

  it("charges nothing on a zero rate, a negative rate or an empty cart", () => {
    expect(cartServiceChargePaisa(225900, 0)).toBe(0);
    expect(cartServiceChargePaisa(225900, -5)).toBe(0);
    expect(cartServiceChargePaisa(0, 5)).toBe(0);
  });
});

describe("serviceChargeAppliesTo (mirrors BranchServiceCharge.appliesTo)", () => {
  const policy = { enabled: true, dineIn: true, takeaway: false, pickup: true };

  it("follows the branch's per-channel flags", () => {
    expect(serviceChargeAppliesTo(policy, "DINE_IN")).toBe(true);
    expect(serviceChargeAppliesTo(policy, "TAKEAWAY")).toBe(false);
    expect(serviceChargeAppliesTo(policy, "PICKUP")).toBe(true);
  });

  it("never charges a delivery, whatever the branch set", () => {
    // The policy carries no delivery flag and the server's switch returns false for it.
    expect(serviceChargeAppliesTo({ ...policy, dineIn: true }, "DELIVERY")).toBe(false);
  });

  it("charges nothing when the policy is disabled or absent", () => {
    expect(serviceChargeAppliesTo({ ...policy, enabled: false }, "DINE_IN")).toBe(false);
    expect(serviceChargeAppliesTo(null, "DINE_IN")).toBe(false);
  });
});
