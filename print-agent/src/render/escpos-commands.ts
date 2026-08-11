/**
 * The ESC/POS command layer.
 *
 * <h2>Where these bytes come from</h2>
 *
 * Every sequence below is taken from **Star Micronics, _Line Thermal Printer ESC/POS Mode Command
 * Specifications_, Revision 2.52**, via `.planning/research/erp-completion/pos-printing.md` §7,
 * which extracted them from the PDF directly rather than from a blog post. Each function cites the
 * section it implements and the parameter range that section defines.
 *
 * <h2>Why parameters are validated instead of clamped</h2>
 *
 * A printer given an out-of-range parameter does something *undefined*. On a paper cutter that is
 * a wasted receipt. On a cash drawer it is either nothing at all or a solenoid held energised —
 * which is how a drawer coil burns out. Every function here throws on a value outside the defined
 * region; none of them silently coerces one into range, because a coerced drawer pulse is a
 * different physical event from the one the caller asked for.
 *
 * <h2>Why this duplicates the encoder library</h2>
 *
 * Deliberately. `@point-of-sale/receipt-printer-encoder` is the right tool for text, codepages and
 * raster images, and it is used for those. But if a library upgrade changes what it emits for a cut
 * or a pulse, this suite fails and a human decides — rather than a restaurant discovering it during
 * a Friday service.
 */

/** ASCII control codes, named so a reader does not have to decode hex in their head. */
const ESC = 0x1b;
const GS = 0x1d;
const DLE = 0x10;
const DC4 = 0x14;

/** The ESC/POS drawer connector pins that exist. There is no pin 3 (research §7.2). */
export type DrawerPin = 2 | 5;

export type CutMode = "NONE" | "PARTIAL" | "FULL";

/**
 * `ESC @` — initialise (research §7.1).
 *
 * > *"Clears data from the print buffer and sets the printer to its default settings."*
 *
 * Sent at the top of EVERY job. Receipts are stateful — bold, size, alignment and codepage all
 * persist across jobs — so a job that does not initialise inherits whatever the last one left
 * behind, which is how one wrongly-formatted receipt becomes every receipt after it.
 *
 * Defined bytes: `1B 40`. No parameters, so nothing to validate.
 */
export function initialize(): Uint8Array {
  return Uint8Array.from([ESC, 0x40]);
}

/**
 * `GS V m` — cut, without feeding (research §7.3).
 *
 * Defined region used here: `m = 0` full cut, `m = 1` partial cut (one point uncut). The
 * specification also accepts 48 and 49 for the same two behaviours; this emits the numeric forms.
 *
 * > *"This command is effective only when processed at the top of the line when standard mode is
 * > being used."*
 * > *"The auto-cut function differs according to the model. A partial cut is executed on those
 * > models that cannot perform a full cut... Models that do not have the auto-cut function do not
 * > cut paper."*
 *
 * `NONE` returns an EMPTY array rather than throwing: a continuous-roll printer, and a branch whose
 * configuration could not be read, both legitimately want no cut at all (D-26-01). An empty command
 * is the honest encoding of "do not command a cut".
 */
export function cut(mode: CutMode): Uint8Array {
  switch (mode) {
    case "NONE":
      return new Uint8Array(0);
    case "FULL":
      return Uint8Array.from([GS, 0x56, 0x00]);
    case "PARTIAL":
      return Uint8Array.from([GS, 0x56, 0x01]);
    default: {
      const exhaustive: never = mode;
      throw new RangeError(`unknown cut mode: ${String(exhaustive)}`);
    }
  }
}

/**
 * `GS V m n` — feed to the cut position plus `n` units, then cut (research §7.3).
 *
 * Defined region used here: `m = 65` feed then FULL cut, `m = 66` feed then PARTIAL cut. This is
 * what most POS software sends, because it feeds the printed area past the cutter before cutting —
 * otherwise the last lines of the receipt are still under the print head when the blade closes.
 *
 * `n` is a single-byte parameter, so `0 <= n <= 255`. The research extract does not restate that
 * bound explicitly for this command; it follows from the parameter being one byte, and it is
 * enforced here rather than allowed to wrap silently at 256.
 *
 * `NONE` is rejected rather than returning empty: a caller that asked to FEED and then not cut has
 * asked for two contradictory things, and quietly doing neither would hide the mistake.
 */
export function feedAndCut(mode: Exclude<CutMode, "NONE">, feedUnits: number): Uint8Array {
  if (!Number.isInteger(feedUnits) || feedUnits < 0 || feedUnits > 255) {
    throw new RangeError(
      `feedUnits must be an integer in 0..255 (it is a single byte); received ${feedUnits}`,
    );
  }
  const m = mode === "FULL" ? 0x41 : 0x42; // 65 / 66
  return Uint8Array.from([GS, 0x56, m, feedUnits]);
}

/**
 * `ESC p m t1 t2` — cash-drawer kick, queued in the print stream (research §7.2).
 *
 * ```
 * Defined region: 0 <= m <= 1, 48 <= m <= 49 ; 0 <= t1 <= 255 ; 0 <= t2 <= 255
 *   m = 0, 48 -> drawer kick connector pin #2
 *   m = 1, 49 -> drawer kick connector pin #5
 * ```
 * > *"Drawer kick on time is set to t1 x 2 ms; off time is set to t2 x 2 ms."*
 * > *"When t1 > t2, the value of t2 is processed as t2 = t1."*
 *
 * <p>Use THIS one at the end of a receipt, so the drawer opens after the paper is printed. For a
 * no-sale drawer open use {@link openDrawerImmediately}, which jumps the print queue. Confusing the
 * two means a drawer that opens in the middle of a receipt.
 *
 * <p>Order note (research §7.3, marked HEARSAY there and repeated as such here): field practice is
 * to CUT before kicking the drawer, because the solenoid can brown out mid-print on an
 * under-powered supply. That is widely held, not a documented requirement.
 *
 * @param onMs  drawer-on duration in milliseconds; encoded as `t1 = onMs / 2`
 * @param offMs drawer-off duration in milliseconds; encoded as `t2 = offMs / 2`
 */
export function openDrawerAfterPrinting(pin: DrawerPin, onMs: number, offMs: number): Uint8Array {
  const m = drawerPinByte(pin);
  return Uint8Array.from([ESC, 0x70, m, toTwoMsUnits(onMs, "onMs"), toTwoMsUnits(offMs, "offMs")]);
}

/**
 * `DLE DC4 n m t` — the REAL-TIME drawer kick (research §7.2).
 *
 * ```
 * Defined region: n = 1 ; m = 0, 1 ; 1 <= t <= 8
 *   m = 0 -> pin #2,  m = 1 -> pin #5
 *   On time = t x 100 ms ; Off time = t x 100 ms
 * ```
 * > *"This command is processed upon reception."*
 * > *"This command is executed even when the printer is offline, the reception buffer is full, or
 * > there is an error status on serial interface models."*
 *
 * <p>This is the NO-SALE button: it jumps the print queue and opens the drawer now. It is a
 * separate function from {@link openDrawerAfterPrinting} on purpose, and the test suite asserts
 * that the two never produce the same bytes — they are for different moments, and a no-sale command
 * emitted inside a receipt job opens the till while the customer is still watching the paper come
 * out.
 *
 * <p>Star caveat, recorded in the research: *"Printing and drawer drive cannot be performed
 * simultaneously"*, so real-time behaviour is not guaranteed while a job is printing.
 *
 * @param pulseMs on/off duration; encoded as `t = pulseMs / 100`, so it must be a multiple of 100
 *                between 100 and 800
 */
export function openDrawerImmediately(pin: DrawerPin, pulseMs: number): Uint8Array {
  const m = pin === 2 ? 0x00 : 0x01;
  if (!Number.isInteger(pulseMs) || pulseMs % 100 !== 0) {
    throw new RangeError(
      `pulseMs must be a whole multiple of 100 (the command encodes t x 100 ms); received ${pulseMs}`,
    );
  }
  const t = pulseMs / 100;
  if (t < 1 || t > 8) {
    throw new RangeError(
      `pulseMs must be between 100 and 800 ms (defined region 1 <= t <= 8); received ${pulseMs}`,
    );
  }
  return Uint8Array.from([DLE, DC4, 0x01, m, t]);
}

// ── Text presentation ────────────────────────────────────────────────────────────────────────
//
// NOTE ON PROVENANCE: research §7 covers initialise, the drawer and the cut, and nothing else.
// The three below are standard ESC/POS and are used by the encoder library too, but they are NOT
// quoted from the Star PDF in the research extract. They are marked as such rather than given a
// citation they do not have — a fabricated citation is worse than an honest gap.

export type Alignment = "LEFT" | "CENTER" | "RIGHT";

/** `ESC a n` — justification. n = 0 left, 1 centre, 2 right. [standard ESC/POS, not in research §7] */
export function align(alignment: Alignment): Uint8Array {
  const n = alignment === "LEFT" ? 0x00 : alignment === "CENTER" ? 0x01 : 0x02;
  return Uint8Array.from([ESC, 0x61, n]);
}

/** `ESC E n` — emphasis (bold) on/off. [standard ESC/POS, not in research §7] */
export function emphasis(on: boolean): Uint8Array {
  return Uint8Array.from([ESC, 0x45, on ? 0x01 : 0x00]);
}

/**
 * `GS ! n` — character size, where the high nibble is the width multiplier and the low nibble the
 * height multiplier, each 1..8 expressed as 0..7. [standard ESC/POS, not in research §7]
 */
export function textSize(widthMultiplier: number, heightMultiplier: number): Uint8Array {
  assertMultiplier(widthMultiplier, "widthMultiplier");
  assertMultiplier(heightMultiplier, "heightMultiplier");
  const n = ((widthMultiplier - 1) << 4) | (heightMultiplier - 1);
  return Uint8Array.from([GS, 0x21, n]);
}

// ── Shared parameter validation ──────────────────────────────────────────────────────────────

/** The maximum on/off duration `ESC p` can encode: `t = 255`, and each unit is 2 ms. */
export const MAX_DRAWER_PULSE_MS = 255 * 2;

function drawerPinByte(pin: DrawerPin): number {
  if (pin === 2) return 0x00;
  if (pin === 5) return 0x01;
  // Not reachable through the type, but reachable from JavaScript and from a config file.
  throw new RangeError(
    `drawer pin must be 2 or 5 — ESC/POS defines no other connector pin (research §7.2); received ${String(pin)}`,
  );
}

function toTwoMsUnits(durationMs: number, label: string): number {
  if (!Number.isInteger(durationMs) || durationMs < 0) {
    throw new RangeError(`${label} must be a non-negative integer; received ${durationMs}`);
  }
  if (durationMs % 2 !== 0) {
    throw new RangeError(
      `${label} must be a whole multiple of 2 ms — the command encodes it in 2 ms units, so ` +
        `${durationMs} cannot be expressed exactly`,
    );
  }
  const units = durationMs / 2;
  if (units > 255) {
    throw new RangeError(
      `${label} of ${durationMs} ms exceeds the maximum this command can encode, which is ` +
        `${MAX_DRAWER_PULSE_MS} ms (t is one byte in 2 ms units)`,
    );
  }
  return units;
}

function assertMultiplier(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 8) {
    throw new RangeError(`${label} must be an integer in 1..8; received ${value}`);
  }
}
