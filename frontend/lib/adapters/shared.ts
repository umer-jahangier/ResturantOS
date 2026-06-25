// Cross-domain adapter helpers (§7.2.5). Money is stored as integer paisa on the
// wire and must NEVER be divided by 100 in a component — always go through here.

export interface Money {
  /** Raw integer amount in paisa (1 PKR = 100 paisa). */
  paisa: number;
  /** Locale-formatted display string, e.g. "Rs 1,234.00". */
  formatted: string;
}

const pkrFormatter = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
});

/** Convert integer paisa into a {@link Money} value object. */
export function toMoney(paisa: number): Money {
  return {
    paisa,
    formatted: pkrFormatter.format(paisa / 100),
  };
}

/** Parse an ISO-8601 instant string into a `Date`. */
export function toInstant(iso: string): Date {
  return new Date(iso);
}
