import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Journal } from "../src/queue/journal.js";
import { PrintQueue, type PrintJobRecord, type QueueOptions } from "../src/queue/queue.js";
import { ConfigError, loadConfig } from "../src/config.js";

/**
 * Durability, against REAL FILES in a real temporary directory.
 *
 * <p>A mocked filesystem cannot expose a durability defect — it is the filesystem's behaviour that
 * is under test. The truncated-tail case in particular is produced by writing a genuinely
 * half-finished line to a genuine file, because that is the shape a power cut leaves behind.
 */

let dir: string;
let journalPath: string;
let clock: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "print-queue-"));
  journalPath = join(dir, "queue.jsonl");
  clock = 1_000_000;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function options(overrides: Partial<QueueOptions> = {}): QueueOptions {
  return {
    maxAttempts: 5,
    baseBackoffMs: 1_000,
    maxBackoffMs: 60_000,
    retentionMs: 7 * 24 * 60 * 60 * 1000,
    now: () => clock,
    random: () => 0.5,
    ...overrides,
  };
}

function newQueue(overrides: Partial<QueueOptions> = {}): PrintQueue {
  return new PrintQueue(new Journal<PrintJobRecord>(journalPath), options(overrides));
}

function enqueueOne(queue: PrintQueue, id = "job-1"): PrintJobRecord {
  return queue.enqueue({
    id,
    printJobId: `pj-${id}`,
    targetPrinterId: "receipt-1",
    document: { schemaVersion: "1.0", type: "CUSTOMER_RECEIPT" },
  });
}

describe("the journal is durable", () => {
  // ── 1. Accepted means ON DISK ───────────────────────────────────────────────────────────────
  it("has the job on disk the instant enqueue returns", () => {
    const queue = newQueue();
    enqueueOne(queue);

    const onDisk = readFileSync(journalPath, "utf8");
    expect(onDisk).toContain('"id":"job-1"');
    expect(onDisk.endsWith("\n")).toBe(true);
  });

  // ── 2. Reconstruct pending jobs, with attempt counts ────────────────────────────────────────
  it("reconstructs exactly the pending jobs and their attempt counts after a restart", () => {
    const first = newQueue();
    enqueueOne(first, "job-a");
    enqueueOne(first, "job-b");
    enqueueOne(first, "job-c");
    first.markSent("job-a");
    first.markFailed("job-b", "printer refused");

    // A different PrintQueue over the same file — the restart.
    const restarted = newQueue();
    expect(restarted.depth()).toEqual({ QUEUED: 1, CLAIMED: 0, SENT: 1, FAILED: 1, DEAD_LETTERED: 0 });
    expect(restarted.get("job-b")?.attempts).toBe(1);
    expect(restarted.get("job-b")?.lastError).toBe("printer refused");
    expect(restarted.get("job-c")?.status).toBe("QUEUED");
  });

  it("returns a job left CLAIMED by a crash to the queue rather than stranding it", () => {
    const first = newQueue();
    enqueueOne(first);
    expect(first.claimNextDue()?.status).toBe("CLAIMED");

    // The process died holding the claim.
    const restarted = newQueue();
    expect(restarted.get("job-1")?.status).toBe("QUEUED");
    expect(restarted.claimNextDue()?.id).toBe("job-1");
  });

  // ── 7. A truncated final record ─────────────────────────────────────────────────────────────
  it("loads every complete record and discards only a truncated tail, and counts it", () => {
    const queue = newQueue();
    enqueueOne(queue, "job-a");
    enqueueOne(queue, "job-b");

    // Exactly what losing power mid-append leaves: a line with no newline and no closing brace.
    appendFileSync(journalPath, '{"id":"job-c","status":"QUE');

    const restarted = newQueue();
    expect(restarted.get("job-a")).toBeDefined();
    expect(restarted.get("job-b")).toBeDefined();
    expect(restarted.get("job-c"), "the partial record must NOT be resurrected as a real job").toBeUndefined();
    expect(
      restarted.corruptedJournalBytes,
      "the loss must be COUNTED — a till that keeps truncating its journal has a failing disk " +
        "or a dying power supply, and nobody goes looking unless something says so",
    ).toBe(Buffer.byteLength('{"id":"job-c","status":"QUE', "utf8"));
  });

  // ── 6. Atomic compaction ────────────────────────────────────────────────────────────────────
  it("compacts terminal records older than the retention window, atomically", () => {
    const queue = newQueue({ retentionMs: 1_000 });
    enqueueOne(queue, "old-sent");
    queue.markSent("old-sent");
    clock += 10_000; // well past retention
    enqueueOne(queue, "fresh");

    const dropped = queue.compact();
    expect(dropped).toBe(1);

    const restarted = newQueue({ retentionMs: 1_000 });
    expect(restarted.get("old-sent")).toBeUndefined();
    expect(restarted.get("fresh")?.status).toBe("QUEUED");
    // The swap is a rename, so no partial file is ever visible.
    expect(readFileSync(journalPath, "utf8").split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("NEVER compacts away a dead-lettered job", () => {
    const queue = newQueue({ maxAttempts: 1, retentionMs: 1 });
    enqueueOne(queue, "lost");
    queue.markFailed("lost", "printer never came back");
    expect(queue.get("lost")?.status).toBe("DEAD_LETTERED");

    clock += 1_000_000;
    queue.compact();

    // A dead-lettered job is a receipt that never printed. Compacting it away because a week
    // passed would erase the only evidence of the one outcome somebody needs to see.
    expect(queue.get("lost")?.status).toBe("DEAD_LETTERED");
    expect(newQueue({ maxAttempts: 1 }).get("lost")).toBeDefined();
  });

  it("survives a corrupt record in the MIDDLE of the file without losing the rest", () => {
    const queue = newQueue();
    enqueueOne(queue, "job-a");
    const good = readFileSync(journalPath, "utf8");
    writeFileSync(journalPath, `${good}this is not json\n${good}`);

    const restarted = newQueue();
    expect(restarted.get("job-a")).toBeDefined();
    expect(restarted.corruptedJournalBytes).toBeGreaterThan(0);
  });
});

describe("the queue's failure behaviour", () => {
  // ── 3. Backoff ──────────────────────────────────────────────────────────────────────────────
  it("increments attempts and schedules the next try with exponential backoff plus jitter", () => {
    const queue = newQueue();
    enqueueOne(queue);

    const first = queue.markFailed("job-1", "ECONNREFUSED");
    expect(first.attempts).toBe(1);
    // base 1000 * 2^0 = 1000, plus 25% jitter at random()=0.5 -> 125
    expect(first.nextAttemptAt).toBe(clock + 1_000 + 125);

    const second = queue.markFailed("job-1", "ECONNREFUSED");
    expect(second.attempts).toBe(2);
    expect(second.nextAttemptAt).toBe(clock + 2_000 + 250);

    const third = queue.markFailed("job-1", "ECONNREFUSED");
    expect(third.nextAttemptAt).toBe(clock + 4_000 + 500);
  });

  it("does not hand back a job before its backoff has elapsed", () => {
    const queue = newQueue();
    enqueueOne(queue);
    queue.markFailed("job-1", "ECONNREFUSED");

    expect(queue.claimNextDue(), "the job is not due yet").toBeNull();
    clock += 2_000;
    expect(queue.claimNextDue()?.id).toBe("job-1");
  });

  it("caps the backoff so a long outage does not schedule a retry days away", () => {
    const queue = newQueue({ maxAttempts: 50, maxBackoffMs: 10_000 });
    enqueueOne(queue);
    for (let i = 0; i < 12; i++) queue.markFailed("job-1", "still down");
    const job = queue.get("job-1")!;
    expect(job.nextAttemptAt - clock).toBeLessThanOrEqual(10_000 + 2_500);
  });

  // ── 4. Dead-lettering ───────────────────────────────────────────────────────────────────────
  it("dead-letters at the attempt limit, never attempts it again, and keeps it readable", () => {
    const queue = newQueue({ maxAttempts: 3 });
    enqueueOne(queue);

    queue.markFailed("job-1", "1");
    queue.markFailed("job-1", "2");
    const dead = queue.markFailed("job-1", "printer never came back");

    expect(dead.status).toBe("DEAD_LETTERED");
    expect(dead.attempts).toBe(3);

    // Never attempted again, however far the clock advances. A wedged printer must not be able to
    // consume the queue's whole throughput.
    clock += 10 * 365 * 24 * 60 * 60 * 1000;
    expect(queue.claimNextDue()).toBeNull();

    // But still readable, with the reason.
    expect(queue.deadLettered().map((j) => j.id)).toEqual(["job-1"]);
    expect(queue.deadLettered()[0]!.lastError).toBe("printer never came back");
  });

  it("uses the same attempt limit as the POS offline outbox", () => {
    // Both queues in this product must fail alike; outbox.ts fixes MAX_ATTEMPTS = 5.
    expect(loadConfig(null, {}).maxAttempts).toBe(5);
  });

  // ── 5. Single-flight ────────────────────────────────────────────────────────────────────────
  /**
   * The protection that actually works: a CLAIMED job is not claimable again.
   *
   * <p>The concurrent-drain test below was the only cover for this and it proved nothing —
   * `claimNextDue` is synchronous, so three drains started by `Promise.all` still run one after
   * another and the second never sees a contended queue. Verified by deleting the re-entrancy
   * guard entirely: all 19 tests still passed. This one goes red, because it exercises the state
   * transition rather than the timing.
   */
  it("will not hand back a job it has already claimed", () => {
    const queue = newQueue();
    enqueueOne(queue, "only-job");

    expect(queue.claimNextDue()?.id).toBe("only-job");
    expect(
      queue.claimNextDue(),
      "the queue handed out a job that was already claimed — the customer gets two receipts and " +
        "the drawer opens twice",
    ).toBeNull();
  });

  it("never hands the same job to two concurrent drains", async () => {
    const queue = newQueue();
    enqueueOne(queue, "only-job");

    const delivered: string[] = [];
    const drain = async (): Promise<void> => {
      const job = queue.claimNextDue();
      if (job !== null) {
        await Promise.resolve();
        delivered.push(job.id);
        queue.markSent(job.id);
      }
    };

    await Promise.all([drain(), drain(), drain()]);

    expect(
      delivered,
      "two drains delivered the same job — the customer gets two receipts and the drawer opens twice",
    ).toEqual(["only-job"]);
  });

  // ── 8. Depth without loading bodies ─────────────────────────────────────────────────────────
  it("reports depth by status", () => {
    const queue = newQueue({ maxAttempts: 1 });
    enqueueOne(queue, "a");
    enqueueOne(queue, "b");
    enqueueOne(queue, "c");
    queue.markSent("a");
    queue.markFailed("b", "gone");

    expect(queue.depth()).toEqual({ QUEUED: 1, CLAIMED: 0, SENT: 1, FAILED: 0, DEAD_LETTERED: 1 });
  });

  it("marks bytes SENT, not PRINTED — the agent cannot observe paper", () => {
    const queue = newQueue();
    enqueueOne(queue);
    const claimed = queue.claimNextDue()!;
    queue.markSent(claimed.id);

    const job = queue.get("job-1")!;
    // Port 9100 is fire-and-forget with no acknowledgement (research §5.1). A status of PRINTED
    // would be a claim about paper the agent has no way to make.
    expect(job.status).toBe("SENT");
    expect(job.sentAt).toBe(clock);
  });
});

describe("configuration refuses to start wide open", () => {
  it("defaults to loopback", () => {
    expect(loadConfig(null, {}).bindAddress).toBe("127.0.0.1");
  });

  it("refuses a non-loopback bind with no shared secret", () => {
    expect(() => loadConfig(null, { PRINT_AGENT_BIND: "0.0.0.0" })).toThrow(ConfigError);
    expect(() => loadConfig(null, { PRINT_AGENT_BIND: "0.0.0.0" })).toThrow(/not loopback/);
  });

  it("allows a non-loopback bind once a secret is set", () => {
    const config = loadConfig(null, { PRINT_AGENT_BIND: "0.0.0.0", PRINT_AGENT_SECRET: "s3cret" });
    expect(config.bindAddress).toBe("0.0.0.0");
    expect(config.sharedSecret).toBe("s3cret");
  });

  it("rejects a misconfigured printer at LOAD time, not at print time", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({ printers: [{ id: "p1", transport: "TCP", port: 9100, columns: 42 }] }),
    );
    // A customer standing at the counter is the worst possible place to discover this.
    expect(() => loadConfig(file, {})).toThrow(/printers\[0\]\.host/);

    writeFileSync(file, JSON.stringify({ printers: [{ id: "p1", transport: "BLUETOOTH", columns: 42 }] }));
    expect(() => loadConfig(file, {})).toThrow(/is not a transport this agent can drive/);
  });
});
