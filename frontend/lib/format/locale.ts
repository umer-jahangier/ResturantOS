/**
 * The pinned locale, and the two formatters everything user-visible goes through.
 *
 * <h3>The defect</h3>
 *
 * `value.toLocaleString()` and `new Intl.NumberFormat(undefined, …)` do not name a locale; they
 * ask whatever runtime is executing the line to pick one. Under Next that is TWO different
 * runtimes for the same markup: the server prerenders a `"use client"` page with Node's ICU
 * default, then the browser hydrates the same subtree using `navigator.language`. For any value
 * >= 1000 or carrying a fraction the group and decimal separators differ — measured, `de-DE`
 * gives `1.234,5` where `en-US` gives `1,234.5` — so the prerendered text and the hydrated text
 * disagree. React discards the server HTML for that subtree and warns, on precisely the numbers
 * a stat tile exists to display.
 *
 * It is invisible to anyone developing in the same locale their ICU defaults to, which is why it
 * was fixed once in `components/ui/meter.tsx` and came straight back in twenty-five fresh call
 * sites across eighteen files, one of them inside `lib/format/stat-line.ts` — a shared helper, so
 * every screen that adopted the helper adopted the bug with it.
 *
 * <h3>Extends `lib/adapters/shared.ts`, does not compete with it</h3>
 *
 * `lib/adapters/shared.ts:29-36` calls itself "THE one construction of a currency-styled platform
 * formatter … so there is no second place where a locale could be chosen differently". That claim
 * was true of MONEY and false of everything else: the locale string `"en-PK"` was also typed out
 * by hand in `components/ui/meter.tsx`, and every unpinned call site was a place choosing
 * differently by omission.
 *
 * So this module EXTENDS that authority rather than mirroring it. {@link PLATFORM_LOCALE} is the
 * single literal, and `lib/adapters/shared.ts` now imports it instead of spelling it out — the
 * currency formatter is still constructed in exactly one place, it just no longer owns a private
 * copy of the locale. Same for `components/ui/meter.tsx` and for `lib/format/elapsed.ts`'s
 * `DEFAULT_LOCALE`. Mirroring would have left four strings that agree today; importing leaves one
 * that cannot disagree tomorrow.
 *
 * <h3>Why numbers and dates carry DIFFERENT tags, and why that is not a second authority</h3>
 *
 * Numbers are `en-PK`, matching the money formatter — the product's figures are PKR and its
 * readers are in Pakistan. Dates are `en-GB`, because that is what the product's date copy
 * already renders: `lib/format/elapsed.ts:138`, `components/audit/audit-log.tsx:81,102`,
 * `components/kds/kds-clear-stale.tsx:67` and `components/kds/kds-cleared-board.tsx:61` all pin
 * `en-GB` today. Re-pinning them to `en-PK` would move `12 Aug 2026, 23:30` to
 * `12-Aug-2026, 11:30 pm` on every audit row, KDS board and ticket in the product for no reason a
 * user asked for. Two tags is not two authorities: it is one authority holding two constants, and
 * the second one was chosen by reading what the product already does rather than by preference.
 *
 * <h3>Dates need a pinned ZONE as well as a pinned locale</h3>
 *
 * A locale fixes the separators; it does nothing about the offset. `2026-08-12T18:30:00Z` is
 * 23:30 on the 12th in Karachi and 18:30 on the 12th in UTC, and a purchase order closed at 23:30
 * PKT renders as the PREVIOUS DAY on a server whose `TZ` is UTC — a date that is simply wrong,
 * not merely differently punctuated. So {@link formatDateTime} defaults `timeZone` to
 * {@link DEFAULT_TIME_ZONE}, matching the `timeZone="Asia/Karachi"` that
 * `components/providers/intl-provider.tsx:17` already hands next-intl.
 *
 * <p>That default is a FLOOR, not the answer. Where a call site knows the branch's stored zone it
 * must pass it — `lib/format/elapsed.ts` takes one for exactly this reason, and
 * `lib/repositories/audit.repository.ts:29` records what happens when it is not passed. A
 * single-branch default is right until the day the product has two branches in two zones.
 *
 * <h3>Unknown zones degrade, they do not throw</h3>
 *
 * `Intl` answers an unrecognised IANA name with a `RangeError`. Thrown from a render that takes
 * the page down, so a bad zone falls back to the pinned locale without one — a stamp in the
 * reader's own zone beats a blank screen. This repeats the shape of `elapsed.ts:176-188` and
 * `audit-log.tsx:89-107`, both of which learned it the same way.
 */

/**
 * The one BCP-47 tag for NUMBERS. Imported by `lib/adapters/shared.ts` and
 * `components/ui/meter.tsx`; not re-typed anywhere.
 */
export const PLATFORM_LOCALE = "en-PK";

/** The one BCP-47 tag for DATES. Imported by `lib/format/elapsed.ts`. See the docblock above. */
export const DATE_LOCALE = "en-GB";

/**
 * The zone a stamp is rendered in when the caller does not know the branch's own.
 * Matches `components/providers/intl-provider.tsx:17`.
 */
export const DEFAULT_TIME_ZONE = "Asia/Karachi";

/** What a stamp that is absent or unparseable renders as. An absence, never a fabricated zero. */
export const NO_VALUE = "—";

/**
 * `Intl` formatters are expensive to construct and are constructed per render otherwise. Keyed by
 * locale plus the serialised options, because the options are fixed at construction.
 */
const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function numberFormatter(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  const cached = numberFormatters.get(key);
  if (cached) return cached;
  const created = new Intl.NumberFormat(PLATFORM_LOCALE, options);
  numberFormatters.set(key, created);
  return created;
}

function dateFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  const cached = dateFormatters.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat(DATE_LOCALE, options);
  dateFormatters.set(key, created);
  return created;
}

/**
 * A number, grouped and punctuated the same way on the server and in the browser.
 *
 * <p>Replaces every `value.toLocaleString()`. Non-finite input renders {@link NO_VALUE} rather
 * than the literal `NaN` — a tile reading `NaN` is worse than one reading `—`, because only one
 * of them is honest about not knowing.
 *
 * @param options the same options `Intl.NumberFormat` takes. The LOCALE is not among them on
 *        purpose: it is the one decision this module exists to take away from the call site.
 */
export function formatNumber(
  value: number | bigint | null | undefined,
  options: Intl.NumberFormatOptions = {},
): string {
  if (value === null || value === undefined) return NO_VALUE;
  if (typeof value === "number" && !Number.isFinite(value)) return NO_VALUE;
  return numberFormatter(options).format(value);
}

/** `dateStyle`/`timeStyle` are deliberately absent so a caller's `hour`/`minute` can compose. */
const DEFAULT_DATE_TIME: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

/**
 * An instant, in a pinned locale AND a pinned zone.
 *
 * <p>Accepts the three shapes a stamp already arrives in — a `Date`, an ISO string off the wire,
 * or epoch milliseconds — so no call site has to hand-roll the `new Date(x)` / `Number.isNaN`
 * guard that four of them were hand-rolling differently.
 */
export function formatDateTime(
  at: Date | string | number | null | undefined,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_TIME,
): string {
  if (at === null || at === undefined || at === "") return NO_VALUE;
  const instant = at instanceof Date ? at : new Date(at);
  const ms = instant.getTime();
  if (!Number.isFinite(ms)) return NO_VALUE;

  const zoned = { timeZone: DEFAULT_TIME_ZONE, ...options };
  try {
    return dateFormatter(zoned).format(instant);
  } catch {
    const { timeZone: _discarded, ...withoutZone } = zoned;
    return dateFormatter(withoutZone).format(instant);
  }
}
