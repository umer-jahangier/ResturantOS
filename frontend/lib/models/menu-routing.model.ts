/**
 * Domain models for station routing — "which screen does this dish print on, at this branch"
 * (S1-01).
 *
 * <h3>The two station fields on an item answer different questions</h3>
 *
 * `stationId` is the item's OWN route at this branch. `null` means no exception has been set, and
 * the screen renders that as "Follow the category" — not as "no station".
 *
 * `effectiveStationId` is where the ticket actually goes. It is resolved on the server by the same
 * resolver the order path uses, and is never recomputed here: a second copy of the resolution
 * order is a second answer, and the two disagree the first time a step is added to one of them.
 */

/** Which rule produced an item's effective station. */
export type RouteSource = "ITEM" | "CATEGORY" | "LEGACY" | "NONE";

export interface CategoryRoute {
  categoryId: string;
  categoryName: string;
  sortOrder: number;
  active: boolean;
  /** The category's route at this branch, or null when it has none. */
  stationId: string | null;
  stationCode: string | null;
  stationName: string | null;
}

export interface ItemRoute {
  itemId: string;
  itemName: string;
  categoryId: string | null;
  categoryName: string | null;
  active: boolean;
  /** The item's own route at this branch. Null = follow the category. */
  stationId: string | null;
  effectiveStationId: string | null;
  effectiveStationCode: string | null;
  effectiveStationName: string | null;
  source: RouteSource;
}

export interface MenuRouting {
  branchId: string;
  categories: CategoryRoute[];
  items: ItemRoute[];
}
