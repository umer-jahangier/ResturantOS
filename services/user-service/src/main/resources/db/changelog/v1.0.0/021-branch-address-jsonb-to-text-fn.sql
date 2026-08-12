-- The jsonb -> text conversion used by changeset 021-001, in its own file so the test that
-- proves the conversion runs the SAME statement the migration runs rather than a copy of it.
--
-- Created and dropped inside the changeset: this is a migration tool, not an API, and leaving it
-- in the schema would invite a caller.
--
-- Shapes handled, all three of which exist in user_db today:
--   "12 Khayaban-e-Iqbal"                    -> 12 Khayaban-e-Iqbal
--   {"city":"Karachi","line1":"12 Zamzama"}  -> 12 Zamzama, Karachi
--   ["12 Zamzama","Karachi"]                 -> 12 Zamzama, Karachi
-- Object keys are emitted in POSTAL order (line1 before city before country), not in whatever
-- order Postgres happens to store them, so a converted address reads like an address. Unknown keys
-- keep their relative order after the known ones. Non-string members are dropped: a {"lat":24.8}
-- is not part of a printed address, and "24.8" as an address line is worse than no line.
CREATE OR REPLACE FUNCTION branch_address_jsonb_to_text(addr jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
    SELECT CASE jsonb_typeof(addr)
        WHEN 'string' THEN NULLIF(btrim(addr #>> '{}'), '')
        WHEN 'array' THEN (
            SELECT NULLIF(string_agg(btrim(elem #>> '{}'), ', ' ORDER BY ord), '')
              FROM jsonb_array_elements(addr) WITH ORDINALITY AS a(elem, ord)
             WHERE jsonb_typeof(elem) = 'string'
               AND btrim(elem #>> '{}') <> ''
        )
        WHEN 'object' THEN (
            SELECT NULLIF(string_agg(val, ', ' ORDER BY rank, key), '')
              FROM (
                SELECT e.key AS key,
                       btrim(e.value #>> '{}') AS val,
                       COALESCE(array_position(
                           ARRAY['line1','line2','line3','street','building','area','sector',
                                 'block','town','city','district','state','province','postalCode',
                                 'postal_code','zip','country'],
                           e.key), 99) AS rank
                  FROM jsonb_each(addr) AS e
                 WHERE jsonb_typeof(e.value) = 'string'
                   AND btrim(e.value #>> '{}') <> ''
              ) parts
        )
        ELSE NULLIF(btrim(addr #>> '{}'), '')
    END
$fn$;
