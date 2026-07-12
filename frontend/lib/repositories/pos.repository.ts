import { apiClient } from "@/lib/api-client/client";
import { get, post, patch, getPaginated, type PaginatedResult } from "@/lib/api-client/request";
import {
  apiMenuItemSchema,
  apiMenuCategorySchema,
  apiDiningTableSchema,
  apiOrderSchema,
  apiOrderSummarySchema,
  apiTableDetailSchema,
  apiUpdateInstructionsSchema,
  apiAssignTableRequestSchema,
  apiTillSessionSchema,
  apiOrderPaymentRecordSchema,
  apiRecordPaymentResultSchema,
} from "@/lib/api-client/schemas/pos.schema";
import {
  adaptMenuItem,
  adaptMenuCategory,
  adaptDiningTable,
  adaptOrder,
  adaptOrderSummary,
  adaptTableDetail,
  adaptTillSession,
  adaptOrderPayment,
} from "@/lib/adapters/pos.adapter";
import type {
  MenuItem,
  MenuCategory,
  DiningTable,
  Order,
  OrderSummary,
  OrderPayment,
  TableDetail,
  TillSession,
  CreateOrderPayload,
  AddItemPayload,
  ApplyDiscountPayload,
  UpdateInstructionsPayload,
  OpenTillPayload,
  CloseTillPayload,
  CloseOrderPayload,
  VoidOrderPayload,
  RefundOrderPayload,
  RecordPaymentPayload,
} from "@/lib/models/pos.model";

// Layer-2 POS repository. Calls Layer-1 request helpers, parses via Zod,
// adapts to domain models. Never exposes raw API types to Layer-3 or above.

export const PosRepository = {
  // ── Menu ──────────────────────────────────────────────────────────────────

  async getMenuCategories(): Promise<MenuCategory[]> {
    const raw = await get<unknown[]>("/api/v1/pos/menu/categories");
    return (Array.isArray(raw) ? raw : []).map((r) => adaptMenuCategory(apiMenuCategorySchema.parse(r)));
  },

  async getMenuItems(params: { categoryId?: string; branchId?: string }): Promise<MenuItem[]> {
    const raw = await get<unknown[]>("/api/v1/pos/menu/items", params as Record<string, unknown>);
    return (Array.isArray(raw) ? raw : []).map((r) => adaptMenuItem(apiMenuItemSchema.parse(r)));
  },

  async getMenuItem(id: string): Promise<MenuItem> {
    const raw = await get<unknown>(`/api/v1/pos/menu/items/${id}`);
    return adaptMenuItem(apiMenuItemSchema.parse(raw));
  },

  // ── Tables ────────────────────────────────────────────────────────────────

  async getTables(branchId: string): Promise<DiningTable[]> {
    const raw = await get<unknown[]>("/api/v1/pos/tables", { branchId });
    return (Array.isArray(raw) ? raw : []).map((r) => adaptDiningTable(apiDiningTableSchema.parse(r)));
  },

  async updateTableStatus(id: string, status: "AVAILABLE" | "OCCUPIED" | "NEEDS_BUSSING"): Promise<DiningTable> {
    const raw = await patch<{ status: string }, unknown>(`/api/v1/pos/tables/${id}`, { status });
    return adaptDiningTable(apiDiningTableSchema.parse(raw));
  },

  /** Table-centric dine-in detail (POS-10): the table's active order + live bill summary. */
  async getActiveOrderForTable(tableId: string, branchId: string): Promise<TableDetail> {
    const raw = await get<unknown>(`/api/v1/pos/tables/${tableId}/active-order`, { branchId });
    return adaptTableDetail(apiTableDetailSchema.parse(raw));
  },

  // ── Orders ────────────────────────────────────────────────────────────────

  async createOrder(payload: CreateOrderPayload): Promise<Order> {
    const clientOrderId = payload.clientOrderId ?? crypto.randomUUID();
    const raw = await apiClient.post<{ data: unknown }>(
      "/api/v1/pos/orders",
      { ...payload, clientOrderId },
      { headers: { "Idempotency-Key": clientOrderId } }
    );
    return adaptOrder(apiOrderSchema.parse(raw.data.data));
  },

  async getOrder(id: string, branchId: string): Promise<Order> {
    const raw = await get<unknown>(`/api/v1/pos/orders/${id}`, { branchId });
    return adaptOrder(apiOrderSchema.parse(raw));
  },

  /**
   * Order Management list (POS-09). GET /api/v1/pos/orders returns OrderSummaryDto[]
   * (not the full OrderDto[] this endpoint historically returned — 07.1-04 SUMMARY, a
   * deliberate breaking wire-contract change). Defaults to ALL non-terminal statuses
   * server-side when `status` is omitted — a non-closed order never disappears.
   */
  async listOrderSummaries(params: { branchId: string; status?: string[] }): Promise<PaginatedResult<OrderSummary>> {
    const result = await getPaginated<unknown>("/api/v1/pos/orders", params as Record<string, unknown>);
    return {
      data: result.data.map((r) => adaptOrderSummary(apiOrderSummarySchema.parse(r))),
      meta: result.meta,
    };
  },

  async addItem(orderId: string, payload: AddItemPayload): Promise<Order> {
    const raw = await post<AddItemPayload, unknown>(`/api/v1/pos/orders/${orderId}/items`, payload);
    return adaptOrder(apiOrderSchema.parse(raw));
  },

  async removeItem(orderId: string, itemId: string): Promise<Order> {
    const response = await apiClient.delete<{ data: unknown }>(`/api/v1/pos/orders/${orderId}/items/${itemId}`);
    return adaptOrder(apiOrderSchema.parse(response.data.data));
  },

  async applyDiscount(orderId: string, payload: ApplyDiscountPayload): Promise<Order> {
    const raw = await post<ApplyDiscountPayload, unknown>(`/api/v1/pos/orders/${orderId}/discounts`, payload);
    return adaptOrder(apiOrderSchema.parse(raw));
  },

  /**
   * Fires all currently-PENDING lines as an incrementing revision (POS-12). `clientFireId`
   * is sent as the Idempotency-Key header — mirrors closeOrder/voidOrder's pattern
   * exactly — so a replayed offline fire never double-sends the same revision.
   */
  async sendToKds(orderId: string, clientFireId: string): Promise<Order> {
    const resp = await apiClient.post<{ data: unknown }>(
      `/api/v1/pos/orders/${orderId}/send-to-kds`,
      undefined,
      { headers: { "Idempotency-Key": clientFireId } }
    );
    return adaptOrder(apiOrderSchema.parse(resp.data.data));
  },

  /** Order-level + per-item instructions edit (POS-13). Offline-safe at the hook layer. */
  async updateInstructions(orderId: string, payload: UpdateInstructionsPayload): Promise<Order> {
    const body = apiUpdateInstructionsSchema.parse(payload);
    const raw = await patch<typeof body, unknown>(`/api/v1/pos/orders/${orderId}/instructions`, body);
    return adaptOrder(apiOrderSchema.parse(raw));
  },

  /**
   * Assign-table row action (POS-24 `PATCH /orders/{id}/table`) — assigns an AVAILABLE
   * table to a (usually tableless) order; the backend re-checks AVAILABLE status inside
   * the transaction and routes the table-status flip through `TableService.syncStatusForOrder`
   * (07.3-04). Returns the full updated order so the caller's cache reflects the new
   * `tableId` immediately.
   */
  async assignTable(orderId: string, tableId: string): Promise<Order> {
    const body = apiAssignTableRequestSchema.parse({ tableId });
    const raw = await patch<typeof body, unknown>(`/api/v1/pos/orders/${orderId}/table`, body);
    return adaptOrder(apiOrderSchema.parse(raw));
  },

  /** Marks a single line SERVED — cashier/server-side only action, never from KDS. */
  async markItemServed(orderId: string, itemId: string): Promise<Order> {
    const raw = await post<undefined, unknown>(`/api/v1/pos/orders/${orderId}/items/${itemId}/serve`);
    return adaptOrder(apiOrderSchema.parse(raw));
  },

  /**
   * Cancels a single line — cashier-initiated, from Order Detail/OrderPanel only (not
   * the KDS). Distinct from `removeItem`'s hard DELETE: this soft-cancels a line even
   * after it was SENT+, keeping it visible with the CANCELLED treatment rather than
   * removing it, per the UI-SPEC "Status System" line-item table.
   */
  async cancelItem(orderId: string, itemId: string): Promise<Order> {
    const raw = await post<undefined, unknown>(`/api/v1/pos/orders/${orderId}/items/${itemId}/cancel`);
    return adaptOrder(apiOrderSchema.parse(raw));
  },

  async closeOrder(orderId: string, payload: CloseOrderPayload, idempotencyKey: string): Promise<Order> {
    const resp = await apiClient.post<{ data: unknown }>(
      `/api/v1/pos/orders/${orderId}/close`,
      payload,
      { headers: { "Idempotency-Key": idempotencyKey } }
    );
    return adaptOrder(apiOrderSchema.parse(resp.data.data));
  },

  /**
   * Payments-history read (POS-22, 07.3-01 `GET /orders/{id}/payments`). Tenant-scoped
   * server-side — no `branchId` param on this endpoint (unlike `getOrder`/`getActiveOrderForTable`,
   * which the backend controller requires it for).
   */
  async getPayments(orderId: string): Promise<OrderPayment[]> {
    const raw = await get<unknown[]>(`/api/v1/pos/orders/${orderId}/payments`);
    return (Array.isArray(raw) ? raw : []).map((r) => adaptOrderPayment(apiOrderPaymentRecordSchema.parse(r)));
  },

  /**
   * Records ONE tender (POS-23 `POST /orders/{id}/payments`) — persists without closing
   * the order; `maybeCloseOrder` (backend seam) closes it only if this payment completes
   * the order AND it is already fully Served. Returns the new running total paid paisa
   * (backend returns a bare `Long`, not an `OrderDto` — callers refetch the order
   * separately via `useOrder`/`useOrderPayments` invalidation to see any status change).
   */
  async recordPayment(orderId: string, payload: RecordPaymentPayload): Promise<number> {
    const raw = await post<RecordPaymentPayload, unknown>(`/api/v1/pos/orders/${orderId}/payments`, payload);
    return apiRecordPaymentResultSchema.parse(raw);
  },

  async voidOrder(orderId: string, payload: VoidOrderPayload, idempotencyKey: string): Promise<Order> {
    const resp = await apiClient.post<{ data: unknown }>(
      `/api/v1/pos/orders/${orderId}/void`,
      payload,
      { headers: { "Idempotency-Key": idempotencyKey } }
    );
    return adaptOrder(apiOrderSchema.parse(resp.data.data));
  },

  async refundOrder(orderId: string, payload: RefundOrderPayload, idempotencyKey: string): Promise<Order> {
    const resp = await apiClient.post<{ data: unknown }>(
      `/api/v1/pos/orders/${orderId}/refund`,
      payload,
      { headers: { "Idempotency-Key": idempotencyKey } }
    );
    return adaptOrder(apiOrderSchema.parse(resp.data.data));
  },

  // ── Tills ─────────────────────────────────────────────────────────────────

  /** Lists till sessions, optionally filtered by cashier/status (used to find the current cashier's active till — POS-14 page-level TillSessionBar). */
  async listTills(params: { cashierId?: string; status?: string }): Promise<TillSession[]> {
    const raw = await get<unknown[]>("/api/v1/pos/tills", params as Record<string, unknown>);
    return (Array.isArray(raw) ? raw : []).map((r) => adaptTillSession(apiTillSessionSchema.parse(r)));
  },

  async openTill(payload: OpenTillPayload): Promise<TillSession> {
    const resp = await apiClient.post<{ data: unknown }>("/api/v1/pos/tills", payload);
    return adaptTillSession(apiTillSessionSchema.parse(resp.data.data));
  },

  async closeTill(tillId: string, payload: CloseTillPayload, idempotencyKey: string): Promise<TillSession> {
    const resp = await apiClient.post<{ data: unknown }>(
      `/api/v1/pos/tills/${tillId}/close`,
      payload,
      { headers: { "Idempotency-Key": idempotencyKey } }
    );
    return adaptTillSession(apiTillSessionSchema.parse(resp.data.data));
  },

  async getTill(tillId: string): Promise<TillSession> {
    const resp = await apiClient.get<{ data: unknown }>(`/api/v1/pos/tills/${tillId}`);
    return adaptTillSession(apiTillSessionSchema.parse(resp.data.data));
  },
};
