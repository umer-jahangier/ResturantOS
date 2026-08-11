import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

/**
 * An append-only, line-delimited journal. The queue's durability lives here and nowhere else.
 *
 * <h2>Why NOT SQLite — do not "simplify" this back</h2>
 *
 * Two options were considered and both rejected on grounds that have nothing to do with taste:
 *
 * <ul>
 *   <li><b>`better-sqlite3`</b> needs a NATIVE BUILD on every machine it installs on. A print agent
 *       that fails to install on a Windows till because there is no C++ toolchain has failed before
 *       it started, and the person hitting it is a restaurant manager, not an engineer.</li>
 *   <li><b>`node:sqlite`</b> is still an EXPERIMENTAL API. A print queue holding a customer's
 *       unprinted receipt is not the place to discover what changed between Node releases.</li>
 * </ul>
 *
 * An append-only journal has no dependency at all, is durable with one `fsync`, and — the part
 * that matters at two in the morning — a support engineer can read it in a text editor.
 *
 * <h2>What "accepted" means</h2>
 *
 * {@link Journal.append} does not return until the bytes are on the platter. That is the whole
 * contract: the HTTP response for an accepted job is written AFTER this returns, so a job the
 * cashier was told was accepted is a job that survives the power going out one millisecond later.
 * Accepting and then losing is the print-queue form of the empty-state-on-failure defect — the
 * product says it worked and no paper appears.
 */

/** One line of the journal. Records are events, not rows: the latest one for an id wins. */
export interface JournalRecord {
  id: string;
  [key: string]: unknown;
}

export interface LoadResult<T extends JournalRecord> {
  records: T[];
  /**
   * How many trailing bytes could not be parsed as a complete record — the shape a power cut
   * produces. Surfaced on the health endpoint rather than swallowed, because a till that keeps
   * truncating its journal is a till with a failing disk or a dying power supply, and nobody will
   * go looking for that unless something says it.
   */
  truncatedTailBytes: number;
}

export class Journal<T extends JournalRecord> {
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }

  get filePath(): string {
    return this.path;
  }

  /**
   * Append one record and FORCE IT TO STORAGE before returning.
   *
   * <p>`fsyncSync` is the line that makes this a durable queue rather than a hopeful one. Without
   * it the write sits in the page cache and a power cut loses it while the caller has already been
   * told the job was accepted. It is synchronous on purpose: an async flush would let the HTTP
   * handler resolve first, which is precisely the ordering being prevented.
   */
  append(record: T): void {
    const line = `${JSON.stringify(record)}\n`;
    const fd = openSync(this.path, "a");
    try {
      writeSync(fd, line);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  /**
   * Read every COMPLETE record, discarding a partial final line.
   *
   * <p>A journal whose last line is half-written is the normal result of losing power mid-append.
   * Every record before it is intact and must be recovered; the partial one is reported, not
   * guessed at. Refusing to load at all would turn one lost job into a whole queue nobody can read.
   */
  load(): LoadResult<T> {
    if (!existsSync(this.path)) {
      return { records: [], truncatedTailBytes: 0 };
    }
    const raw = readFileSync(this.path, "utf8");
    if (raw.length === 0) {
      return { records: [], truncatedTailBytes: 0 };
    }

    const lastNewline = raw.lastIndexOf("\n");
    const complete = lastNewline === -1 ? "" : raw.slice(0, lastNewline);
    const tail = raw.slice(lastNewline + 1);

    const records: T[] = [];
    let corruptBytes = Buffer.byteLength(tail, "utf8");

    for (const line of complete.split("\n")) {
      if (line.length === 0) continue;
      try {
        records.push(JSON.parse(line) as T);
      } catch {
        // A complete LINE that is not valid JSON is corruption in the middle of the file, not a
        // truncated tail. Counted the same way and skipped: one unreadable record must not take
        // the rest of the queue with it.
        corruptBytes += Buffer.byteLength(line, "utf8");
      }
    }

    return { records, truncatedTailBytes: corruptBytes };
  }

  /**
   * Rewrite the journal with `records` and swap it in ATOMICALLY.
   *
   * <p>Write a sibling file, fsync it, then `rename` over the original. POSIX rename within a
   * directory is atomic, so a crash at any instant leaves either the whole old journal or the
   * whole new one — never a half-written file. Truncating in place and rewriting would have a
   * window in which the queue is a fragment of itself, and that window is exactly when a till loses
   * power because someone kicked the plug.
   */
  compact(records: T[]): void {
    const temporary = `${this.path}.compact`;
    const fd = openSync(temporary, "w");
    try {
      for (const record of records) {
        writeSync(fd, `${JSON.stringify(record)}\n`);
      }
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, this.path);
  }

  /** Remove the journal entirely. Test-support and factory-reset only. */
  destroy(): void {
    if (existsSync(this.path)) unlinkSync(this.path);
  }
}
