---
phase: 26
plan: "04"
subsystem: print-agent
status: partial
tags: [print, escpos, print-agent, dependency, specification]
requires:
  - 26-01 (PrintDocument — the input the renderer will consume in task 3)
provides:
  - "the `print-agent` package: the only component permitted to emit printer bytes"
  - "`escpos-commands.ts` — initialise, cut, feed-and-cut, and both drawer commands, pinned to the Star specification"
  - "the one approved runtime dependency, pinned exactly, with a committed lockfile"
affects:
  - a new top-level `print-agent/` package (nothing existing is touched)
tech-stack:
  added:
    - "@point-of-sale/receipt-printer-encoder 3.0.3 (exact pin, MIT, human-verified)"
  patterns: [validate-never-clamp, cite-the-specification, duplicate-the-library-on-purpose]
key-files:
  created:
    - print-agent/package.json
    - print-agent/pnpm-lock.yaml
    - print-agent/tsconfig.json
    - print-agent/vitest.config.ts
    - print-agent/README.md
    - print-agent/src/render/escpos-commands.ts
    - print-agent/test/escpos-commands.test.ts
  modified: []
decisions:
  - "The dependency is pinned to an exact version with no caret, and the lockfile is committed"
  - "Parameters are validated and rejected, never clamped — a coerced drawer pulse is a different physical event from the one asked for"
  - "The queued drawer command and the real-time one are separate functions that provably never emit the same bytes"
  - "The command layer deliberately duplicates sequences the encoder library also produces, so a library upgrade fails a test rather than a service"
  - "align/emphasis/textSize are marked as standard ESC/POS, NOT cited to the Star PDF, because research §7 does not cover them"
metrics:
  duration: ~25m
  completed: 2026-08-11
commits:
  - 58826f5 feat(26-04) — the ESC/POS command layer
---

# Phase 26 Plan 04: The ESC/POS Command Layer — PARTIAL

**Task 1 (checkpoint) approved. Task 2 complete and verified. Task 3 NOT started.**

## Task 1 — the package-legitimacy checkpoint

Halted as required; **not auto-approved**. The coordinator verified independently and approved:
`@point-of-sale/receipt-printer-encoder` 3.0.3, MIT, four published versions, last publish
2025-04-05; GitHub `NielsLeenheer/ReceiptPrinterEncoder` 328 stars, not archived, last push
2026-03-01; author a known name rather than an anonymous publisher.

Their instruction — pin the exact version, no caret, commit the lockfile — was followed:

```
"@point-of-sale/receipt-printer-encoder": "3.0.3"        # no ^ or ~ anywhere in the manifest
```

The resolved tree was then checked against what they described, and matches exactly:

```
$ pnpm ls --depth 1 --prod
@restaurantos/print-agent@0.1.0 (PRIVATE)
└─┬ @point-of-sale/receipt-printer-encoder@3.0.3
  ├── @canvas/image-data@1.1.0
  ├── @point-of-sale/codepage-encoder@3.0.2
  ├── canvas-dither@1.0.1
  ├── canvas-flatten@1.0.1
  └── resize-image-data@0.3.1
```

Image processing for logo rasterisation plus the author's own codepage encoder. Nothing else, and
nothing surprising. The lockfile records the integrity hash
`sha512-2+xgs6rwNfrkEw9g4LkgQS6k29qnmo3+hOV7Z2xHNBFn8h4FrwquZwL/dBOTwgmQ9sWEYBkj/bQkg9Rz6lL99w==`.

## Task 2 — the command layer

One function per command, each citing the Star Micronics Rev 2.52 section it implements via
research §7, and each validating its parameters against the range that section defines:

| Function | Command | Bytes | Defined region enforced |
| --- | --- | --- | --- |
| `initialize()` | `ESC @` (§7.1) | `1B 40` | none |
| `cut("FULL"/"PARTIAL"/"NONE")` | `GS V m` (§7.3) | `1D 56 00` / `1D 56 01` / *empty* | closed set |
| `feedAndCut(mode, n)` | `GS V m n` (§7.3) | `1D 56 41 nn` / `1D 56 42 nn` | `0 ≤ n ≤ 255` |
| `openDrawerAfterPrinting(pin, onMs, offMs)` | `ESC p m t1 t2` (§7.2) | `1B 70 mm t1 t2` | pin ∈ {2,5}; `t ≤ 255` in 2 ms units |
| `openDrawerImmediately(pin, pulseMs)` | `DLE DC4 n m t` (§7.2) | `10 14 01 mm t` | `n = 1`; `1 ≤ t ≤ 8` in 100 ms units |

**Validated, never clamped.** A printer given an out-of-range parameter does something *undefined*.
On a cutter that is a wasted receipt; on a drawer it is either nothing at all or a solenoid held
energised. Every function throws rather than coercing, because a coerced pulse is a different
physical event from the one the caller asked for.

**The two drawer commands are deliberately separate.** `ESC p` is queued and fires when the printer
reaches it — use it at the end of a receipt. `DLE DC4` is *"processed upon reception"* and jumps the
queue — it is the no-sale button. A test asserts they never produce the same bytes and do not even
share a leading byte, so a truncated stream cannot be mistaken for the other command. Confusing them
means a till that opens in the middle of a receipt.

**Writing the tests found something worth pinning.** The two commands do **not** have the same
maximum duration: `ESC p` encodes `t` in one byte of 2 ms units, so 510 ms; `DLE DC4` encodes `t` as
1–8 of 100 ms units, so 800 ms. A caller assuming they match gets a `RangeError` from one and a
working pulse from the other. Now asserted in both directions. (My first draft of the test asserted
800 ms against both and failed — the right fix was to pin the asymmetry, not to lower the assertion.)

**Every expectation is a hexadecimal literal** from the specification, never a second call to the
code under test. These bytes cut paper and energise a solenoid; a test that re-derived the
implementation's own arithmetic would pass for a command that opens the wrong pin, and the first
person to find out would be a cashier whose till does not open with a customer waiting.

## Real command output

```
$ cd print-agent && npm test -- test/escpos-commands.test.ts
 Test Files  1 passed (1)
      Tests  16 passed (16)

$ npx tsc --noEmit
TYPECHECK: clean          # strict, noUncheckedIndexedAccess, verbatimModuleSyntax

$ node -e "console.log(Object.keys(require('./package.json').dependencies).length)"
1                          # exactly one runtime dependency

$ grep -cE '"\^|"~' package.json
0                          # no floating ranges anywhere
```

## Deviations from Plan

**[Honesty, not a rule] `align`, `emphasis` and `textSize` carry no specification citation.**
Research §7 covers initialise, the drawer and the cut, and nothing else. Those three are standard
ESC/POS and the encoder library emits them too, but they are **not** quoted from the Star PDF in the
research extract. They are marked in-source as such rather than given a citation they do not have —
a fabricated citation is worse than an honest gap, and this file's whole value is that its citations
can be trusted.

**Behaviour 7 of task 2 cannot be satisfied in task 2.** It reads *"Alignment, emphasis and size
commands round-trip through the emulator's decoder"* — but the emulator is created in **task 3**.
The plan sequenced a forward reference. What task 2 asserts instead is the exact byte output for all
three; the round-trip lands with the emulator.

## NOT DONE — task 3

**Task 3 (the emulator and the renderer it proves) is not started.** This is the substantial half of
26-04: an emulator that decodes the produced stream back into a structured render and throws on any
byte sequence it does not recognise, so a malformed or truncated stream cannot pass as correct —
which is the mechanism D-26-02 names for proving behaviour without hardware.

Without it there is a command layer but no `PrintDocument → bytes` renderer, so nothing yet consumes
`contracts/print/golden-receipt-document.json` on the agent side. 26-06 (the agent proper) depends on
this.

## Hardware sign-off (U3)

Everything in task 2 is byte-level and needs no peripheral. What these bytes *do to paper and to a
solenoid* — whether a partial cut degrades to a full cut on the model bought, whether the drawer
fires at the configured pulse voltage — is exactly what D-26-02 defers to U3, and is unchanged by
this plan.

## Known stubs

None. Every exported function is implemented and asserted.
