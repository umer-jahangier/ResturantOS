import { describe, expect, it } from "vitest";
import {
  addLine,
  cartTaxPaisa,
  cartTotalPaisa,
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
