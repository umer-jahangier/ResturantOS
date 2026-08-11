# print-agent

**The only component in this system permitted to emit printer bytes.**

Everything upstream — the POS tab, `pos-service`, the kitchen router — speaks
`PrintDocument`, the semantic tree defined in `shared-lib` and pinned by
`contracts/print/golden-receipt-document.json`. Nothing else anywhere renders ESC/POS. That is
research §9.3 decision 1: one renderer, one language, one place to fix "the Urdu codepage is wrong
on the Bixolon". Sending bytes from the browser would force printer-model knowledge into every
client and then require it to be reimplemented server-side for the cloud path as well.

## Why this and not QZ Tray

QZ Tray does most of this and is the right answer if you need it working in two weeks and you
accept: an annual certificate cost per deployment (or your own signed build), a JVM on every till,
one agent **per machine** rather than per branch, and the print path dying when the browser tab
closes — it is browser-driven by design. For a multi-tenant ERP that has to keep printing kitchen
tickets when no tab is open, a per-branch agent with a server-side queue is strictly more reliable
and carries no per-seat licence. Research §9.7. QZ Tray remains supportable as an adapter for a
customer who already runs it; it is not the architecture.

## The one runtime dependency

`@point-of-sale/receipt-printer-encoder`, pinned to an exact version with a committed lockfile.
Its identity was verified against npm and GitHub by a human before it entered this manifest — see
plan 26-04 task 1. Hand-rolling was considered and rejected: research §6.4 identifies codepage
handling for Urdu and Arabic as the genuinely hard part, Floating Terrace is in Islamabad, and a
hand-rolled encoder would get that wrong quietly.

`src/render/escpos-commands.ts` deliberately duplicates a handful of that library's sequences as
literal bytes checked against the Star Micronics specification. If a library upgrade changes what
it emits for a cut or a drawer pulse, the test suite fails and a person decides — rather than a
restaurant discovering it during service.

## The queue is an append-only journal, and that is a decision — not a placeholder

Two options were considered for durable storage and **both were rejected on operational grounds,
not on taste**. Do not "simplify" this back:

- **`better-sqlite3`** requires a **native build on every machine it installs on**. A print agent
  that fails to install on a Windows till because there is no C++ toolchain has failed before it
  started — and the person hitting that error is a restaurant manager, not an engineer.
- **`node:sqlite`** is still an **experimental API**. A queue holding a customer's unprinted
  receipt is not where you want to find out what changed between Node releases.

An append-only, line-delimited journal has no dependency at all, is durable with one `fsync`, and —
the part that matters at two in the morning — a support engineer can read it in a text editor.

`src/queue/journal.ts` carries the same note at the top of the file, because a decision recorded
only in a README is a decision the next person editing the file will not see.

### What "accepted" means

`Journal.append` does not return until the bytes are on the platter, and the HTTP response for an
accepted job is written **after** it returns. That ordering is the contract: a job the cashier was
told was accepted survives the power going out one millisecond later. Accepting and then losing is
the print-queue form of the empty-state-on-failure defect — the product says it worked and no paper
appears.

### `SENT`, never `PRINTED`

Port 9100 is fire-and-forget with no acknowledgement (research §5.1). The agent knows it wrote bytes
to a socket; it does **not** know whether paper moved. The queue's terminal success state is named
`SENT` for that reason, and nothing in this package will ever claim a paper outcome it cannot
observe.

---

# Running the agent

## Install

Node 20+. No native build, no compiler, no database.

```bash
cd print-agent && pnpm install && pnpm exec tsc -p tsconfig.json
node dist/main.js            # or: PRINT_AGENT_CONFIG=/etc/print-agent.json node dist/main.js
```

One agent per BRANCH, not per till — a Raspberry Pi or the counter PC. That is the whole reason
this exists rather than QZ Tray (see above): kitchen tickets must print when no browser tab is open.

## Configuration

`./print-agent.config.json` by default, overridable per key by environment variable.

| Key | Env | Default | What it means |
| --- | --- | --- | --- |
| `bindAddress` | `PRINT_AGENT_BIND` | `127.0.0.1` | **Loopback by default.** A non-loopback bind with no `sharedSecret` **refuses to start**. |
| `port` | `PRINT_AGENT_PORT` | `7654` | |
| `sharedSecret` | `PRINT_AGENT_SECRET` | none | Required for any non-loopback bind. Sent as `X-Print-Agent-Secret`. |
| `allowedOrigins` | `PRINT_AGENT_ORIGINS` | none | Browser origins that may call the agent. **A wildcard is refused at load.** |
| `journalPath` | `PRINT_AGENT_JOURNAL` | `./.print-agent/queue.jsonl` | Where the queue lives. |
| `maxAttempts` | `PRINT_AGENT_MAX_ATTEMPTS` | `5` | Matches the POS offline outbox. |
| `printers` | — | `[]` | The registry from plan 26-02. Validated at LOAD, so a bad entry stops startup rather than a receipt. |

### Why it refuses to start rather than warning

An unauthenticated print endpoint on a restaurant LAN prints whatever anyone sends it, and on most
restaurant networks that includes the guest wifi. `Access-Control-Allow-Origin: *` is the same
problem through the browser: any page open on the till could print. Both are refusals, not
warnings, because nobody reads a warning on a till.

## Endpoints

| Method | Path | Response |
| --- | --- | --- |
| `POST` | `/print` | `200 DELIVERED` \| `202 QUEUED` \| `404 UNKNOWN_PRINTER` \| `422 INVALID_DOCUMENT` |
| `POST` | `/test-print` | as above; prints a **column ruler** |
| `GET` | `/health` | version, queue depth by status, per-printer last attempt |
| `GET` | `/printers` | the registry, without secrets |
| `GET` | `/queue` | depth, plus dead-lettered jobs |

**200 vs 202 is load-bearing.** They are two different messages to a cashier — "printed" and
"queued, printer offline" — and 26-09's fallback ladder branches on exactly this.

## The journal, and recovering a dead-lettered job

`queue.jsonl` is line-delimited JSON, one record per event, **last record for an id wins**. Read it
with anything:

```bash
tail -5 .print-agent/queue.jsonl | jq .
jq -c 'select(.status=="DEAD_LETTERED") | {id, targetPrinterId, attempts, lastError}' .print-agent/queue.jsonl
curl -s localhost:7654/queue | jq .deadLettered
```

A dead-lettered job has exhausted `maxAttempts` and will **never** be retried automatically — that
is deliberate, so a wedged printer cannot consume the queue. It is also **never compacted away**:
that record is the only evidence a customer's receipt was not printed. To retry one, re-POST the
document to `/print`; to see what was lost, read the record.

`corruptedJournalBytes` on `/health` counts bytes the loader could not parse — the shape a power cut
leaves. A number that keeps climbing means a failing disk or a dying power supply, not a software
bug.

## What the agent will never tell you

It **cannot** tell you a receipt printed. Port 9100 is fire-and-forget with no acknowledgement, and
a spooler accepts jobs for a printer unplugged since Tuesday. The terminal success state is `SENT`
— bytes reached a socket — and nothing here will ever claim more than that.
