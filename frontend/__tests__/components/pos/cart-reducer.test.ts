import { describe, it, expect } from "vitest";
import {
  addLine,
  incrementLine,
  decrementLine,
  clearCart,
  cartLineKey,
  cartTotalPaisa,
  type CartLine,
} from "@/components/pos/cart-reducer";

const BURGER_ID = "a1000001-0000-4000-8000-000000000001";
const CHEESE_ID = "m1000001-0000-4000-8000-000000000001";
const BACON_ID = "m1000001-0000-4000-8000-000000000002";

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
      modifierIds: [CHEESE_ID],
    });
    cart = addLine(cart, {
      menuItemId: BURGER_ID,
      name: "Burger",
      unitPricePaisa: 45000,
      modifierIds: [],
    });

    expect(cart).toHaveLength(2);
    expect(cart[0]?.quantity).toBe(1);
    expect(cart[1]?.quantity).toBe(1);
  });

  it("differing notes create a separate line", () => {
    let cart: CartLine[] = [];
    cart = addLine(cart, { menuItemId: BURGER_ID, name: "Burger", unitPricePaisa: 45000, notes: "rare" });
    cart = addLine(cart, { menuItemId: BURGER_ID, name: "Burger", unitPricePaisa: 45000, notes: "" });

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
      modifierIds: [CHEESE_ID, BACON_ID],
    });
    cart = addLine(cart, {
      menuItemId: BURGER_ID,
      name: "Burger",
      unitPricePaisa: 45000,
      modifierIds: [BACON_ID, CHEESE_ID],
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
});
