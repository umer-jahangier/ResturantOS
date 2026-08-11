import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig, type AgentConfig, type PrinterEntry } from "../src/config.js";
import { Journal } from "../src/queue/journal.js";
import { PrintQueue, type PrintJobRecord } from "../src/queue/queue.js";
import { createAgentServer, renderTestPage, type AgentServer } from "../src/server.js";
import { emulate } from "./escpos-emulator.js";
import { FakePrinter } from "./fake-printer.js";

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
  throw new Error(`could not find ${FIXTURE_RELATIVE}`);
}

const RAW = JSON.parse(readFileSync(locateFixture(), "utf8")) as Record<string, unknown>;
const DOCUMENT = { ...RAW, fiscal: null };

const PRINTER: PrinterEntry = {
  id: "receipt-1",
  terminalId: null,
  role: "RECEIPT",
  stationCode: null,
  transport: "TCP",
  host: "127.0.0.1",
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

let dir: string;
let agent: AgentServer | null = null;
let printer: FakePrinter | null = null;
let baseUrl = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-server-"));
});

afterEach(async () => {
  await agent?.close();
  agent = null;
  await printer?.close();
  printer = null;
  rmSync(dir, { recursive: true, force: true });
});

function baseConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    ...loadConfig(null, {}),
    journalPath: join(dir, "queue.jsonl"),
    printers: [PRINTER],
    ...overrides,
  };
}

async function start(
  config: AgentConfig,
  sender?: (bytes: Uint8Array) => Promise<void>,
): Promise<{ queue: PrintQueue; logs: Record<string, unknown>[] }> {
  const queue = new PrintQueue(new Journal<PrintJobRecord>(config.journalPath), {
    maxAttempts: config.maxAttempts,
    baseBackoffMs: 1,
    maxBackoffMs: 5,
    retentionMs: config.retentionMs,
  });
  const logs: Record<string, unknown>[] = [];
  agent = createAgentServer({
    config,
    queue,
    senderFor: sender === undefined ? undefined : () => sender,
    log: (event) => logs.push(event),
  });
  await new Promise<void>((resolve) => agent!.server.listen(0, "127.0.0.1", resolve));
  const address = agent.server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
  return { queue, logs };
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("the daemon", () => {
  // ── 1. Accept, persist, deliver ─────────────────────────────────────────────────────────────
  it("persists, acknowledges with a job id, and delivers", async () => {
    printer = new FakePrinter("accept");
    const port = await printer.listen();
    const config = baseConfig({ printers: [{ ...PRINTER, port }] });
    const { queue } = await start(config);

    const res = await post("/print", { targetPrinterId: "receipt-1", document: DOCUMENT });
    const body = (await res.json()) as { state: string; jobId: string };

    expect(res.status).toBe(200);
    expect(body.state).toBe("DELIVERED");
    expect(body.jobId).toBeTruthy();

    // On disk, and the bytes reached the socket.
    expect(readFileSync(config.journalPath, "utf8")).toContain(body.jobId);
    expect(queue.get(body.jobId)?.status).toBe("SENT");
    expect(emulate(printer.received()).lines.length).toBeGreaterThan(10);
  });

  // ── 2. Invalid document, rejected BEFORE persistence ────────────────────────────────────────
  it("rejects an invalid document naming the path, and persists nothing", async () => {
    const config = baseConfig();
    const { queue } = await start(config, async () => undefined);

    const broken = structuredClone(DOCUMENT) as unknown as { totals: { grandTotal: { formatted: string } } };
    broken.totals.grandTotal.formatted = "Rs 284,347.00"; // disagrees with its paisa

    const res = await post("/print", { targetPrinterId: "receipt-1", document: broken });
    const body = (await res.json()) as { error: string; path: string };

    expect(res.status).toBe(422);
    expect(body.error).toBe("INVALID_DOCUMENT");
    expect(body.path).toContain("totals.grandTotal");

    // A contract break must be visible HERE, not at the printer — and nothing may be written.
    expect(queue.depth()).toEqual({ QUEUED: 0, CLAIMED: 0, SENT: 0, FAILED: 0, DEAD_LETTERED: 0 });
    expect(existsSync(config.journalPath)).toBe(false);
  });

  // ── 3. Unknown printer, a DISTINCT status ───────────────────────────────────────────────────
  it("rejects an unknown printer with a status distinct from a validation failure", async () => {
    await start(baseConfig(), async () => undefined);

    const res = await post("/print", { targetPrinterId: "nope", document: DOCUMENT });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("UNKNOWN_PRINTER");

    // The two are different messages to a cashier — one is a configuration gap a manager fixes,
    // the other is a contract break an engineer does — so they must not share a status.
    const invalid = await post("/print", { targetPrinterId: "receipt-1", document: { nope: true } });
    expect(invalid.status).toBe(422);
    expect(invalid.status).not.toBe(res.status);
  });

  // ── 4 & 5. Health and printers ──────────────────────────────────────────────────────────────
  it("reports version, queue depth and per-printer last-attempt state", async () => {
    printer = new FakePrinter("accept");
    const port = await printer.listen();
    await start(baseConfig({ printers: [{ ...PRINTER, port }] }));

    const before = (await (await fetch(`${baseUrl}/health`)).json()) as Record<string, any>;
    expect(before.version).toBeTruthy();
    expect(before.depth.QUEUED).toBe(0);
    expect(before.printers[0].lastAttemptAt).toBeNull();

    await post("/print", { targetPrinterId: "receipt-1", document: DOCUMENT });

    const after = (await (await fetch(`${baseUrl}/health`)).json()) as Record<string, any>;
    expect(after.printers[0].lastAttemptOk).toBe(true);
    expect(after.printers[0].lastAttemptAt).toBeGreaterThan(0);
    expect(after.depth.SENT).toBe(1);
  });

  it("lists printers with roles and transports and NO secrets", async () => {
    await start(baseConfig({ sharedSecret: null }));
    const body = (await (await fetch(`${baseUrl}/printers`)).json()) as { printers: Record<string, unknown>[] };

    expect(body.printers[0]).toMatchObject({ id: "receipt-1", role: "RECEIPT", transport: "TCP" });
    // Nothing that would help someone reach the printer directly, and no agent secret.
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain("sharedSecret");
    expect(serialised).not.toContain("host");
  });

  // ── 6. Test print, with an assertion behind the button ──────────────────────────────────────
  it("renders a test page containing a column ruler, and enqueues it", async () => {
    printer = new FakePrinter("accept");
    const port = await printer.listen();
    await start(baseConfig({ printers: [{ ...PRINTER, port }] }));

    const res = await post("/test-print", { targetPrinterId: "receipt-1" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { jobId: string }).jobId).toBeTruthy();

    // Decoded from what the SOCKET received — the configuration UI's button has an assertion
    // behind it rather than a hope.
    const decoded = emulate(printer.received());
    const text = decoded.lines.map((l) => l.text);
    expect(text.some((t) => t.includes("PRINT AGENT TEST PAGE"))).toBe(true);
    expect(text.some((t) => t.includes("columns  42"))).toBe(true);

    // The ruler is exactly the configured column count, because measuring it is its entire job.
    const ruler = text.find((t) => /^\.{9}1/.test(t));
    expect(ruler, "no column ruler on the test page").toBeDefined();
    expect(ruler!.length).toBe(42);
  });

  it("marks an UNMEASURED column count on the test page", () => {
    const bytes = renderTestPage({ ...PRINTER, columnsMeasured: false });
    const text = emulate(bytes).lines.map((l) => l.text);
    expect(text.some((t) => t.includes("NOT MEASURED"))).toBe(true);
  });

  // ── 7. CORS ─────────────────────────────────────────────────────────────────────────────────
  it("answers preflight for a configured origin and not for others", async () => {
    await start(baseConfig({ allowedOrigins: ["https://pos.example.com"] }));

    const allowed = await fetch(`${baseUrl}/print`, {
      method: "OPTIONS",
      headers: { origin: "https://pos.example.com", "access-control-request-method": "POST" },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://pos.example.com");

    const other = await fetch(`${baseUrl}/print`, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example.com", "access-control-request-method": "POST" },
    });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses a wildcard origin at CONFIGURATION LOAD", () => {
    // An unauthenticated print endpoint with `Allow-Origin: *` lets any page open in the cashier's
    // browser — an advert iframe on a news site left up on the till — print on this branch.
    expect(() => loadConfig(null, { PRINT_AGENT_ORIGINS: "*" })).toThrow(/wildcard/);
    expect(() => loadConfig(null, { PRINT_AGENT_ORIGINS: "https://pos.example.com,*" })).toThrow(/wildcard/);
  });

  // ── 8. Unsafe bind ──────────────────────────────────────────────────────────────────────────
  it("refuses to start bound to a wildcard address with no shared secret, and says why", () => {
    expect(() => loadConfig(null, { PRINT_AGENT_BIND: "0.0.0.0" })).toThrow(/not loopback/);
    expect(() => loadConfig(null, { PRINT_AGENT_BIND: "0.0.0.0" })).toThrow(/guest wifi/);
  });

  // ── 9. The shared secret ────────────────────────────────────────────────────────────────────
  it("accepts a request carrying the secret and rejects one without it, logging no body", async () => {
    const { logs } = await start(baseConfig({ sharedSecret: "s3cret" }), async () => undefined);

    const without = await post("/print", { targetPrinterId: "receipt-1", document: DOCUMENT });
    expect(without.status).toBe(401);

    const withSecret = await post(
      "/print",
      { targetPrinterId: "receipt-1", document: DOCUMENT },
      { "x-print-agent-secret": "s3cret" },
    );
    expect([200, 202]).toContain(withSecret.status);

    const rejection = logs.find((l) => l.event === "unauthorised");
    expect(rejection, "the rejection must be logged").toBeDefined();
    expect(rejection!.from, "with the source address").toBeTruthy();
    // …and with NO body. A receipt carries a customer's order and their tender.
    expect(JSON.stringify(logs)).not.toContain("Chicken Karahi");
    expect(JSON.stringify(logs)).not.toContain("2,843.47");
  });

  // ── The three cashier-visible outcomes are three different shapes ───────────────────────────
  it("distinguishes DELIVERED from QUEUED so the fallback ladder can pick the right message", async () => {
    const port = await FakePrinter.refusedPort();
    const { queue } = await start(baseConfig({ printers: [{ ...PRINTER, port }] }));

    const res = await post("/print", { targetPrinterId: "receipt-1", document: DOCUMENT });
    const body = (await res.json()) as { state: string; jobId: string; reason: string };

    // 202, not 200 and not a 4xx: accepted and ON DISK, printer did not answer. "1 queued —
    // receipt printer offline" is a different message from "printing failed".
    expect(res.status).toBe(202);
    expect(body.state).toBe("QUEUED");
    expect(body.reason).toContain("connection refused");
    expect(queue.get(body.jobId)?.status).toBe("FAILED");
    expect(queue.get(body.jobId)?.attempts).toBe(1);
  });

  it("drains a queued job when the printer comes back", async () => {
    printer = new FakePrinter("accept");
    const port = await printer.listen();
    const config = baseConfig({ printers: [{ ...PRINTER, port }] });

    let up = false;
    const { queue } = await start(config, async (bytes) => {
      if (!up) throw new Error("printer at 127.0.0.1: connection refused");
      const { sendOverTcp9100 } = await import("../src/transport/tcp9100.js");
      await sendOverTcp9100(bytes, { host: "127.0.0.1", port, connectTimeoutMs: 500, writeTimeoutMs: 500 });
    });

    const res = await post("/print", { targetPrinterId: "receipt-1", document: DOCUMENT });
    expect(res.status).toBe(202);

    up = true;
    await new Promise((r) => setTimeout(r, 20));
    expect(await agent!.drainOnce()).toBe(true);

    expect(queue.depth().SENT).toBe(1);
    expect(emulate(printer.received()).lines.length).toBeGreaterThan(10);
  });
});
