import { apiClient } from "@/lib/api-client/client";
import { get, post, patch, getPaginated, type PaginatedResult } from "@/lib/api-client/request";
import {
  apiMenuItemSchema,
  apiMenuCategorySchema,
  apiDiningTableSchema,
  apiOrderSchema,
  apiTillSessionSchema,
} from "@/lib/api-client/schemas/pos.schema";
import {
  adaptMenuItem,
  adaptMenuCategory,
  adaptDiningTable,
  adaptOrder,
  adaptTillSession,
} from "@/lib/adapters/pos.adapter";
import type {
  MenuItem,
  MenuCategory,
  DiningTable,
  Order,
  TillSession,
  CreateOrderPayload,
  AddItemPayload,
  ApplyDiscountPayload,
  OpenTillPayload,
  CloseTillPayload,
  CloseOrderPayload,
  VoidOrderPayload,
  RefundOrderPayload,
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

  async updateTableStatus(id: string, status: "AVAILABLE" | "OCCUPIED"): Promise<DiningTable> {
    const raw = await patch<{ status: string }, unknown>(`/api/v1/pos/tables/${id}`, { status });
    return adaptDiningTable(apiDiningTableSchema.parse(raw));
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

  async listOrders(params: { branchId: string; status?: string[] }): Promise<PaginatedResult<Order>> {
    const result = await getPaginated<unknown>("/api/v1/pos/orders", params as Record<string, unknown>);
    return {
      data: result.data.map((r) => adaptOrder(apiOrderSchema.parse(r))),
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

  async sendToKds(orderId: string): Promise<Order> {
    const raw = await post<undefined, unknown>(`/api/v1/pos/orders/${orderId}/send-to-kds`);
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
