// Offline-first types: outbox operations, IndexedDB schema shapes.

export type OutboxOpType = "CREATE_ORDER" | "APPEND_ITEMS";
export type OutboxStatus = "PENDING" | "IN_FLIGHT" | "SYNCED" | "FAILED";

export interface OutboxOp {
  /** uuid v4 assigned at enqueue time — IDB primary key. */
  id: string;
  /**
   * Stable uuid v4 used as the idempotency key for the server.
   * For CREATE_ORDER ops: the client-generated order ID that the server stores
   * in the `client_order_id` column (deduplicates replay).
   * For APPEND_ITEMS ops: the server's order UUID (used as orderId in the URL).
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
