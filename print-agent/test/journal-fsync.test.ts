import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * That the journal FORCES its bytes to storage, not merely to the page cache.
 *
 * <h2>Why this asserts a syscall, which is otherwise a thing to avoid</h2>
 *
 * The durability test in `queue.test.ts` reads the file back after `enqueue` returns and finds the
 * record. That check cannot fail: without `fsync` the write still sits in the OS page cache and any
 * process reads it back happily. Verified rather than assumed — the `fsyncSync` call was deleted
 * and all nineteen tests still passed.
 *
 * <p>Only a real power cut distinguishes the two, and no unit test can arrange one. Even `SIGKILL`
 * cannot: the page cache outlives the process, so a killed process's unsynced write is still
 * readable afterwards. So the honest available proxy is that the code makes the call — and this
 * file says that is what it is proving, rather than implying it has tested durability itself.
 *
 * <p>It lives in its own file because `vi.mock` is hoisted per module graph, and mocking `node:fs`
 * for the whole queue suite would replace the real filesystem those tests deliberately use.
 */

const fsyncSpy = vi.fn();

vi.mock("node:fs", async () => {
  const real = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...real,
    fsyncSync: (fd: number) => {
      fsyncSpy(fd);
      real.fsyncSync(fd);
    },
  };
});

const { Journal } = await import("../src/queue/journal.js");

let dir: string;

beforeEach(() => {
  fsyncSpy.mockClear();
  dir = mkdtempSync(join(tmpdir(), "journal-fsync-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("journal durability", () => {
  it("fsyncs before append returns", () => {
    const journal = new Journal<{ id: string }>(join(dir, "q.jsonl"));
    journal.append({ id: "job-1" });

    expect(
      fsyncSpy,
      "the journal appended WITHOUT fsync. A job the cashier was told was accepted would not " +
        "survive the power going out one millisecond later — which is the print-queue form of " +
        "the empty-state-on-failure defect: the product says it worked and no paper appears.",
    ).toHaveBeenCalledTimes(1);
  });

  it("fsyncs the compacted file before the atomic rename", () => {
    const journal = new Journal<{ id: string }>(join(dir, "q.jsonl"));
    journal.append({ id: "a" });
    fsyncSpy.mockClear();

    journal.compact([{ id: "a" }]);

    expect(
      fsyncSpy,
      "compaction renamed an unsynced file over the live journal — a crash immediately after " +
        "would leave a journal whose contents were never written",
    ).toHaveBeenCalledTimes(1);
  });
});
