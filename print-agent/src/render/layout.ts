/**
 * Column arithmetic. Pure strings — there is not a single byte in this file.
 *
 * <p>Separated from the renderer so the hard part (what happens when a name is too long to sit
 * beside its amount) is testable without any printer concept at all.
 *
 * <p><b>Nothing here has a default column count.</b> Every function takes it. Research §7.5 could
 * not establish a canonical column count for ANY model — it is a function of model, configured
 * print width, font and codepage together, and the one vendor datasheet consulted was provably
 * wrong about its own character dimensions. So the number is measured on the hardware during
 * onboarding, stored per printer, and passed in. A `42` or a `48` compiled into this file would
 * quietly override that measurement.
 */

export class LayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutError";
  }
}

function assertColumns(columns: number): void {
  if (!Number.isInteger(columns) || columns < 1) {
    throw new LayoutError(`columns must be a positive integer; received ${columns}`);
  }
}

/** Hard-wrap `text` to `columns`, breaking on spaces where possible and mid-word when it must. */
export function wrap(text: string, columns: number): string[] {
  assertColumns(columns);
  if (text.length === 0) return [""];

  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const word of paragraph.split(" ")) {
      // A single word longer than the line gets cut. A receipt cannot scroll sideways.
      if (word.length > columns) {
        if (current.length > 0) {
          out.push(current);
          current = "";
        }
        for (let i = 0; i < word.length; i += columns) {
          const chunk = word.slice(i, i + columns);
          if (chunk.length === columns) out.push(chunk);
          else current = chunk;
        }
        continue;
      }
      if (current.length === 0) current = word;
      else if (current.length + 1 + word.length <= columns) current = `${current} ${word}`;
      else {
        out.push(current);
        current = word;
      }
    }
    out.push(current);
  }
  return out;
}

/**
 * A label on the left and an amount hard against the right margin.
 *
 * <p>When the label does not fit beside the amount it wraps, and <b>the amount stays on the first
 * line</b>. That is the important half: an amount that migrates to the second line of a wrapped
 * item name stops being visually attached to it, and on a 42-column receipt with several long
 * names the reader can no longer tell which figure belongs to which item.
 */
export function amountRow(label: string, amount: string, columns: number): string[] {
  assertColumns(columns);
  if (amount.length >= columns) {
    throw new LayoutError(
      `the amount "${amount}" is ${amount.length} characters and does not fit in ${columns} ` +
        "columns. The printer's measured column count is too small for the amounts this branch " +
        "prints — re-run the calibration print.",
    );
  }

  const labelWidth = columns - amount.length - 1;
  const wrapped = wrap(label, labelWidth);
  const first = `${(wrapped[0] ?? "").padEnd(labelWidth)} ${amount}`;
  return [first, ...wrapped.slice(1)];
}

/** Centre `text`, without padding the right — trailing spaces are wasted thermal travel. */
export function centre(text: string, columns: number): string[] {
  assertColumns(columns);
  return wrap(text, columns).map((line) => {
    const pad = Math.max(0, Math.floor((columns - line.length) / 2));
    return " ".repeat(pad) + line;
  });
}

/** A full-width rule. */
export function divider(columns: number, char = "-"): string {
  assertColumns(columns);
  if (char.length !== 1) {
    throw new LayoutError(`a divider character must be exactly one character; received "${char}"`);
  }
  return char.repeat(columns);
}

/** `3 x Butter Naan` — the quantity prefix used on every billable line. */
export function quantityLabel(quantity: number, name: string | null): string {
  return `${quantity} x ${name ?? ""}`.trimEnd();
}
