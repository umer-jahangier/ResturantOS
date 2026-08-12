import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Journal } from "../src/queue/journal.js";
import { PrintQueue, type PrintJobRecord } from "../src/queue/queue.js";
import { createPollLoop, type CloudConfig } from "../src/cloud/poll.js";
import type { DeviceScan } from "../src/devices/system-devices.js";

/**
 * The queues the machine has, reported UP on the poll (S8).
 *
 * <p>This is the wire half of the fix. The settings screen can only offer a printer BY NAME if the
 * name reaches the server, and the only channel from a restaurant LAN to the cloud is this poll —
 * there is no route inward (26-CONTEXT, D-26-06).
 */
describe("the poll reports the machine's print queues", () => {
  let dir: string;
  let queue: PrintQueue;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "poll-devices-"));
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

  const EMPTY_CLAIM = () =>
    new Response(JSON.stringify({ data: { jobs: [], printers: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const SCAN: DeviceScan = {
    devices: [
      { name: "STMicroelectronics_POS80_Printer_USB", description: "POS80", state: "IDLE", isDefault: true },
      { name: "_80Series2", description: null, state: "STOPPED", isDefault: false },
    ],
    unavailable: null,
    scannedAt: 1,
  };

  function bodyOf(fetchImpl: ReturnType<typeof vi.fn>): Record<string, unknown> {
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    return JSON.parse(String(init.body)) as Record<string, unknown>;
  }

  it("sends every discovered queue name on the claim", async () => {
    const fetchImpl = vi.fn(async () => EMPTY_CLAIM());
    const loop = createPollLoop({
      queue,
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      deviceScan: () => SCAN,
    });

    await loop.pollOnce();

    const body = bodyOf(fetchImpl);
    expect(body.devices).toEqual([
      { name: "STMicroelectronics_POS80_Printer_USB", description: "POS80", state: "IDLE", isDefault: true },
      { name: "_80Series2", description: null, state: "STOPPED", isDefault: false },
    ]);
    // Explicitly null — the scan RAN and found no reason to complain. Distinct from the field
    // being absent, which is what "this agent has not looked yet" sends.
    expect(body.devicesUnavailable).toBeNull();
  });

  it("sends the REASON when the machine could not be scanned, and an empty list", async () => {
    const fetchImpl = vi.fn(async () => EMPTY_CLAIM());
    const loop = createPollLoop({
      queue,
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      deviceScan: () => ({ devices: [], unavailable: "no CUPS on this machine", scannedAt: 1 }),
    });

    await loop.pollOnce();

    const body = bodyOf(fetchImpl);
    // Both fields travel: an empty list ALONE would tell the server "this machine has no printers",
    // which is a different and wrong sentence for a machine nobody could ask.
    expect(body.devices).toEqual([]);
    expect(body.devicesUnavailable).toBe("no CUPS on this machine");
  });

  it("says NOTHING about devices when no scan has completed", async () => {
    const fetchImpl = vi.fn(async () => EMPTY_CLAIM());
    const loop = createPollLoop({
      queue,
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      deviceScan: () => null,
    });

    await loop.pollOnce();

    const body = bodyOf(fetchImpl);
    // Silence, not an empty list. The server leaves the stored list alone, so an agent restarting
    // does not blank the printer picker for the seconds before its first scan lands.
    expect("devices" in body).toBe(false);
    expect(body.max).toBe(5);
  });

  it("polls exactly as before when the agent has no scanner wired in at all", async () => {
    const fetchImpl = vi.fn(async () => EMPTY_CLAIM());
    const loop = createPollLoop({
      queue,
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await loop.pollOnce();

    expect(bodyOf(fetchImpl)).toEqual({ max: 5 });
  });
});
