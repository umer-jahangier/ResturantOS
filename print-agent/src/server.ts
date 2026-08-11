import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { isLoopback, type AgentConfig, type PrinterEntry } from "./config.js";
import { PrintDocumentError, parsePrintDocument } from "./contract/print-document.schema.js";
import { renderReceipt, type PrinterProfile } from "./render/escpos-renderer.js";
import { divider } from "./render/layout.js";
import { encodeText } from "./render/escpos-renderer.js";
import { initialize, cut as cutCommand } from "./render/escpos-commands.js";
import { PrintQueue, type PrintJobRecord } from "./queue/queue.js";
import { selectTransport, type Sender } from "./transport/index.js";

export const AGENT_VERSION = "0.1.0";

/**
 * The agent's HTTP surface. Node's standard library, not a framework — four routes do not justify
 * a second runtime dependency in a package whose single dependency was human-verified.
 *
 * <h2>Three outcomes, three shapes</h2>
 *
 * Research §9.4's fallback ladder gives a cashier three DIFFERENT messages, so this gives three
 * different responses:
 *
 * <ul>
 *   <li><b>200 `DELIVERED`</b> — the bytes reached the printer's socket. (Not "printed": see
 *       `tcp9100.ts`.)</li>
 *   <li><b>202 `QUEUED`</b> — accepted and ON DISK, but the printer did not answer. The badge says
 *       "1 queued — receipt printer offline" and the drain loop keeps trying.</li>
 *   <li><b>4xx</b> — rejected, nothing persisted.</li>
 * </ul>
 *
 * <p>A ladder that cannot tell QUEUED from rejected shows the wrong message at the worst moment,
 * which is why these are distinguishable by status code and not only by a body field.
 *
 * <h2>Logging</h2>
 *
 * <p>Job ids, printer ids, outcomes, durations. <b>Never a document body.</b> A receipt carries a
 * customer's order, their tender and potentially their identity, and an agent log on a shared till
 * is not a place for any of it.
 */

/** What a delivery attempt last did, per printer. Reported on /health. */
interface PrinterHealth {
  lastAttemptAt: number | null;
  lastAttemptOk: boolean | null;
  lastError: string | null;
}

export interface AgentServer {
  server: Server;
  /** Drain one due job. Exposed so a test can drive the loop deterministically. */
  drainOnce(): Promise<boolean>;
  health(): Record<string, unknown>;
  close(): Promise<void>;
}

export interface ServerDeps {
  config: AgentConfig;
  queue: PrintQueue;
  /** Injected so tests can point every printer at a fake socket. */
  senderFor?: (printer: PrinterEntry) => Sender;
  log?: (event: Record<string, unknown>) => void;
}

export function createAgentServer(deps: ServerDeps): AgentServer {
  const { config, queue } = deps;
  const log = deps.log ?? ((event) => console.log(JSON.stringify(event)));
  const senderFor =
    deps.senderFor ?? ((printer: PrinterEntry) => selectTransport(printer, config));

  const printerHealth = new Map<string, PrinterHealth>();
  for (const printer of config.printers) {
    printerHealth.set(printer.id, { lastAttemptAt: null, lastAttemptOk: null, lastError: null });
  }

  const findPrinter = (id: string): PrinterEntry | undefined =>
    config.printers.find((p) => p.id === id);

  async function deliver(job: PrintJobRecord): Promise<{ ok: boolean; error?: string }> {
    const printer = findPrinter(job.targetPrinterId);
    if (printer === undefined) {
      return { ok: false, error: `no printer "${job.targetPrinterId}" is configured` };
    }
    const started = Date.now();
    try {
      const bytes = renderJob(job, printer);
      await senderFor(printer)(bytes);
      printerHealth.set(printer.id, { lastAttemptAt: Date.now(), lastAttemptOk: true, lastError: null });
      // Job id, printer id, outcome, duration. No document.
      log({ event: "sent", jobId: job.id, printerId: printer.id, ms: Date.now() - started });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      printerHealth.set(printer.id, {
        lastAttemptAt: Date.now(),
        lastAttemptOk: false,
        lastError: message,
      });
      log({ event: "send_failed", jobId: job.id, printerId: printer.id, ms: Date.now() - started, error: message });
      return { ok: false, error: message };
    }
  }

  async function drainOnce(): Promise<boolean> {
    const job = queue.claimNextDue();
    if (job === null) return false;
    const result = await deliver(job);
    if (result.ok) queue.markSent(job.id);
    else queue.markFailed(job.id, result.error ?? "unknown transport failure");
    return true;
  }

  const server = createServer((req, res) => {
    void handle(req, res).catch((err) => {
      log({ event: "unhandled", error: err instanceof Error ? err.message : String(err) });
      send(res, 500, { error: "INTERNAL", message: "the agent failed to handle this request" });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    applyCors(req, res, config);

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    if (!authorised(req, config)) {
      // Source address and the fact of rejection. NOT the body — an unauthenticated caller's
      // payload is exactly the thing not to write into a log on a shared till.
      log({ event: "unauthorised", from: req.socket.remoteAddress ?? "unknown", path: req.url });
      send(res, 401, { error: "UNAUTHORISED", message: "a shared secret is required" });
      return;
    }

    const url = new URL(req.url ?? "/", "http://agent.local");

    if (req.method === "GET" && url.pathname === "/health") {
      send(res, 200, healthPayload());
      return;
    }

    if (req.method === "GET" && url.pathname === "/printers") {
      // Roles and transports. No secret, and no agent configuration beyond what a UI needs.
      send(res, 200, {
        printers: config.printers.map((p) => ({
          id: p.id,
          role: p.role,
          transport: p.transport,
          stationCode: p.stationCode,
          terminalId: p.terminalId,
          widthMm: p.widthMm,
          columns: p.columns,
          columnsMeasured: p.columnsMeasured,
        })),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/queue") {
      send(res, 200, { depth: queue.depth(), deadLettered: queue.deadLettered().map(summarise) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/print") {
      await handlePrint(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/test-print") {
      await handleTestPrint(req, res);
      return;
    }

    send(res, 404, { error: "NOT_FOUND", message: `no route for ${req.method} ${url.pathname}` });
  }

  async function handlePrint(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    } catch {
      send(res, 400, { error: "MALFORMED_JSON", message: "the request body is not JSON" });
      return;
    }

    const targetPrinterId = String(body.targetPrinterId ?? "");
    const printer = findPrinter(targetPrinterId);
    if (printer === undefined) {
      // DISTINCT from a validation failure on purpose: this is a configuration gap the manager can
      // fix, not a contract break an engineer must. The cashier-facing messages differ.
      send(res, 404, {
        error: "UNKNOWN_PRINTER",
        message: `no printer "${targetPrinterId}" is configured on this agent`,
      });
      return;
    }

    // Validated BEFORE persistence, so a contract break is visible here rather than at the printer.
    try {
      parsePrintDocument(body.document);
    } catch (err) {
      if (err instanceof PrintDocumentError) {
        send(res, 422, { error: "INVALID_DOCUMENT", message: err.message, path: err.path });
        return;
      }
      throw err;
    }

    const job = queue.enqueue({
      id: randomUUID(),
      printJobId: body.printJobId === undefined || body.printJobId === null ? null : String(body.printJobId),
      targetPrinterId,
      document: body.document,
    });
    // The job is ON DISK by the time enqueue returned. Only now is a response written.

    await respondWithDelivery(res, job);
  }

  async function handleTestPrint(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = JSON.parse((await readBody(req)) || "{}") as Record<string, unknown>;
    const targetPrinterId = String(body.targetPrinterId ?? "");
    const printer = findPrinter(targetPrinterId);
    if (printer === undefined) {
      send(res, 404, {
        error: "UNKNOWN_PRINTER",
        message: `no printer "${targetPrinterId}" is configured on this agent`,
      });
      return;
    }

    const job = queue.enqueue({
      id: randomUUID(),
      printJobId: null,
      targetPrinterId,
      document: { __diagnostic: true, bytes: Buffer.from(renderTestPage(printer)).toString("base64") },
    });

    await respondWithDelivery(res, job);
  }

  async function respondWithDelivery(res: ServerResponse, job: PrintJobRecord): Promise<void> {
    const claimed = queue.claimNextDue();
    const toDeliver = claimed?.id === job.id ? claimed : job;
    const result = await deliver(toDeliver);

    if (result.ok) {
      queue.markSent(job.id);
      send(res, 200, { state: "DELIVERED", jobId: job.id, targetPrinterId: job.targetPrinterId });
      return;
    }
    queue.markFailed(job.id, result.error ?? "unknown transport failure");
    // 202: ACCEPTED and on disk, but the printer did not answer. The cashier sees "queued —
    // printer offline", not an error, and the drain loop keeps trying.
    send(res, 202, {
      state: "QUEUED",
      jobId: job.id,
      targetPrinterId: job.targetPrinterId,
      reason: result.error,
    });
  }

  function healthPayload(): Record<string, unknown> {
    return {
      version: AGENT_VERSION,
      depth: queue.depth(),
      corruptedJournalBytes: queue.corruptedJournalBytes,
      printers: config.printers.map((p) => ({
        id: p.id,
        role: p.role,
        transport: p.transport,
        ...(printerHealth.get(p.id) ?? { lastAttemptAt: null, lastAttemptOk: null, lastError: null }),
      })),
    };
  }

  return {
    server,
    drainOnce,
    health: healthPayload,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** Job id, target, attempts, error. Never the body. */
function summarise(job: PrintJobRecord): Record<string, unknown> {
  return {
    id: job.id,
    printJobId: job.printJobId,
    targetPrinterId: job.targetPrinterId,
    attempts: job.attempts,
    lastError: job.lastError,
    enqueuedAt: job.enqueuedAt,
  };
}

function profileFor(printer: PrinterEntry): PrinterProfile {
  return {
    columns: printer.columns,
    codepage: printer.codepage,
    cut: printer.cut,
    drawerPin: printer.drawerPin === 2 || printer.drawerPin === 5 ? printer.drawerPin : null,
    drawerPulseMs: printer.drawerPulseMs,
  };
}

export function renderJob(job: PrintJobRecord, printer: PrinterEntry): Uint8Array {
  const doc = job.document as Record<string, unknown>;
  if (doc?.__diagnostic === true) {
    return new Uint8Array(Buffer.from(String(doc.bytes), "base64"));
  }
  return renderReceipt(parsePrintDocument(job.document), profileFor(printer));
}

/**
 * The diagnostic page behind the configuration UI's Test Print button.
 *
 * <p>Its centrepiece is a COLUMN RULER. Research §7.5 could not establish a canonical column count
 * for any model — it depends on model, configured print width, font and codepage together, and the
 * one vendor datasheet consulted was provably wrong about its own character dimensions. So the
 * number is measured, and this is what measures it: whoever installs the printer counts where the
 * ruler stops.
 */
export function renderTestPage(printer: PrinterEntry): Uint8Array {
  const cols = printer.columns;
  const ruler: string[] = [];
  let scale = "";
  for (let i = 1; i <= cols; i++) scale += i % 10 === 0 ? String((i / 10) % 10) : ".";
  ruler.push(scale);
  ruler.push(divider(cols, "="));

  const lines = [
    "PRINT AGENT TEST PAGE",
    divider(cols),
    `printer  ${printer.id}`,
    `role     ${printer.role}`,
    `width    ${printer.widthMm}mm`,
    `columns  ${printer.columns}${printer.columnsMeasured ? " (measured)" : " (NOT MEASURED)"}`,
    `codepage ${printer.codepage}`,
    divider(cols),
    "Count the ruler below. If it does not end",
    "exactly at the column count above, correct",
    "the stored value - the layout depends on it.",
    ...ruler,
  ];

  const chunks: Uint8Array[] = [initialize()];
  for (const line of lines) {
    chunks.push(encodeText(line.slice(0, cols)));
    chunks.push(Uint8Array.from([0x0a]));
  }
  chunks.push(Uint8Array.from([0x0a, 0x0a, 0x0a]));
  chunks.push(cutCommand(printer.cut));

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Preflight, so a browser on an HTTPS POS page can reach loopback at all.
 *
 * <p>Origins are configuration and default to NONE; a wildcard is refused at config load. Chrome
 * 142's local-network-access permission is a separate gate the agent cannot influence — what it
 * can do is answer preflight correctly so the browser's decision is the only obstacle.
 */
function applyCors(req: IncomingMessage, res: ServerResponse, config: AgentConfig): void {
  const origin = req.headers.origin;
  if (typeof origin === "string" && config.allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type, x-print-agent-secret");
    res.setHeader("Access-Control-Max-Age", "600");
  }
}

function authorised(req: IncomingMessage, config: AgentConfig): boolean {
  if (config.sharedSecret === null) return true;
  if (isLoopback(config.bindAddress) && config.sharedSecret === null) return true;
  return req.headers["x-print-agent-secret"] === config.sharedSecret;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
