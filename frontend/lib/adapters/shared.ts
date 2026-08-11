// Cross-domain adapter helpers (§7.2.5). Money is stored as integer paisa on the
// wire and must NEVER be divided by 100 in a component — always go through here.

export interface Money {
  /** Raw integer amount in paisa (1 PKR = 100 paisa). */
  paisa: number;
  /** Display string, e.g. "Rs 1,234.56". Produced by {@link formatPaisa}. */
  formatted: string;
}

/**
 * The JVM's `ReceiptMoneyFormatter` emits a plain ASCII space after the prefix; the browser's
 * currency formatter emits U+00A0. A screen cannot tell them apart, a thermal printer's codepage
 * may not carry U+00A0 at all, and a byte comparison between the two stacks' output is the whole
 * mechanism keeping them honest (see money-display-vectors.json). ASCII wins.
 */
const NON_BREAKING_SPACE = " ";

/**
 * Formatters are keyed by their maximum fraction digits because the options are fixed at
 * construction. Two places is money; more places is a RATE — see {@link formatPaisa}.
 */

/**
 * THE one construction of a currency-styled platform formatter in the frontend tree. Everything
 * else — including the cache's value type — is derived from it, so there is no second place where
 * a locale, a currency or a fraction-digit setting could be chosen differently.
 */
function makeCurrencyFormatter(currency: string, maxFractionDigits: number) {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: maxFractionDigits,
  });
}

const formatterCache = new Map<string, ReturnType<typeof makeCurrencyFormatter>>();

function formatterFor(currency: string, maxFractionDigits: number) {
  const key = `${currency}:${maxFractionDigits}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const created = makeCurrencyFormatter(currency, maxFractionDigits);
  formatterCache.set(key, created);
  return created;
}

/**
 * Convert an exact paisa integer to a decimal string WITHOUT going through a binary float.
 *
 * A number literal cannot hold 9007199254740993; it silently becomes ...992. Splitting the bigint
 * into major and minor units and handing the formatter a string keeps every digit. This is the
 * hard part of the job, and it exists exactly once on purpose.
 */
function exactDecimalString(paisa: bigint): Intl.StringNumericLiteral {
  const negative = paisa < 0n;
  const abs = negative ? -paisa : paisa;
  const major = abs / 100n;
  const minor = abs % 100n;
  // `StringNumericLiteral` is a template-literal type TypeScript cannot prove a runtime-built
  // string inhabits. The shape is guaranteed by construction above — optional sign, digits, a
  // point, exactly two digits — and the vector suite asserts the rendered output on both stacks.
  return `${negative ? "-" : ""}${major}.${minor
    .toString()
    .padStart(2, "0")}` as Intl.StringNumericLiteral;
}

/**
 * THE single site where a paisa value becomes a string a user reads (D-37-01).
 *
 * Byte-identical to the JVM's `MoneyUtils.formatPkr` / `ReceiptMoneyFormatter.format` for every
 * vector in `shared-lib/src/test/resources/money-display-vectors.json`, which both stacks' tests
 * read. Change the rule here and the Java test goes red; change it there and this one does.
 *
 * @param paisa integer paisa (pass a `bigint` for anything that may exceed 2^53), or a fractional
 *              value for a per-unit RATE
 * @param opts.maxFractionDigits extra decimal places for a RATE rather than an amount. A per-gram
 *              cost of 6.2 paisa is Rs 0.062; at the usual two places it reads Rs 0.06, and
 *              anything cheaper reads Rs 0.00 — the "this ingredient is free" impression a unit
 *              cost must never give. Pass 4 on a per-unit cost column; leave it alone for money.
 * @param opts.currency defaults to PKR, which is the only currency the JVM cross-check covers.
 *              Nothing in the product passes anything else today; the parameter exists so a
 *              future multi-currency caller has a supported route rather than a second formatter.
 */
export function formatPaisa(
  paisa: number | bigint,
  opts?: { maxFractionDigits?: number; currency?: string },
): string {
  const maxFractionDigits = Math.max(2, opts?.maxFractionDigits ?? 2);
  const currency = opts?.currency ?? "PKR";
  const isWhole = typeof paisa === "bigint" || Number.isInteger(paisa);

  // Amounts are integral and can be very large, so they keep the exact BigInt path. Rates are not
  // integral — since V12 a per-stock-unit cost is NUMERIC(18,4) — and BigInt() throws outright on
  // a fractional value, which would have taken out every screen showing a unit cost.
  const value = isWhole ? exactDecimalString(BigInt(paisa)) : Number(paisa) / 100;

  return formatterFor(currency, maxFractionDigits).format(value).replaceAll(NON_BREAKING_SPACE, " ");
}

/** Convert integer paisa into a {@link Money} value object. */
export function toMoney(paisa: number): Money {
  return {
    paisa,
    formatted: formatPaisa(paisa),
  };
}

/** Parse an ISO-8601 instant string into a `Date`. */
export function toInstant(iso: string): Date {
  return new Date(iso);
}
