import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Journal } from "../src/queue/journal.js";
import { PrintQueue, type PrintJobRecord } from "../src/queue/queue.js";
import { createPollLoop, loadCloudConfig, type CloudConfig } from "../src/cloud/poll.js";

/**
 * The poll loop, against a fake cloud.
 *
 * <p>The property this file exists to pin is the one 26-11 exists for: a claimed job reaches the
 * SAME durable queue a browser-submitted job reaches, so the kitchen ticket does not depend on a
 * browser being open anywhere.
 */
describe("the cloud poll loop", () => {
  let dir: string;
  let queue: PrintQueue;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "poll-test-"));
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

  const CONFIG: CloudConfig = {
    baseUrl: "https://cloud.example",
    credential: "rosprt.11111111111141118111111111111111.lookup.secret",
    pollIntervalMs: 1_000,
    batchSize: 5,
    requestTimeoutMs: 1_000,
  };

  function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  const DOCUMENT = JSON.stringify({ schemaVersion: "1.0", type: "KITCHEN_TICKET" });

  function claimResponse(ids: string[]): Response {
    return json(200, {
      data: {
        jobs: ids.map((id) => ({
          printJobId: id,
          targetPrinterId: "kitchen-hot",
          documentType: "KITCHEN_TICKET",
          document: DOCUMENT,
        })),
        leaseExpiresAt: "2026-08-12T10:02:00Z",
      },
    });
  }

  // ── 1. The whole point ────────────────────────────────────────────────────────────────────

  it("ENQUEUES a claimed job onto the durable queue rather than delivering it directly", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(claimResponse(["job-1", "job-2"]));
    const loop = createPollLoop({ queue, config: CONFIG, fetchImpl: fetchImpl as never });

    expect(await loop.pollOnce()).toBe(2);

    // The assertion that matters: the jobs are ON THE QUEUE. A loop that delivered directly would
    // leave this at zero and would quietly own a second set of retry and durability semantics.
    expect(queue.depth().QUEUED).toBe(2);
    expect(queue.get("job-1")?.targetPrinterId).toBe("kitchen-hot");
    expect(loop.health().claimedTotal).toBe(2);
  });

  it("posts the credential in the header and nothing credential-shaped in the body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(claimResponse([]));
    const loop = createPollLoop({ queue, config: CONFIG, fetchImpl: fetchImpl as never });
    await loop.pollOnce();

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://cloud.example/api/v1/pos/print-agent/claim");
    expect((init.headers as Record<string, string>)["x-print-agent-key"]).toBe(CONFIG.credential);
    expect(String(init.body)).not.toContain(CONFIG.credential);
  });

  // ── 2. An empty claim is a SUCCESSFUL poll ────────────────────────────────────────────────

  it("treats an explicitly empty claim as a successful poll, not a failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(claimResponse([]));
    const loop = createPollLoop({ queue, config: CONFIG, fetchImpl: fetchImpl as never });

    expect(await loop.pollOnce()).toBe(0);
    // The server distinguishes "nothing queued" from "wired wrong" on purpose — under its forced
    // RLS those look identical — so the loop must not collapse them back into one.
    expect(loop.health().state).toBe("POLLING");
    expect(loop.health().lastError).toBeNull();
    expect(loop.health().lastPollAt).not.toBeNull();
  });

  // ── 3. Acknowledgement, and the reclaim that outranks it ──────────────────────────────────

  it("acknowledges a delivery, and a failed delivery as FAILED so both sides agree", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, { data: { applied: true, status: "PRINTED" } }))
      .mockResolvedValueOnce(json(200, { data: { applied: true, status: "QUEUED" } }));
    const loop = createPollLoop({ queue, config: CONFIG, fetchImpl: fetchImpl as never });

    expect(await loop.acknowledge("job-1", true)).toBe(true);
    expect(await loop.acknowledge("job-2", false, "printer refused the connection")).toBe(true);

    const bodies = fetchImpl.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(bodies[0]).toMatchObject({ printJobId: "job-1", result: "DELIVERED" });
    // The agent's attempt count and the server's must not diverge into two truths, so a failed
    // delivery is reported rather than swallowed.
    expect(bodies[1]).toMatchObject({ printJobId: "job-2", result: "FAILED" });
    expect(bodies[1].error).toContain("printer refused");
  });

  it("accepts a rejected acknowledgement as information — the server's reclaim outranks it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { data: { applied: false, status: "QUEUED" } }));
    const loop = createPollLoop({ queue, config: CONFIG, fetchImpl: fetchImpl as never });

    expect(await loop.acknowledge("job-1", true)).toBe(false);
    // Exactly one call. Retrying would be arguing with a server that has already handed the job to
    // another agent — and would risk marking PRINTED something that agent is mid-way through.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // ── 4. A cloud outage does not touch the loopback path ────────────────────────────────────

  it("survives a cloud outage, reports it on health, and leaves the queue usable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const loop = createPollLoop({ queue, config: CONFIG, fetchImpl: fetchImpl as never });

    await expect(loop.pollOnce()).resolves.toBe(0);
    expect(loop.health().state).toBe("UNREACHABLE");
    expect(loop.health().lastError).toContain("ECONNREFUSED");

    // The loopback path is a different path. A browser can still submit and the queue still works.
    queue.enqueue({ id: "browser-1", printJobId: null, targetPrinterId: "receipt-1", document: {} });
    expect(queue.depth().QUEUED).toBe(1);
  });

  // ── 5. A revoked credential stops the loop rather than hammering ──────────────────────────

  it("STOPS on a revoked credential, logs once, and reports REVOKED on health", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(401, {}));
    const logged: string[] = [];
    const cleared = vi.fn();
    const loop = createPollLoop({
      queue,
      config: CONFIG,
      fetchImpl: fetchImpl as never,
      log: (m) => logged.push(m),
      setIntervalImpl: (() => 1 as unknown as ReturnType<typeof setInterval>) as never,
      clearIntervalImpl: cleared as never,
    });
    loop.start();

    await loop.pollOnce();
    expect(loop.health().state).toBe("REVOKED");
    expect(cleared).toHaveBeenCalled();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("Re-enrol");
    expect(logged[0]).not.toContain(CONFIG.credential);

    // Further polls do nothing — no tight retry loop against an endpoint saying no.
    const before = fetchImpl.mock.calls.length;
    await loop.pollOnce();
    await loop.pollOnce();
    expect(fetchImpl.mock.calls.length).toBe(before);
    expect(logged).toHaveLength(1);
  });

  // ── 6. No cloud configured means no loop at all ───────────────────────────────────────────

  it("does not start, and does not poll, with no cloud URL configured", async () => {
    const fetchImpl = vi.fn();
    const setIntervalImpl = vi.fn();
    const loop = createPollLoop({
      queue,
      config: { ...CONFIG, baseUrl: null },
      fetchImpl: fetchImpl as never,
      setIntervalImpl: setIntervalImpl as never,
    });

    loop.start();
    expect(setIntervalImpl).not.toHaveBeenCalled();
    expect(await loop.pollOnce()).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    // The agent behaves exactly as it did in 26-06 — a supported deployment, not a broken one.
    expect(loop.health().state).toBe("DISABLED");
  });

  it("is disabled when a URL is present but no credential is", async () => {
    const fetchImpl = vi.fn();
    const loop = createPollLoop({
      queue,
      config: { ...CONFIG, credential: null },
      fetchImpl: fetchImpl as never,
    });
    expect(await loop.pollOnce()).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(loop.health().state).toBe("DISABLED");
  });

  // ── Config ────────────────────────────────────────────────────────────────────────────────

  it("reads the cloud configuration from the environment and disables cleanly when absent", () => {
    expect(loadCloudConfig({}).baseUrl).toBeNull();
    expect(loadCloudConfig({}).credential).toBeNull();

    const configured = loadCloudConfig({
      PRINT_AGENT_CLOUD_URL: "https://cloud.example/",
      PRINT_AGENT_CREDENTIAL: "rosprt.a.b.c",
      PRINT_AGENT_POLL_MS: "1500",
    });
    // The trailing slash is stripped, or every request path would carry a double slash — which
    // would not match the gateway's EXACT-equality agent-path check and would 401.
    expect(configured.baseUrl).toBe("https://cloud.example");
    expect(configured.pollIntervalMs).toBe(1500);
  });

  it("does not run two polls concurrently", async () => {
    let resolveFirst: (r: Response) => void = () => {};
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Response>((r) => (resolveFirst = r)))
      .mockResolvedValue(claimResponse([]));
    const loop = createPollLoop({ queue, config: CONFIG, fetchImpl: fetchImpl as never });

    const first = loop.pollOnce();
    // A second poll while the first is in flight must not issue a second claim — otherwise a slow
    // network turns one lease into several and multiplies the double-print window.
    expect(await loop.pollOnce()).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    resolveFirst(claimResponse(["job-1"]));
    expect(await first).toBe(1);
  });
});
