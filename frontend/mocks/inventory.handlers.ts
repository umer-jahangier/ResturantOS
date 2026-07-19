import { http, HttpResponse } from "msw";

// NOTE: ids below must be well-formed UUIDs (hex only) — apiMenuItemCatalogSchema/
// apiIngredientSchema/apiUomSchema/apiRecipeSchema all validate id-ish fields with
// z.string().uuid(), and InventoryRepository always .parse()s before adapting (FE-08).
const MENU_ITEM_BURGER = "21111111-1111-4111-8111-111111110001";
const MENU_ITEM_BIRYANI = "21111111-1111-4111-8111-111111110002";
const MENU_ITEM_CAKE = "21111111-1111-4111-8111-111111110003";

const ING_CHICKEN = "31111111-1111-4111-8111-111111110001";
const ING_FLOUR = "31111111-1111-4111-8111-111111110002";
const ING_SUGAR = "31111111-1111-4111-8111-111111110003";

const UOM_KG = "41111111-1111-4111-8111-111111110001";
const UOM_G = "41111111-1111-4111-8111-111111110002";

const RECIPE_BURGER_V1 = "51111111-1111-4111-8111-111111110001";

interface MockMenuItemCatalogEntry {
  menuItemId: string;
  name: string;
  categoryName: string | null;
  active: boolean;
  basePricePaisa: number;
}

/** 08.1-02: the synced menu-item catalog — 3 active entries seed the recipe-builder picker. */
const menuItems: MockMenuItemCatalogEntry[] = [
  { menuItemId: MENU_ITEM_BURGER, name: "Zinger Burger", categoryName: "Burgers", active: true, basePricePaisa: 65_000 },
  { menuItemId: MENU_ITEM_BIRYANI, name: "Chicken Biryani", categoryName: "Rice", active: true, basePricePaisa: 85_000 },
  { menuItemId: MENU_ITEM_CAKE, name: "Chocolate Cake", categoryName: "Desserts", active: true, basePricePaisa: 45_000 },
];

interface MockIngredient {
  id: string;
  name: string;
  sku: string | null;
  baseUomCode: string;
  category: string | null;
  reorderPoint: string;
  active: boolean;
}

const ingredients: MockIngredient[] = [
  { id: ING_CHICKEN, name: "Chicken", sku: "ING-CHK", baseUomCode: "kg", category: "Meat", reorderPoint: "10", active: true },
  { id: ING_FLOUR, name: "Flour", sku: "ING-FLR", baseUomCode: "kg", category: "Dry Goods", reorderPoint: "20", active: true },
  { id: ING_SUGAR, name: "Sugar", sku: "ING-SGR", baseUomCode: "kg", category: "Dry Goods", reorderPoint: "15", active: true },
];

interface MockUom {
  id: string;
  code: string;
  name: string;
  baseUnitCode: string | null;
  toBaseFactor: string;
}

const uoms: MockUom[] = [
  { id: UOM_KG, code: "kg", name: "Kilogram", baseUnitCode: "kg", toBaseFactor: "1" },
  { id: UOM_G, code: "g", name: "Gram", baseUnitCode: "kg", toBaseFactor: "0.001" },
];

interface MockRecipeLine {
  id: string;
  ingredientId: string;
  qty: string;
  uomCode: string;
  yieldPct: string | null;
}

interface MockRecipe {
  id: string;
  menuItemId: string;
  version: number;
  current: boolean;
  effectiveFrom: string;
  yieldServings: string;
  name: string | null;
  lines: MockRecipeLine[];
}

/**
 * In-memory mutable recipe store, seeded with ONE existing version for the burger (so
 * `listRecipeVersions`/coverage have real data before any create) — createRecipe/getCoverage
 * read/write this same array across calls within a test.
 */
const recipes: MockRecipe[] = [
  {
    id: RECIPE_BURGER_V1,
    menuItemId: MENU_ITEM_BURGER,
    version: 1,
    current: true,
    effectiveFrom: "2026-06-01T00:00:00Z",
    yieldServings: "1",
    name: "Zinger Burger v1",
    lines: [
      { id: "61111111-1111-4111-8111-111111110001", ingredientId: ING_CHICKEN, uomCode: "kg", qty: "0.2", yieldPct: "95" },
      { id: "61111111-1111-4111-8111-111111110002", ingredientId: ING_FLOUR, uomCode: "kg", qty: "0.1", yieldPct: null },
    ],
  },
];

let recipeSeq = recipes.length;
let recipeLineSeq = recipes.reduce((sum, r) => sum + r.lines.length, 0);

function ok<T>(data: T) {
  return HttpResponse.json({ data, meta: null, warnings: [] });
}

function apiError(code: string, message: string, status: number) {
  return HttpResponse.json(
    { error: { code, message, details: [], traceId: "mock-trace-id" } },
    { status },
  );
}

interface CreateRecipeLineBody {
  ingredientId: string;
  qty: string;
  uomCode: string;
  yieldPct?: number;
}

interface CreateRecipeBody {
  menuItemId: string;
  yieldServings: string;
  effectiveFrom?: string | null;
  name?: string;
  lines: CreateRecipeLineBody[];
}

/** getCoverage() recomputes covered/missing from the in-memory `recipes` array against `menuItems`. */
function computeCoverage() {
  const activeMenuItems = menuItems.filter((mi) => mi.active);
  const coveredIds = new Set(
    recipes.filter((r) => r.current).map((r) => r.menuItemId),
  );
  const missing = activeMenuItems
    .filter((mi) => !coveredIds.has(mi.menuItemId))
    .map((mi) => ({ menuItemId: mi.menuItemId, name: mi.name }));
  return {
    totalActiveMenuItems: activeMenuItems.length,
    covered: activeMenuItems.length - missing.length,
    missing,
  };
}

/** MSW fixtures for the inventory recipe-builder + coverage dashboard (08.1-04, D-04). */
export const inventoryHandlers = [
  http.get("*/api/v1/inventory/menu-items", () => ok(menuItems.filter((mi) => mi.active))),

  http.get("*/api/v1/inventory/ingredients", () => ok(ingredients)),

  http.get("*/api/v1/inventory/uom", () => ok(uoms)),

  // INV-10: create a new recipe version. Rejects an empty menuItemId/lines the same way the real
  // backend's Bean Validation would (client-side createRecipeInputSchema already guards this, but
  // the mock stays defensive for direct-fetch test scenarios).
  http.post("*/api/v1/inventory/recipes", async ({ request }) => {
    const body = (await request.json()) as CreateRecipeBody;
    if (!body.menuItemId || !body.lines?.length) {
      return apiError("VALIDATION_ERROR", "menuItemId and at least one line are required", 400);
    }
    const menuItem = menuItems.find((mi) => mi.menuItemId === body.menuItemId);
    if (!menuItem) {
      return apiError("MENU_ITEM_NOT_FOUND", "Menu item not found in the synced catalog", 404);
    }

    // A new version supersedes any prior current version for the same menu item.
    for (const r of recipes) {
      if (r.menuItemId === body.menuItemId) r.current = false;
    }
    const priorVersions = recipes.filter((r) => r.menuItemId === body.menuItemId).length;
    recipeSeq += 1;
    const id = `51111111-1111-4111-8111-${String(recipeSeq).padStart(12, "0")}`;
    const lines: MockRecipeLine[] = body.lines.map((l) => {
      recipeLineSeq += 1;
      return {
        id: `61111111-1111-4111-8111-${String(recipeLineSeq).padStart(12, "0")}`,
        ingredientId: l.ingredientId,
        qty: l.qty,
        uomCode: l.uomCode,
        yieldPct: l.yieldPct != null ? String(l.yieldPct) : null,
      };
    });
    const created: MockRecipe = {
      id,
      menuItemId: body.menuItemId,
      version: priorVersions + 1,
      current: true,
      effectiveFrom: body.effectiveFrom ?? new Date().toISOString(),
      yieldServings: body.yieldServings,
      name: body.name ?? null,
      lines,
    };
    recipes.push(created);
    return ok(created);
  }),

  http.get("*/api/v1/inventory/recipes", ({ request }) => {
    const url = new URL(request.url);
    const menuItemId = url.searchParams.get("menuItemId");
    const rows = menuItemId ? recipes.filter((r) => r.menuItemId === menuItemId) : recipes;
    return ok(rows);
  }),

  http.get("*/api/v1/inventory/recipes/coverage", () => ok(computeCoverage())),
];
