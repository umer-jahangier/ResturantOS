import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parsePrintDocument } from "../src/contract/print-document.schema.js";
import { renderReceipt, type PrinterProfile } from "../src/render/escpos-renderer.js";
import { TransportError, selectTransport } from "../src/transport/index.js";
import { sendOverTcp9100 } from "../src/transport/tcp9100.js";
import { currencyTokens, emulate } from "./escpos-emulator.js";
import { FakePrinter } from "./fake-printer.js";
import type { PrinterEntry } from "../src/config.js";

/**
 * The first END-TO-END claim in this phase.
 *
 * <p>Everything before it proves the renderer produced correct bytes. This proves those bytes
 * survive a socket — and it decodes what the SERVER RECEIVED with the same emulator, rather than
 * re-examining what the renderer returned. That distinction is the whole point: comparing the
 * renderer's output to itself would let a renderer bug and a transport bug cancel each other out.
 */

const FIXTURE_RELATIVE = join("contracts", "print", "golden-receipt-document.json");

function locateFixture(): string {
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, FIXTURE_RELATIVE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not find ${FIXTURE_RELATIVE} from ${process.cwd()}`);
}

const RAW = JSON.parse(readFileSync(locateFixture(), "utf8")) as Record<string, unknown>;
const DOCUMENT = parsePrintDocument({ ...RAW, fiscal: null });

const PROFILE: PrinterProfile = {
  columns: 42,
  codepage: "CP437",
  cut: "PARTIAL",
  drawerPin: 2,
  drawerPulseMs: 100,
};

const TIMEOUTS = { connectTimeoutMs: 500, writeTimeoutMs: 500 };

let printer: FakePrinter | null = null;

afterEach(async () => {
  await printer?.close();
  printer = null;
});

describe("the port-9100 transport", () => {
  // ── 1. The bytes arrive, and they are the right bytes ───────────────────────────────────────
  it("delivers the exact rendered stream, asserted by decoding what the SOCKET received", async () => {
    printer = new FakePrinter("accept");
    const port = await printer.listen();
    const bytes = renderReceipt(DOCUMENT, PROFILE);

    await sendOverTcp9100(bytes, { host: "127.0.0.1", port, ...TIMEOUTS });

    const received = printer.received();
    expect(Array.from(received), "the socket did not receive the bytes the renderer produced").toEqual(
      Array.from(bytes),
    );

    // Decoded from the RECEIVED buffer. `emulate` throws on any byte it cannot classify, so a
    // stream mangled in transit cannot reach the assertions below.
    const decoded = emulate(received);
    expect(decoded.lines.length).toBeGreaterThan(10);

    // Every amount on the paper is one the document carried — the 100x guard, now applied to what
    // came off a wire rather than to what a function returned.
    const allowed = new Set<string>();
    DOCUMENT.lines.forEach((l) => allowed.add(l.lineTotal.formatted));
    if (DOCUMENT.totals) {
      for (const a of Object.values(DOCUMENT.totals)) allowed.add(a.formatted);
    }
    DOCUMENT.taxBreakdown.forEach((t) => allowed.add(t.amount.formatted));
    DOCUMENT.tenders.forEach((t) => {
      allowed.add(t.amountApplied.formatted);
      allowed.add(t.amountTendered.formatted);
      allowed.add(t.change.formatted);
    });
    for (const token of currencyTokens(decoded)) {
      expect(Array.from(allowed), `"${token}" arrived at the printer but is not in the document`).toContain(
        token,
      );
    }

    expect(decoded.events.filter((e) => e.kind === "cut")).toHaveLength(1);
    expect(decoded.events.filter((e) => e.kind === "drawer")).toHaveLength(1);
  });

  // ── 2. Refused ──────────────────────────────────────────────────────────────────────────────
  it("reports a refused connection as a failure naming the host and port", async () => {
    const port = await FakePrinter.refusedPort();

    await expect(
      sendOverTcp9100(Uint8Array.from([0x1b, 0x40]), { host: "127.0.0.1", port, ...TIMEOUTS }),
    ).rejects.toThrow(TransportError);

    await expect(
      sendOverTcp9100(Uint8Array.from([0x1b, 0x40]), { host: "127.0.0.1", port, ...TIMEOUTS }),
    ).rejects.toThrow(new RegExp(`127\\.0\\.0\\.1:${port}.*connection refused`));
  });

  it("does not leave an unhandled rejection behind when a connection is refused", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const port = await FakePrinter.refusedPort();
      await sendOverTcp9100(Uint8Array.from([0x1b, 0x40]), {
        host: "127.0.0.1",
        port,
        ...TIMEOUTS,
      }).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  // ── 3. Opens and then stalls ────────────────────────────────────────────────────────────────
  it("abandons a connection that opens and then stalls, and reports a failure", async () => {
    // A printer whose firmware has hung accepts the connection and then does nothing at all. With
    // no timeout this wedges the queue behind one job forever.
    printer = new FakePrinter("stall");
    const port = await printer.listen();

    const started = Date.now();
    await expect(
      sendOverTcp9100(renderReceipt(DOCUMENT, PROFILE), { host: "127.0.0.1", port, ...TIMEOUTS }),
    ).rejects.toThrow(/timed out after \d+ms/);

    expect(Date.now() - started).toBeLessThan(5_000);
    // The caller must not be able to read this as delivered.
    expect(printer.connectionCount).toBe(1);
  });

  // ── 4. Closed mid-stream ────────────────────────────────────────────────────────────────────
  it("reports a mid-stream close as a FAILURE, never as a success", async () => {
    printer = new FakePrinter("close-mid-stream", 64);
    const port = await printer.listen();

    // Large enough that the close lands mid-write rather than after it.
    const big = new Uint8Array(2 * 1024 * 1024).fill(0x41);

    await expect(
      sendOverTcp9100(big, { host: "127.0.0.1", port, ...TIMEOUTS }),
    ).rejects.toThrow(TransportError);

    // A half-printed receipt is a visible fault on the paper and must be retried. Reporting this
    // as success would leave a customer holding half a bill and the queue believing it is done.
  });

  // ── 5. One connection per job ───────────────────────────────────────────────────────────────
  it("opens and closes its own connection for every job, never pooling", async () => {
    printer = new FakePrinter("accept");
    const port = await printer.listen();
    const target = { host: "127.0.0.1", port, ...TIMEOUTS };

    await sendOverTcp9100(Uint8Array.from([0x1b, 0x40, 0x41, 0x0a]), target);
    await sendOverTcp9100(Uint8Array.from([0x1b, 0x40, 0x42, 0x0a]), target);

    expect(
      printer.connectionCount,
      "the two jobs shared a connection. These devices drop idle sockets without telling anyone, " +
        "and a pooled one the printer abandoned strands the next job behind a write that never " +
        "completes.",
    ).toBe(2);

    // And both jobs' bytes arrived, in order.
    expect(Array.from(printer.received())).toEqual([0x1b, 0x40, 0x41, 0x0a, 0x1b, 0x40, 0x42, 0x0a]);
  });
});

describe("the system-printer transport", () => {
  // ── 6. Reports the spooler's acceptance, and nothing more ───────────────────────────────────
  it("resolves when the spooler accepts and rejects when it does not", async () => {
    const { sendToSystemPrinter } = await import("../src/transport/system-printer.js");
    if (process.platform === "win32") {
      await expect(
        sendToSystemPrinter(Uint8Array.from([0x1b]), { systemPrinterName: "x", writeTimeoutMs: 500 }),
      ).rejects.toThrow(/not implemented/);
      return;
    }

    const fakeSpawn = (exitCode: number) =>
      ((): unknown => {
        const handlers: Record<string, ((arg?: unknown) => void)[]> = {};
        const child = {
          stdin: { end: () => undefined, on: () => undefined },
          stderr: { on: () => undefined },
          kill: () => undefined,
          on(event: string, cb: (arg?: unknown) => void) {
            (handlers[event] ??= []).push(cb);
            if (event === "close") setTimeout(() => cb(exitCode), 0);
            return child;
          },
        };
        return child;
      }) as never;

    await expect(
      sendToSystemPrinter(
        Uint8Array.from([0x1b, 0x40]),
        { systemPrinterName: "till-1", writeTimeoutMs: 500 },
        fakeSpawn(0),
      ),
    ).resolves.toBeUndefined();

    await expect(
      sendToSystemPrinter(
        Uint8Array.from([0x1b, 0x40]),
        { systemPrinterName: "till-1", writeTimeoutMs: 500 },
        fakeSpawn(1),
      ),
    ).rejects.toThrow(/lp exited 1/);
  });
});

describe("transport selection", () => {
  const base: PrinterEntry = {
    id: "receipt-1",
    terminalId: null,
    role: "RECEIPT",
    stationCode: null,
    transport: "TCP",
    host: "10.0.7.21",
    port: 9100,
    systemPrinterName: null,
    widthMm: 80,
    columns: 42,
    columnsMeasured: true,
    codepage: "CP437",
    cut: "PARTIAL",
    drawerPin: 2,
    drawerPulseMs: 100,
  };

  // ── 7. An unknown transport fails at CONFIGURATION time ─────────────────────────────────────
  it("rejects an unknown transport when the configuration is loaded, not when a customer is waiting", async () => {
    const { loadConfig } = await import("../src/config.js");
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");

    const dir = mkdtempSync(join(tmpdir(), "transport-select-"));
    const file = join(dir, "config.json");
    try {
      writeFileSync(file, JSON.stringify({ printers: [{ ...base, transport: "BLUETOOTH" }] }));
      expect(() => loadConfig(file, {})).toThrow(/printers\[0\]\.transport/);
      expect(() => loadConfig(file, {})).toThrow(/is not a transport this agent can drive/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns a working sender for each known transport", () => {
    expect(typeof selectTransport(base, TIMEOUTS)).toBe("function");
    expect(
      typeof selectTransport(
        { ...base, transport: "SYSTEM", host: null, port: null, systemPrinterName: "till-1" },
        TIMEOUTS,
      ),
    ).toBe("function");
  });

  it("refuses a TCP printer that reached the agent with no host", () => {
    expect(() => selectTransport({ ...base, host: null }, TIMEOUTS)).toThrow(TransportError);
    expect(() => selectTransport({ ...base, host: null }, TIMEOUTS)).toThrow(/no host or port/);
  });
});
