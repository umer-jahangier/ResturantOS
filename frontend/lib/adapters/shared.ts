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

// ── Rupee entry: the OTHER direction of the money boundary (S1-05) ─────────────────────────────
//
// `formatPaisa` is the single site where paisa becomes something a person reads. This is the
// single site where something a person TYPED becomes paisa. It lives here, beside its inverse, so
// there is exactly one rounding rule in the frontend and no screen can invent a second one.
//
// Why it exists at all: the Charge screen used to ask the cashier for paisa
// (`aria-label="Amount in paisa"`, `placeholder="Amount (paisa)"`) on a `type="number"` input
// whose handler was `parseInt(e.target.value)`. Typing a bill as it is printed — `3456.80` —
// produced `34560` in the box and a Rs 345.60 tender against a Rs 3,456.80 check: a silent
// ten-fold under-collection with no error anywhere. The `type="number"` element blanks its own
// `.value` on the intermediate `"3456."` keystroke, `parseInt` then read `0`, and the digits that
// followed landed against an emptied field. Nothing about that is recoverable by validation; the
// unit the cashier is asked for has to change.

/** The most paisa this parser will return — beyond it, integer arithmetic in JS stops being exact. */
const MAX_SAFE_PAISA = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Parse a rupee amount a human typed into exact integer paisa, HALF_UP, without ever touching a
 * binary float.
 *
 * Accepts what people actually type at a till: `3456.80`, `3,456.80`, `Rs 3456.8`, `.5`, `12`,
 * with or without surrounding space. Returns `null` — never a silently-wrong number — for
 * anything else, including a negative amount, an empty box and `1e3`. A caller that gets `null`
 * must refuse to submit, not fall back to zero.
 *
 * Rounding is HALF_UP on the third decimal place, matching `PercentOfPaisa` on the JVM side:
 * `12.345` → `1235`, `12.344` → `1234`. Only the first discarded digit can decide HALF_UP, so no
 * further digits are consulted. The whole computation runs on digit strings and `BigInt`, so
 * `parseRupeesToPaisa("0.29")` is 29 and not the 28.999999999999996 a float would give.
 */
export function parseRupeesToPaisa(input: string): number | null {
  if (typeof input !== "string") return null;
  // Strip what a keyboard, a locale or a paste from another screen adds. `\s` already covers the
  // NBSP and narrow-NBSP that `Intl.NumberFormat` emits as its group separator, so a figure copied
  // straight off this app's own display parses back; `,` covers the ASCII grouping people type.
  const cleaned = input.replace(/[\s,]/g, "").replace(/^(?:rs\.?|pkr|₨)/i, "");
  if (cleaned === "") return null;

  const match = /^(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return null;
  const whole = match[1] ?? "";
  const frac = match[2] ?? "";
  // "." alone is not an amount, and neither is "" — both would otherwise read as zero.
  if (whole === "" && frac === "") return null;

  const paisaDigits = (frac + "00").slice(0, 2);
  let paisa = BigInt(whole || "0") * 100n + BigInt(paisaDigits);
  // HALF_UP: the discarded remainder is >= 0.5 of a paisa exactly when its leading digit is >= 5.
  if (frac.length > 2 && frac.charCodeAt(2) - 48 >= 5) paisa += 1n;

  if (paisa > MAX_SAFE_PAISA) return null;
  return Number(paisa);
}

/**
 * Render integer paisa as the plain rupee string that belongs INSIDE a text box — `3456.80`, not
 * `Rs 3,456.80`.
 *
 * Deliberately not `formatPaisa`: a grouped, currency-prefixed string put back into an input is a
 * string the user then has to edit around, and it round-trips through {@link parseRupeesToPaisa}
 * only by the grace of that function's cleanup. This is the value; `formatPaisa` is the label.
 */
export function paisaToRupeeInput(paisa: number): string {
  const negative = paisa < 0;
  const abs = BigInt(Math.trunc(Math.abs(paisa)));
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}
