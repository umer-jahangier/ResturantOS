-- V22 — B3: a discount has to say WHY, and WHO.
--
-- `order_discounts` recorded scope/type/value/amount and an `applied_by` uuid. That is enough to
-- reduce a bill and not enough to answer the only question an owner ever asks about a discount:
-- why did we give this away, and who decided? The Discount Summary report in /app/reports could
-- therefore only ever be a column of amounts, and the Takings screen said so out loud
-- ("COMPS — Not known").
--
-- `reason` is NOT NULL deliberately. A nullable column would have been quietly bypassed by the
-- next write path added; NOT NULL means every future insert has to answer the question, and the
-- promotion engine's rows carry a system reason rather than an exemption.
--
-- The two rows that predate this migration are backfilled with an explicit statement that the
-- reason was never captured. Inventing a plausible one ("Manager discount") on a money-adjacent
-- audit trail would be worse than an honest blank — the same call V21 made for `voided_by`.
-- THE BACKFILL IS A COLUMN DEFAULT, NOT AN UPDATE, AND IT HAS TO BE.
--
-- This migration first shipped as `ADD COLUMN reason` + `UPDATE … WHERE reason IS NULL` +
-- `ALTER COLUMN reason SET NOT NULL`, and pos-service could not boot on it:
--
--   Migration of schema "public" to version "22 - order discount reason" failed!
--   SQL State : 23502
--   Message   : ERROR: column "reason" of relation "order_discounts" contains null values
--
-- `order_discounts` carries FORCE ROW LEVEL SECURITY (`pg_class.relforcerowsecurity = t`, read
-- back live on 2026-08-12), which is what the RLS repair added so that the table's OWNER is not
-- exempt from its own policies. Flyway runs as that owner on a connection with no `app.tenant_id`
-- GUC set, so the UPDATE matched ZERO rows while `SET NOT NULL` — DDL, which RLS does not filter
-- — still saw every pre-existing row and refused.
--
-- `ADD COLUMN … NOT NULL DEFAULT` is immune to that: the default is applied by the table rewrite
-- itself, to every row, regardless of policy. It is also the idiom V14 already used for
-- `station_type`. The DEFAULT is then dropped so that a future insert cannot quietly acquire the
-- "not recorded" sentence instead of a real reason — which is the whole point of the column.
ALTER TABLE order_discounts
    ADD COLUMN IF NOT EXISTS reason          VARCHAR(200) NOT NULL
        DEFAULT 'Not recorded — applied before a reason was required',
    ADD COLUMN IF NOT EXISTS applied_by_name VARCHAR(200);

ALTER TABLE order_discounts
    ALTER COLUMN reason DROP DEFAULT;

COMMENT ON COLUMN order_discounts.reason IS
    'Why this discount was given. Free text, 3-200 chars, supplied by the operator; the promotion engine writes its own system reason. Never null since V22.';
COMMENT ON COLUMN order_discounts.applied_by_name IS
    'Display name of applied_by, snapshotted at the time of the discount so the report still names the right person after they leave. NULL when the staff directory was unreachable — readers fall back to applied_by.';
