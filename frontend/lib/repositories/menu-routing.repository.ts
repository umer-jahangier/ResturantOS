import { get, put } from "@/lib/api-client/request";
import {
  apiMenuRoutingSchema,
  assignStationInputSchema,
} from "@/lib/api-client/schemas/menu-routing.schema";
import { adaptMenuRouting } from "@/lib/adapters/menu-routing.adapter";
import type { MenuRouting } from "@/lib/models/menu-routing.model";

/**
 * Layer-2 repository for station routing (S1-01).
 *
 * ```
 * GET /api/v1/pos/menu/routing?branchId=              pos.menu.manage   (new — the read half)
 * PUT /api/v1/pos/menu/categories/{id}/station?branchId=  pos.menu.manage  (28-05, unchanged)
 * PUT /api/v1/pos/menu/items/{id}/station?branchId=       pos.menu.manage  (28-05, unchanged)
 * ```
 *
 * <h3>The two writes have existed since 28-05 and had zero callers</h3>
 *
 * That is the whole shape of this gap: the endpoints worked, the resolution order was correct and
 * tested, and no screen in the product could reach either of them — so every drink on a mixed
 * check went to the kitchen board and the bar never got it. Nothing about the wire contract needed
 * changing; only the read beside them was missing, because a category's route was writable and
 * unreadable.
 *
 * <h3>Every call is branch-scoped, and that is not incidental</h3>
 *
 * A station code is unique within a BRANCH. Menu categories are tenant-scoped. The whole reason
 * these route tables exist is that the two do not line up, so a routing call without a branch is
 * not a call with a default — it is a call with no meaning, and pos-service refuses it.
 */
export const MenuRoutingRepository = {
  async getRouting(branchId: string): Promise<MenuRouting> {
    const raw = await get<unknown>("/api/v1/pos/menu/routing", { branchId });
    return adaptMenuRouting(apiMenuRoutingSchema.parse(raw));
  },

  /**
   * Route a whole category, or clear it with `stationId: null`.
   *
   * <p>Clearing does NOT discard the per-item exceptions set against it — they are the exception
   * mechanism, and pos-service leaves them standing on purpose.
   *
   * <p>Answers `204 No Content`, so there is nothing to parse and nothing to return. The caller
   * refetches; it must not patch a cache from a response body that does not exist.
   */
  async assignCategoryStation(
    categoryId: string,
    branchId: string,
    stationId: string | null,
  ): Promise<void> {
    const body = assignStationInputSchema.parse({ stationId });
    await put<typeof body, void>(
      `/api/v1/pos/menu/categories/${encodeURIComponent(categoryId)}/station?branchId=${encodeURIComponent(branchId)}`,
      body,
    );
  },

  /**
   * Route one item, or clear its exception with `stationId: null` so it falls back to its
   * category's route.
   */
  async assignItemStation(
    itemId: string,
    branchId: string,
    stationId: string | null,
  ): Promise<void> {
    const body = assignStationInputSchema.parse({ stationId });
    await put<typeof body, unknown>(
      `/api/v1/pos/menu/items/${encodeURIComponent(itemId)}/station?branchId=${encodeURIComponent(branchId)}`,
      body,
    );
  },
};
