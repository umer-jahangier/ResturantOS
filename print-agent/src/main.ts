import { Journal } from "./queue/journal.js";
import { PrintQueue, type PrintJobRecord } from "./queue/queue.js";
import { loadConfig } from "./config.js";
import { AGENT_VERSION, createAgentServer } from "./server.js";
import { createPollLoop, loadCloudConfig } from "./cloud/poll.js";
import { applyRegistry } from "./cloud/registry.js";

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

  const poll = createPollLoop({
    queue,
    config: cloud,
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
