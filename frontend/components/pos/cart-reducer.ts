// Pure, framework-agnostic client-cart module (POS-16/D-01, POS-17/D-02). No React
// imports — the order-taking terminal holds this in local state and persists lazily
// only on the explicit Send to Kitchen / Charge action (pos-terminal.tsx). Unit-tested
// without a DOM (cart-reducer.test.ts).

/**
 * One chosen modifier, carried on the cart line (S6).
 *
 * <p>The NAME and the PRICE travel with the id deliberately. A line that carried only ids could
 * render neither "Extra cheese" under the dish nor the right money, and the till would have to
 * re-look-up the catalogue on every render to price its own cart. `priceDeltaPaisa` here is a copy
 * of the catalogue's figure for DISPLAY and for the pre-send estimate only — the server resolves
 * both again from the catalogue when the line is persisted, and the server's answer is the one the
 * guest is charged. See `ModifierSelectionResolver`.
 */
export interface CartModifier {
  id: string;
  name: string;
  /** Signed BIGINT paisa: +15000 "extra cheese", -5000 "no cheese". Never a float. */
  priceDeltaPaisa: number;
}

export interface CartLine {
  menuItemId: string;
  name: string;
  unitPricePaisa: number;
  /**
   * The rate this line will be CHARGED at, as a percent (17 = 17%).
   *
   * <p>Callers must pass {@code MenuItem.effectiveTaxRatePct} — the rate the server resolved
   * from the item's class, its category's class, or its own legacy column — and never
   * {@code MenuItem.taxRatePct}, which is only the last of those three and is 0.00 on most rows.
   * Passing the wrong one is what showed Rs 25.60 of tax on a Rs 1,657.00 check.
   */
  taxRatePct: number;
  quantity: number;
  /** The chosen modifiers, in catalogue order — the same order the ticket and the bill print. */
  modifiers: CartModifier[];
  notes: string | null;
}

export interface AddLineInput {
  menuItemId: string;
  name: string;
  unitPricePaisa: number;
  taxRatePct?: number;
  modifiers?: CartModifier[];
  notes?: string | null;
  quantity?: number;
}

/** The ids, in line order — what `POST /orders/{id}/items` takes as `modifierIds`. */
export function modifierIdsOf(line: Pick<CartLine, "modifiers">): string[] {
  return line.modifiers.map((m) => m.id);
}

/**
 * What ONE of this line costs: the dish plus every modifier delta.
 *
 * <p>The single definition the cart, the line row and the pre-send tax estimate all use, and the
 * same arithmetic {@code OrderPricingCalculator.lineSubtotal} does on the server. Two copies of
 * this sum is how a screen and a bill come to disagree.
 */
export function lineUnitPricePaisa(line: Pick<CartLine, "unitPricePaisa" | "modifiers">): number {
  return line.modifiers.reduce((sum, m) => sum + m.priceDeltaPaisa, line.unitPricePaisa);
}

/** What this whole line costs before tax: the unit price with modifiers, times quantity. */
export function lineSubtotalPaisa(
  line: Pick<CartLine, "unitPricePaisa" | "modifiers" | "quantity">,
): number {
  return lineUnitPricePaisa(line) * line.quantity;
}

/**
 * Merge key (07.3-CONTEXT Specific Ideas): menuItemId + sorted modifierIds + notes.
 * Sorting modifierIds makes the key order-insensitive — mods=[a,b] merges with
 * mods=[b,a]. Differing modifiers/notes (including "" vs null-equivalent empty
 * string) produce a distinct key and therefore a separate cart line.
 */
export function cartLineKey(
  menuItemId: string,
  modifierIds: string[],
  notes: string | null,
): string {
  const sortedMods = [...modifierIds].sort().join(",");
  return `${menuItemId}::${sortedMods}::${notes ?? ""}`;
}

function keyOf(line: CartLine): string {
  return cartLineKey(line.menuItemId, modifierIdsOf(line), line.notes);
}

/**
 * Adds one tap's worth of a menu item to the cart. Repeated taps with an identical
 * key merge into the existing line (qty += quantity, default 1); a differing key
 * (modifiers/notes) always creates a new line — never mutates an unrelated line.
 */
export function addLine(cart: CartLine[], input: AddLineInput): CartLine[] {
  const modifiers = input.modifiers ?? [];
  const notes = input.notes ?? null;
  const quantity = input.quantity ?? 1;
  const key = cartLineKey(input.menuItemId, modifiers.map((m) => m.id), notes);
  const idx = cart.findIndex((line) => keyOf(line) === key);

  if (idx === -1) {
    return [
      ...cart,
      {
        menuItemId: input.menuItemId,
        name: input.name,
        unitPricePaisa: input.unitPricePaisa,
        taxRatePct: input.taxRatePct ?? 0,
        quantity,
        modifiers,
        notes,
      },
    ];
  }

  return cart.map((line, i) =>
    i === idx ? { ...line, quantity: line.quantity + quantity } : line,
  );
}

/** Increments the line matching `key` by 1 (the order panel's "+" stepper). */
export function incrementLine(cart: CartLine[], key: string): CartLine[] {
  return cart.map((line) =>
    keyOf(line) === key ? { ...line, quantity: line.quantity + 1 } : line,
  );
}

/**
 * Decrements the line matching `key` by 1 (the order panel's "-" stepper). Quantity 0
 * removes the line entirely — never leaves a zero-qty row rendered.
 */
export function decrementLine(cart: CartLine[], key: string): CartLine[] {
  return cart
    .map((line) => (keyOf(line) === key ? { ...line, quantity: line.quantity - 1 } : line))
    .filter((line) => line.quantity > 0);
}

/** Removes the line matching `key` entirely, regardless of quantity (cart line's × button). */
export function removeLine(cart: CartLine[], key: string): CartLine[] {
  return cart.filter((line) => keyOf(line) !== key);
}

/** Empties the cart (Clear / New Order, D-04). */
export function clearCart(): CartLine[] {
  return [];
}

/**
 * Cart subtotal = sum(quantity × (unit price + modifier deltas)).
 *
 * <p>S6: the deltas used to be missing from this sum, because a cart line could not carry a
 * modifier at all. A till that prices two cheesy Karahis at the plain Karahi price shows the guest
 * one number and charges another the moment the server re-prices the line.
 */
export function cartTotalPaisa(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + lineSubtotalPaisa(line), 0);
}

/**
 * Tax for the pre-send cart. The SAME number the server will compute, to the paisa.
 *
 * <h2>Why this is no longer an estimate (F16)</h2>
 *
 * <p>It used to be labelled "Tax (est.)" for two separate reasons, and only one of them was
 * about arithmetic. The bigger one was that the rate itself was the item's own
 * {@code taxRatePct} column, which most menu items do not carry — the cart was estimating
 * because it was guessing. It now prices from {@code effectiveTaxRatePct}, the rate the server
 * resolved and the rate the server will charge. There are no discounts pre-send, so
 * {@code lineNet == line subtotal}, and nothing else moves between here and the order row.
 *
 * <h2>The arithmetic half, which had a real one-paisa hole</h2>
 *
 * <p>The server computes {@code BigDecimal(lineNet) * (rate/100)} and rounds HALF_UP.
 * {@code Math.round(lineNet * rate / 100)} in doubles agrees almost always — but a two-decimal
 * rate such as 17.10 is not exactly representable in binary, so a product whose true value lands
 * exactly on a .5 boundary can arrive as 16150.499999999998 and round DOWN where the server
 * rounds UP. One paisa, on a screen that is about to be compared with a printed bill.
 *
 * <p>So the rate is taken to integer basis points first ({@code 17.00 -> 1700}) and the whole
 * calculation is done on integers: {@code floor((lineNet * basis + 5000) / 10000)} is HALF_UP by
 * construction. The largest intermediate is bounded by {@code 10^9 paisa * 10^4}, which is
 * {@code 10^13} — comfortably inside the 2^53 exact-integer range of a double.
 */
export function cartTaxPaisa(lines: CartLine[]): number {
  return lines.reduce((sum, line) => {
    // S6: the modifier deltas are part of the base the server taxes, so they are part of the base
    // taxed here too. Leaving them out under-declared the tax on every configured line.
    const lineNet = lineSubtotalPaisa(line);
    // NUMERIC(5,2) server-side, so two decimals is the whole domain; this rounding only ever
    // removes representation noise, never a digit the tenant typed.
    const basisPoints = Math.round(line.taxRatePct * 100);
    if (basisPoints <= 0 || lineNet <= 0) return sum;
    return sum + Math.floor((lineNet * basisPoints + 5000) / 10000);
  }, 0);
}
