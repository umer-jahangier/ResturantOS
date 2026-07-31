import { apiClient } from "@/lib/api-client/client";
import { get, post, put, patch, getPaginated, type PaginatedResult } from "@/lib/api-client/request";
import {
  apiMenuItemSchema,
  apiMenuCategorySchema,
  createMenuItemInputSchema,
  createMenuCategoryInputSchema,
  type CreateMenuItemInput,
  type CreateMenuCategoryInput,
  apiDiningTableSchema,
  apiOrderSchema,
  apiOrderSummarySchema,
  apiTableDetailSchema,
  apiUpdateInstructionsSchema,
  apiAssignTableRequestSchema,
  apiTillSessionSchema,
  apiTillReconciliationSchema,
  apiTillReviewActionSchema,
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
  adaptTillReconciliation,
  adaptTillReviewAction,
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
  TillReconciliation,
  TillReviewAction,
  FlagTillPayload,
  AddTillNotePayload,
  CreateOrderPayload,
  AddItemPayload,
  ApplyDiscountPayload,
  UpdateInstructionsPayload,
  OpenTillPayload,
  CloseTillPayload,
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

  /** Admin listing (Menu Items management page) — includes inactive/deactivated items, unlike
   * {@link getMenuItems}, which backs the order-taking grid and must stay active-only. */
  async getMenuItemsForAdmin(categoryId?: string): Promise<MenuItem[]> {
    const raw = await get<unknown[]>("/api/v1/pos/menu/items/admin", categoryId ? { categoryId } : undefined);
    return (Array.isArray(raw) ? raw : []).map((r) => adaptMenuItem(apiMenuItemSchema.parse(r)));
  },

  /** Admin listing — includes inactive categories, unlike {@link getMenuCategories}. */
  async getMenuCategoriesForAdmin(): Promise<MenuCategory[]> {
    const raw = await get<unknown[]>("/api/v1/pos/menu/categories/admin");
    return (Array.isArray(raw) ? raw : []).map((r) => adaptMenuCategory(apiMenuCategorySchema.parse(r)));
  },

  async createMenuItem(payload: CreateMenuItemInput): Promise<MenuItem> {
    const body = createMenuItemInputSchema.parse(payload);
    const raw = await post<typeof body, unknown>("/api/v1/pos/menu/items", body);
    return adaptMenuItem(apiMenuItemSchema.parse(raw));
  },

  /** Unlike create, {@code categoryId} is REQUIRED here even though the backend's
   * UpdateMenuItemRequest treats it as optional ("omit to leave unchanged") — this repository
   * always sends the item's current or newly-chosen category explicitly, so there is one
   * behavior to reason about rather than two. */
  async updateMenuItem(id: string, payload: CreateMenuItemInput): Promise<MenuItem> {
    const body = createMenuItemInputSchema.parse(payload);
    const raw = await put<typeof body, unknown>(`/api/v1/pos/menu/items/${id}`, body);
    return adaptMenuItem(apiMenuItemSchema.parse(raw));
  },

  async activateMenuItem(id: string): Promise<MenuItem> {
    const raw = await patch<undefined, unknown>(`/api/v1/pos/menu/items/${id}/activate`, undefined);
    return adaptMenuItem(apiMenuItemSchema.parse(raw));
  },

  async deactivateMenuItem(id: string): Promise<MenuItem> {
    const raw = await patch<undefined, unknown>(`/api/v1/pos/menu/items/${id}/deactivate`, undefined);
    return adaptMenuItem(apiMenuItemSchema.parse(raw));
  },

  async createMenuCategory(payload: CreateMenuCategoryInput): Promise<MenuCategory> {
    const body = createMenuCategoryInputSchema.parse(payload);
    const raw = await post<typeof body, unknown>("/api/v1/pos/menu/categories", body);
    return adaptMenuCategory(apiMenuCategorySchema.parse(raw));
  },

  /** Same request shape as create (`CreateMenuCategoryInput` — no `active` field either way);
   * activate/deactivate own their own endpoints below rather than folding state in here. */
  async updateMenuCategory(id: string, payload: CreateMenuCategoryInput): Promise<MenuCategory> {
    const body = createMenuCategoryInputSchema.parse(payload);
    const raw = await put<typeof body, unknown>(`/api/v1/pos/menu/categories/${id}`, body);
    return adaptMenuCategory(apiMenuCategorySchema.parse(raw));
  },

  async activateMenuCategory(id: string): Promise<MenuCategory> {
    const raw = await patch<undefined, unknown>(`/api/v1/pos/menu/categories/${id}/activate`, undefined);
    return adaptMenuCategory(apiMenuCategorySchema.parse(raw));
  },

  async deactivateMenuCategory(id: string): Promise<MenuCategory> {
    const raw = await patch<undefined, unknown>(`/api/v1/pos/menu/categories/${id}/deactivate`, undefined);
    return adaptMenuCategory(apiMenuCategorySchema.parse(raw));
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
   * is sent as the Idempotency-Key header — mirrors voidOrder/refundOrder's pattern
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

  /**
   * Branch-wide till history for manager/owner review (newest first), server-paginated —
   * the backend returns a `PageMeta` envelope for this branch of `GET /tills` (unlike the
   * cashier-scoped `listTills` above, which stays an unpaginated list).
   */
  async listBranchTills(params: {
    branchId: string;
    page?: number;
    size?: number;
  }): Promise<PaginatedResult<TillSession>> {
    const result = await getPaginated<unknown>("/api/v1/pos/tills", params as Record<string, unknown>);
    return {
      data: result.data.map((r) => adaptTillSession(apiTillSessionSchema.parse(r))),
      meta: result.meta,
    };
  },

  /** A till session + every order within it + cash/non-cash collected (live expected cash). */
  async getTillReconciliation(tillId: string): Promise<TillReconciliation> {
    const resp = await apiClient.get<{ data: unknown }>(`/api/v1/pos/tills/${tillId}/reconciliation`);
    return adaptTillReconciliation(apiTillReconciliationSchema.parse(resp.data.data));
  },

  // ── Till review (manager/owner) ───────────────────────────────────────────

  async approveTill(tillId: string): Promise<TillSession> {
    const raw = await post<undefined, unknown>(`/api/v1/pos/tills/${tillId}/approve`);
    return adaptTillSession(apiTillSessionSchema.parse(raw));
  },

  async flagTill(tillId: string, payload: FlagTillPayload): Promise<TillSession> {
    const raw = await post<FlagTillPayload, unknown>(`/api/v1/pos/tills/${tillId}/flag`, payload);
    return adaptTillSession(apiTillSessionSchema.parse(raw));
  },

  async addTillNote(tillId: string, payload: AddTillNotePayload): Promise<TillSession> {
    const raw = await post<AddTillNotePayload, unknown>(`/api/v1/pos/tills/${tillId}/note`, payload);
    return adaptTillSession(apiTillSessionSchema.parse(raw));
  },

  /** Append-only review history for a till session (newest first). */
  async listTillReviewActions(tillId: string): Promise<TillReviewAction[]> {
    const raw = await get<unknown[]>(`/api/v1/pos/tills/${tillId}/review-actions`);
    return (Array.isArray(raw) ? raw : []).map((r) => adaptTillReviewAction(apiTillReviewActionSchema.parse(r)));
  },
};
