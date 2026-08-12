-- idempotency_keys.request_hash is now what its name always claimed: a SHA-256 hex digest,
-- computed inside DefaultIdempotencyService.checkAndLock rather than supplied by the caller.
--
-- Rows written before that change hold the RAW payload instead — a void reason, a refund
-- reason concatenated with its amount, an order id. Those no longer compare equal to the
-- digest the service now computes for the very same request, so a replay of a pre-change key
-- would raise a spurious IdempotencyConflictException.
--
-- Hashing each stored value in place reproduces exactly what checkAndLock now computes for
-- that payload, so every surviving pre-change row keeps matching its own replay. (Note the
-- overflow bug meant long reasons never got a row at all — the rows that DO exist are the
-- ones whose payload happened to fit in 64 characters.)
--
-- In practice only IN_PROGRESS rows can reach that comparison: voidOrder and refund consult
-- getCompletedResponse first and return the stored result before checkAndLock runs. But the
-- rewrite is exact and cheap, and it closes the window where a void interrupted mid-flight
-- would 409 on every retry until its 24h TTL expired.
--
-- The regex guard makes a manual re-run a no-op instead of a double-hash. It would skip a
-- legacy plaintext payload that happened to be exactly 64 lowercase hex characters; no caller
-- in this service can produce one (reasons are prose, order ids are 36-char dashed UUIDs).
--
-- sha256(), encode() and convert_to() are core Postgres 11+; pgcrypto is not required.
UPDATE idempotency_keys
SET request_hash = encode(sha256(convert_to(request_hash, 'UTF8')), 'hex')
WHERE request_hash !~ '^[0-9a-f]{64}$';
