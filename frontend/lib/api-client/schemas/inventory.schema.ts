import { z } from "zod";

// `qty`/`yieldServings`/`yieldPct`/`reorderPoint`/`toBaseFactor` are backend BigDecimal fields
// (RecipeDtos.java / InventoryDtos.java) with no custom Jackson serializer, so the real API
// returns them as a JSON number (e.g. `100` or `12.5`), not a string — coerce either shape to a
// string so downstream qty/yield formatting has one consistent type (mirrors purchasing.schema's
// `qtyField`).
const qtyField = z.union([z.string(), z.number()]).transform((v) => String(v));

// Same coercion, used only for write-payload (input) fields where the server accepts either
// shape but the caller may already hold a plain number (e.g. a controlled numeric input).
const qtyInputField = z.union([z.string(), z.number()]);

// Mirrors MenuItemCatalogDto (services/inventory-service .../dto/MenuItemCatalogDtos.java) — the
// 08.1-02 read-model synced from pos-service's menu catalog via MenuItemCatalogConsumer.
export const apiMenuItemCatalogSchema = z.object({
  menuItemId: z.string().uuid(),
  name: z.string(),
  categoryName: z.string().nullable().optional(),
  active: z.boolean(),
  basePricePaisa: z.number().int(),
});

// ── Item categories (INV-13, ItemCategoryDtos.java / plan 08.2-06) ─────────────────────────────

// Mirrors ItemCategoryDtos.ResolvedGlAccountsDto exactly (inventoryAccountCode/costAccountCode/
// wasteAccountCode/inventoryInherited/costInherited/wasteInherited) — the most-specific-wins GL
// account resolution; the `*Inherited` flags drive the UI's "(inherited)" suffix without the
// browser re-deriving anything.
export const apiResolvedGlAccountsSchema = z.object({
  inventoryAccountCode: z.string().nullable().optional(),
  costAccountCode: z.string().nullable().optional(),
  wasteAccountCode: z.string().nullable().optional(),
  inventoryInherited: z.boolean(),
  costInherited: z.boolean(),
  wasteInherited: z.boolean(),
});

// Mirrors ItemCategoryDtos.ItemCategoryDto exactly (id/parentId/level/code/name/
// defaultInventoryAccountCode/defaultCostAccountCode/defaultWasteAccountCode/varianceCapPct/
// excludeFromPoSuggestions/sortOrder/archivedAt/ingredientCount/resolvedGlAccounts).
export const apiItemCategorySchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional(),
  level: z.number().int(),
  code: z.string().nullable().optional(),
  name: z.string(),
  defaultInventoryAccountCode: z.string().nullable().optional(),
  defaultCostAccountCode: z.string().nullable().optional(),
  defaultWasteAccountCode: z.string().nullable().optional(),
  varianceCapPct: qtyField.nullable().optional(),
  excludeFromPoSuggestions: z.boolean(),
  sortOrder: z.number().int(),
  archivedAt: z.string().nullable().optional(),
  ingredientCount: z.number().int(),
  resolvedGlAccounts: apiResolvedGlAccountsSchema,
});

type ItemCategoryValue = z.infer<typeof apiItemCategorySchema>;

/** Recursive shape mirroring ItemCategoryDtos.ItemCategoryNodeDto exactly (category/children). */
type ItemCategoryNodeShape = {
  category: ItemCategoryValue;
  children: ItemCategoryNodeShape[];
};

// Mirrors ItemCategoryDtos.ItemCategoryNodeDto exactly (category/children) — the tree returned by
// GET /api/v1/inventory/categories/tree. Recursive, hence `z.lazy` + the explicit
// `z.ZodType<ItemCategoryNodeShape>` annotation so TypeScript can infer the tree type without an
// implicit `any`.
export const apiItemCategoryNodeSchema: z.ZodType<ItemCategoryNodeShape> = z.lazy(() =>
  z.object({
    category: apiItemCategorySchema,
    children: z.array(apiItemCategoryNodeSchema),
  }),
);

// Mirrors ItemCategoryDtos.CreateItemCategoryRequest exactly. `tenantId`/`level` are intentionally
// absent — the server derives both (resolved from TenantContext/JWT and the parent's level).
export const createItemCategoryInputSchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  name: z.string().min(1, "Name is required").max(160),
  code: z.string().max(40).optional(),
  defaultInventoryAccountCode: z.string().optional(),
  defaultCostAccountCode: z.string().optional(),
  defaultWasteAccountCode: z.string().optional(),
  varianceCapPct: qtyInputField.optional(),
  excludeFromPoSuggestions: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

// Mirrors ItemCategoryDtos.UpdateItemCategoryRequest exactly — every create field except
// `parentId` (re-parenting goes through `moveItemCategoryInputSchema`/`PUT .../parent` instead).
export const updateItemCategoryInputSchema = createItemCategoryInputSchema.omit({ parentId: true });

// Mirrors ItemCategoryDtos.MoveItemCategoryRequest exactly — `newParentId` nullable means
// "make this a root".
export const moveItemCategoryInputSchema = z.object({
  newParentId: z.string().uuid().nullable().optional(),
});

// ── Ingredient master data (INV-01/INV-14, InventoryDtos.java / plan 08.2-09) ──────────────────

// Mirrors InventoryDtos.IngredientConversionDto exactly (fromUomCode/toUomCode/factor/note).
export const apiIngredientConversionSchema = z.object({
  fromUomCode: z.string(),
  toUomCode: z.string(),
  factor: qtyField,
  note: z.string().nullable().optional(),
});

const ingredientConversionInputSchema = z.object({
  fromUomCode: z.string().min(1, "Source unit is required"),
  toUomCode: z.string().min(1, "Target unit is required"),
  factor: qtyInputField,
  note: z.string().optional(),
});

// Mirrors InventoryDtos.CreateIngredientRequest exactly. `categoryId` is REQUIRED (D-02: exactly
// one deterministic primary category) — the client-side gate mirrors the backend's `@NotNull` and
// the DB-level NOT NULL FK.
export const createIngredientInputSchema = z.object({
  name: z.string().min(1, "Name is required"),
  sku: z.string().min(1, "SKU is required"),
  baseUomCode: z.string().min(1, "Base unit is required"),
  categoryId: z.string().uuid("A category is required"),
  shortName: z.string().optional(),
  description: z.string().optional(),
  itemType: z.string().optional(),
  producedByRecipeId: z.string().uuid().optional(),
  measureType: z.string().optional(),
  recipeUomCode: z.string().optional(),
  defaultYieldPct: qtyInputField.optional(),
  storageLocation: z.string().optional(),
  shelfLifeDays: z.number().int().positive().optional(),
  perishable: z.boolean().optional(),
  reorderPoint: qtyInputField,
  parLevel: qtyInputField.optional(),
  conversions: z.array(ingredientConversionInputSchema).optional(),
  allergenCodes: z.array(z.string()).optional(),
});

// Mirrors InventoryDtos.UpdateIngredientRequest exactly — every create field except `sku`
// (immutable after creation), plus the required `active` flag.
export const updateIngredientInputSchema = createIngredientInputSchema.omit({ sku: true }).extend({
  active: z.boolean(),
});

// Mirrors InventoryDtos.IngredientDto exactly — REWRITTEN, not extended: the free-text `category`
// field is GONE, replaced by `categoryId`/`categoryName`/`categoryPath`; `measureTypeLocked` and
// `archivedAt` are new (08.2-09).
export const apiIngredientSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  sku: z.string().nullable().optional(),
  baseUomCode: z.string(),
  categoryId: z.string().uuid(),
  categoryName: z.string().nullable().optional(),
  categoryPath: z.string().nullable().optional(),
  shortName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  itemType: z.string().nullable().optional(),
  producedByRecipeId: z.string().uuid().nullable().optional(),
  measureType: z.string().nullable().optional(),
  measureTypeLocked: z.boolean(),
  recipeUomCode: z.string().nullable().optional(),
  defaultYieldPct: qtyField.nullable().optional(),
  storageLocation: z.string().nullable().optional(),
  shelfLifeDays: z.number().int().nullable().optional(),
  perishable: z.boolean(),
  reorderPoint: qtyField,
  parLevel: qtyField.nullable().optional(),
  conversions: z.array(apiIngredientConversionSchema),
  allergenCodes: z.array(z.string()),
  archivedAt: z.string().nullable().optional(),
  active: z.boolean(),
});

// Mirrors InventoryDtos.UomDto (id/code/name/baseUnitCode/toBaseFactor) — returned by
// GET /api/v1/inventory/uom (UnitOfMeasureController).
export const apiUomSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  baseUnitCode: z.string().nullable().optional(),
  toBaseFactor: qtyField,
});

// ── Stock levels (INV-15, StockLevelDtos.java / plan 08.2-02) ──────────────────────────────────

// Mirrors StockLevelDtos.StockLevelDto exactly (ingredientId/ingredientName/sku/baseUomCode/
// categoryId/categoryName/qtyOnHand/reorderPoint/avgCostPaisa/stockValuePaisa/lastCountedAt, plus
// two server-derived warning flags) — the flags are computed backend-side so the stock screen's
// warning/destructive row washes can never drift from backend semantics.
export const apiStockLevelSchema = z.object({
  ingredientId: z.string().uuid(),
  ingredientName: z.string(),
  sku: z.string().nullable().optional(),
  baseUomCode: z.string(),
  categoryId: z.string().uuid().nullable().optional(),
  categoryName: z.string().nullable().optional(),
  qtyOnHand: qtyField,
  reorderPoint: qtyField,
  avgCostPaisa: z.number().int(),
  stockValuePaisa: z.number().int(),
  lastCountedAt: z.string().nullable().optional(),
  belowReorderPoint: z.boolean(),
  nonPositive: z.boolean(),
});

// Mirrors StockLevelDtos.StockLevelsResponse exactly (branchId/items/totalStockValuePaisa) — the
// GET /api/v1/inventory/stock response envelope.
export const apiStockLevelsResponseSchema = z.object({
  branchId: z.string().uuid(),
  items: z.array(apiStockLevelSchema),
  totalStockValuePaisa: z.number().int(),
});

// ── Recipes / BOM / coverage / cost-preview (INV-02/INV-11/INV-15, RecipeDtos.java) ────────────

// One ingredient line in the create-recipe write payload — mirrors RecipeDtos.RecipeLineRequest's
// writable fields (ingredientId, qty, uomCode, yieldPct). `qty`/`uomCode` are client-required;
// `yieldPct` is optional (server-side default applies when omitted).
export const recipeLineInputSchema = z.object({
  ingredientId: z.string().uuid(),
  qty: z.string().min(1, "Quantity is required"),
  uomCode: z.string().min(1, "Unit is required"),
  yieldPct: z.number().optional(),
});

// Mirrors the (implied) CreateRecipeRequest write payload for `POST /api/v1/inventory/recipes` —
// menuItemId + yieldServings + optional effectiveFrom/name + at least one ingredient line.
export const createRecipeInputSchema = z.object({
  menuItemId: z.string().uuid(),
  yieldServings: z.string().min(1, "Yield (servings) is required"),
  effectiveFrom: z.string().nullable().optional(),
  name: z.string().optional(),
  lines: z.array(recipeLineInputSchema).min(1, "Add at least one ingredient line"),
});

// Mirrors RecipeDtos.RecipeLineDto exactly (id/ingredientId/qty/uomCode/yieldPct).
export const apiRecipeLineSchema = z.object({
  id: z.string().uuid(),
  ingredientId: z.string().uuid(),
  qty: qtyField,
  uomCode: z.string(),
  yieldPct: qtyField.nullable().optional(),
});

// Mirrors RecipeDtos.RecipeDto exactly (id/menuItemId/version/current/effectiveFrom/
// yieldServings/name/lines).
export const apiRecipeSchema = z.object({
  id: z.string().uuid(),
  menuItemId: z.string().uuid(),
  version: z.number().int(),
  current: z.boolean(),
  effectiveFrom: z.string(),
  yieldServings: qtyField,
  name: z.string().nullable().optional(),
  lines: z.array(apiRecipeLineSchema),
});

// Mirrors RecipeDtos.MissingMenuItemDto (menuItemId/name) — one active catalog menu item with no
// effective recipe as of the report time (INV-11).
export const apiMissingMenuItemSchema = z.object({
  menuItemId: z.string().uuid(),
  name: z.string(),
});

// Mirrors RecipeDtos.MenuItemCoverageDto exactly (menuItemId/name/state/scheduledFrom) — the
// three-state per-menu-item coverage detail (INV-15). `scheduledFrom` is non-null only when
// `state === "SCHEDULED"`, in which case it is the earliest future `effectiveFrom` among the
// item's versions.
export const apiMenuItemCoverageSchema = z.object({
  menuItemId: z.string().uuid(),
  name: z.string(),
  state: z.enum(["COVERED", "SCHEDULED", "NO_RECIPE"]),
  scheduledFrom: z.string().nullable().optional(),
});

// Mirrors RecipeDtos.CoverageResponse exactly (totalActiveMenuItems/covered/scheduled/noRecipe/
// items/missing) — the GET /api/v1/inventory/recipes/coverage report (INV-11/INV-15). `items` is
// the authoritative three-state list; `missing` is retained for additive backward compatibility
// with the pre-08.2-03 shape and now means NO_RECIPE only (no longer includes scheduled items).
// No component may re-derive coverage state from a boolean — `items[].state` is the single
// source of truth.
export const apiCoverageSchema = z.object({
  totalActiveMenuItems: z.number().int(),
  covered: z.number().int(),
  scheduled: z.number().int(),
  noRecipe: z.number().int(),
  items: z.array(apiMenuItemCoverageSchema),
  missing: z.array(apiMissingMenuItemSchema),
});

// Mirrors RecipeDtos.PreviewRecipeCostRequest exactly (branchId/menuItemId/yieldServings/lines).
// Reuses `recipeLineInputSchema` verbatim so the preview payload and the create-version payload
// share an identical line shape. `branchId` must equal the caller's JWT branch claim (enforced
// server-side in RecipeController) — never trusted as a free-form client choice beyond that.
export const previewRecipeCostInputSchema = z.object({
  branchId: z.string().uuid(),
  menuItemId: z.string().uuid().optional(),
  yieldServings: z.string().min(1, "Yield (servings) is required"),
  lines: z.array(recipeLineInputSchema).min(1, "Add at least one ingredient line"),
});

// Mirrors RecipeDtos.RecipeCostLineDto exactly (index/ingredientId/ingredientName/
// effectiveBaseQty/lineCostPaisa/sharePctOfBatch/warning). `lineCostPaisa`/`sharePctOfBatch` are
// null exactly when `warning` is non-null — a degraded line never carries a partial/misleading
// cost figure.
export const apiRecipeCostLineSchema = z.object({
  index: z.number().int(),
  ingredientId: z.string().uuid(),
  ingredientName: z.string(),
  effectiveBaseQty: qtyField,
  lineCostPaisa: z.number().int().nullable().optional(),
  sharePctOfBatch: z.number().int().nullable().optional(),
  warning: z.string().nullable().optional(),
});

// Mirrors RecipeDtos.RecipeCostPreviewDto exactly (batchCostPaisa/portionCostPaisa/
// yieldServings/menuItemPricePaisa/foodCostPct/excludedLineCount/lines) — the non-persisting
// plate-cost preview response (INV-15). `foodCostPct` is null whenever `menuItemPricePaisa` is
// null or zero.
export const apiRecipeCostPreviewSchema = z.object({
  batchCostPaisa: z.number().int(),
  portionCostPaisa: z.number().int(),
  yieldServings: qtyField,
  menuItemPricePaisa: z.number().int().nullable().optional(),
  foodCostPct: qtyField.nullable().optional(),
  excludedLineCount: z.number().int(),
  lines: z.array(apiRecipeCostLineSchema),
});
