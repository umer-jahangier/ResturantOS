// Pure, framework-agnostic client-cart module (POS-16/D-01, POS-17/D-02). No React
// imports — the order-taking terminal holds this in local state and persists lazily
// only on the explicit Send to Kitchen / Charge action (pos-terminal.tsx). Unit-tested
// without a DOM (cart-reducer.test.ts).

export interface CartLine {
  menuItemId: string;
  name: string;
  unitPricePaisa: number;
  /** Menu item's tax rate percent (e.g. 16 = 16%) — drives the pre-send tax estimate. */
  taxRatePct: number;
  quantity: number;
  modifierIds: string[];
  notes: string | null;
}

export interface AddLineInput {
  menuItemId: string;
  name: string;
  unitPricePaisa: number;
  taxRatePct?: number;
  modifierIds?: string[];
  notes?: string | null;
  quantity?: number;
}

/**
 * Merge key (07.3-CONTEXT Specific Ideas): menuItemId + sorted modifierIds + notes.
 * Sorting modifierIds makes the key order-insensitive — mods=[a,b] merges with
 * mods=[b,a]. Differing modifiers/notes (including "" vs null-equivalent empty
 * string) produce a distinct key and therefore a separate cart line.
 */
export function cartLineKey(menuItemId: string, modifierIds: string[], notes: string | null): string {
  const sortedMods = [...modifierIds].sort().join(",");
  return `${menuItemId}::${sortedMods}::${notes ?? ""}`;
}

function keyOf(line: CartLine): string {
  return cartLineKey(line.menuItemId, line.modifierIds, line.notes);
}

/**
 * Adds one tap's worth of a menu item to the cart. Repeated taps with an identical
 * key merge into the existing line (qty += quantity, default 1); a differing key
 * (modifiers/notes) always creates a new line — never mutates an unrelated line.
 */
export function addLine(cart: CartLine[], input: AddLineInput): CartLine[] {
  const modifierIds = input.modifierIds ?? [];
  const notes = input.notes ?? null;
  const quantity = input.quantity ?? 1;
  const key = cartLineKey(input.menuItemId, modifierIds, notes);
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
        modifierIds,
        notes,
      },
    ];
  }

  return cart.map((line, i) => (i === idx ? { ...line, quantity: line.quantity + quantity } : line));
}

/** Increments the line matching `key` by 1 (the order panel's "+" stepper). */
export function incrementLine(cart: CartLine[], key: string): CartLine[] {
  return cart.map((line) => (keyOf(line) === key ? { ...line, quantity: line.quantity + 1 } : line));
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

/** Cart subtotal = sum(line quantity * unit price). */
export function cartTotalPaisa(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.unitPricePaisa * line.quantity, 0);
}

/**
 * Estimated tax for the pre-send cart — mirrors the server's per-line calculation
 * (OrderPricingCalculator.perLineTax): round(lineNet * taxRatePct/100) HALF_UP to paisa,
 * summed across lines. Labelled "estimated" in the UI: there are no discounts pre-send,
 * so lineNet == line subtotal; the server recomputes authoritatively once persisted.
 */
export function cartTaxPaisa(lines: CartLine[]): number {
  return lines.reduce((sum, line) => {
    const lineNet = line.unitPricePaisa * line.quantity;
    return sum + Math.round((lineNet * line.taxRatePct) / 100);
  }, 0);
}
