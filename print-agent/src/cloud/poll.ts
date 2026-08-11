import type { PrintQueue, PrintJobRecord } from "../queue/queue.js";

/**
 * The outbound poll loop — the thing that makes a cloud-hosted RestaurantOS able to print at all.
 *
 * <h2>Why this exists rather than the cloud pushing</h2>
 *
 * RestaurantOS runs in a datacentre; the printers sit on the restaurant's LAN behind NAT. There is
 * no route from the cloud to port 9100 and there never will be — a topology fact, not a firewall
 * rule (26-CONTEXT, D-26-06). Everything that reaches a printer must be initiated from INSIDE the
 * restaurant. So the agent goes and gets its work.
 *
 * <h2>It enqueues; it never delivers</h2>
 *
 * A claimed job goes onto the SAME durable queue a browser-submitted job goes onto, and the same
 * drain loop delivers both. That is deliberate: durability, retry, backoff, dead-lettering and the
 * health surface are then shared, and a bug fixed in one path cannot leave the other broken. A
 * second delivery path is a second set of failure modes nobody is watching.
 *
 * <h2>The double-print window, and which side wins</h2>
 *
 * If a delivery outlasts the server's lease, the server may hand the job to another agent. The
 * SERVER'S RECLAIM IS AUTHORITATIVE and a late acknowledgement is a no-op there — this loop
 * therefore treats a rejected acknowledgement as information, not as an error, and does not retry
 * it. The residual window is real and is documented in the README: an agent wedged for longer than
 * the lease, which then completes, prints a ticket a second agent already printed. A duplicated
 * kitchen ticket is a wasted plate; pretending the window does not exist would be worse.
 *
 * <h2>A cloud outage must not touch the loopback path</h2>
 *
 * Every failure here is caught and reported on the health surface. Nothing in this file can throw
 * into the agent's HTTP server, because a browser submitting a bill to `127.0.0.1:7654` is on a
 * LAN-local path that has nothing to do with the WAN being up.
 */

export interface CloudConfig {
  /** e.g. `https://api.restaurantos.example`. Null disables the loop entirely. */
  baseUrl: string | null;
  /** The `rosprt.…` credential from enrolment. Null disables the loop entirely. */
  credential: string | null;
  pollIntervalMs: number;
  /** How many jobs to ask for per poll. The server clamps this. */
  batchSize: number;
  requestTimeoutMs: number;
}

export const CLOUD_DEFAULTS = {
  /**
   * Three seconds. Slow enough that four agents on one branch are 80 requests a minute rather than
   * a load problem; fast enough that a chef is not waiting. A job enqueued during a poll gap is
   * picked up on the next poll — never lost, because the job is a durable row on the server until
   * it is acknowledged.
   */
  pollIntervalMs: 3_000,
  batchSize: 5,
  requestTimeoutMs: 10_000,
} as const;

/** Why the loop is not running, when it is not. */
export type CloudState = "DISABLED" | "POLLING" | "UNREACHABLE" | "REVOKED";

export interface CloudChannelHealth {
  state: CloudState;
  lastPollAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  claimedTotal: number;
}

export interface ClaimedJob {
  printJobId: string;
  targetPrinterId: string;
  documentType: string;
  /** The serialised PrintDocument, as a JSON string. */
  document: string;
}

export interface PollLoop {
  /** One poll. Exposed so tests drive it deterministically instead of waiting on a timer. */
  pollOnce(): Promise<number>;
  acknowledge(printJobId: string, delivered: boolean, error?: string): Promise<boolean>;
  start(): void;
  stop(): void;
  health(): CloudChannelHealth;
}

export interface PollLoopDeps {
  queue: PrintQueue;
  config: CloudConfig;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Injected so tests do not depend on real timers. */
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
  log?: (message: string) => void;
}

export function createPollLoop(deps: PollLoopDeps): PollLoop {
  const { queue, config } = deps;
  const doFetch = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const setIntervalFn = deps.setIntervalImpl ?? setInterval;
  const clearIntervalFn = deps.clearIntervalImpl ?? clearInterval;
  const log = deps.log ?? ((m: string) => console.log(m));

  const enabled = config.baseUrl !== null && config.credential !== null;

  let state: CloudState = enabled ? "POLLING" : "DISABLED";
  let lastPollAt: number | null = null;
  let lastErrorAt: number | null = null;
  let lastError: string | null = null;
  let claimedTotal = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  /** Logged ONCE on revocation. A revoked agent must not fill a restaurant's disk with a loop. */
  let revocationLogged = false;

  function headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      // NEVER logged. The credential appears here and nowhere else in this file.
      "x-print-agent-key": config.credential ?? "",
    };
  }

  async function post(path: string, body: unknown): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      return await doFetch(`${config.baseUrl}${path}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function pollOnce(): Promise<number> {
    if (!enabled || state === "REVOKED") return 0;
    if (inFlight) return 0;
    inFlight = true;
    try {
      const response = await post("/api/v1/pos/print-agent/claim", { max: config.batchSize });

      if (response.status === 401 || response.status === 403) {
        // Revoked, or the credential was rotated. STOP — do not retry in a tight loop against an
        // endpoint that is telling us no.
        state = "REVOKED";
        lastErrorAt = now();
        lastError = `credential rejected (HTTP ${response.status})`;
        if (!revocationLogged) {
          revocationLogged = true;
          log(
            "print agent credential was rejected by the cloud; the poll loop has STOPPED. " +
              "Re-enrol from the printing settings screen. Loopback printing is unaffected.",
          );
        }
        stop();
        return 0;
      }

      if (!response.ok) {
        state = "UNREACHABLE";
        lastErrorAt = now();
        lastError = `claim failed with HTTP ${response.status}`;
        return 0;
      }

      const payload = (await response.json()) as { data?: { jobs?: ClaimedJob[] } };
      // An explicitly empty list is a SUCCESSFUL poll, not a failure. The server draws that
      // distinction on purpose (its forced-RLS zero-rows trap makes "nothing queued" and "wired
      // wrong" otherwise identical), so this loop must not collapse it back into one.
      const jobs = payload.data?.jobs ?? [];

      state = "POLLING";
      lastPollAt = now();

      for (const job of jobs) {
        // ENQUEUE. Not deliver — see the header. The drain loop that already exists takes it from
        // here, with the same durability and retry a browser-submitted job gets.
        queue.enqueue({
          id: job.printJobId,
          printJobId: job.printJobId,
          targetPrinterId: job.targetPrinterId,
          document: JSON.parse(job.document) as unknown,
        });
        claimedTotal += 1;
      }
      return jobs.length;
    } catch (error) {
      // A cloud outage. The loopback path is untouched by design: nothing in this function is
      // reachable from the agent's HTTP server.
      state = "UNREACHABLE";
      lastErrorAt = now();
      lastError = error instanceof Error ? error.message : String(error);
      return 0;
    } finally {
      inFlight = false;
    }
  }

  async function acknowledge(printJobId: string, delivered: boolean, error?: string): Promise<boolean> {
    if (!enabled || state === "REVOKED") return false;
    try {
      const response = await post("/api/v1/pos/print-agent/ack", {
        printJobId,
        result: delivered ? "DELIVERED" : "FAILED",
        error: error ?? null,
      });
      if (!response.ok) {
        lastErrorAt = now();
        lastError = `ack failed with HTTP ${response.status}`;
        return false;
      }
      const payload = (await response.json()) as { data?: { applied?: boolean } };
      // `applied: false` means the lease had expired and the server already reclaimed the job.
      // That is INFORMATION, not an error: the server's reclaim is authoritative and retrying the
      // acknowledgement would be arguing with it.
      return payload.data?.applied === true;
    } catch (e) {
      lastErrorAt = now();
      lastError = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  function start(): void {
    if (!enabled) {
      // No cloud configured: the agent behaves exactly as it did in 26-06. Not an error, and not
      // a warning either — a single-till shop with a browser bill is a supported deployment.
      return;
    }
    if (timer !== null) return;
    timer = setIntervalFn(() => {
      void pollOnce();
    }, config.pollIntervalMs);
  }

  function stop(): void {
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
  }

  function health(): CloudChannelHealth {
    return { state, lastPollAt, lastErrorAt, lastError, claimedTotal };
  }

  return { pollOnce, acknowledge, start, stop, health };
}

/** Read the cloud half of the agent's configuration. Absent values disable the loop. */
export function loadCloudConfig(env: NodeJS.ProcessEnv = process.env): CloudConfig {
  const baseUrl = env.PRINT_AGENT_CLOUD_URL?.trim();
  const credential = env.PRINT_AGENT_CREDENTIAL?.trim();
  return {
    baseUrl: baseUrl ? baseUrl.replace(/\/+$/, "") : null,
    credential: credential ? credential : null,
    pollIntervalMs: intOr(env.PRINT_AGENT_POLL_MS, CLOUD_DEFAULTS.pollIntervalMs),
    batchSize: intOr(env.PRINT_AGENT_BATCH, CLOUD_DEFAULTS.batchSize),
    requestTimeoutMs: intOr(env.PRINT_AGENT_CLOUD_TIMEOUT_MS, CLOUD_DEFAULTS.requestTimeoutMs),
  };
}

function intOr(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Re-exported for the drain loop, which acknowledges a record after its delivery resolves. */
export type { PrintJobRecord };
