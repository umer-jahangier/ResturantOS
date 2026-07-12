// Pure, framework-agnostic client-cart module (POS-16/D-01, POS-17/D-02). No React
// imports — the order-taking terminal holds this in local state and persists lazily
// only on the explicit Send to Kitchen / Charge action (pos-terminal.tsx). Unit-tested
// without a DOM (cart-reducer.test.ts).

export interface CartLine {
  menuItemId: string;
  name: string;
  unitPricePaisa: number;
  quantity: number;
  modifierIds: string[];
  notes: string | null;
}

export interface AddLineInput {
  menuItemId: string;
  name: string;
  unitPricePaisa: number;
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

/** Empties the cart (Clear / New Order, D-04). */
export function clearCart(): CartLine[] {
  return [];
}

/** Cart total = sum(line quantity * unit price). */
export function cartTotalPaisa(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.unitPricePaisa * line.quantity, 0);
}
