import { describe, expect, it } from "vitest";

import {
  MAX_DRAWER_PULSE_MS,
  align,
  cut,
  emphasis,
  feedAndCut,
  initialize,
  openDrawerAfterPrinting,
  openDrawerImmediately,
  textSize,
} from "../src/render/escpos-commands.js";

/**
 * Every expectation here is a HEXADECIMAL LITERAL taken from Star Micronics, _Line Thermal Printer
 * ESC/POS Mode Command Specifications_ Rev 2.52, via research §7 — never a second call to the code
 * under test, and never a re-derivation of the same arithmetic.
 *
 * <p>That matters more than usual here. These bytes cut paper and energise a solenoid. A test that
 * computed its expectation the same way the implementation does would pass for a drawer command
 * that opens the wrong pin, and the first person to find out would be a cashier whose till does not
 * open with a customer waiting.
 */
function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

describe("initialise (research §7.1)", () => {
  it("emits exactly ESC @", () => {
    expect(hex(initialize())).toBe("1b 40");
    expect(initialize()).toHaveLength(2);
  });
});

describe("cut (research §7.3)", () => {
  it("emits the specification's exact sequence for a full and a partial cut", () => {
    expect(hex(cut("FULL"))).toBe("1d 56 00"); //    GS V 0
    expect(hex(cut("PARTIAL"))).toBe("1d 56 01"); // GS V 1
  });

  it("emits NOTHING for NONE — a continuous roll and an unreadable config both want no cut", () => {
    expect(cut("NONE")).toHaveLength(0);
  });

  it("never emits the same bytes for a full cut as for a partial one", () => {
    expect(hex(cut("FULL"))).not.toBe(hex(cut("PARTIAL")));
  });
});

describe("feed-then-cut (research §7.3)", () => {
  it("emits the feed parameter as its own byte, after m = 65 / 66", () => {
    // GS V 66 0 — the sequence the research names as what most POS software sends.
    expect(hex(feedAndCut("PARTIAL", 0))).toBe("1d 56 42 00");
    expect(hex(feedAndCut("FULL", 0))).toBe("1d 56 41 00");
    // The feed value really is a separate byte, not folded into m.
    expect(hex(feedAndCut("PARTIAL", 3))).toBe("1d 56 42 03");
    expect(hex(feedAndCut("FULL", 255))).toBe("1d 56 41 ff");
  });

  it("rejects a feed outside the single-byte range rather than wrapping it", () => {
    expect(() => feedAndCut("FULL", 256)).toThrow(/0\.\.255/);
    expect(() => feedAndCut("FULL", -1)).toThrow(/0\.\.255/);
    expect(() => feedAndCut("FULL", 1.5)).toThrow(/0\.\.255/);
  });
});

describe("cash drawer, queued in the print stream (research §7.2)", () => {
  it("emits different, specification-exact sequences for pin 2 and pin 5", () => {
    // The research's own worked example: ESC p 0 50 250 -> 100 ms on, 500 ms off, pin 2.
    expect(hex(openDrawerAfterPrinting(2, 100, 500))).toBe("1b 70 00 32 fa");
    // Same timings, pin 5: only m changes.
    expect(hex(openDrawerAfterPrinting(5, 100, 500))).toBe("1b 70 01 32 fa");

    expect(hex(openDrawerAfterPrinting(2, 100, 500))).not.toBe(
      hex(openDrawerAfterPrinting(5, 100, 500)),
    );
  });

  it("encodes on-time and off-time in the specification's 2 ms units", () => {
    // 50 x 2 = 100 ms on, 250 x 2 = 500 ms off — the ubiquitous 1B 70 00 19 FA variant is
    // 25 x 2 = 50 ms on.
    expect(hex(openDrawerAfterPrinting(2, 50, 500))).toBe("1b 70 00 19 fa");
    expect(hex(openDrawerAfterPrinting(2, 0, 0))).toBe("1b 70 00 00 00");
  });

  it("rejects a pulse longer than the command can encode, naming the maximum", () => {
    expect(MAX_DRAWER_PULSE_MS).toBe(510);
    expect(() => openDrawerAfterPrinting(2, 512, 100)).toThrow(/510 ms/);
    expect(() => openDrawerAfterPrinting(2, 100, 900)).toThrow(/510 ms/);
    // A duration that is not expressible in 2 ms units is refused, not rounded: a rounded drawer
    // pulse is a different physical event from the one the caller asked for.
    expect(() => openDrawerAfterPrinting(2, 101, 500)).toThrow(/2 ms units/);
  });

  it("rejects a connector pin outside the defined set rather than coercing it", () => {
    // Reachable from a config file even though the type forbids it.
    expect(() => openDrawerAfterPrinting(3 as 2, 100, 500)).toThrow(/must be 2 or 5/);
    expect(() => openDrawerAfterPrinting(0 as 2, 100, 500)).toThrow(/must be 2 or 5/);
  });
});

describe("cash drawer, real time — the NO-SALE command (research §7.2)", () => {
  it("emits DLE DC4 with the specification's fixed n and its t x 100 ms unit", () => {
    expect(hex(openDrawerImmediately(2, 100))).toBe("10 14 01 00 01");
    expect(hex(openDrawerImmediately(5, 100))).toBe("10 14 01 01 01");
    expect(hex(openDrawerImmediately(2, 800))).toBe("10 14 01 00 08");
  });

  it("rejects a duration outside 1 <= t <= 8 and one that is not a whole 100 ms", () => {
    expect(() => openDrawerImmediately(2, 900)).toThrow(/between 100 and 800/);
    expect(() => openDrawerImmediately(2, 0)).toThrow(/between 100 and 800/);
    expect(() => openDrawerImmediately(2, 150)).toThrow(/multiple of 100/);
  });

  /**
   * The two drawer commands are for DIFFERENT MOMENTS. `ESC p` is queued and fires when the printer
   * reaches it, so it opens the till after the receipt has printed. `DLE DC4` is processed on
   * reception and jumps the queue — it is the no-sale button. Emitting the real-time one inside a
   * receipt job opens the drawer while the paper is still coming out.
   */
  it("never produces the same bytes as the queued drawer command", () => {
    // Only durations BOTH commands can encode: ESC p tops out at 510 ms (one byte of 2 ms units)
    // while DLE DC4 reaches 800 ms (t x 100, t <= 8). The asymmetry is asserted on its own below.
    for (const pin of [2, 5] as const) {
      for (const ms of [100, 200, 500]) {
        expect(hex(openDrawerImmediately(pin, ms))).not.toBe(
          hex(openDrawerAfterPrinting(pin, ms, ms)),
        );
      }
    }
    // And they do not even share a leading byte, so a truncated stream cannot be mistaken for the
    // other command.
    expect(openDrawerImmediately(2, 100)[0]).not.toBe(openDrawerAfterPrinting(2, 100, 100)[0]);
  });

  /**
   * The two commands do not have the same maximum duration, and a caller that assumes they do will
   * get a RangeError from one and a working pulse from the other. `ESC p` encodes t in ONE BYTE of
   * 2 ms units, so 510 ms; `DLE DC4` encodes t as 1..8 of 100 ms units, so 800 ms.
   */
  it("has a different maximum encodable pulse from the queued command — 800 ms vs 510 ms", () => {
    expect(hex(openDrawerImmediately(2, 800))).toBe("10 14 01 00 08");
    expect(() => openDrawerAfterPrinting(2, 800, 800)).toThrow(/510 ms/);

    // The queued command's own ceiling really is 510, not 500 or 512.
    expect(hex(openDrawerAfterPrinting(2, 510, 510))).toBe("1b 70 00 ff ff");
    expect(() => openDrawerAfterPrinting(2, 512, 100)).toThrow(/510 ms/);
  });
});

describe("text presentation", () => {
  it("emits ESC a / ESC E / GS ! with the expected parameter bytes", () => {
    expect(hex(align("LEFT"))).toBe("1b 61 00");
    expect(hex(align("CENTER"))).toBe("1b 61 01");
    expect(hex(align("RIGHT"))).toBe("1b 61 02");

    expect(hex(emphasis(true))).toBe("1b 45 01");
    expect(hex(emphasis(false))).toBe("1b 45 00");

    // GS ! n — high nibble width, low nibble height, each stored as multiplier - 1.
    expect(hex(textSize(1, 1))).toBe("1d 21 00");
    expect(hex(textSize(2, 2))).toBe("1d 21 11");
    expect(hex(textSize(1, 2))).toBe("1d 21 01");
    expect(hex(textSize(8, 8))).toBe("1d 21 77");
  });

  it("rejects a size multiplier outside 1..8", () => {
    expect(() => textSize(0, 1)).toThrow(/1\.\.8/);
    expect(() => textSize(1, 9)).toThrow(/1\.\.8/);
  });
});
