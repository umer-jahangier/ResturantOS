---
phase: 26
plan: "06"
subsystem: print-agent
status: partial
tags: [print-agent, queue, durability, journal, config]
requires:
  - 26-04 (the renderer and the emulator the transports will assert against)
provides:
  - "`Journal` — an append-only, fsync-durable, atomically-compacted record file"
  - "`PrintQueue` — enqueue, claim, backoff, dead-letter, depth-by-status"
  - "`loadConfig` — loopback by default, refuses a wide-open bind, validates printers at load"
  - "`sendOverTcp9100` / `sendToSystemPrinter` / `selectTransport` — the wire, with every failure reported as one"
  - "`FakePrinter` — a TCP printer that can refuse, stall and close mid-stream"
affects:
  - print-agent (new src/config.ts, src/queue/*)
tech-stack:
  added: []
  patterns: [append-only-journal, fsync-before-accept, atomic-rename-compaction, dead-letter-never-delete]
key-files:
  created:
    - print-agent/src/config.ts
    - print-agent/src/queue/journal.ts
    - print-agent/src/queue/queue.ts
    - print-agent/test/queue.test.ts
    - print-agent/test/journal-fsync.test.ts
  modified:
    - print-agent/README.md
decisions:
  - "An append-only journal, not SQLite — recorded in the file header AND the README"
  - "Terminal success is SENT, never PRINTED: port 9100 has no acknowledgement"
  - "Dead-lettered jobs are never compacted away"
  - "Loopback by default; a non-loopback bind with no shared secret refuses to start"
  - "Printer misconfiguration is rejected at config load, not at print time"
metrics:
  duration: ~40m
  completed: 2026-08-11
commits:
  - c5ea5b7 feat(26-06) — task 1
  - dab08e9 feat(26-06) — task 2
---

# Phase 26 Plan 06: The Print Agent — PARTIAL

**Tasks 1 and 2 complete and verified. Task 3 (the daemon) is NOT started.**

## What landed

`Journal` is append-only and line-delimited, `fsync`s before an append returns, and compacts by
writing a sibling file and renaming it over the original — so a crash at any instant leaves either
the whole old journal or the whole new one. A truncated final record (what a power cut leaves) is
discarded and **counted**, and the count is exposed so a till that keeps truncating its journal
becomes visible rather than silently lossy.

`PrintQueue` mirrors the POS offline outbox's shape and its `MAX_ATTEMPTS = 5`, so the two queues in
this product fail alike. Exponential backoff with jitter — without the jitter, every job queued
during an outage retries in lockstep the moment the printer returns and hammers a device that has
just come back. Dead letters are **never** compacted away: that record is the only evidence a
customer's receipt never printed.

Terminal success is `SENT`, not `PRINTED`. Port 9100 is fire-and-forget with no acknowledgement, so
the agent knows it wrote bytes to a socket and says exactly that.

`loadConfig` defaults to loopback and **refuses to start** on a non-loopback bind with no shared
secret — an unauthenticated print endpoint on a restaurant LAN is reachable from the guest wifi.
Printer misconfiguration is rejected at load rather than at print time.

## The negative controls — three of my own tests were theatre

Seven sabotages. Four went red immediately (retry-forever, compact-away-dead-letters, wildcard bind
default, ignore-backoff). **Three stayed green**, and two of those were defects in the tests:

| Sabotage | First result | What it exposed |
| --- | --- | --- |
| delete `fsyncSync` | **green** | A same-process read cannot tell the page cache from the platter. No unit test can arrange a power cut — `SIGKILL` will not do it either, because the page cache outlives the process. |
| delete the single-flight guard | **green** | `claimNextDue` is synchronous, so three drains started by `Promise.all` run one after another and never contend. The test proved nothing. |
| resurrect the truncated tail | **green** | A bad sabotage, not a bad test — the `JSON.parse` guard caught it anyway. |

Fixes:

- The fsync assertion moved to its **own** file with a `vi.mock("node:fs")` factory (a spy on the
  namespace does not intercept an already-bound builtin import). It asserts the **syscall**, which
  is unusual and deliberate, and its doc comment says that is what it proves rather than implying it
  has tested durability itself. Now red for both `append` and `compact`.
- The concurrency test was replaced with the protection that actually works: **a `CLAIMED` job is
  not claimable again**. Now red.
- Two better tail sabotages (stop counting the tail; resurrect an unparseable line as a job) — both
  red. The corrupt-byte count is now asserted exactly rather than `> 0`.

## Real command output

```
$ npm test -- test/queue.test.ts
      Tests  20 passed (20)
$ npm test
      Tests  61 passed (61)
$ npx tsc --noEmit
TYPECHECK: clean
$ # acceptance gates
sqlite in non-comment queue lines: 0
runtime deps: 1
```

## NOT DONE

| Task | Status |
| --- | --- |
| **3 — the daemon** (`server.ts`, `main.ts`, `server.test.ts`) | not started |

Task 3 is the HTTP listener that ties the three together: accept a document over loopback, persist
it before responding, drain to a transport, and report queue depth and printer reachability on a
health surface. Everything it needs now exists.

## Task 2 — the transports, and the first end-to-end byte claim

Everything before this proved the renderer produced correct bytes. This proves those bytes **survive
a socket** — and the assertion decodes what the socket RECEIVED using 26-04's emulator, not what the
renderer returned. That distinction is the whole value: comparing the renderer's output to itself
would let a renderer bug and a transport bug cancel out. Proven rather than argued — sabotaging the
**renderer** to emit a wrong amount turns the **transport** suite red.

`fake-printer.ts` also misbehaves the three ways a real 9100 device does: refuse, accept-then-stall,
close mid-stream. Each is a way a job fails and each is asserted to be reported as a failure.

One connection per job, never pooled — these devices drop idle sockets without telling anyone, and a
pooled one the printer abandoned strands the next job behind a write that never completes.
Reconnecting costs milliseconds; a stuck queue costs a kitchen. Asserted by counting connections.

**What a resolved promise means**: bytes reached the kernel and the peer closed cleanly. It does not
mean paper moved — an out-of-paper printer accepts bytes exactly like a working one. The system
printer is weaker still and its header says so: a spooler accepts jobs for a printer that has been
unplugged since Tuesday. Windows raw printing **rejects** rather than silently no-oping, because a
till reporting every receipt accepted and printing none is the worst available outcome.

### Negative controls — seven, three redone

Red as intended: truncate in transit, corrupt a byte in transit, swallow a refused connection, and a
renderer emitting a wrong amount.

Green first time, and both investigated:

- **"no inactivity timeout"** — a **bad sabotage**, not a bad test. The patch used the wrong
  indentation so the write timeout was never actually removed. Redone properly, it goes red.
- **"resolve on errored close"** — a **real finding**. Node emits `error` before `close`, so the
  `hadError` branch never runs for any failure this transport actually meets; the error handler has
  already settled the promise. It is kept as a backstop, and the code now **says** the suite does not
  independently cover it rather than implying it does.

### Caught by running the full verify, not just the tests

A `TS4115` override error on `TransportError.cause`. `vitest` does not typecheck, so `npm test`
alone was green while `tsc --noEmit` was not — a reminder that the plan's verify is
`npm test && npx tsc --noEmit` for a reason.

## Known stubs

None. Everything written is exercised.
