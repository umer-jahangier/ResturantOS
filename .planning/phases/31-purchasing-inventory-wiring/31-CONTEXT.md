# Phase 31 — Purchasing & Inventory Wiring Repair · CONTEXT

## Why

The user, from hands-on testing: *"I found many issues in the app while testing vendor invoices,
adding stocks, or ingredients, all these things are not linked properly or not working."*

Independent findings that corroborate it:

- **The seed could not create ANY purchasing data** — purchasing answered **403 for the MANAGER**,
  so Floating Terrace has no vendor, no purchase order, no goods receipt. Recorded honestly in
  `scripts/CREDENTIALS.md` rather than skipped.
- **Nobody could approve a purchase order.** `approval_limit_paisa` was NULL on every role and
  unsettable from inside the product, and `vendor.rego`/`finance.rego`/`pos.rego` all fail closed
  on an absent limit. Partially fixed in the seed (commit `28f3964`), but **still not settable in
  the UI** — which is the actual defect.
- **Purchasing accepts PO lines for ingredient ids inventory has never seen** (22b, D-5). The
  message dead-letters, the PO shows `CLOSED`, and there is no stock and no ledger entry. It fails
  silently because only pos and kitchen have DLQ monitors.
- **A goods-receipt UOM bug, mirror-image of the COGS one** (22b, D-2): a gram-priced pack into a
  KG-stocked ingredient was received **1000× short**.

## Locked decisions

**D-31-01 — Establish what is actually broken before building.** Drive the full procure-to-pay
chain with real data through the live stack first — vendor → PO → approve → receive → invoice →
three-way match → payment — and record where it breaks. Do not infer from code. This project has
produced eight defects that were green in tests and broken in reality.

**D-31-02 — The MANAGER 403 is a permission-model question, not a grant to hand out.**
Find which permission purchasing demands, which role should hold it, and whether the demand is
right. Do NOT simply widen a role to make the seed pass — 13-02 split `rbac.manage` deliberately,
and 19b created `pos.tables.admin` rather than reuse a waiter-held code. Follow that discipline.

**D-31-03 — Approval limits are tenant-managed in the UI.** An owner sets them per role or per
user. No SQL, no seed, no support ticket.

**D-31-04 — A PO line must reference an ingredient that exists, refused at the API with a usable
error.** Not accepted-then-dead-lettered. The current behaviour reports success and produces
nothing, which is the worst available outcome.

**D-31-05 — Unit conversion is the highest-risk arithmetic here.** Both directions have already
been wrong by 1000×. Every conversion goes through one resolver that computes the real ratio
between the purchase unit and the stock unit, returns empty across incompatible families rather
than guessing 1, and is asserted with a case whose answer a human can check by hand.

**D-31-06 — Stock and ingredient management must be complete CRUD in the UI**, including
categories, units, suppliers, reorder points and opening stock.

## Constraints

- Money is **BIGINT paisa**; quantities are decimal with explicit precision.
- `purchasing_db` and `inventory_db` are FORCE RLS (phase 17b closed a live cross-tenant leak).
  Testcontainers' superuser bypasses RLS — verify against the live databases as the real roles.
- Do not weaken the `JE_UNBALANCED` trigger or the GR/IR posting fixed in phase 14.
- Any new consumer needs `default-requeue-rejected: false` **and** a bound DLQ — phase 14 found
  four services requeuing poison messages forever.

## Definition of done

1. An owner completes vendor → PO → approve → receive → invoice → match → pay entirely in the UI.
2. Approval limits are set in the UI and actually gate approval.
3. A PO line for an unknown ingredient is refused at the API with a message naming the problem.
4. Receiving a gram-priced pack into a KG-stocked ingredient produces the arithmetically correct
   quantity, asserted with a hand-checkable case.
5. Stock, ingredients, categories, units and reorder points are full CRUD in the UI.
6. The seed can create purchasing data without a 403 — and `scripts/CREDENTIALS.md`'s "Purchasing
   is empty" caveat is deleted because it is no longer true.
