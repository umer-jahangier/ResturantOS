/**
 * An ESC/POS emulator: bytes in, a structured render out.
 *
 * <p>This is the mechanism D-26-02 names. "Built and proven against an emulator; hardware is
 * sign-off, not a dependency" only means something if the emulator is STRICT — so this one
 * consumes every byte and throws the moment it meets one it cannot classify. An emulator that
 * shrugs at garbage would let a truncated or malformed stream pass as a correct receipt, and the
 * whole no-hardware argument would be worth nothing.
 *
 * <p>Three things it refuses, each with its own self-test:
 * <ol>
 *   <li>an unrecognised escape sequence;</li>
 *   <li>a multi-byte command cut short by the end of the stream;</li>
 *   <li>a trailing byte it cannot classify.</li>
 * </ol>
 */

export type Alignment = "LEFT" | "CENTER" | "RIGHT";

export interface DecodedLine {
  text: string;
  align: Alignment;
  emphasis: boolean;
  /** The `ESC t n` code table in force when this line was printed. */
  codepage: number;
  widthMultiplier: number;
  heightMultiplier: number;
}

export type DecodedEvent =
  | { kind: "init"; afterLine: number }
  | { kind: "cut"; mode: "FULL" | "PARTIAL"; feed: number | null; afterLine: number }
  | { kind: "drawer"; realtime: boolean; pin: 2 | 5; onMs: number; offMs: number; afterLine: number };

export interface DecodedRender {
  lines: DecodedLine[];
  events: DecodedEvent[];
}

export class EmulatorError extends Error {
  constructor(
    readonly offset: number,
    detail: string,
  ) {
    super(`byte ${offset}: ${detail}`);
    this.name = "EmulatorError";
  }
}

const ESC = 0x1b;
const GS = 0x1d;
const DLE = 0x10;
const DC4 = 0x14;
const LF = 0x0a;

export function emulate(stream: Uint8Array): DecodedRender {
  const lines: DecodedLine[] = [];
  const events: DecodedEvent[] = [];

  let align: Alignment = "LEFT";
  let emphasis = false;
  let codepage = 0;
  let widthMultiplier = 1;
  let heightMultiplier = 1;
  let current = "";
  let currentStarted = false;

  let i = 0;

  /** A multi-byte command that ran off the end is a TRUNCATION, not an unknown command. */
  const need = (count: number, what: string): void => {
    if (i + count > stream.length) {
      throw new EmulatorError(
        i,
        `${what} needs ${count} more byte(s) but the stream ends after ${stream.length - i}. ` +
          "A truncated command would be executed by a real printer with whatever bytes arrive next.",
      );
    }
  };

  const flush = (): void => {
    lines.push({ text: current, align, emphasis, codepage, widthMultiplier, heightMultiplier });
    current = "";
    currentStarted = false;
  };

  while (i < stream.length) {
    const b = stream[i]!;

    if (b === LF) {
      i += 1;
      flush();
      continue;
    }

    if (b === ESC) {
      const start = i;
      i += 1;
      need(1, "an ESC command");
      const op = stream[i]!;
      i += 1;
      switch (op) {
        case 0x40: // ESC @
          events.push({ kind: "init", afterLine: lines.length });
          align = "LEFT";
          emphasis = false;
          codepage = 0;
          widthMultiplier = 1;
          heightMultiplier = 1;
          break;
        case 0x61: {
          // ESC a n
          need(1, "ESC a (justification)");
          const n = stream[i]!;
          i += 1;
          align = n === 0 || n === 48 ? "LEFT" : n === 1 || n === 49 ? "CENTER" : n === 2 || n === 50 ? "RIGHT" : null!;
          if (align === null) {
            throw new EmulatorError(i - 1, `ESC a has no justification ${n}`);
          }
          break;
        }
        case 0x45: {
          // ESC E n
          need(1, "ESC E (emphasis)");
          emphasis = (stream[i]! & 0x01) === 1;
          i += 1;
          break;
        }
        case 0x74: {
          // ESC t n
          need(1, "ESC t (code table)");
          codepage = stream[i]!;
          i += 1;
          break;
        }
        case 0x70: {
          // ESC p m t1 t2
          need(3, "ESC p (drawer kick)");
          const m = stream[i]!;
          const t1 = stream[i + 1]!;
          const t2 = stream[i + 2]!;
          i += 3;
          if (m !== 0 && m !== 1 && m !== 48 && m !== 49) {
            throw new EmulatorError(i - 3, `ESC p has no drawer connector ${m}`);
          }
          events.push({
            kind: "drawer",
            realtime: false,
            pin: m === 0 || m === 48 ? 2 : 5,
            onMs: t1 * 2,
            offMs: t2 * 2,
            afterLine: lines.length,
          });
          break;
        }
        default:
          throw new EmulatorError(
            start,
            `unrecognised escape sequence ESC 0x${op.toString(16).padStart(2, "0")}`,
          );
      }
      continue;
    }

    if (b === GS) {
      const start = i;
      i += 1;
      need(1, "a GS command");
      const op = stream[i]!;
      i += 1;
      switch (op) {
        case 0x21: {
          // GS ! n
          need(1, "GS ! (character size)");
          const n = stream[i]!;
          i += 1;
          widthMultiplier = ((n >> 4) & 0x0f) + 1;
          heightMultiplier = (n & 0x0f) + 1;
          break;
        }
        case 0x56: {
          // GS V m [n]
          need(1, "GS V (cut)");
          const m = stream[i]!;
          i += 1;
          if (m === 0 || m === 48) {
            events.push({ kind: "cut", mode: "FULL", feed: null, afterLine: lines.length });
          } else if (m === 1 || m === 49) {
            events.push({ kind: "cut", mode: "PARTIAL", feed: null, afterLine: lines.length });
          } else if (m === 65 || m === 66) {
            need(1, "GS V m n (feed then cut)");
            const n = stream[i]!;
            i += 1;
            events.push({
              kind: "cut",
              mode: m === 65 ? "FULL" : "PARTIAL",
              feed: n,
              afterLine: lines.length,
            });
          } else {
            throw new EmulatorError(i - 1, `GS V has no cut mode ${m}`);
          }
          break;
        }
        default:
          throw new EmulatorError(
            start,
            `unrecognised escape sequence GS 0x${op.toString(16).padStart(2, "0")}`,
          );
      }
      continue;
    }

    if (b === DLE) {
      const start = i;
      i += 1;
      need(1, "a DLE command");
      if (stream[i]! !== DC4) {
        throw new EmulatorError(start, `unrecognised escape sequence DLE 0x${stream[i]!.toString(16)}`);
      }
      i += 1;
      need(3, "DLE DC4 (real-time drawer)");
      const n = stream[i]!;
      const m = stream[i + 1]!;
      const t = stream[i + 2]!;
      i += 3;
      if (n !== 1) throw new EmulatorError(i - 3, `DLE DC4 is only defined for n = 1; received ${n}`);
      if (m !== 0 && m !== 1) throw new EmulatorError(i - 2, `DLE DC4 has no drawer connector ${m}`);
      if (t < 1 || t > 8) throw new EmulatorError(i - 1, `DLE DC4 pulse t must be 1..8; received ${t}`);
      events.push({
        kind: "drawer",
        realtime: true,
        pin: m === 0 ? 2 : 5,
        onMs: t * 100,
        offMs: t * 100,
        afterLine: lines.length,
      });
      continue;
    }

    // Printable ASCII becomes line content. Anything else is a byte this emulator will not guess at.
    if (b >= 0x20 && b <= 0x7e) {
      current += String.fromCharCode(b);
      currentStarted = true;
      i += 1;
      continue;
    }

    throw new EmulatorError(
      i,
      `unclassifiable byte 0x${b.toString(16).padStart(2, "0")}. It is neither a command this ` +
        "emulator knows nor printable text, so a real printer's behaviour on it is undefined.",
    );
  }

  // Text with no trailing line feed still reached the print buffer.
  if (currentStarted) flush();

  return { lines, events };
}

/** Every currency-shaped token in a decoded render — the 100x guard, applied to the paper. */
export function currencyTokens(render: DecodedRender): string[] {
  const out: string[] = [];
  for (const line of render.lines) {
    for (const match of line.text.matchAll(/-?Rs\s[\d,]+\.\d{2}/g)) out.push(match[0]);
  }
  return out;
}
