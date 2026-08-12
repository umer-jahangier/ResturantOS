import { describe, it, expect } from "vitest";
import {
  addLine,
  incrementLine,
  decrementLine,
  clearCart,
  cartLineKey,
  cartTotalPaisa,
  cartTaxPaisa,
  lineSubtotalPaisa,
  modifierIdsOf,
  type CartLine,
} from "@/components/pos/cart-reducer";

const BURGER_ID = "a1000001-0000-4000-8000-000000000001";
const CHEESE_ID = "m1000001-0000-4000-8000-000000000001";
const BACON_ID = "m1000001-0000-4000-8000-000000000002";

// S6: a cart line carries the chosen modifier's NAME and PRICE, not just its id — the panel
// renders "Extra cheese +Rs 150" under the dish and the subtotal includes the delta.
const CHEESE = { id: CHEESE_ID, name: "Extra cheese", priceDeltaPaisa: 15000 };
const BACON = { id: BACON_ID, name: "Bacon", priceDeltaPaisa: 20000 };

describe("cart-reducer", () => {
  it("merges repeated taps of the same item (no modifiers, no notes) into one line, qty 2", () => {
    let cart: CartLine[] = [];
    cart = addLine(cart, { menuItemId: BURGER_ID, name: "Burger", unitPricePaisa: 45000 });
    cart = addLine(cart, { menuItemId: BURGER_ID, name: "Burger", unitPricePaisa: 45000 });

    expect(cart).toHaveLength(1);
    expect(cart[0]?.quantity).toBe(2);
  });

  it("differing modifiers create a separate line", () => {
    let cart: CartLine[] = [];
    cart = addLine(cart, {
      menuItemId: BURGER_ID,
      name: "Burger",
      unitPricePaisa: 45000,
      modifiers: [CHEESE],
    });
    cart = addLine(cart, {
      menuItemId: BURGER_ID,
      name: "Burger",
      unitPricePaisa: 45000,
      modifiers: [],
    });

    expect(cart).toHaveLength(2);
    expect(cart[0]?.quantity).toBe(1);
    expect(cart[1]?.quantity).toBe(1);
  });

  it("differing notes create a separate line", () => {
    let cart: CartLine[] = [];
    cart = addLine(cart, {
      menuItemId: BURGER_ID,
      name: "Burger",
      unitPricePaisa: 45000,
      notes: "rare",
    });
    cart = addLine(cart, {
      menuItemId: BURGER_ID,
      name: "Burger",
      unitPricePaisa: 45000,
      notes: "",
    });

    expect(cart).toHaveLength(2);
  });

  it("merge key is order-insensitive on modifierIds", () => {
    expect(cartLineKey(BURGER_ID, [CHEESE_ID, BACON_ID], null)).toBe(
      cartLineKey(BURGER_ID, [BACON_ID, CHEESE_ID], null),
    );

    let cart: CartLine[] = [];
    cart = addLine(cart, {
      menuItemId: BURGER_ID,
      name: "Burger",
      unitPricePaisa: 45000,
      modifiers: [CHEESE, BACON],
    });
    cart = addLine(cart, {
      menuItemId: BURGER_ID,
      name: "Burger",
      unitPricePaisa: 45000,
      modifiers: [BACON, CHEESE],
    });

    expect(cart).toHaveLength(1);
    expect(cart[0]?.quantity).toBe(2);
  });

  it("incrementLine/decrementLine adjust qty; decrement to 0 removes the line", () => {
    let cart: CartLine[] = [];
    cart = addLine(cart, { menuItemId: BURGER_ID, name: "Burger", unitPricePaisa: 45000 });
    const key = cartLineKey(BURGER_ID, [], null);

    cart = incrementLine(cart, key);
    expect(cart[0]?.quantity).toBe(2);

    cart = decrementLine(cart, key);
    expect(cart[0]?.quantity).toBe(1);

    cart = decrementLine(cart, key);
    expect(cart).toHaveLength(0);
  });

  it("clearCart empties the cart", () => {
    let cart: CartLine[] = [];
    cart = addLine(cart, { menuItemId: BURGER_ID, name: "Burger", unitPricePaisa: 45000 });
    expect(cart).toHaveLength(1);

    cart = clearCart();
    expect(cart).toHaveLength(0);
  });

  it("cartTotalPaisa sums quantity * unit price across lines", () => {
    let cart: CartLine[] = [];
    cart = addLine(cart, { menuItemId: BURGER_ID, name: "Burger", unitPricePaisa: 45000 });
    cart = addLine(cart, { menuItemId: BURGER_ID, name: "Burger", unitPricePaisa: 45000 });
    cart = addLine(cart, {
      menuItemId: "a1000001-0000-4000-8000-000000000002",
      name: "Fries",
      unitPricePaisa: 20000,
    });

    expect(cartTotalPaisa(cart)).toBe(45000 * 2 + 20000);
  });

  /**
   * S6, and the reason the cart line had to grow a price at all.
   *
   * <p>Before this, a line could only carry modifier IDS, so the subtotal was the bare dish price
   * however many paid add-ons were on it: two cheesy burgers rang at Rs 900.00 on the screen and
   * Rs 1,200.00 on the bill the moment the server re-priced them. It fails against a
   * `cartTotalPaisa` that reads `unitPricePaisa * quantity`.
   */
  it("cart subtotal and tax include the modifier deltas, to the paisa", () => {
    let cart: CartLine[] = [];
    cart = addLine(cart, {
      menuItemId: BURGER_ID,
      name: "Burger",
      unitPricePaisa: 45000,
      taxRatePct: 17,
      modifiers: [CHEESE],
      quantity: 2,
    });

    // (Rs 450.00 + Rs 150.00) × 2 = Rs 1,200.00, NOT Rs 900.00.
    expect(cartTotalPaisa(cart)).toBe((45000 + 15000) * 2);
    // 17% of the SAME base, HALF_UP on integers — the figure the server will compute.
    expect(cartTaxPaisa(cart)).toBe(Math.floor((120000 * 1700 + 5000) / 10000));
  });

  /** One definition of "what one of these costs", shared with the line row and the server. */
  it("lineSubtotalPaisa is quantity × (unit price + deltas)", () => {
    const line: CartLine = {
      menuItemId: BURGER_ID,
      name: "Burger",
      unitPricePaisa: 45000,
      taxRatePct: 0,
      quantity: 3,
      modifiers: [CHEESE, { id: BACON_ID, name: "No bacon", priceDeltaPaisa: -5000 }],
      notes: null,
    };
    expect(lineSubtotalPaisa(line)).toBe((45000 + 15000 - 5000) * 3);
    expect(modifierIdsOf(line)).toEqual([CHEESE_ID, BACON_ID]);
  });
});
