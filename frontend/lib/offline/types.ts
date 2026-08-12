// Offline-first types: outbox operations, IndexedDB schema shapes.

export type OutboxOpType =
  | "CREATE_ORDER"
  | "APPEND_ITEMS"
  | "UPDATE_INSTRUCTIONS"
  /**
   * Fire the order's PENDING lines as a kitchen revision — the outbox twin of
   * `POST /pos/orders/{id}/send-to-kds`.
   *
   * Its ABSENCE was S0-07: the outbox could create an order offline and add its lines,
   * but the fire the cashier actually pressed had no wire representation at all, so it
   * was simply dropped. The order replayed on reconnect as a DRAFT that the kitchen
   * never saw, while the till had said "Sent to kitchen".
   */
  | "SEND_TO_KDS";

/**
 * Payload of a {@link OutboxOpType} `SEND_TO_KDS` op.
 *
 * `clientFireId` is minted once, at ENQUEUE time, and replayed verbatim as the
 * Idempotency-Key header. Minting it at REPLAY time instead would hand the server a
 * fresh key on every retry, so a fire that actually succeeded but whose response was
 * lost would fire a SECOND revision — the kitchen cooking the same ticket twice.
 */
export interface SendToKdsOpPayload {
  clientFireId: string;
}
// DEAD = retries exhausted (attempts reached MAX_ATTEMPTS). A terminal state: the op is
// no longer auto-retried and is EXCLUDED from the "queued" badge count so a permanently
// failing op can't inflate the pill forever. It stays in the outbox for operator review
// (explicit Retry or Dismiss) rather than being silently dropped.
export type OutboxStatus = "PENDING" | "IN_FLIGHT" | "SYNCED" | "FAILED" | "DEAD";

export interface OutboxOp {
  /** uuid v4 assigned at enqueue time — IDB primary key. */
  id: string;
  /**
   * Stable uuid v4 used as the idempotency key for the server.
   * For CREATE_ORDER ops: the client-generated order ID that the server stores
   * in the `client_order_id` column (deduplicates replay).
   * For APPEND_ITEMS ops: the server's order UUID (used as orderId in the URL).
   * For UPDATE_INSTRUCTIONS ops: the server's order UUID (used as orderId in the URL).
   */
  clientOrderId: string;
  type: OutboxOpType;
  /** Serialised request body sent to the server on replay. */
  payload: unknown;
  status: OutboxStatus;
  /** Incremented on every markFailed call. */
  attempts: number;
  /** Date.now() at enqueue time — used for FIFO ordering. */
  createdAt: number;
  /** Last error message from a failed attempt. */
  lastError?: string;
}

export interface CachedMenu {
  branchId: string;
  categories: unknown[];
  items: unknown[];
  /** Date.now() when this snapshot was written. */
  cachedAt: number;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}
