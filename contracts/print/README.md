# `contracts/print` — the print-document wire contract

`golden-receipt-document.json` is a fully populated `PrintDocument` (Phase 26, plan 26-01). It is
**generated** by `PrintDocumentContractTest` in `shared-lib` and **consumed** by three separate
build systems: Maven (shared-lib's contract test), vitest (the frontend's `print.adapter` suite),
and vitest again (the print agent's renderer suite). That is why it lives at the repository root,
outside every module — a fixture under `shared-lib/src/test/resources/` is reachable by Maven and
by nobody else, and the workaround people reach for is copying it, which is exactly the drift this
one file exists to prevent. **Do not copy it. Do not edit it by hand.**

Regenerate it deliberately, read the diff, then commit:

```bash
mvn -pl shared-lib test -Dtest=PrintDocumentContractTest -Dprint.fixture.regenerate=true
```

The fixture deliberately exercises the hard cases: a line whose total carries a non-zero paisa
remainder (`16066` → `Rs 160.66`), a discount, a service charge, two tax rate codes, two tenders
of which one is cash with change, a populated FBR fiscal region, and a non-ASCII character in the
footer. Every `{ paisa, formatted }` pair in it round-trips — asserted in Java by
`ReceiptMoneyFormatter.parse` and again in TypeScript by a zod refinement, because a receipt that
is wrong by a factor of a hundred is a defect this project has already shipped once.
