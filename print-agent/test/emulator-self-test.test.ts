import { describe, expect, it } from "vitest";

import { EmulatorError, emulate } from "./escpos-emulator.js";

/**
 * The emulator is the thing every other assertion in this package leans on, so it gets tested
 * before it is trusted.
 *
 * <p>D-26-02 says hardware is sign-off, not a dependency — everything except real-paper behaviour
 * is provable against an emulator. That argument is only worth something if the emulator REFUSES
 * malformed input. One that quietly skipped bytes it did not recognise would report a truncated
 * receipt as a correct one, and the no-hardware claim would be false while every test stayed green.
 */
describe("the emulator refuses what a printer would mishandle", () => {
  it("throws on an unrecognised escape sequence", () => {
    // ESC 0x99 is not a command in any ESC/POS dialect this agent speaks.
    const stream = Uint8Array.from([0x1b, 0x40, 0x1b, 0x99, 0x41, 0x0a]);
    expect(() => emulate(stream)).toThrow(EmulatorError);
    expect(() => emulate(stream)).toThrow(/unrecognised escape sequence ESC 0x99/);
  });

  it("throws on a truncated multi-byte command", () => {
    // ESC p (drawer kick) needs three parameter bytes and gets one.
    const stream = Uint8Array.from([0x1b, 0x40, 0x1b, 0x70, 0x00]);
    expect(() => emulate(stream)).toThrow(EmulatorError);
    expect(() => emulate(stream)).toThrow(/needs 3 more byte\(s\)/);

    // And a command cut off at the operator byte, not just at its parameters.
    expect(() => emulate(Uint8Array.from([0x1b, 0x40, 0x1d]))).toThrow(/needs 1 more byte/);
  });

  it("throws on a trailing byte it cannot classify", () => {
    // 0x07 (BEL) is a real control code, and precisely the kind of byte a naive emulator would
    // silently drop while a printer did something with it.
    const stream = Uint8Array.from([0x1b, 0x40, 0x41, 0x42, 0x0a, 0x07]);
    expect(() => emulate(stream)).toThrow(EmulatorError);
    expect(() => emulate(stream)).toThrow(/unclassifiable byte 0x07/);
  });

  it("reports the byte OFFSET, so a failure can be located in the stream", () => {
    try {
      emulate(Uint8Array.from([0x1b, 0x40, 0x41, 0x07]));
      throw new Error("expected the emulator to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EmulatorError);
      expect((err as EmulatorError).offset).toBe(3);
    }
  });

  it("decodes a well-formed stream completely, leaving nothing unconsumed", () => {
    const stream = Uint8Array.from([
      0x1b, 0x40, // ESC @
      0x1b, 0x74, 0x00, // ESC t 0
      0x1b, 0x61, 0x01, // centre
      0x1b, 0x45, 0x01, // bold on
      0x48, 0x49, 0x0a, // "HI\n"
      0x1b, 0x45, 0x00, // bold off
      0x1b, 0x61, 0x00, // left
      0x1d, 0x21, 0x11, // double width + height
      0x4f, 0x4b, 0x0a, // "OK\n"
      0x1d, 0x56, 0x42, 0x00, // GS V 66 0 — feed then partial cut
      0x1b, 0x70, 0x00, 0x32, 0xfa, // ESC p 0 50 250 — pin 2, 100ms on / 500ms off
    ]);

    const render = emulate(stream);

    expect(render.lines).toHaveLength(2);
    expect(render.lines[0]).toMatchObject({ text: "HI", align: "CENTER", emphasis: true, codepage: 0 });
    expect(render.lines[1]).toMatchObject({
      text: "OK",
      align: "LEFT",
      emphasis: false,
      widthMultiplier: 2,
      heightMultiplier: 2,
    });

    expect(render.events).toEqual([
      { kind: "init", afterLine: 0 },
      { kind: "cut", mode: "PARTIAL", feed: 0, afterLine: 2 },
      { kind: "drawer", realtime: false, pin: 2, onMs: 100, offMs: 500, afterLine: 2 },
    ]);
  });

  it("decodes the real-time drawer command distinctly from the queued one", () => {
    const render = emulate(Uint8Array.from([0x1b, 0x40, 0x10, 0x14, 0x01, 0x01, 0x03]));
    expect(render.events[1]).toEqual({
      kind: "drawer",
      realtime: true,
      pin: 5,
      onMs: 300,
      offMs: 300,
      afterLine: 0,
    });
  });

  it("rejects a real-time drawer command outside its defined region", () => {
    // t = 9 is outside 1..8.
    expect(() => emulate(Uint8Array.from([0x1b, 0x40, 0x10, 0x14, 0x01, 0x00, 0x09]))).toThrow(
      /pulse t must be 1\.\.8/,
    );
    // n must be 1.
    expect(() => emulate(Uint8Array.from([0x1b, 0x40, 0x10, 0x14, 0x02, 0x00, 0x01]))).toThrow(
      /only defined for n = 1/,
    );
  });
});
