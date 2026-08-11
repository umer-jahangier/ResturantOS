import { Journal, type JournalRecord } from "./journal.js";

/**
 * The agent's durable print queue.
 *
 * <p>Shaped after `frontend/lib/offline/outbox.ts` — the POS offline outbox — deliberately, so the
 * two queues in this product behave the same way under a failure. Same five-attempt limit, same
 * dead-letter-rather-than-drop, same terminal state that needs an operator to clear. Its CODE is
 * not reused: that one is browser-bound and IndexedDB-backed.
 *
 * <p>Storage is {@link Journal}. See its header for why this is not SQLite.
 */

/**
 * Deliberately aligned with `PrintJobStatus` in pos-service (26-03), so the agent's state and the
 * server's state reconcile without a translation table.
 *
 * <p>`SENT` rather than `PRINTED` is the important one. Port 9100 is fire-and-forget with no
 * acknowledgement (research §5.1), so the agent knows only that it wrote bytes to a socket. It does
 * NOT know whether paper moved, and a status claiming otherwise would be the Appearance-screen lie
 * with a printer attached.
 */
export type QueuedStatus = "QUEUED" | "CLAIMED" | "SENT" | "FAILED" | "DEAD_LETTERED";

export interface PrintJobRecord extends JournalRecord {
  id: string;
  /** The pos-service `print_jobs` row this came from, when there is one. */
  printJobId: string | null;
  targetPrinterId: string;
  /** The serialised PrintDocument. NEVER logged — see the prohibition in 26-06. */
  document: unknown;
  status: QueuedStatus;
  attempts: number;
  enqueuedAt: number;
  /** Epoch ms before which this job must not be attempted again. */
  nextAttemptAt: number;
  lastError: string | null;
  /** When the agent wrote the bytes to a socket. Not "when it printed" — it cannot know that. */
  sentAt: number | null;
}

export interface QueueOptions {
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  retentionMs: number;
  /** Injected so backoff and retention are testable without waiting in real time. */
  now?: () => number;
  /** Injected so jitter is deterministic in tests. */
  random?: () => number;
}

export interface DepthByStatus {
  QUEUED: number;
  CLAIMED: number;
  SENT: number;
  FAILED: number;
  DEAD_LETTERED: number;
}

export class PrintQueue {
  private readonly jobs = new Map<string, PrintJobRecord>();
  private readonly now: () => number;
  private readonly random: () => number;
  /** Single-flight guard: two concurrent drains must not deliver one job twice. */
  private claiming = false;
  private truncatedTailBytes = 0;

  constructor(
    private readonly journal: Journal<PrintJobRecord>,
    private readonly options: QueueOptions,
  ) {
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.replay();
  }

  /**
   * Rebuild state from the journal. Records are EVENTS and the last one for an id wins, which is
   * what makes an append-only file behave like a mutable table.
   *
   * <p>A job left `CLAIMED` by a crash is returned to `QUEUED`. The alternative — leaving it
   * claimed — strands a real receipt forever behind a process that no longer exists.
   */
  private replay(): void {
    const { records, truncatedTailBytes } = this.journal.load();
    this.truncatedTailBytes = truncatedTailBytes;
    for (const record of records) {
      this.jobs.set(record.id, record);
    }
    for (const job of this.jobs.values()) {
      if (job.status === "CLAIMED") {
        job.status = "QUEUED";
        job.nextAttemptAt = 0;
      }
    }
  }

  /** Bytes the loader could not parse — surfaced on /health, never swallowed. */
  get corruptedJournalBytes(): number {
    return this.truncatedTailBytes;
  }

  /**
   * Accept a job. Returns only once the record is ON DISK.
   *
   * <p>The HTTP handler writes its response after this returns. That ordering is the contract: a
   * job the cashier was told was accepted survives the power going out immediately afterwards.
   */
  enqueue(input: {
    id: string;
    printJobId: string | null;
    targetPrinterId: string;
    document: unknown;
  }): PrintJobRecord {
    const record: PrintJobRecord = {
      id: input.id,
      printJobId: input.printJobId,
      targetPrinterId: input.targetPrinterId,
      document: input.document,
      status: "QUEUED",
      attempts: 0,
      enqueuedAt: this.now(),
      nextAttemptAt: 0,
      lastError: null,
      sentAt: null,
    };
    this.write(record);
    return record;
  }

  /**
   * Take the oldest job that is due, marking it CLAIMED in the same breath.
   *
   * <p>Synchronous and guarded, so two concurrent drains cannot both receive the same job. An
   * async gap between "choose" and "mark" is exactly where a receipt gets printed twice.
   */
  claimNextDue(): PrintJobRecord | null {
    if (this.claiming) return null;
    this.claiming = true;
    try {
      const now = this.now();
      let chosen: PrintJobRecord | null = null;
      for (const job of this.jobs.values()) {
        if (job.status !== "QUEUED" && job.status !== "FAILED") continue;
        if (job.nextAttemptAt > now) continue;
        if (chosen === null || job.enqueuedAt < chosen.enqueuedAt) chosen = job;
      }
      if (chosen === null) return null;
      const claimed: PrintJobRecord = { ...chosen, status: "CLAIMED" };
      this.write(claimed);
      return claimed;
    } finally {
      this.claiming = false;
    }
  }

  /** The bytes reached a socket. NOT "the receipt printed" — the agent cannot observe that. */
  markSent(id: string): void {
    const job = this.require(id);
    this.write({ ...job, status: "SENT", sentAt: this.now(), lastError: null });
  }

  /**
   * Delivery failed: count the attempt, schedule the next one, and dead-letter at the limit.
   *
   * <p>Exponential backoff with jitter. The jitter is not decoration — without it, every job
   * queued during an outage retries in lockstep the moment the printer returns, and the agent
   * hammers a device that has just come back.
   *
   * <p>A dead-lettered job is never attempted again and is never deleted. Deleting it would lose
   * the only record that a customer's receipt was never printed.
   */
  markFailed(id: string, error: string): PrintJobRecord {
    const job = this.require(id);
    const attempts = job.attempts + 1;
    const dead = attempts >= this.options.maxAttempts;

    const exponential = Math.min(
      this.options.baseBackoffMs * Math.pow(2, attempts - 1),
      this.options.maxBackoffMs,
    );
    const jitter = Math.floor(exponential * 0.25 * this.random());

    const updated: PrintJobRecord = {
      ...job,
      attempts,
      status: dead ? "DEAD_LETTERED" : "FAILED",
      lastError: error,
      nextAttemptAt: dead ? Number.MAX_SAFE_INTEGER : this.now() + exponential + jitter,
    };
    this.write(updated);
    return updated;
  }

  get(id: string): PrintJobRecord | undefined {
    return this.jobs.get(id);
  }

  /** Depth by status, WITHOUT touching document bodies. */
  depth(): DepthByStatus {
    const out: DepthByStatus = { QUEUED: 0, CLAIMED: 0, SENT: 0, FAILED: 0, DEAD_LETTERED: 0 };
    for (const job of this.jobs.values()) out[job.status] += 1;
    return out;
  }

  /** Dead-lettered jobs stay readable so a human can see exactly what was lost. */
  deadLettered(): PrintJobRecord[] {
    return [...this.jobs.values()].filter((j) => j.status === "DEAD_LETTERED");
  }

  /**
   * Drop terminal records older than the retention window and rewrite the journal atomically.
   *
   * <p>`SENT` only. A dead-lettered job is a receipt that never printed, and compacting it away
   * because a week passed would erase the evidence of the one outcome somebody needs to see.
   */
  compact(): number {
    const cutoff = this.now() - this.options.retentionMs;
    const keep: PrintJobRecord[] = [];
    let dropped = 0;
    for (const job of this.jobs.values()) {
      const expired = job.status === "SENT" && (job.sentAt ?? job.enqueuedAt) < cutoff;
      if (expired) {
        dropped += 1;
        this.jobs.delete(job.id);
      } else {
        keep.push(job);
      }
    }
    this.journal.compact(keep);
    return dropped;
  }

  private require(id: string): PrintJobRecord {
    const job = this.jobs.get(id);
    if (job === undefined) throw new Error(`no such print job: ${id}`);
    return job;
  }

  private write(record: PrintJobRecord): void {
    this.journal.append(record);
    this.jobs.set(record.id, record);
  }
}
