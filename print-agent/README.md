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
