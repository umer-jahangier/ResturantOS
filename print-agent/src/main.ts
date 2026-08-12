import { Journal } from "./queue/journal.js";
import { PrintQueue, type PrintJobRecord } from "./queue/queue.js";
import { loadConfig } from "./config.js";
import { AGENT_VERSION, createAgentServer } from "./server.js";
import { createPollLoop, loadCloudConfig } from "./cloud/poll.js";
import { applyRegistry } from "./cloud/registry.js";
import { scanSystemPrinters, type DeviceScan } from "./devices/system-devices.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env.PRINT_AGENT_CONFIG ?? "./print-agent.config.json");
  const queue = new PrintQueue(new Journal<PrintJobRecord>(config.journalPath), {
    maxAttempts: config.maxAttempts,
    baseBackoffMs: config.baseBackoffMs,
    maxBackoffMs: config.maxBackoffMs,
    retentionMs: config.retentionMs,
  });

  // The cloud channel (26-11). Declared before the server so the drain loop can acknowledge
  // through it; `loadCloudConfig` returns nulls when nothing is configured, which disables the
  // loop entirely and leaves the agent behaving exactly as it did in 26-06.
  const cloud = loadCloudConfig();

  // Job ids, printer ids, outcomes. Never a document.
  const log = (event: Record<string, unknown>): void => console.log(JSON.stringify(event));

  /**
   * The machine's print queues, rescanned on a slow timer (S8).
   *
   * <p>Not scanned inside the poll: `lpstat` spawns a process, the poll runs every three seconds,
   * and a subprocess per three seconds on a till is a cost nobody asked for. Not scanned once at
   * startup either — a USB printer is plugged in by a human, usually after the agent was started,
   * and a list captured at boot would be a list of what was attached at breakfast.
   */
  let deviceScan: DeviceScan | null = null;
  const rescanDevices = async (): Promise<void> => {
    try {
      const scan = await scanSystemPrinters();
      deviceScan = scan;
      log({
        event: "devices_scanned",
        count: scan.devices.length,
        unavailable: scan.unavailable,
        names: scan.devices.map((d) => d.name),
      });
    } catch (error) {
      // A scan that throws must not take the agent down. It reports as "not scanned", which the
      // settings screen says out loud rather than showing an empty list.
      deviceScan = null;
      log({ event: "devices_scan_failed", error: error instanceof Error ? error.message : String(error) });
    }
  };
  await rescanDevices();
  const deviceTimer = setInterval(() => void rescanDevices(), 60_000);

  const poll = createPollLoop({
    queue,
    config: cloud,
    deviceScan: () => deviceScan,
    /**
     * The server's registry REPLACES the local one, in place, on the live config object the HTTP
     * server and the drain loop both read. Replacing rather than merging is the point: the branch
     * record is the single source of truth for what this branch prints on, and a local leftover
     * that survived a deletion would be a printer nobody can see and nobody can stop.
     *
     * <p>A locally-configured agent with no cloud credential never reaches here — `poll.ts`
     * disables itself — so a single-till shop running from a JSON file is unaffected.
     */
    onRegistry: (printers) => {
      const applied = applyRegistry(config.printers, printers);
      config.printers = applied.adopted;
      if (applied.changed || applied.rejected.length > 0) {
        log({
          event: "registry_applied",
          printers: applied.adopted.map((p) => p.id),
          rejected: applied.rejected,
        });
      }
    },
  });

  const agent = createAgentServer({
    config,
    queue,
    onSettled: (job, delivered, error) => {
      // Only jobs that CAME from the cloud are acknowledged to it. A browser-submitted job has no
      // server-side row and nothing to tell.
      if (job.printJobId === null) return;
      void poll.acknowledge(job.printJobId, delivered, error);
    },
  });

  log({
    event: "starting",
    version: AGENT_VERSION,
    bind: `${config.bindAddress}:${config.port}`,
    printers: config.printers.length,
    journal: config.journalPath,
    recoveredCorruptBytes: queue.corruptedJournalBytes,
    depth: queue.depth(),
  });

  agent.server.listen(config.port, config.bindAddress, () => {
    log({ event: "listening", bind: `${config.bindAddress}:${config.port}` });
  });

  let draining = false;
  let stopping = false;

  const tick = async (): Promise<void> => {
    if (draining || stopping) return;
    draining = true;
    try {
      // Drain until nothing is due. `claimNextDue` is the single-flight guard.
      while (await agent.drainOnce()) {
        if (stopping) break;
      }
    } finally {
      draining = false;
    }
  };

  const timer = setInterval(() => void tick(), 1_000);
  poll.start();
  log({ event: "cloud_channel", state: poll.health().state, pollIntervalMs: cloud.pollIntervalMs });

  /**
   * Finish the in-flight job before exiting.
   *
   * <p>Killing mid-delivery would leave a job CLAIMED; the queue returns those to QUEUED on the
   * next start, so nothing is lost either way — but a half-written socket is a half-printed
   * receipt, and waiting a moment avoids one.
   */
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    log({ event: "stopping", signal, depth: queue.depth() });
    clearInterval(timer);
    clearInterval(deviceTimer);
    poll.stop();
    void (async () => {
      const deadline = Date.now() + 5_000;
      while (draining && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      await agent.close();
      log({ event: "stopped" });
      process.exit(0);
    })();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

void main().catch((err: unknown) => {
  // A configuration refusal lands here. It must be loud and it must name the reason.
  console.error(JSON.stringify({ event: "failed_to_start", error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
