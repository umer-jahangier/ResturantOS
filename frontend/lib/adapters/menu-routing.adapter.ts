import type {
  ApiCategoryRoute,
  ApiItemRoute,
  ApiMenuRouting,
} from "@/lib/api-client/schemas/menu-routing.schema";
import type {
  CategoryRoute,
  ItemRoute,
  MenuRouting,
  RouteSource,
} from "@/lib/models/menu-routing.model";

const ROUTE_SOURCES = new Set<RouteSource>(["ITEM", "CATEGORY", "LEGACY", "NONE"]);

/**
 * An unrecognised `source` degrades to NONE rather than throwing.
 *
 * <p>`source` is a LABEL. It decides whether the screen writes "Follow category" or "Set for this
 * item" next to a destination the server already resolved — it is not the destination itself and
 * it is not a security control. Throwing on an unknown value would empty a whole routing screen
 * over a caption, which is the trade `apiStationSchema` already refuses for `stationType`.
 */
function toSource(raw: string | null | undefined): RouteSource {
  const upper = raw?.toUpperCase();
  return upper && ROUTE_SOURCES.has(upper as RouteSource) ? (upper as RouteSource) : "NONE";
}

export function adaptCategoryRoute(raw: ApiCategoryRoute): CategoryRoute {
  return {
    categoryId: raw.categoryId,
    categoryName: raw.categoryName,
    sortOrder: raw.sortOrder ?? 0,
    // An absent `active` means ACTIVE. The opposite default would render a whole menu as archived
    // the day a server stopped sending the field — "you have nothing sellable" is the more
    // expensive of the two wrong answers.
    active: raw.active ?? true,
    stationId: raw.stationId ?? null,
    stationCode: raw.stationCode ?? null,
    stationName: raw.stationName ?? null,
  };
}

export function adaptItemRoute(raw: ApiItemRoute): ItemRoute {
  return {
    itemId: raw.itemId,
    itemName: raw.itemName,
    categoryId: raw.categoryId ?? null,
    categoryName: raw.categoryName ?? null,
    active: raw.active ?? true,
    stationId: raw.stationId ?? null,
    effectiveStationId: raw.effectiveStationId ?? null,
    effectiveStationCode: raw.effectiveStationCode ?? null,
    effectiveStationName: raw.effectiveStationName ?? null,
    source: toSource(raw.source),
  };
}

export function adaptMenuRouting(raw: ApiMenuRouting): MenuRouting {
  return {
    branchId: raw.branchId,
    categories: (raw.categories ?? []).map(adaptCategoryRoute),
    items: (raw.items ?? []).map(adaptItemRoute),
  };
}
