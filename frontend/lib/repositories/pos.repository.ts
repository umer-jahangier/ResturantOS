import { apiClient } from "@/lib/api-client/client";
import {
  del,
  get,
  post,
  put,
  patch,
  getPaginated,
  type PaginatedResult,
} from "@/lib/api-client/request";
import {
  apiMenuItemSchema,
  apiMenuCategorySchema,
  createMenuItemInputSchema,
  updateMenuItemInputSchema,
  createMenuCategoryInputSchema,
  updateMenuCategoryInputSchema,
  createDiningTableInputSchema,
  type CreateMenuItemInput,
  type UpdateMenuItemInput,
  type CreateMenuCategoryInput,
  type UpdateMenuCategoryInput,
  type CreateDiningTableInput,
  apiDiningTableSchema,
  apiOrderSchema,
  apiDiscountPreviewSchema,
  apiOrderSummarySchema,
  apiTableDetailSchema,
  apiUpdateInstructionsSchema,
  apiAssignTableRequestSchema,
  apiTillSessionSchema,
  apiTillReconciliationSchema,
  apiTillReviewActionSchema,
  apiOrderPaymentRecordSchema,
  apiRecordPaymentResultSchema,
  apiStationSchema,
  createStationInputSchema,
  updateStationInputSchema,
  type CreateStationInput,
  type UpdateStationInput,
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
  adaptStation,
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
  DiscountPreview,
  UpdateInstructionsPayload,
  OpenTillPayload,
  CloseTillPayload,
  VoidOrderPayload,
  RefundOrderPayload,
  RecordPaymentPayload,
  Station,
} from "@/lib/models/pos.model";
import { apiEligibleCashierSchema } from "@/lib/api-client/schemas/till-cashier.schema";
import { adaptEligibleCashier } from "@/lib/adapters/till-cashier.adapter";
import type {
  EligibleCashier,
  OpenTillForCashierPayload,
} from "@/lib/models/till-cashier.model";

// Layer-2 POS repository. Calls Layer-1 request helpers, parses via Zod,
// adapts to domain models. Never exposes raw API types to Layer-3 or above.

/**
 * Rows per request when loading the till's menu. Comfortably larger than a real restaurant's
 * whole card, so the common case is one round trip; `getMenuItems` pages past it regardless.
 */
const MENU_PAGE_SIZE = 200;
/** Bound on that loop — 2,000 active items is far beyond any menu, and stops a runaway. */
const MENU_MAX_PAGES = 10;

export const PosRepository = {
  // ── Menu ──────────────────────────────────────────────────────────────────

  async getMenuCategories(): Promise<MenuCategory[]> {
    const raw = await get<unknown[]>("/api/v1/pos/menu/categories");
    return (Array.isArray(raw) ? raw : []).map((r) =>
      adaptMenuCategory(apiMenuCategorySchema.parse(r)),
    );
  },

  /**
   * The order-taking menu, WHOLE.
   *
   * <p>This used to be a single `get` with `{categoryId, branchId}` and no `size`, against an
   * endpoint that takes a Spring `Pageable` — default page size 20. A tenant whose menu ran past
   * 20 active items sold about twenty of them: the rest never reached the grid, and the till's
   * search filters client-side over what was already fetched, so searching for one of the missing
   * items returned "No items match your search". Nothing on screen said a single item was missing,
   * because the endpoint returned bare rows with no total.
   *
   * <p>The endpoint now publishes `meta`, and this walks it to the end. A menu grid is not a paged
   * table — a cashier cannot sell from page 2 of a list they were never told exists — so the
   * paging happens here, once, and the grid receives the complete menu. `MENU_PAGE_SIZE` is a
   * transport detail, not a cap on the menu: whatever it is, the loop keeps going until `meta`
   * says nothing follows.
   */
  async getMenuItems(params: { categoryId?: string; branchId?: string }): Promise<MenuItem[]> {
    const items: MenuItem[] = [];
    let page = 0;
    let totalCount = 0;

    for (;;) {
      const result = await getPaginated<unknown>("/api/v1/pos/menu/items", {
        ...params,
        page,
        size: MENU_PAGE_SIZE,
      });
      for (const r of result.data) items.push(adaptMenuItem(apiMenuItemSchema.parse(r)));

      totalCount = result.meta?.totalCount ?? items.length;
      const nextCursor = result.meta?.page?.nextCursor;
      // Belt and braces: stop on the cursor, but also stop if a page came back empty or the
      // count is already satisfied, so a backend that mis-reports `nextCursor` cannot spin here.
      if (!nextCursor || result.data.length === 0 || items.length >= totalCount) break;
      page += 1;
      if (page >= MENU_MAX_PAGES) break;
    }

    // Reaching here short means the menu exceeded MENU_PAGE_SIZE * MENU_MAX_PAGES. Say so loudly.
    // A silently short grid is the defect this exists to remove; re-introducing it at a higher
    // number would be worse for being harder to notice.
    if (items.length < totalCount) {
      console.error(
        `Menu truncated: ${items.length} of ${totalCount} items loaded for the till. ` +
          `Raise MENU_PAGE_SIZE/MENU_MAX_PAGES — the grid must show every sellable item.`,
      );
    }
    return items;
  },

  async getMenuItem(id: string): Promise<MenuItem> {
    const raw = await get<unknown>(`/api/v1/pos/menu/items/${id}`);
    return adaptMenuItem(apiMenuItemSchema.parse(raw));
  },

  /** Admin listing (Menu Items management page) — includes inactive/deactivated items, unlike
   * {@link getMenuItems}, which backs the order-taking grid and must stay active-only. */
  async getMenuItemsForAdmin(categoryId?: string): Promise<MenuItem[]> {
    const raw = await get<unknown[]>(
      "/api/v1/pos/menu/items/admin",
      categoryId ? { categoryId } : undefined,
    );
    return (Array.isArray(raw) ? raw : []).map((r) => adaptMenuItem(apiMenuItemSchema.parse(r)));
  },

  /** Admin listing — includes inactive categories, unlike {@link getMenuCategories}. */
  async getMenuCategoriesForAdmin(): Promise<MenuCategory[]> {
    const raw = await get<unknown[]>("/api/v1/pos/menu/categories/admin");
    return (Array.isArray(raw) ? raw : []).map((r) =>
      adaptMenuCategory(apiMenuCategorySchema.parse(r)),
    );
  },

  async createMenuItem(payload: CreateMenuItemInput): Promise<MenuItem> {
    const body = createMenuItemInputSchema.parse(payload);
    const raw = await post<typeof body, unknown>("/api/v1/pos/menu/items", body);
    return adaptMenuItem(apiMenuItemSchema.parse(raw));
  },

  /** Unlike create, {@code categoryId} is REQUIRED here even though the backend's
   * UpdateMenuItemRequest treats it as optional ("omit to leave unchanged") — this repository
   * always sends the item's current or newly-chosen category explicitly, so there is one
   * behavior to reason about rather than two.
   *
   * The same reasoning is why the payload type is `UpdateMenuItemInput` and not
   * `CreateMenuItemInput`: `taxRateCode` and `imageFileId` are REMOVE-on-absent server-side, so
   * on this path they are required rather than optional and a wipe-by-omission fails to parse
   * here instead of succeeding silently in the database (S0-03). */
  async updateMenuItem(id: string, payload: UpdateMenuItemInput): Promise<MenuItem> {
    const body = updateMenuItemInputSchema.parse(payload);
    const raw = await put<typeof body, unknown>(`/api/v1/pos/menu/items/${id}`, body);
    return adaptMenuItem(apiMenuItemSchema.parse(raw));
  },

  async activateMenuItem(id: string): Promise<MenuItem> {
    const raw = await patch<undefined, unknown>(`/api/v1/pos/menu/items/${id}/activate`, undefined);
    return adaptMenuItem(apiMenuItemSchema.parse(raw));
  },

  async deactivateMenuItem(id: string): Promise<MenuItem> {
    const raw = await patch<undefined, unknown>(
      `/api/v1/pos/menu/items/${id}/deactivate`,
      undefined,
    );
    return adaptMenuItem(apiMenuItemSchema.parse(raw));
  },

  async createMenuCategory(payload: CreateMenuCategoryInput): Promise<MenuCategory> {
    const body = createMenuCategoryInputSchema.parse(payload);
    const raw = await post<typeof body, unknown>("/api/v1/pos/menu/categories", body);
    return adaptMenuCategory(apiMenuCategorySchema.parse(raw));
  },

  /**
   * Activate/deactivate own their own endpoints below rather than folding state in here — there
   * is still no `active` field on this request.
   *
   * <p>`UpdateMenuCategoryInput`, not `CreateMenuCategoryInput` (F16): PUT is a REPLACE and an
   * omitted `taxClassId` CLEARS the category's tax rule, so a rename that forgot the field would
   * silently un-tax every dish under it. Requiring it makes that fail to compile.
   */
  async updateMenuCategory(id: string, payload: UpdateMenuCategoryInput): Promise<MenuCategory> {
    const body = updateMenuCategoryInputSchema.parse(payload);
    const raw = await put<typeof body, unknown>(`/api/v1/pos/menu/categories/${id}`, body);
    return adaptMenuCategory(apiMenuCategorySchema.parse(raw));
  },

  async activateMenuCategory(id: string): Promise<MenuCategory> {
    const raw = await patch<undefined, unknown>(
      `/api/v1/pos/menu/categories/${id}/activate`,
      undefined,
    );
    return adaptMenuCategory(apiMenuCategorySchema.parse(raw));
  },

  async deactivateMenuCategory(id: string): Promise<MenuCategory> {
    const raw = await patch<undefined, unknown>(
      `/api/v1/pos/menu/categories/${id}/deactivate`,
      undefined,
    );
    return adaptMenuCategory(apiMenuCategorySchema.parse(raw));
  },

  // ── Tables ────────────────────────────────────────────────────────────────

  /**
   * Service-time list — ACTIVE tables only, which is the server default. This is what the
   * order-taking picker reads; a retired table must never be selectable.
   */
  async getTables(branchId: string): Promise<DiningTable[]> {
    const raw = await get<unknown[]>("/api/v1/pos/tables", { branchId });
    return (Array.isArray(raw) ? raw : []).map((r) =>
      adaptDiningTable(apiDiningTableSchema.parse(r)),
    );
  },

  /**
   * Catalogue list — includes retired tables so they can be found and reactivated. Requires
   * `pos.tables.admin`; a waiter calling this gets a 403 rather than a silently narrower list.
   */
  async getTablesForAdmin(branchId: string): Promise<DiningTable[]> {
    const raw = await get<unknown[]>("/api/v1/pos/tables", {
      branchId,
      includeInactive: true,
    });
    return (Array.isArray(raw) ? raw : []).map((r) =>
      adaptDiningTable(apiDiningTableSchema.parse(r)),
    );
  },

  async createTable(branchId: string, payload: CreateDiningTableInput): Promise<DiningTable> {
    const body = createDiningTableInputSchema.parse(payload);
    const raw = await post<typeof body, unknown>(
      `/api/v1/pos/tables?branchId=${encodeURIComponent(branchId)}`,
      body,
    );
    return adaptDiningTable(apiDiningTableSchema.parse(raw));
  },

  async updateTable(
    id: string,
    branchId: string,
    payload: CreateDiningTableInput,
  ): Promise<DiningTable> {
    const body = createDiningTableInputSchema.parse(payload);
    const raw = await put<typeof body, unknown>(
      `/api/v1/pos/tables/${id}?branchId=${encodeURIComponent(branchId)}`,
      body,
    );
    return adaptDiningTable(apiDiningTableSchema.parse(raw));
  },

  /**
   * Retire (`false`) or restore (`true`) a table. There is deliberately no delete: `orders`
   * reference these rows, so a closed order must keep naming the table it was served at.
   */
  async setTableActive(id: string, branchId: string, active: boolean): Promise<DiningTable> {
    const action = active ? "activate" : "deactivate";
    const raw = await patch<undefined, unknown>(
      `/api/v1/pos/tables/${id}/${action}?branchId=${encodeURIComponent(branchId)}`,
      undefined,
    );
    return adaptDiningTable(apiDiningTableSchema.parse(raw));
  },

  // ── Stations (phase 28) ───────────────────────────────────────────────────

  /**
   * `GET /api/v1/pos/stations?branchId=` — the POS-OWNED canonical station list.
   *
   * <p>Deliberately NOT `/api/v1/kitchen/kds/stations`, which is the kitchen-service
   * PROJECTION and auto-seeds a `DEFAULT` row for a branch that has none. That behaviour is
   * correct for a board which must never be empty, and wrong for a catalogue screen, where it
   * would invent a station the admin never created and then offer to edit it.
   *
   * <p>The server returns active AND retired rows — there is no `includeInactive` parameter on
   * this endpoint (unlike tables). The catalogue screen filters client-side; see
   * `use-station-admin.ts`.
   */
  async getStations(branchId: string): Promise<Station[]> {
    const raw = await get<unknown[]>("/api/v1/pos/stations", { branchId });
    return (Array.isArray(raw) ? raw : []).map((r) => adaptStation(apiStationSchema.parse(r)));
  },

  async createStation(branchId: string, payload: CreateStationInput): Promise<Station> {
    const body = createStationInputSchema.parse(payload);
    const raw = await post<typeof body, unknown>(
      `/api/v1/pos/stations?branchId=${encodeURIComponent(branchId)}`,
      body,
    );
    return adaptStation(apiStationSchema.parse(raw));
  },

  async updateStation(
    id: string,
    branchId: string,
    payload: UpdateStationInput,
  ): Promise<Station> {
    const body = updateStationInputSchema.parse(payload);
    const raw = await put<typeof body, unknown>(
      `/api/v1/pos/stations/${id}?branchId=${encodeURIComponent(branchId)}`,
      body,
    );
    return adaptStation(apiStationSchema.parse(raw));
  },

  /**
   * Retire a station. `DELETE` is the verb pos-service exposes but the effect is
   * `active = false` — the row survives, because fired tickets and the KDS projection are keyed
   * on its code. Restoring one goes back through `updateStation` with `active: true`; there is
   * deliberately no separate reactivate endpoint to keep in step with it.
   */
  async retireStation(id: string, branchId: string): Promise<Station> {
    const raw = await del<unknown>(
      `/api/v1/pos/stations/${id}?branchId=${encodeURIComponent(branchId)}`,
    );
    return adaptStation(apiStationSchema.parse(raw));
  },

  async updateTableStatus(
    id: string,
    status: "AVAILABLE" | "OCCUPIED" | "NEEDS_BUSSING",
  ): Promise<DiningTable> {
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
      { headers: { "Idempotency-Key": clientOrderId } },
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
  async listOrderSummaries(params: {
    branchId: string;
    status?: string[];
    /**
     * S0-05 free-text search — order number, table name, or the attached customer's
     * phone/name, matched SERVER-side across every status when `status` is omitted. Sent as
     * `q` so the search reaches rows this page never fetched; filtering the fetched array
     * instead is what made a voided check unfindable by its own number.
     */
    q?: string;
    /** Rows per page. Omitted, the server's Pageable default (20) applies. */
    size?: number;
  }): Promise<PaginatedResult<OrderSummary>> {
    const result = await getPaginated<unknown>(
      "/api/v1/pos/orders",
      params as Record<string, unknown>,
    );
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
    const response = await apiClient.delete<{ data: unknown }>(
      `/api/v1/pos/orders/${orderId}/items/${itemId}`,
    );
    return adaptOrder(apiOrderSchema.parse(response.data.data));
  },

  async applyDiscount(orderId: string, payload: ApplyDiscountPayload): Promise<Order> {
    const raw = await post<ApplyDiscountPayload, unknown>(
      `/api/v1/pos/orders/${orderId}/discounts`,
      payload,
    );
    return adaptOrder(apiOrderSchema.parse(raw));
  },

  /**
   * What that discount would do, before it is done (D-1). Writes nothing.
   *
   * Same payload as `applyDiscount` above, deliberately: the two routes take one request shape so
   * they cannot be asked different questions. The server runs the identical pricing path and
   * throws back the identical refusals, so a preview that 4xx's is the apply telling the operator
   * the rule before they commit rather than after.
   *
   * No adapter: the wire shape IS the domain shape here — nine paisa integers, no renaming, no
   * derivation. An adapter would be a place for a second copy of the arithmetic to grow.
   */
  async previewDiscount(
    orderId: string,
    payload: ApplyDiscountPayload,
  ): Promise<DiscountPreview> {
    const raw = await post<ApplyDiscountPayload, unknown>(
      `/api/v1/pos/orders/${orderId}/discounts/preview`,
      payload,
    );
    return apiDiscountPreviewSchema.parse(raw);
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
      { headers: { "Idempotency-Key": clientFireId } },
    );
    return adaptOrder(apiOrderSchema.parse(resp.data.data));
  },

  /** Order-level + per-item instructions edit (POS-13). Offline-safe at the hook layer. */
  async updateInstructions(orderId: string, payload: UpdateInstructionsPayload): Promise<Order> {
    const body = apiUpdateInstructionsSchema.parse(payload);
    const raw = await patch<typeof body, unknown>(
      `/api/v1/pos/orders/${orderId}/instructions`,
      body,
    );
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
    const raw = await post<undefined, unknown>(
      `/api/v1/pos/orders/${orderId}/items/${itemId}/serve`,
    );
    return adaptOrder(apiOrderSchema.parse(raw));
  },

  /**
   * S0-06 — serves every remaining line of the check in ONE call, which is what lets the
   * server's Paid-AND-Served rule close it.
   *
   * <p>Not a convenience wrapper around N `markItemServed` calls: those are N transactions and
   * N chances to stop halfway, leaving the order PARTIALLY_SERVED and still open — the exact
   * state this repair exists to eliminate. The server does it atomically and closes as a
   * consequence. Returns the order in whatever state that left it (CLOSED when fully paid,
   * still open with every line SERVED when it is not).
   */
  async serveAllItems(orderId: string): Promise<Order> {
    const raw = await post<undefined, unknown>(`/api/v1/pos/orders/${orderId}/serve-all`);
    return adaptOrder(apiOrderSchema.parse(raw));
  },

  /**
   * Cancels a single line — cashier-initiated, from Order Detail/OrderPanel only (not
   * the KDS). Distinct from `removeItem`'s hard DELETE: this soft-cancels a line even
   * after it was SENT+, keeping it visible with the CANCELLED treatment rather than
   * removing it, per the UI-SPEC "Status System" line-item table.
   */
  async cancelItem(orderId: string, itemId: string): Promise<Order> {
    const raw = await post<undefined, unknown>(
      `/api/v1/pos/orders/${orderId}/items/${itemId}/cancel`,
    );
    return adaptOrder(apiOrderSchema.parse(raw));
  },

  /**
   * Payments-history read (POS-22, 07.3-01 `GET /orders/{id}/payments`). Tenant-scoped
   * server-side — no `branchId` param on this endpoint (unlike `getOrder`/`getActiveOrderForTable`,
   * which the backend controller requires it for).
   */
  async getPayments(orderId: string): Promise<OrderPayment[]> {
    const raw = await get<unknown[]>(`/api/v1/pos/orders/${orderId}/payments`);
    return (Array.isArray(raw) ? raw : []).map((r) =>
      adaptOrderPayment(apiOrderPaymentRecordSchema.parse(r)),
    );
  },

  /**
   * Records ONE tender (POS-23 `POST /orders/{id}/payments`) — persists without closing
   * the order; `maybeCloseOrder` (backend seam) closes it only if this payment completes
   * the order AND it is already fully Served. Returns the new running total paid paisa
   * (backend returns a bare `Long`, not an `OrderDto` — callers refetch the order
   * separately via `useOrder`/`useOrderPayments` invalidation to see any status change).
   */
  async recordPayment(orderId: string, payload: RecordPaymentPayload): Promise<number> {
    const raw = await post<RecordPaymentPayload, unknown>(
      `/api/v1/pos/orders/${orderId}/payments`,
      payload,
    );
    return apiRecordPaymentResultSchema.parse(raw);
  },

  async voidOrder(
    orderId: string,
    payload: VoidOrderPayload,
    idempotencyKey: string,
  ): Promise<Order> {
    const resp = await apiClient.post<{ data: unknown }>(
      `/api/v1/pos/orders/${orderId}/void`,
      payload,
      { headers: { "Idempotency-Key": idempotencyKey } },
    );
    return adaptOrder(apiOrderSchema.parse(resp.data.data));
  },

  async refundOrder(
    orderId: string,
    payload: RefundOrderPayload,
    idempotencyKey: string,
  ): Promise<Order> {
    const resp = await apiClient.post<{ data: unknown }>(
      `/api/v1/pos/orders/${orderId}/refund`,
      payload,
      { headers: { "Idempotency-Key": idempotencyKey } },
    );
    return adaptOrder(apiOrderSchema.parse(resp.data.data));
  },

  // ── Tills ─────────────────────────────────────────────────────────────────

  /** Lists till sessions, optionally filtered by cashier/status (used to find the current cashier's active till — POS-14 page-level TillSessionBar). */
  async listTills(params: { cashierId?: string; status?: string }): Promise<TillSession[]> {
    const raw = await get<unknown[]>("/api/v1/pos/tills", params as Record<string, unknown>);
    return (Array.isArray(raw) ? raw : []).map((r) =>
      adaptTillSession(apiTillSessionSchema.parse(r)),
    );
  },

  async openTill(payload: OpenTillPayload): Promise<TillSession> {
    const resp = await apiClient.post<{ data: unknown }>("/api/v1/pos/tills", payload);
    return adaptTillSession(apiTillSessionSchema.parse(resp.data.data));
  },

  /**
   * Open a drawer FOR a named cashier (F11) — the duty manager counting the float and handing it
   * over. Same endpoint as `openTill`; the `cashierId` is what makes it a different act, and
   * pos-service refuses it without `pos.till.open.other`.
   */
  async openTillForCashier(payload: OpenTillForCashierPayload): Promise<TillSession> {
    const resp = await apiClient.post<{ data: unknown }>("/api/v1/pos/tills", payload);
    return adaptTillSession(apiTillSessionSchema.parse(resp.data.data));
  },

  /** Who at this branch may be handed a drawer, and who is already holding one. */
  async listEligibleCashiers(branchId: string): Promise<EligibleCashier[]> {
    const raw = await get<unknown[]>("/api/v1/pos/tills/cashiers", { branchId });
    return (Array.isArray(raw) ? raw : []).map((r) =>
      adaptEligibleCashier(apiEligibleCashierSchema.parse(r)),
    );
  },

  async closeTill(
    tillId: string,
    payload: CloseTillPayload,
    idempotencyKey: string,
  ): Promise<TillSession> {
    const resp = await apiClient.post<{ data: unknown }>(
      `/api/v1/pos/tills/${tillId}/close`,
      payload,
      { headers: { "Idempotency-Key": idempotencyKey } },
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
    const result = await getPaginated<unknown>(
      "/api/v1/pos/tills",
      params as Record<string, unknown>,
    );
    return {
      data: result.data.map((r) => adaptTillSession(apiTillSessionSchema.parse(r))),
      meta: result.meta,
    };
  },

  /** A till session + every order within it + cash/non-cash collected (live expected cash). */
  async getTillReconciliation(tillId: string): Promise<TillReconciliation> {
    const resp = await apiClient.get<{ data: unknown }>(
      `/api/v1/pos/tills/${tillId}/reconciliation`,
    );
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
    const raw = await post<AddTillNotePayload, unknown>(
      `/api/v1/pos/tills/${tillId}/note`,
      payload,
    );
    return adaptTillSession(apiTillSessionSchema.parse(raw));
  },

  /** Append-only review history for a till session (newest first). */
  async listTillReviewActions(tillId: string): Promise<TillReviewAction[]> {
    const raw = await get<unknown[]>(`/api/v1/pos/tills/${tillId}/review-actions`);
    return (Array.isArray(raw) ? raw : []).map((r) =>
      adaptTillReviewAction(apiTillReviewActionSchema.parse(r)),
    );
  },
};
