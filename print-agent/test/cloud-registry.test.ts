import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Journal } from "../src/queue/journal.js";
import { PrintQueue, type PrintJobRecord } from "../src/queue/queue.js";
import { createPollLoop, type CloudConfig, type RegistryPrinter } from "../src/cloud/poll.js";
import { applyRegistry } from "../src/cloud/registry.js";
import { DEFAULTS, type AgentConfig } from "../src/config.js";
import { createAgentServer } from "../src/server.js";
import { FakePrinter } from "./fake-printer.js";
import { emulate } from "./escpos-emulator.js";

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

/**
 * The seam this repair opened: a printer configured in the PRODUCT reaches the agent, and a job
 * addressed to it prints.
 *
 * <h2>Why this file exists at all</h2>
 *
 * <p>Every part of the print path was already built and already tested — the renderer, the queue,
 * the transports, the claim loop, the enrolment credential, the branch registry endpoint and its
 * settings model. What was missing was the ONE edge between the registry and the agent. A job
 * carries a `targetPrinterId`; the agent resolved that id against a JSON file on the till and
 * against nothing else. So a manager could add a printer in the product, save it, reload it, watch
 * it persist — and the agent would answer `no printer "…" is configured` for every job addressed to
 * it, for ever.
 *
 * <p><b>The negative control for this file is the first test below.</b> With `onRegistry` removed
 * from `poll.ts`, or with `applyRegistry` returning the current list unchanged, the delivery
 * assertion fails with exactly that message. Watched fail before the fix went in.
 */
describe("the branch registry reaching the agent", () => {
  let dir: string;
  let queue: PrintQueue;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "registry-test-"));
    queue = new PrintQueue(new Journal<PrintJobRecord>(join(dir, "journal.ndjson")), {
      maxAttempts: 5,
      baseBackoffMs: 1_000,
      maxBackoffMs: 60_000,
      retentionMs: 60_000,
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const CLOUD: CloudConfig = {
    baseUrl: "https://cloud.example",
    credential: "rosprt.11111111111141118111111111111111.lookup.secret",
    pollIntervalMs: 1_000,
    batchSize: 5,
    requestTimeoutMs: 1_000,
  };

  // The checked-in golden document, not a hand-written one: this test is about the seam between
  // the registry and the transport, and a bespoke document would be asserting the parser instead.
  const RECEIPT_DOCUMENT: Record<string, unknown> = {
    ...(JSON.parse(readFileSync(locateFixture(), "utf8")) as Record<string, unknown>),
    fiscal: null,
  };

  function emptyConfig(printers: AgentConfig["printers"]): AgentConfig {
    return {
      bindAddress: "127.0.0.1",
      port: 0,
      sharedSecret: null,
      journalPath: join(dir, "journal.ndjson"),
      maxAttempts: DEFAULTS.maxAttempts,
      retentionMs: DEFAULTS.retentionMs,
      baseBackoffMs: DEFAULTS.baseBackoffMs,
      maxBackoffMs: DEFAULTS.maxBackoffMs,
      connectTimeoutMs: 1_000,
      writeTimeoutMs: 2_000,
      allowedOrigins: [],
      printers,
    };
  }

  it("delivers a claimed job to a printer the agent learned from the server, never from a local file", async () => {
    const printer = new FakePrinter("accept");
    const port = await printer.listen();

    // The agent starts knowing NOTHING. This is the honest starting state for an agent enrolled
    // one minute ago on a machine whose config file has an empty printers array.
    const config = emptyConfig([]);
    const agent = createAgentServer({ config, queue });

    const registry: RegistryPrinter[] = [
      {
        id: "receipt-front",
        role: "RECEIPT",
        stationCode: null,
        transport: "TCP",
        host: "127.0.0.1",
        port,
        systemPrinterName: null,
        widthMm: 80,
        columns: 42,
        columnsMeasured: false,
        codepage: "CP437",
        cut: "PARTIAL",
        drawerPin: null,
        drawerPulseMs: null,
      },
    ];

    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith("/claim")) {
        return new Response(
          JSON.stringify({
            data: {
              jobs: [
                {
                  printJobId: "44444444-4444-4444-8444-444444444444",
                  targetPrinterId: "receipt-front",
                  documentType: "CUSTOMER_RECEIPT",
                  document: JSON.stringify(RECEIPT_DOCUMENT),
                },
              ],
              leaseExpiresAt: "2026-08-12T10:02:00Z",
              printers: registry,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: { applied: true } }), { status: 200 });
    }) as unknown as typeof fetch;

    const poll = createPollLoop({
      queue,
      config: CLOUD,
      fetchImpl,
      onRegistry: (printers) => {
        config.printers = applyRegistry(config.printers, printers).adopted;
      },
    });

    expect(config.printers).toHaveLength(0);
    await poll.pollOnce();
    // The registry arrived with the work, so the agent now knows what the job's id means.
    expect(config.printers.map((p) => p.id)).toEqual(["receipt-front"]);

    expect(await agent.drainOnce()).toBe(true);

    // Asserted on what the SOCKET received, not on what the renderer returned — a renderer bug and
    // a transport bug must not be able to cancel each other out.
    const decoded = emulate(printer.received());
    const text = decoded.lines.map((l) => l.text).join("\n");
    expect(text).toContain(String(RECEIPT_DOCUMENT.orderNo));
    // SENT, not merely accepted. The queue's own counters are the durable record.
    expect(queue.depth()).toMatchObject({ QUEUED: 0, SENT: 1 });
    await printer.close();
    await agent.close();
  });

  it("REPLACES the local list, so a printer deleted in the product stops accepting jobs", () => {
    const stale = applyRegistry(
      [
        {
          id: "decommissioned",
          terminalId: null,
          role: "RECEIPT",
          stationCode: null,
          transport: "TCP",
          host: "10.0.0.9",
          port: 9100,
          systemPrinterName: null,
          widthMm: 80,
          columns: 42,
          columnsMeasured: true,
          codepage: "CP437",
          cut: "PARTIAL",
          drawerPin: null,
          drawerPulseMs: null,
        },
      ],
      [],
    );
    // Not a merge. A printer removed from the branch record is a printer this agent must stop
    // being able to address, or "I deleted it" and "it stopped printing" are different facts.
    expect(stale.adopted).toEqual([]);
    expect(stale.changed).toBe(true);
  });

  it("never infers columnsMeasured, and drops an entry whose transport has no address", () => {
    const applied = applyRegistry([], [
      {
        id: "kitchen-hot",
        role: "KITCHEN",
        stationCode: "DEFAULT",
        transport: "TCP",
        host: "10.0.0.5",
        port: 9100,
        systemPrinterName: null,
        widthMm: 80,
        columns: 48,
        columnsMeasured: false,
        codepage: "CP437",
        cut: "FULL",
        drawerPin: null,
        drawerPulseMs: null,
      },
      // TCP with no host: a half-finished entry. Dropped, not adopted — and critically, the
      // sibling above is still adopted, because one bad row must not stop a kitchen printing.
      {
        id: "half-configured",
        role: "KITCHEN",
        stationCode: "BAR",
        transport: "TCP",
        host: null,
        port: null,
        systemPrinterName: null,
        widthMm: 80,
        columns: 42,
        columnsMeasured: false,
        codepage: "CP437",
        cut: "PARTIAL",
        drawerPin: null,
        drawerPulseMs: null,
      },
    ]);

    expect(applied.adopted.map((p) => p.id)).toEqual(["kitchen-hot"]);
    expect(applied.rejected).toEqual(["half-configured"]);
    // The whole point of the flag: it came across false and it stays false.
    expect(applied.adopted[0]?.columnsMeasured).toBe(false);
  });

  it("leaves the registry alone when the server does not send one", async () => {
    const config = emptyConfig([]);
    let applications = 0;
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { jobs: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    const poll = createPollLoop({
      queue,
      config: CLOUD,
      fetchImpl,
      onRegistry: () => {
        applications += 1;
      },
    });
    await poll.pollOnce();
    // An older server that does not know about the field must not be read as "you have no
    // printers" — that would take a restaurant's printing out on a deploy.
    expect(applications).toBe(0);
    expect(config.printers).toHaveLength(0);
  });
});
