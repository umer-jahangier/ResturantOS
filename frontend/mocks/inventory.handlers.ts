import { http, HttpResponse } from "msw";

// NOTE: ids below must be well-formed UUIDs (hex only) — apiMenuItemCatalogSchema/
// apiIngredientSchema/apiUomSchema/apiRecipeSchema/apiItemCategorySchema all validate id-ish
// fields with z.string().uuid(), and InventoryRepository always .parse()s before adapting (FE-08).

// Mirrors mocks/handlers.ts's demo branch — the finance/pos mocks already standardise on this id.
const BRANCH_ID = "b0000001-0000-4000-8000-000000000001";

const MENU_ITEM_BURGER = "21111111-1111-4111-8111-111111110001";
const MENU_ITEM_BIRYANI = "21111111-1111-4111-8111-111111110002";
const MENU_ITEM_CAKE = "21111111-1111-4111-8111-111111110003";

const ING_CHICKEN = "31111111-1111-4111-8111-111111110001";
const ING_FLOUR = "31111111-1111-4111-8111-111111110002";
const ING_SUGAR = "31111111-1111-4111-8111-111111110003";
// 08.2-17: a pure non-positive (destructive-only, no warning) fixture — reorderPoint "0" means
// belowReorderPoint can never be true for this ingredient (mirrors StockLevelService.toDto()'s
// `reorderPoint.signum() > 0` guard), so the destructive-wash test has a genuinely single-flag row
// distinct from Sugar's both-flags-set case.
const ING_MILK = "31111111-1111-4111-8111-111111110004";

const UOM_KG = "41111111-1111-4111-8111-111111110001";
const UOM_G = "41111111-1111-4111-8111-111111110002";
const UOM_EACH = "41111111-1111-4111-8111-111111110003";

const LOC_WALK_IN = "81111111-1111-4111-8111-111111110001";
const LOC_DRY_STORE = "81111111-1111-4111-8111-111111110002";

const RECIPE_BURGER_V1 = "51111111-1111-4111-8111-111111110001";
const RECIPE_BIRYANI_FUTURE = "51111111-1111-4111-8111-111111110002";

const CAT_MEAT = "71111111-1111-4111-8111-111111110001";
const CAT_POULTRY = "71111111-1111-4111-8111-111111110002";
const CAT_DRY_GOODS = "71111111-1111-4111-8111-111111110003";
const CAT_BEVERAGES = "71111111-1111-4111-8111-111111110004";

interface MockMenuItemCatalogEntry {
  menuItemId: string;
  name: string;
  categoryName: string | null;
  active: boolean;
  basePricePaisa: number;
}

/** 08.1-02: the synced menu-item catalog — 3 active entries seed the recipe-builder picker. */
const menuItems: MockMenuItemCatalogEntry[] = [
  {
    menuItemId: MENU_ITEM_BURGER,
    name: "Zinger Burger",
    categoryName: "Burgers",
    active: true,
    basePricePaisa: 65_000,
  },
  {
    menuItemId: MENU_ITEM_BIRYANI,
    name: "Chicken Biryani",
    categoryName: "Rice",
    active: true,
    basePricePaisa: 85_000,
  },
  {
    menuItemId: MENU_ITEM_CAKE,
    name: "Chocolate Cake",
    categoryName: "Desserts",
    active: true,
    basePricePaisa: 45_000,
  },
];

// ── Item categories (INV-13) ───────────────────────────────────────────────────────────────
// A real 3-level tree so the archive-refusal and depth-cap paths are testable without a backend:
// Meat & Poultry (L1) -> Poultry (L2, has an ingredient) ; Dry Goods (L1, has 2 ingredients) ;
// Beverages (L1, empty — the only category the archive HAPPY path can exercise).

interface MockResolvedGlAccounts {
  inventoryAccountCode: string | null;
  costAccountCode: string | null;
  wasteAccountCode: string | null;
  inventoryInherited: boolean;
  costInherited: boolean;
  wasteInherited: boolean;
  inventoryAccountName: string | null;
  costAccountName: string | null;
  wasteAccountName: string | null;
  inventoryInheritedFrom: string | null;
  costInheritedFrom: string | null;
  wasteInheritedFrom: string | null;
}

interface MockItemCategory {
  id: string;
  parentId: string | null;
  level: number;
  code: string | null;
  name: string;
  defaultInventoryAccountCode: string | null;
  defaultCostAccountCode: string | null;
  defaultWasteAccountCode: string | null;
  varianceCapPct: string | null;
  excludeFromPoSuggestions: boolean;
  sortOrder: number;
  archivedAt: string | null;
}

const MAX_CATEGORY_LEVEL = 3;

const categories: MockItemCategory[] = [
  {
    id: CAT_MEAT,
    parentId: null,
    level: 1,
    code: "MEAT",
    name: "Meat & Poultry",
    defaultInventoryAccountCode: "1310",
    defaultCostAccountCode: "5010",
    defaultWasteAccountCode: "5910",
    varianceCapPct: "5",
    excludeFromPoSuggestions: false,
    sortOrder: 1,
    archivedAt: null,
  },
  {
    id: CAT_POULTRY,
    parentId: CAT_MEAT,
    level: 2,
    code: "POULTRY",
    name: "Poultry",
    defaultInventoryAccountCode: null,
    defaultCostAccountCode: null,
    defaultWasteAccountCode: null,
    varianceCapPct: null,
    excludeFromPoSuggestions: false,
    sortOrder: 1,
    archivedAt: null,
  },
  {
    id: CAT_DRY_GOODS,
    parentId: null,
    level: 1,
    code: "DRY",
    name: "Dry Goods",
    defaultInventoryAccountCode: "1320",
    defaultCostAccountCode: "5020",
    defaultWasteAccountCode: "5920",
    varianceCapPct: "3",
    excludeFromPoSuggestions: false,
    sortOrder: 2,
    archivedAt: null,
  },
  {
    id: CAT_BEVERAGES,
    parentId: null,
    level: 1,
    code: "BEV",
    name: "Beverages",
    defaultInventoryAccountCode: "1330",
    defaultCostAccountCode: "5030",
    defaultWasteAccountCode: "5930",
    varianceCapPct: null,
    excludeFromPoSuggestions: true,
    sortOrder: 3,
    archivedAt: null,
  },
];

let categorySeq = categories.length;

function resolveGlAccounts(category: MockItemCategory): MockResolvedGlAccounts {
  function resolve(
    field: "defaultInventoryAccountCode" | "defaultCostAccountCode" | "defaultWasteAccountCode",
  ) {
    let current: MockItemCategory | undefined = category;
    let inherited = false;
    while (current) {
      const value = current[field];
      // `from` is the category the winning value actually came from — the server sends this so the
      // form can attribute an inherited placeholder to the right ancestor.
      if (value) return { value, inherited, from: inherited ? current.name : null };
      current = categories.find((c) => c.id === current?.parentId);
      inherited = true;
    }
    return { value: null, inherited: false, from: null };
  }
  const inv = resolve("defaultInventoryAccountCode");
  const cost = resolve("defaultCostAccountCode");
  const waste = resolve("defaultWasteAccountCode");
  return {
    inventoryAccountCode: inv.value,
    costAccountCode: cost.value,
    wasteAccountCode: waste.value,
    inventoryInherited: inv.inherited,
    costInherited: cost.inherited,
    wasteInherited: waste.inherited,
    inventoryAccountName: glAccountName(inv.value),
    costAccountName: glAccountName(cost.value),
    wasteAccountName: glAccountName(waste.value),
    inventoryInheritedFrom: inv.from,
    costInheritedFrom: cost.from,
    wasteInheritedFrom: waste.from,
  };
}

// ── GL accounts (the category form's three pickers) ────────────────────────────────────────────
// Served by inventory's own narrow proxy onto finance-service's chart of accounts, so an inventory
// manager needs no finance permission. The handler filters by `usage` exactly as the server does —
// the browser is never trusted to narrow the chart itself.

interface MockGlAccount {
  id: string;
  code: string;
  name: string;
  accountType: string;
}

const glAccounts: MockGlAccount[] = [
  {
    id: "51111111-1111-4111-8111-111111110001",
    code: "1400",
    name: "Food Inventory",
    accountType: "ASSET",
  },
  {
    id: "51111111-1111-4111-8111-111111110002",
    code: "1410",
    name: "Beverage Inventory",
    accountType: "ASSET",
  },
  {
    id: "51111111-1111-4111-8111-111111110003",
    code: "5010",
    name: "Food Cost",
    accountType: "COGS",
  },
  {
    id: "51111111-1111-4111-8111-111111110004",
    code: "5020",
    name: "Beverage Cost",
    accountType: "COGS",
  },
  {
    id: "51111111-1111-4111-8111-111111110005",
    code: "6100",
    name: "Wastage & Spoilage",
    accountType: "EXPENSE",
  },
];

const GL_USAGE_TYPES: Record<string, string[]> = {
  INVENTORY: ["ASSET"],
  COST: ["COGS", "EXPENSE"],
  WASTE: ["EXPENSE", "COGS"],
};

function glAccountName(code: string | null): string | null {
  return glAccounts.find((a) => a.code === code)?.name ?? null;
}

/** Most-specific-wins walk up the category tree, mirroring ItemCategoryService's resolution. */
function resolveVarianceCapPct(categoryId: string | null): string | null {
  let current = categories.find((c) => c.id === categoryId);
  while (current) {
    if (current.varianceCapPct) return current.varianceCapPct;
    current = categories.find((c) => c.id === current?.parentId);
  }
  return null;
}

function ingredientCountForCategory(categoryId: string): number {
  return ingredients.filter((i) => i.categoryId === categoryId && i.archivedAt === null).length;
}

function toItemCategoryDto(category: MockItemCategory) {
  return {
    id: category.id,
    parentId: category.parentId,
    level: category.level,
    code: category.code,
    name: category.name,
    defaultInventoryAccountCode: category.defaultInventoryAccountCode,
    defaultCostAccountCode: category.defaultCostAccountCode,
    defaultWasteAccountCode: category.defaultWasteAccountCode,
    varianceCapPct: category.varianceCapPct,
    excludeFromPoSuggestions: category.excludeFromPoSuggestions,
    sortOrder: category.sortOrder,
    archivedAt: category.archivedAt,
    ingredientCount: ingredientCountForCategory(category.id),
    resolvedGlAccounts: resolveGlAccounts(category),
  };
}

function buildCategoryTree(includeArchived: boolean, parentId: string | null): unknown[] {
  return categories
    .filter((c) => c.parentId === parentId && (includeArchived || c.archivedAt === null))
    .map((c) => ({
      category: toItemCategoryDto(c),
      children: buildCategoryTree(includeArchived, c.id),
    }));
}

function categoryHasNonArchivedChildren(id: string): boolean {
  return categories.some((c) => c.parentId === id && c.archivedAt === null);
}

// ── Ingredients (INV-01/INV-14) ───────────────────────────────────────────────────────────────

interface MockIngredientConversion {
  fromUomCode: string;
  toUomCode: string;
  factor: string;
  note: string | null;
}

interface MockIngredient {
  id: string;
  name: string;
  sku: string | null;
  baseUomCode: string;
  categoryId: string;
  categoryName: string;
  categoryPath: string;
  shortName: string | null;
  description: string | null;
  itemType: string | null;
  producedByRecipeId: string | null;
  measureType: string | null;
  measureTypeLocked: boolean;
  recipeUomCode: string | null;
  defaultYieldPct: string | null;
  storageLocationId: string | null;
  storageLocation: string | null;
  shelfLifeDays: number | null;
  perishable: boolean;
  reorderPoint: string;
  parLevel: string | null;
  conversions: MockIngredientConversion[];
  allergenCodes: string[];
  archivedAt: string | null;
  active: boolean;
}

const ingredients: MockIngredient[] = [
  {
    id: ING_CHICKEN,
    name: "Chicken",
    sku: "ING-CHK",
    baseUomCode: "kg",
    categoryId: CAT_POULTRY,
    categoryName: "Poultry",
    categoryPath: "Meat & Poultry / Poultry",
    shortName: "Chicken",
    description: "Fresh whole chicken",
    itemType: "PURCHASED",
    producedByRecipeId: null,
    measureType: "WEIGHT",
    measureTypeLocked: false,
    recipeUomCode: "kg",
    defaultYieldPct: "95",
    storageLocationId: LOC_WALK_IN,
    storageLocation: "Walk-in Cooler",
    shelfLifeDays: 3,
    perishable: true,
    reorderPoint: "10",
    parLevel: "25",
    conversions: [],
    allergenCodes: [],
    archivedAt: null,
    active: true,
  },
  {
    id: ING_FLOUR,
    name: "Flour",
    sku: "ING-FLR",
    baseUomCode: "kg",
    categoryId: CAT_DRY_GOODS,
    categoryName: "Dry Goods",
    categoryPath: "Dry Goods",
    shortName: "Flour",
    description: "All-purpose flour",
    itemType: "PURCHASED",
    producedByRecipeId: null,
    measureType: "WEIGHT",
    measureTypeLocked: false,
    recipeUomCode: "kg",
    defaultYieldPct: "100",
    storageLocationId: LOC_DRY_STORE,
    storageLocation: "Dry Store",
    shelfLifeDays: null,
    perishable: false,
    reorderPoint: "20",
    parLevel: "50",
    conversions: [{ fromUomCode: "g", toUomCode: "kg", factor: "0.001", note: null }],
    allergenCodes: ["GLUTEN"],
    archivedAt: null,
    active: true,
  },
  {
    id: ING_SUGAR,
    name: "Sugar",
    sku: "ING-SGR",
    baseUomCode: "kg",
    categoryId: CAT_DRY_GOODS,
    categoryName: "Dry Goods",
    categoryPath: "Dry Goods",
    shortName: "Sugar",
    description: null,
    itemType: "PURCHASED",
    producedByRecipeId: null,
    measureType: "WEIGHT",
    measureTypeLocked: false,
    recipeUomCode: "kg",
    defaultYieldPct: "100",
    storageLocationId: LOC_DRY_STORE,
    storageLocation: "Dry Store",
    shelfLifeDays: null,
    perishable: false,
    reorderPoint: "15",
    parLevel: "30",
    conversions: [],
    allergenCodes: [],
    archivedAt: null,
    active: true,
  },
  {
    id: ING_MILK,
    name: "Milk",
    sku: "ING-MLK",
    baseUomCode: "l",
    categoryId: CAT_DRY_GOODS,
    categoryName: "Dry Goods",
    categoryPath: "Dry Goods",
    shortName: "Milk",
    description: null,
    itemType: "PURCHASED",
    producedByRecipeId: null,
    measureType: "VOLUME",
    measureTypeLocked: false,
    recipeUomCode: "l",
    defaultYieldPct: "100",
    storageLocationId: LOC_WALK_IN,
    storageLocation: "Walk-in Cooler",
    shelfLifeDays: 5,
    perishable: true,
    // No reorder-point tracking (0) — belowReorderPoint can never be true for this ingredient;
    // its stock row (below) is oversold to exercise the destructive-ONLY row-wash case.
    reorderPoint: "0",
    parLevel: null,
    conversions: [],
    allergenCodes: [],
    archivedAt: null,
    active: true,
  },
];

let ingredientSeq = ingredients.length;

interface MockUom {
  id: string;
  code: string;
  name: string;
  measureType: string;
  baseUnitCode: string | null;
  toBaseFactor: string;
}

// `measureType` mirrors InventoryDtos.UomDto (V7) — the ingredient form filters its Stock/Recipe
// unit selects on it, so this fixture carries at least one unit outside WEIGHT to keep that
// filtering observable rather than vacuously true.
const uoms: MockUom[] = [
  // baseUnitCode null means "this IS the family's base unit" — the same invariant the real
  // UnitOfMeasure rows carry, and what RecipeCostPreviewService.dimensionMatches reads. This
  // fixture previously pointed kg at itself, which no real row ever does.
  {
    id: UOM_KG,
    code: "kg",
    name: "Kilogram",
    measureType: "WEIGHT",
    baseUnitCode: null,
    toBaseFactor: "1",
  },
  {
    id: UOM_G,
    code: "g",
    name: "Gram",
    measureType: "WEIGHT",
    baseUnitCode: "kg",
    toBaseFactor: "0.001",
  },
  {
    id: UOM_EACH,
    code: "each",
    name: "Each",
    measureType: "COUNT",
    baseUnitCode: null,
    toBaseFactor: "1",
  },
];

let uomSeq = uoms.length;

// ── Storage locations (V10) ────────────────────────────────────────────────────────────────────
// Tenant-managed master data replacing ingredients.storage_location's free text. `ingredientCount`
// is derived from the ingredients array below rather than stored, so the archive refusal here
// behaves like the server's: it counts what is actually filed there right now.

interface MockStorageLocation {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  archivedAt: string | null;
}

const storageLocations: MockStorageLocation[] = [
  {
    id: LOC_WALK_IN,
    name: "Walk-in Cooler",
    description: "Chilled, 2–4°C",
    sortOrder: 1,
    archivedAt: null,
  },
  { id: LOC_DRY_STORE, name: "Dry Store", description: null, sortOrder: 2, archivedAt: null },
];

let storageLocationSeq = storageLocations.length;

/** The name the server would derive for an ingredient's legacy free-text column (V10). */
function storageLocationName(id: string | null | undefined): string | null {
  if (!id) return null;
  return storageLocations.find((l) => l.id === id)?.name ?? null;
}

function liveIngredientsIn(locationId: string): number {
  return ingredients.filter((i) => i.storageLocationId === locationId && i.archivedAt == null)
    .length;
}

function storageLocationDto(location: MockStorageLocation) {
  return { ...location, ingredientCount: liveIngredientsIn(location.id) };
}

// ── Stock levels (INV-15) ──────────────────────────────────────────────────────────────────────
// One row per ingredient; qtyOnHand/reorderPoint drive the belowReorderPoint/nonPositive flags —
// Chicken is intentionally below reorder point, Sugar is intentionally non-positive (oversell).

interface MockStockRow {
  ingredientId: string;
  qtyOnHand: string;
  avgCostPaisa: number;
  lastCountedAt: string | null;
}

const stockRows: MockStockRow[] = [
  {
    ingredientId: ING_CHICKEN,
    qtyOnHand: "4",
    avgCostPaisa: 85_000,
    lastCountedAt: "2026-07-20T08:00:00Z",
  },
  {
    ingredientId: ING_FLOUR,
    qtyOnHand: "35",
    avgCostPaisa: 12_000,
    lastCountedAt: "2026-07-18T08:00:00Z",
  },
  {
    ingredientId: ING_SUGAR,
    qtyOnHand: "-2",
    avgCostPaisa: 9_000,
    lastCountedAt: "2026-07-15T08:00:00Z",
  },
  {
    ingredientId: ING_MILK,
    qtyOnHand: "-3",
    avgCostPaisa: 5_000,
    lastCountedAt: "2026-07-10T08:00:00Z",
  },
];

// Fixed per-base-unit cost table backing the recipe cost-preview handler.
const COST_PER_BASE_UNIT_PAISA: Record<string, number> = {
  [ING_CHICKEN]: 85_000,
  [ING_FLOUR]: 12_000,
  [ING_SUGAR]: 9_000,
};

const INGREDIENT_NAMES: Record<string, string> = {
  [ING_CHICKEN]: "Chicken",
  [ING_FLOUR]: "Flour",
  [ING_SUGAR]: "Sugar",
};

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
 * In-memory mutable recipe store, seeded with:
 * - Burger: one PAST-dated version (`effectiveFrom` in 2026-06) → COVERED.
 * - Biryani: one FUTURE-dated version only → SCHEDULED (the state whose absence let the
 *   origin bug ship — CONTEXT.md "Carried-over defects").
 * - Cake: no versions at all → NO_RECIPE.
 * `createRecipe`/`getCoverage` read/write this same array across calls within a test.
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
      {
        id: "61111111-1111-4111-8111-111111110001",
        ingredientId: ING_CHICKEN,
        uomCode: "kg",
        qty: "0.2",
        yieldPct: "95",
      },
      {
        id: "61111111-1111-4111-8111-111111110002",
        ingredientId: ING_FLOUR,
        uomCode: "kg",
        qty: "0.1",
        yieldPct: null,
      },
    ],
  },
  {
    id: RECIPE_BIRYANI_FUTURE,
    menuItemId: MENU_ITEM_BIRYANI,
    version: 1,
    current: true,
    effectiveFrom: "2099-01-01T00:00:00Z",
    yieldServings: "1",
    name: "Chicken Biryani v1 (future)",
    lines: [
      {
        id: "61111111-1111-4111-8111-111111110003",
        ingredientId: ING_CHICKEN,
        uomCode: "kg",
        qty: "0.3",
        yieldPct: "95",
      },
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

/**
 * getCoverage() recomputes covered/scheduled/noRecipe/items from the in-memory `recipes` array
 * against `menuItems`, classified EXACTLY as RecipeService.getCoverage() does: a single captured
 * `now`, `effectiveFrom <= now` → COVERED, else the earliest future `effectiveFrom` → SCHEDULED,
 * else NO_RECIPE. `Recipe#current` is never consulted — that boolean is exactly what disagreed
 * with the backend's definition and let the origin bug ship untested (CONTEXT.md).
 */
function computeCoverage() {
  const now = new Date();
  const activeMenuItems = menuItems.filter((mi) => mi.active);
  const items: {
    menuItemId: string;
    name: string;
    state: "COVERED" | "SCHEDULED" | "NO_RECIPE";
    scheduledFrom: string | null;
  }[] = [];
  const missing: { menuItemId: string; name: string }[] = [];
  let covered = 0;
  let scheduled = 0;
  let noRecipe = 0;

  for (const item of activeMenuItems) {
    const versions = recipes.filter((r) => r.menuItemId === item.menuItemId);
    const hasEffective = versions.some((r) => new Date(r.effectiveFrom) <= now);
    const futureVersions = versions
      .map((r) => r.effectiveFrom)
      .filter((effectiveFrom) => new Date(effectiveFrom) > now)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    const earliestFuture = futureVersions[0] ?? null;

    if (hasEffective) {
      covered += 1;
      items.push({
        menuItemId: item.menuItemId,
        name: item.name,
        state: "COVERED",
        scheduledFrom: null,
      });
    } else if (earliestFuture) {
      scheduled += 1;
      items.push({
        menuItemId: item.menuItemId,
        name: item.name,
        state: "SCHEDULED",
        scheduledFrom: earliestFuture,
      });
    } else {
      noRecipe += 1;
      items.push({
        menuItemId: item.menuItemId,
        name: item.name,
        state: "NO_RECIPE",
        scheduledFrom: null,
      });
      missing.push({ menuItemId: item.menuItemId, name: item.name });
    }
  }

  return {
    totalActiveMenuItems: activeMenuItems.length,
    covered,
    scheduled,
    noRecipe,
    items,
    missing,
  };
}

interface CreateItemCategoryBody {
  parentId?: string | null;
  name: string;
  code?: string;
  defaultInventoryAccountCode?: string;
  defaultCostAccountCode?: string;
  defaultWasteAccountCode?: string;
  varianceCapPct?: string | number;
  excludeFromPoSuggestions?: boolean;
  sortOrder?: number;
}

interface CreateIngredientBody {
  name: string;
  sku: string;
  baseUomCode: string;
  categoryId: string;
  shortName?: string;
  description?: string;
  itemType?: string;
  producedByRecipeId?: string;
  measureType?: string;
  recipeUomCode?: string;
  defaultYieldPct?: string | number;
  storageLocationId?: string;
  shelfLifeDays?: number;
  perishable?: boolean;
  reorderPoint: string | number;
  parLevel?: string | number;
  conversions?: MockIngredientConversion[];
  allergenCodes?: string[];
  active?: boolean;
}

// ── Stock operations (INV-15 Screen 7, plan 08.2-17) ───────────────────────────────────────────
// The four Phase-8 write endpoints (opening-balance/receipts/transfers/counts) had no mock at
// all until this plan — mutating the SAME `stockRows` array the GET /stock handler above reads,
// so a receipt/transfer/count posted from a dialog is immediately visible on the stock page.

interface RecordOpeningBalanceBody {
  ingredientId: string;
  branchId: string;
  qty: string | number;
  unitCostPaisa: number;
  expiryDate?: string | null;
}

interface ReceiveStockBody {
  ingredientId: string;
  branchId: string;
  qty: string | number;
  unitCostPaisa: number;
  expiryDate?: string | null;
}

interface TransferLineBody {
  ingredientId: string;
  qty: string | number;
}

interface CreateTransferBody {
  fromBranchId: string;
  toBranchId: string;
  lines: TransferLineBody[];
}

interface ReceiveLineBody {
  ingredientId: string;
  qtyReceived: string | number;
}

interface ReceiveTransferBody {
  transferId: string;
  lines: ReceiveLineBody[];
}

interface CountLineBody {
  ingredientId: string;
  countedQty: string | number;
}

interface CreateStockCountBody {
  branchId: string;
  lines: CountLineBody[];
}

interface MockTransferLine {
  ingredientId: string;
  qtyShipped: string;
  qtyReceived: string | null;
  varianceQty: string | null;
  unitCostPaisa: number;
}

interface MockTransfer {
  transferId: string;
  fromBranchId: string;
  toBranchId: string;
  status: string;
  lines: MockTransferLine[];
}

const transfers: MockTransfer[] = [];
let transferSeq = 0;
let receiptSeq = 0;
let countSeq = 0;

/** Finds (or lazily creates, zero on-hand) the mutable stock row for an ingredient — mirrors the
 * always-a-row-exists shape `IngredientBranchStockRepository`'s real read path guarantees. */
function findOrCreateStockRow(ingredientId: string): MockStockRow {
  let row = stockRows.find((r) => r.ingredientId === ingredientId);
  if (!row) {
    row = { ingredientId, qtyOnHand: "0", avgCostPaisa: 0, lastCountedAt: null };
    stockRows.push(row);
  }
  return row;
}

/** Weighted-average recompute on receive — a simplified mock of `MacCalculator`'s HALF_UP
 * weighted-average (D-02's oversell-reset edge case is out of scope for this mock). */
function applyReceipt(ingredientId: string, qty: number, unitCostPaisa: number) {
  const row = findOrCreateStockRow(ingredientId);
  const oldQty = Number(row.qtyOnHand);
  const newQty = oldQty + qty;
  row.avgCostPaisa =
    newQty > 0
      ? Math.round((oldQty * row.avgCostPaisa + qty * unitCostPaisa) / newQty)
      : unitCostPaisa;
  row.qtyOnHand = String(newQty);
  return { newQtyOnHand: row.qtyOnHand, newAvgCostPaisa: row.avgCostPaisa };
}

const stockOperationHandlers = [
  http.post("*/api/v1/inventory/opening-balance", async ({ request }) => {
    const body = (await request.json()) as RecordOpeningBalanceBody;
    if (!body.ingredientId || !body.branchId || Number(body.qty) <= 0) {
      return apiError(
        "VALIDATION_ERROR",
        "ingredientId, branchId and a positive qty are required",
        400,
      );
    }
    applyReceipt(body.ingredientId, Number(body.qty), body.unitCostPaisa);
    return ok(null);
  }),

  http.post("*/api/v1/inventory/receipts", async ({ request }) => {
    const body = (await request.json()) as ReceiveStockBody;
    if (!body.ingredientId || Number(body.qty) <= 0 || !body.unitCostPaisa) {
      return apiError(
        "VALIDATION_ERROR",
        "ingredientId, a positive qty and unitCostPaisa are required",
        400,
      );
    }
    const { newQtyOnHand, newAvgCostPaisa } = applyReceipt(
      body.ingredientId,
      Number(body.qty),
      body.unitCostPaisa,
    );
    receiptSeq += 1;
    return ok({
      lotId: `81111111-1111-4111-8111-${String(receiptSeq).padStart(12, "0")}`,
      newQtyOnHand,
      newAvgCostPaisa,
    });
  }),

  http.post("*/api/v1/inventory/transfers/ship", async ({ request }) => {
    const body = (await request.json()) as CreateTransferBody;
    if (!body.fromBranchId || !body.toBranchId || !body.lines?.length) {
      return apiError(
        "VALIDATION_ERROR",
        "fromBranchId, toBranchId and at least one line are required",
        400,
      );
    }
    transferSeq += 1;
    const lines: MockTransferLine[] = body.lines.map((l) => {
      const row = findOrCreateStockRow(l.ingredientId);
      const unitCostPaisa = row.avgCostPaisa;
      row.qtyOnHand = String(Number(row.qtyOnHand) - Number(l.qty));
      return {
        ingredientId: l.ingredientId,
        qtyShipped: String(l.qty),
        qtyReceived: null,
        varianceQty: null,
        unitCostPaisa,
      };
    });
    const created: MockTransfer = {
      transferId: `91111111-1111-4111-8111-${String(transferSeq).padStart(12, "0")}`,
      fromBranchId: body.fromBranchId,
      toBranchId: body.toBranchId,
      status: "SHIPPED",
      lines,
    };
    transfers.push(created);
    return ok(created);
  }),

  // 08.2-17: the real backend gained this GET endpoint as part of this plan — no consumer
  // existed before (ship/receive were write-only). Mirrors TransferController.pending's
  // own-branch filter (the mock ignores the `branchId` query param itself since this fixture
  // set only ever seeds one destination branch, but ALL fixtures target that same branch).
  http.get("*/api/v1/inventory/transfers/pending", () =>
    ok(transfers.filter((t) => t.status === "SHIPPED")),
  ),

  http.post("*/api/v1/inventory/transfers/receive", async ({ request }) => {
    const body = (await request.json()) as ReceiveTransferBody;
    const transfer = transfers.find((t) => t.transferId === body.transferId);
    if (!transfer) return apiError("TRANSFER_NOT_FOUND", "Transfer not found", 404);
    for (const line of transfer.lines) {
      const receiveLine = body.lines.find((l) => l.ingredientId === line.ingredientId);
      const qtyReceived = receiveLine ? Number(receiveLine.qtyReceived) : 0;
      const row = findOrCreateStockRow(line.ingredientId);
      row.qtyOnHand = String(Number(row.qtyOnHand) + qtyReceived);
      line.qtyReceived = String(qtyReceived);
      line.varianceQty = String(Number(line.qtyShipped) - qtyReceived);
    }
    transfer.status = "RECEIVED";
    return ok(transfer);
  }),

  http.post("*/api/v1/inventory/counts", async ({ request }) => {
    const body = (await request.json()) as CreateStockCountBody;
    if (!body.branchId || !body.lines?.length) {
      return apiError("VALIDATION_ERROR", "branchId and at least one count line are required", 400);
    }
    let totalVarianceCostPaisa = 0;
    const lines = body.lines.map((l) => {
      const row = findOrCreateStockRow(l.ingredientId);
      const systemQty = row.qtyOnHand;
      const countedQty = String(l.countedQty);
      const varianceQty = Number(countedQty) - Number(systemQty);
      const varianceCostPaisa = Math.round(varianceQty * row.avgCostPaisa);
      totalVarianceCostPaisa += varianceCostPaisa;
      row.qtyOnHand = countedQty;
      row.lastCountedAt = new Date().toISOString();
      return {
        ingredientId: l.ingredientId,
        systemQty,
        countedQty,
        varianceQty: String(varianceQty),
        varianceCostPaisa,
      };
    });
    countSeq += 1;
    return ok({
      countId: `a1111111-1111-4111-8111-${String(countSeq).padStart(12, "0")}`,
      branchId: body.branchId,
      status: "POSTED",
      lines,
      totalVarianceCostPaisa,
    });
  }),
];

/** MSW fixtures for the inventory master-data/recipe-builder/coverage/stock surfaces (08.2-12). */
export const inventoryHandlers = [
  http.get("*/api/v1/inventory/menu-items", () => ok(menuItems.filter((mi) => mi.active))),

  // ── Item categories (INV-13) ─────────────────────────────────────────────────────────────
  http.get("*/api/v1/inventory/categories/tree", ({ request }) => {
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    return ok(buildCategoryTree(includeArchived, null));
  }),

  http.get("*/api/v1/inventory/categories/:id", ({ params }) => {
    const category = categories.find((c) => c.id === params.id);
    if (!category) return apiError("CATEGORY_NOT_FOUND", "Category not found", 404);
    return ok(toItemCategoryDto(category));
  }),

  http.get("*/api/v1/inventory/categories", ({ request }) => {
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const rows = categories.filter((c) => includeArchived || c.archivedAt === null);
    return ok(rows.map(toItemCategoryDto));
  }),

  http.post("*/api/v1/inventory/categories", async ({ request }) => {
    const body = (await request.json()) as CreateItemCategoryBody;
    if (!body.name?.trim()) {
      return apiError("VALIDATION_ERROR", "Name is required", 400);
    }
    let level = 1;
    if (body.parentId) {
      const parent = categories.find((c) => c.id === body.parentId);
      if (!parent) return apiError("CATEGORY_NOT_FOUND", "Parent category not found", 404);
      if (parent.level >= MAX_CATEGORY_LEVEL) {
        return apiError(
          "CATEGORY_VALIDATION_FAILED",
          `Categories are limited to ${MAX_CATEGORY_LEVEL} levels deep; "${parent.name}" is already at the maximum depth.`,
          400,
        );
      }
      level = parent.level + 1;
    }
    categorySeq += 1;
    const created: MockItemCategory = {
      id: `71111111-1111-4111-8111-${String(categorySeq).padStart(12, "0")}`,
      parentId: body.parentId ?? null,
      level,
      code: body.code ?? null,
      name: body.name,
      defaultInventoryAccountCode: body.defaultInventoryAccountCode ?? null,
      defaultCostAccountCode: body.defaultCostAccountCode ?? null,
      defaultWasteAccountCode: body.defaultWasteAccountCode ?? null,
      varianceCapPct: body.varianceCapPct != null ? String(body.varianceCapPct) : null,
      excludeFromPoSuggestions: body.excludeFromPoSuggestions ?? false,
      sortOrder: body.sortOrder ?? 0,
      archivedAt: null,
    };
    categories.push(created);
    return ok(toItemCategoryDto(created));
  }),

  http.put("*/api/v1/inventory/categories/:id/parent", async ({ params, request }) => {
    const category = categories.find((c) => c.id === params.id);
    if (!category) return apiError("CATEGORY_NOT_FOUND", "Category not found", 404);
    const body = (await request.json()) as { newParentId?: string | null };
    if (!body.newParentId) {
      category.parentId = null;
      category.level = 1;
      return ok(toItemCategoryDto(category));
    }
    if (body.newParentId === category.id) {
      return apiError("CATEGORY_VALIDATION_FAILED", "A category cannot be its own parent.", 400);
    }
    const newParent = categories.find((c) => c.id === body.newParentId);
    if (!newParent) return apiError("CATEGORY_NOT_FOUND", "New parent category not found", 404);
    if (newParent.level >= MAX_CATEGORY_LEVEL) {
      return apiError(
        "CATEGORY_VALIDATION_FAILED",
        `Categories are limited to ${MAX_CATEGORY_LEVEL} levels deep; "${newParent.name}" is already at the maximum depth.`,
        400,
      );
    }
    category.parentId = newParent.id;
    category.level = newParent.level + 1;
    return ok(toItemCategoryDto(category));
  }),

  http.put("*/api/v1/inventory/categories/:id", async ({ params, request }) => {
    const category = categories.find((c) => c.id === params.id);
    if (!category) return apiError("CATEGORY_NOT_FOUND", "Category not found", 404);
    const body = (await request.json()) as CreateItemCategoryBody;
    if (!body.name?.trim()) {
      return apiError("VALIDATION_ERROR", "Name is required", 400);
    }
    category.name = body.name;
    category.code = body.code ?? null;
    category.defaultInventoryAccountCode = body.defaultInventoryAccountCode ?? null;
    category.defaultCostAccountCode = body.defaultCostAccountCode ?? null;
    category.defaultWasteAccountCode = body.defaultWasteAccountCode ?? null;
    category.varianceCapPct = body.varianceCapPct != null ? String(body.varianceCapPct) : null;
    category.excludeFromPoSuggestions = body.excludeFromPoSuggestions ?? false;
    category.sortOrder = body.sortOrder ?? category.sortOrder;
    return ok(toItemCategoryDto(category));
  }),

  // Archive is refused (409 CATEGORY_IN_USE) while a non-archived child or an assigned
  // ingredient exists — mirrors ItemCategoryService.archive's D-04 refusal exactly, so the
  // refusal path is exercisable in a component test with no backend.
  http.post("*/api/v1/inventory/categories/:id/archive", ({ params }) => {
    const category = categories.find((c) => c.id === params.id);
    if (!category) return apiError("CATEGORY_NOT_FOUND", "Category not found", 404);
    const ingredientCount = ingredientCountForCategory(category.id);
    if (ingredientCount > 0) {
      return apiError(
        "CATEGORY_IN_USE",
        `Can't archive — ${ingredientCount} ingredient(s) still use this category. Reassign them, then try again.`,
        409,
      );
    }
    if (categoryHasNonArchivedChildren(category.id)) {
      return apiError(
        "CATEGORY_IN_USE",
        "Can't archive — this category still has subcategories.",
        409,
      );
    }
    category.archivedAt = new Date().toISOString();
    return ok(toItemCategoryDto(category));
  }),

  http.post("*/api/v1/inventory/categories/:id/restore", ({ params }) => {
    const category = categories.find((c) => c.id === params.id);
    if (!category) return apiError("CATEGORY_NOT_FOUND", "Category not found", 404);
    category.archivedAt = null;
    return ok(toItemCategoryDto(category));
  }),

  // ── Ingredients (INV-01/INV-14) ──────────────────────────────────────────────────────────
  http.get("*/api/v1/inventory/ingredients/:id", ({ params }) => {
    const ingredient = ingredients.find((i) => i.id === params.id);
    if (!ingredient) return apiError("INGREDIENT_NOT_FOUND", "Ingredient not found", 404);
    return ok(ingredient);
  }),

  http.get("*/api/v1/inventory/ingredients", ({ request }) => {
    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.toLowerCase();
    const categoryId = url.searchParams.get("categoryId");
    const status = url.searchParams.get("status") ?? "ACTIVE";
    let rows = ingredients;
    if (status !== "ALL") {
      const wantActive = status !== "ARCHIVED";
      rows = rows.filter((i) => i.active === wantActive);
    }
    if (categoryId) rows = rows.filter((i) => i.categoryId === categoryId);
    if (search)
      rows = rows.filter(
        (i) => i.name.toLowerCase().includes(search) || i.sku?.toLowerCase().includes(search),
      );
    return ok(rows);
  }),

  http.post("*/api/v1/inventory/ingredients", async ({ request }) => {
    const body = (await request.json()) as CreateIngredientBody;
    if (!body.name?.trim() || !body.sku?.trim() || !body.baseUomCode?.trim()) {
      return apiError("VALIDATION_ERROR", "name, sku and baseUomCode are required", 400);
    }
    const category = categories.find((c) => c.id === body.categoryId);
    if (!category) return apiError("CATEGORY_NOT_FOUND", "A valid category is required", 404);
    ingredientSeq += 1;
    const created: MockIngredient = {
      id: `31111111-1111-4111-8111-${String(ingredientSeq).padStart(12, "0")}`,
      name: body.name,
      sku: body.sku,
      baseUomCode: body.baseUomCode,
      categoryId: category.id,
      categoryName: category.name,
      categoryPath: category.name,
      shortName: body.shortName ?? null,
      description: body.description ?? null,
      itemType: body.itemType ?? null,
      producedByRecipeId: body.producedByRecipeId ?? null,
      measureType: body.measureType ?? null,
      measureTypeLocked: false,
      recipeUomCode: body.recipeUomCode ?? null,
      defaultYieldPct: body.defaultYieldPct != null ? String(body.defaultYieldPct) : null,
      storageLocationId: body.storageLocationId ?? null,
      storageLocation: storageLocationName(body.storageLocationId),
      shelfLifeDays: body.shelfLifeDays ?? null,
      perishable: body.perishable ?? false,
      reorderPoint: String(body.reorderPoint),
      parLevel: body.parLevel != null ? String(body.parLevel) : null,
      conversions: body.conversions ?? [],
      allergenCodes: body.allergenCodes ?? [],
      archivedAt: null,
      active: true,
    };
    ingredients.push(created);
    return ok(created);
  }),

  http.put("*/api/v1/inventory/ingredients/:id", async ({ params, request }) => {
    const ingredient = ingredients.find((i) => i.id === params.id);
    if (!ingredient) return apiError("INGREDIENT_NOT_FOUND", "Ingredient not found", 404);
    const body = (await request.json()) as CreateIngredientBody & { active?: boolean };
    if (!body.name?.trim() || !body.baseUomCode?.trim()) {
      return apiError("VALIDATION_ERROR", "name and baseUomCode are required", 400);
    }
    const category = categories.find((c) => c.id === body.categoryId);
    if (!category) return apiError("CATEGORY_NOT_FOUND", "A valid category is required", 404);
    ingredient.name = body.name;
    ingredient.baseUomCode = body.baseUomCode;
    ingredient.categoryId = category.id;
    ingredient.categoryName = category.name;
    ingredient.categoryPath = category.name;
    ingredient.shortName = body.shortName ?? null;
    ingredient.description = body.description ?? null;
    ingredient.itemType = body.itemType ?? null;
    ingredient.producedByRecipeId = body.producedByRecipeId ?? null;
    ingredient.measureType = body.measureType ?? null;
    ingredient.recipeUomCode = body.recipeUomCode ?? null;
    ingredient.defaultYieldPct = body.defaultYieldPct != null ? String(body.defaultYieldPct) : null;
    ingredient.storageLocationId = body.storageLocationId ?? null;
    // Derived, never echoed — mirrors IngredientService keeping the legacy text column in sync
    // with the referenced location's name (V10).
    ingredient.storageLocation = storageLocationName(body.storageLocationId);
    ingredient.shelfLifeDays = body.shelfLifeDays ?? null;
    ingredient.perishable = body.perishable ?? false;
    ingredient.reorderPoint = String(body.reorderPoint);
    ingredient.parLevel = body.parLevel != null ? String(body.parLevel) : null;
    ingredient.conversions = body.conversions ?? [];
    ingredient.allergenCodes = body.allergenCodes ?? [];
    ingredient.active = body.active ?? ingredient.active;
    return ok(ingredient);
  }),

  // D-04: archive/restore are POST sub-resources — no `del` handler exists for ingredients.
  http.post("*/api/v1/inventory/ingredients/:id/archive", ({ params }) => {
    const ingredient = ingredients.find((i) => i.id === params.id);
    if (!ingredient) return apiError("INGREDIENT_NOT_FOUND", "Ingredient not found", 404);
    ingredient.archivedAt = new Date().toISOString();
    ingredient.active = false;
    return ok(ingredient);
  }),

  http.post("*/api/v1/inventory/ingredients/:id/restore", ({ params }) => {
    const ingredient = ingredients.find((i) => i.id === params.id);
    if (!ingredient) return apiError("INGREDIENT_NOT_FOUND", "Ingredient not found", 404);
    ingredient.archivedAt = null;
    ingredient.active = true;
    return ok(ingredient);
  }),

  http.get("*/api/v1/inventory/uom", () => ok(uoms)),

  // Mirrors IngredientService.createUom's validation order, so a Setup-screen test sees the same
  // refusals a real tenant would: duplicate code, then base-unit resolution/dimension, then the
  // factor-must-be-1 rule for a unit that declares itself a family base.
  http.post("*/api/v1/inventory/uom", async ({ request }) => {
    const body = (await request.json()) as {
      code: string;
      name: string;
      measureType: string;
      baseUnitCode?: string;
      toBaseFactor: string | number;
    };
    const code = body.code?.trim() ?? "";
    const clash = uoms.find((u) => u.code.toLowerCase() === code.toLowerCase());
    if (clash) {
      return apiError(
        "UOM_DUPLICATE_CODE",
        `The unit code "${clash.code}" is already used by "${clash.name}".`,
        422,
      );
    }
    let baseUnitCode: string | null = null;
    if (body.baseUnitCode?.trim()) {
      const base = uoms.find(
        (u) => u.code.toLowerCase() === body.baseUnitCode!.trim().toLowerCase(),
      );
      if (!base) {
        return apiError(
          "UOM_NOT_FOUND",
          `Unknown unit of measure "${body.baseUnitCode}" for the base unit.`,
          422,
        );
      }
      if (base.measureType !== body.measureType) {
        return apiError(
          "UOM_DIMENSION_MISMATCH",
          `Base unit "${base.code}" measures a different quantity than this unit.`,
          422,
        );
      }
      baseUnitCode = base.code;
    } else if (Number(body.toBaseFactor) !== 1) {
      return apiError(
        "UOM_CONVERSION_INVALID",
        "A unit with no base unit is the base of its own family, so its factor must be 1.",
        422,
      );
    }
    uomSeq += 1;
    const created: MockUom = {
      id: `41111111-1111-4111-8111-${String(uomSeq).padStart(12, "0")}`,
      code,
      name: body.name.trim(),
      measureType: body.measureType,
      baseUnitCode,
      toBaseFactor: String(body.toBaseFactor),
    };
    uoms.push(created);
    return ok(created);
  }),

  // ── Storage locations (V10) ────────────────────────────────────────────────────────────────
  http.get("*/api/v1/inventory/storage-locations", ({ request }) => {
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    return ok(
      storageLocations
        .filter((l) => includeArchived || l.archivedAt == null)
        .map(storageLocationDto),
    );
  }),

  http.post("*/api/v1/inventory/storage-locations", async ({ request }) => {
    const body = (await request.json()) as {
      name: string;
      description?: string;
      sortOrder?: number;
    };
    const name = body.name?.trim() ?? "";
    const clash = storageLocations.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (clash) {
      return apiError(
        "STORAGE_LOCATION_DUPLICATE",
        `A storage location named "${clash.name}" already exists.`,
        422,
      );
    }
    storageLocationSeq += 1;
    const created: MockStorageLocation = {
      id: `81111111-1111-4111-8111-${String(storageLocationSeq).padStart(12, "0")}`,
      name,
      description: body.description?.trim() || null,
      sortOrder: body.sortOrder ?? 0,
      archivedAt: null,
    };
    storageLocations.push(created);
    return ok(storageLocationDto(created));
  }),

  http.put("*/api/v1/inventory/storage-locations/:id", async ({ params, request }) => {
    const location = storageLocations.find((l) => l.id === params.id);
    if (!location) return apiError("STORAGE_LOCATION_NOT_FOUND", "Storage location not found", 404);
    const body = (await request.json()) as {
      name: string;
      description?: string;
      sortOrder?: number;
    };
    const name = body.name?.trim() ?? "";
    const clash = storageLocations.find(
      (l) => l.id !== location.id && l.name.toLowerCase() === name.toLowerCase(),
    );
    if (clash) {
      return apiError(
        "STORAGE_LOCATION_DUPLICATE",
        `A storage location named "${clash.name}" already exists.`,
        422,
      );
    }
    location.name = name;
    location.description = body.description?.trim() || null;
    if (body.sortOrder != null) location.sortOrder = body.sortOrder;
    // Keep every ingredient's derived text in step with the rename, as the server's read path does.
    ingredients
      .filter((i) => i.storageLocationId === location.id)
      .forEach((i) => {
        i.storageLocation = location.name;
      });
    return ok(storageLocationDto(location));
  }),

  http.post("*/api/v1/inventory/storage-locations/:id/archive", ({ params }) => {
    const location = storageLocations.find((l) => l.id === params.id);
    if (!location) return apiError("STORAGE_LOCATION_NOT_FOUND", "Storage location not found", 404);
    const inUse = liveIngredientsIn(location.id);
    if (inUse > 0) {
      return apiError(
        "STORAGE_LOCATION_IN_USE",
        `Can't archive "${location.name}" — ${inUse} ${inUse === 1 ? "item is" : "items are"} still stored there. Move them first.`,
        409,
      );
    }
    location.archivedAt = new Date().toISOString();
    return ok(storageLocationDto(location));
  }),

  http.post("*/api/v1/inventory/storage-locations/:id/restore", ({ params }) => {
    const location = storageLocations.find((l) => l.id === params.id);
    if (!location) return apiError("STORAGE_LOCATION_NOT_FOUND", "Storage location not found", 404);
    location.archivedAt = null;
    return ok(storageLocationDto(location));
  }),

  http.get("*/api/v1/inventory/gl-accounts", ({ request }) => {
    const url = new URL(request.url);
    const usage = url.searchParams.get("usage") ?? "";
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const types = GL_USAGE_TYPES[usage] ?? [];
    return ok(
      glAccounts.filter(
        (a) =>
          types.includes(a.accountType) &&
          (!q || a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)),
      ),
    );
  }),

  // ── Stock levels (INV-15) ────────────────────────────────────────────────────────────────
  http.get("*/api/v1/inventory/stock", ({ request }) => {
    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.toLowerCase();
    let rows = stockRows.map((row) => {
      const ingredient = ingredients.find((i) => i.id === row.ingredientId);
      const qtyOnHand = Number(row.qtyOnHand);
      const reorderPoint = Number(ingredient?.reorderPoint ?? "0");
      const stockValuePaisa = Math.round(qtyOnHand * row.avgCostPaisa);
      return {
        ingredientId: row.ingredientId,
        ingredientName: ingredient?.name ?? "Unknown",
        sku: ingredient?.sku ?? null,
        baseUomCode: ingredient?.baseUomCode ?? "kg",
        categoryId: ingredient?.categoryId ?? null,
        categoryName: ingredient?.categoryName ?? null,
        qtyOnHand: row.qtyOnHand,
        reorderPoint: ingredient?.reorderPoint ?? "0",
        avgCostPaisa: row.avgCostPaisa,
        stockValuePaisa,
        lastCountedAt: row.lastCountedAt,
        // Mirrors StockLevelService.toDto() exactly (belowReorderPoint requires a POSITIVE
        // reorder point AND qty at-or-below it; "at or below zero" is inclusive `<=`) — fixed as
        // part of 08.2-17 (was a plain `qtyOnHand < reorderPoint` with no positive-reorder-point
        // guard, which could flag a row with reorderPoint=0 as below-reorder, unlike the real
        // backend). This is exactly the class of frontend/backend divergence this phase exists
        // to close, so it's fixed here rather than worked around with different fixture data.
        belowReorderPoint: reorderPoint > 0 && qtyOnHand <= reorderPoint,
        nonPositive: qtyOnHand <= 0,
        // Resolved most-specific-wins up the category tree, exactly as StockLevelService does via
        // ItemCategoryService.resolveDefaultsByCategory — the count sheet reads this to warn about
        // an over-cap line before the post is rejected.
        varianceCapPct: resolveVarianceCapPct(ingredient?.categoryId ?? null),
      };
    });
    if (search) {
      rows = rows.filter(
        (r) =>
          r.ingredientName.toLowerCase().includes(search) || r.sku?.toLowerCase().includes(search),
      );
    }
    return ok({
      branchId: BRANCH_ID,
      items: rows,
      totalStockValuePaisa: rows.reduce((sum, r) => sum + r.stockValuePaisa, 0),
    });
  }),

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

  // INV-15: non-persisting plate-cost preview. Costed against a fixed per-base-unit cost table;
  // an unrecognised ingredientId gets a per-line warning instead of a partial/misleading cost.
  http.post("*/api/v1/inventory/recipes/preview", async ({ request }) => {
    const body = (await request.json()) as {
      branchId: string;
      menuItemId?: string;
      yieldServings: string;
      lines: CreateRecipeLineBody[];
    };
    if (!body.lines?.length) {
      return apiError("VALIDATION_ERROR", "At least one ingredient line is required", 400);
    }
    let batchCostPaisa = 0;
    let excludedLineCount = 0;
    const costedLines = body.lines.map((line, index) => {
      const costPerUnit = COST_PER_BASE_UNIT_PAISA[line.ingredientId];
      const qty = Number(line.qty) || 0;
      const yieldFactor = line.yieldPct != null ? line.yieldPct / 100 : 1;
      const effectiveBaseQty = yieldFactor > 0 ? qty / yieldFactor : qty;
      if (costPerUnit == null) {
        excludedLineCount += 1;
        return {
          index,
          ingredientId: line.ingredientId,
          ingredientName: INGREDIENT_NAMES[line.ingredientId] ?? "Unknown ingredient",
          effectiveBaseQty: String(effectiveBaseQty),
          lineCostPaisa: null,
          sharePctOfBatch: null,
          warning: "No cost data for this ingredient — excluded from the batch total.",
        };
      }
      const lineCostPaisa = Math.round(effectiveBaseQty * costPerUnit);
      batchCostPaisa += lineCostPaisa;
      return {
        index,
        ingredientId: line.ingredientId,
        ingredientName: INGREDIENT_NAMES[line.ingredientId] ?? "Unknown",
        effectiveBaseQty: String(effectiveBaseQty),
        lineCostPaisa,
        sharePctOfBatch: null as number | null,
        warning: null as string | null,
      };
    });
    for (const line of costedLines) {
      if (line.lineCostPaisa != null && batchCostPaisa > 0) {
        line.sharePctOfBatch = Math.round((line.lineCostPaisa / batchCostPaisa) * 100);
      }
    }
    const yieldServings = Number(body.yieldServings) || 1;
    const portionCostPaisa = Math.round(batchCostPaisa / yieldServings);
    const menuItem = body.menuItemId
      ? menuItems.find((mi) => mi.menuItemId === body.menuItemId)
      : undefined;
    const menuItemPricePaisa = menuItem?.basePricePaisa ?? null;
    const foodCostPct =
      menuItemPricePaisa && menuItemPricePaisa > 0
        ? String(Math.round((portionCostPaisa / menuItemPricePaisa) * 10000) / 100)
        : null;
    return ok({
      batchCostPaisa,
      portionCostPaisa,
      yieldServings: body.yieldServings,
      menuItemPricePaisa,
      foodCostPct,
      excludedLineCount,
      lines: costedLines,
    });
  }),

  // Registered BEFORE the bare "/recipes" handler below: MSW matches in registration order, and
  // "/recipes" would otherwise never let "/recipes/options" through.
  http.get("*/api/v1/inventory/recipes/options", () =>
    ok(
      recipes
        .filter((r) => r.current)
        .map((r) => ({
          recipeId: r.id,
          menuItemId: r.menuItemId,
          menuItemName:
            menuItems.find((mi) => mi.menuItemId === r.menuItemId)?.name ?? "Unknown menu item",
          name: r.name ?? null,
          version: r.version,
        }))
        .sort((a, b) => a.menuItemName.localeCompare(b.menuItemName)),
    ),
  ),

  http.get("*/api/v1/inventory/recipes", ({ request }) => {
    const url = new URL(request.url);
    const menuItemId = url.searchParams.get("menuItemId");
    const rows = menuItemId ? recipes.filter((r) => r.menuItemId === menuItemId) : recipes;
    return ok(rows);
  }),

  http.get("*/api/v1/inventory/recipes/coverage", () => ok(computeCoverage())),

  // ── Stock operations (INV-15 Screen 7, plan 08.2-17) ─────────────────────────────────────
  ...stockOperationHandlers,
];
