package io.restaurantos.inventory.service;

import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.domain.model.IngredientAllergen;
import io.restaurantos.inventory.domain.model.IngredientUomConversion;
import io.restaurantos.inventory.domain.model.ItemCategory;
import io.restaurantos.inventory.domain.model.StorageLocation;
import io.restaurantos.inventory.domain.model.UnitOfMeasure;
import io.restaurantos.inventory.dto.InventoryDtos.CreateIngredientRequest;
import io.restaurantos.inventory.dto.InventoryDtos.CreateUomRequest;
import io.restaurantos.inventory.dto.InventoryDtos.IngredientCategoryLookupDto;
import io.restaurantos.inventory.dto.InventoryDtos.IngredientConversionDto;
import io.restaurantos.inventory.dto.InventoryDtos.IngredientDto;
import io.restaurantos.inventory.dto.InventoryDtos.UomDto;
import io.restaurantos.inventory.dto.InventoryDtos.UpdateIngredientRequest;
import io.restaurantos.inventory.exception.IngredientCategoryInvalidException;
import io.restaurantos.inventory.exception.ItemTypeInvalidException;
import io.restaurantos.inventory.exception.UomInvalidException;
import io.restaurantos.inventory.repository.IngredientAllergenRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.IngredientUomConversionRepository;
import io.restaurantos.inventory.repository.InventoryMovementRepository;
import io.restaurantos.inventory.repository.ItemCategoryRepository;
import io.restaurantos.inventory.repository.RecipeRepository;
import io.restaurantos.inventory.repository.StockLotRepository;
import io.restaurantos.inventory.repository.UnitOfMeasureRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Ingredient + unit-of-measure master-data CRUD (INV-01, INV-14). Tenant is always resolved from
 * {@link TenantContext} — a client can never supply its own tenant id (must_haves.prohibitions #2).
 *
 * <p>Every category assignment is validated against {@link ItemCategoryRepository} (D-02: exactly
 * one required, tenant-owned, non-archived primary category). Measure type locks once any
 * inventory movement or stock lot exists for the ingredient (D-06) — {@link #isMeasureTypeLocked}
 * is exposed on every {@link IngredientDto} so the UI can disable the field before submit rather
 * than surfacing a submit-time error. Archiving (D-04) never deletes: unlike categories, there is
 * no in-use refusal — an archived ingredient simply drops out of active pickers while existing
 * recipes, stock and purchase history keep resolving it.
 *
 * <p>Unit codes are validated on the same footing as the category (see {@link #resolveUnits}):
 * every {@code baseUomCode}, {@code recipeUomCode} and conversion code must resolve to a real
 * {@code units_of_measure} row for the tenant, the stock unit's dimension must agree with the
 * ingredient's measure type, and the resolved row's own code is what gets stored. Each write path
 * first calls {@link UomProvisioningService#ensureStandardUoms} so a tenant that has never had
 * units provisioned self-heals instead of rejecting every ingredient it owns.
 */
@Service
@Transactional(readOnly = true)
public class IngredientService {

    private static final String MEASURE_TYPE_LOCK_MESSAGE =
            "Can't change the unit type — stock transactions already exist for this ingredient.";
    private static final String UNCATEGORIZED = "Uncategorized";

    private final IngredientRepository ingredientRepository;
    private final UnitOfMeasureRepository uomRepository;
    private final IngredientUomConversionRepository conversionRepository;
    private final IngredientAllergenRepository allergenRepository;
    private final ItemCategoryRepository itemCategoryRepository;
    private final InventoryMovementRepository movementRepository;
    private final StockLotRepository stockLotRepository;
    private final UomProvisioningService uomProvisioningService;
    private final StorageLocationService storageLocationService;
    private final RecipeRepository recipeRepository;
    private final TenantContext tenantContext;

    public IngredientService(IngredientRepository ingredientRepository,
                              UnitOfMeasureRepository uomRepository,
                              IngredientUomConversionRepository conversionRepository,
                              IngredientAllergenRepository allergenRepository,
                              ItemCategoryRepository itemCategoryRepository,
                              InventoryMovementRepository movementRepository,
                              StockLotRepository stockLotRepository,
                              UomProvisioningService uomProvisioningService,
                              StorageLocationService storageLocationService,
                              RecipeRepository recipeRepository,
                              TenantContext tenantContext) {
        this.ingredientRepository = ingredientRepository;
        this.uomRepository = uomRepository;
        this.conversionRepository = conversionRepository;
        this.allergenRepository = allergenRepository;
        this.itemCategoryRepository = itemCategoryRepository;
        this.movementRepository = movementRepository;
        this.stockLotRepository = stockLotRepository;
        this.uomProvisioningService = uomProvisioningService;
        this.storageLocationService = storageLocationService;
        this.recipeRepository = recipeRepository;
        this.tenantContext = tenantContext;
    }

    /**
     * @param status {@code ACTIVE} (default, live/non-archived only), {@code ARCHIVED}
     *               (archived only) or {@code ALL}. Filtering happens after ONE fetch from the
     *               repository — never a per-status repository method fan-out.
     */
    public List<IngredientDto> listIngredients(String search, UUID categoryId, String status) {
        UUID tenantId = tenantContext.requireTenantId();
        List<Ingredient> all = fetchByStatus(tenantId, status);

        List<Ingredient> filtered = all.stream()
                .filter(i -> categoryId == null || categoryId.equals(i.getCategoryId()))
                .filter(i -> matchesSearch(i, search))
                .toList();

        return toDtos(filtered, tenantId);
    }

    public IngredientDto getIngredient(UUID id) {
        UUID tenantId = tenantContext.requireTenantId();
        Ingredient ingredient = requireIngredient(tenantId, id);
        return toDtos(List.of(ingredient), tenantId).get(0);
    }

    @Transactional
    public IngredientDto createIngredient(CreateIngredientRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        requireAssignableCategory(tenantId, request.categoryId());
        ResolvedUnits units = resolveUnits(tenantId, request.baseUomCode(), request.measureType(),
                request.recipeUomCode(), request.conversions());

        Ingredient ingredient = new Ingredient();
        ingredient.setTenantId(tenantId);
        ingredient.setName(request.name());
        ingredient.setSku(request.sku());
        ingredient.setBaseUomCode(units.baseUomCode());
        ingredient.setCategoryId(request.categoryId());
        applyMasterDataFields(ingredient, tenantId, request.shortName(), request.description(), request.itemType(),
                request.producedByRecipeId(), units.measureType(), units.recipeUomCode(),
                request.defaultYieldPct(), request.storageLocationId(), request.shelfLifeDays(),
                request.perishable(), request.parLevel());
        ingredient.setReorderPoint(request.reorderPoint());
        ingredient.setActive(true);

        Ingredient saved = ingredientRepository.save(ingredient);
        replaceConversions(tenantId, saved.getId(), units.conversions());
        replaceAllergens(tenantId, saved.getId(), request.allergenCodes());

        return toDtos(List.of(saved), tenantId).get(0);
    }

    @Transactional
    public IngredientDto updateIngredient(UUID id, UpdateIngredientRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        Ingredient ingredient = requireIngredient(tenantId, id);
        requireAssignableCategory(tenantId, request.categoryId());

        // The lock is checked against the RAW requested measure type, before any unit validation,
        // so an attempt to change a locked ingredient's dimension still answers with the lock
        // message rather than a dimension-mismatch complaint about the pair it was changing to —
        // the lock is the more actionable fact, and it is the outcome D-06's contract promises.
        // A blank measure type is not a change request: resolveUnits derives it from the stock
        // unit below, where it will simply agree with what the ingredient already has.
        String requestedMeasureType = trimToNull(request.measureType());
        if (requestedMeasureType != null
                && !Objects.equals(ingredient.getMeasureType(), requestedMeasureType)
                && isMeasureTypeLocked(tenantId, id)) {
            throw new StateInvalidException(MEASURE_TYPE_LOCK_MESSAGE);
        }

        ResolvedUnits units = resolveUnits(tenantId, request.baseUomCode(), request.measureType(),
                request.recipeUomCode(), request.conversions());

        ingredient.setName(request.name());
        ingredient.setBaseUomCode(units.baseUomCode());
        ingredient.setCategoryId(request.categoryId());
        applyMasterDataFields(ingredient, tenantId, request.shortName(), request.description(), request.itemType(),
                request.producedByRecipeId(), units.measureType(), units.recipeUomCode(),
                request.defaultYieldPct(), request.storageLocationId(), request.shelfLifeDays(),
                request.perishable(), request.parLevel());
        ingredient.setReorderPoint(request.reorderPoint());
        ingredient.setActive(request.active());

        Ingredient saved = ingredientRepository.save(ingredient);
        replaceConversions(tenantId, saved.getId(), units.conversions());
        replaceAllergens(tenantId, saved.getId(), request.allergenCodes());

        return toDtos(List.of(saved), tenantId).get(0);
    }

    /**
     * D-04: archive, never hard-delete. Unlike {@code ItemCategoryService.archive}, there is NO
     * in-use refusal — an archived ingredient simply drops out of active pickers while existing
     * recipes, stock and purchase history keep resolving it.
     */
    @Transactional
    public IngredientDto archiveIngredient(UUID id) {
        UUID tenantId = tenantContext.requireTenantId();
        Ingredient ingredient = requireIngredient(tenantId, id);
        ingredient.setArchivedAt(Instant.now());
        ingredient.setActive(false);
        Ingredient saved = ingredientRepository.save(ingredient);
        return toDtos(List.of(saved), tenantId).get(0);
    }

    @Transactional
    public IngredientDto restoreIngredient(UUID id) {
        UUID tenantId = tenantContext.requireTenantId();
        Ingredient ingredient = requireIngredient(tenantId, id);
        ingredient.setArchivedAt(null);
        ingredient.setActive(true);
        Ingredient saved = ingredientRepository.save(ingredient);
        return toDtos(List.of(saved), tenantId).get(0);
    }

    /**
     * Bounded batch resolution for the internal category-resolution seam
     * ({@code InternalIngredientCategoryController}) — one ingredient fetch plus one whole-tenant
     * category fetch regardless of how many ids are requested. An id that does not resolve to a
     * live ingredient in this tenant still gets an entry, labelled {@code "Uncategorized"} rather
     * than being omitted, so the caller never has to invent a fallback.
     */
    public List<IngredientCategoryLookupDto> resolveCategoryLookups(Collection<UUID> ingredientIds) {
        UUID tenantId = tenantContext.requireTenantId();
        Map<UUID, Ingredient> ingredientsById = new HashMap<>();
        for (Ingredient ingredient : ingredientRepository.findByTenantIdAndIdIn(tenantId, ingredientIds)) {
            ingredientsById.put(ingredient.getId(), ingredient);
        }
        Map<UUID, ItemCategory> categoriesById = categoriesById(tenantId);

        List<IngredientCategoryLookupDto> result = new ArrayList<>();
        for (UUID ingredientId : ingredientIds) {
            Ingredient ingredient = ingredientsById.get(ingredientId);
            if (ingredient == null) {
                result.add(new IngredientCategoryLookupDto(ingredientId, null, UNCATEGORIZED, UNCATEGORIZED));
                continue;
            }
            ItemCategory category = categoriesById.get(ingredient.getCategoryId());
            result.add(new IngredientCategoryLookupDto(
                    ingredientId, ingredient.getCategoryId(),
                    categoryName(category), categoryPath(category, categoriesById)));
        }
        return result;
    }

    /**
     * Read-WRITE by design: this is the ingredient form's only source of units, so it is also where
     * a tenant that has never been provisioned gets its standard set
     * ({@link UomProvisioningService#ensureStandardUoms}). Without that, the form's required
     * "Stock unit" select renders empty with no way to fill it — the UI never calls
     * {@code POST /api/v1/inventory/uom}.
     */
    @Transactional
    public List<UomDto> listUoms() {
        UUID tenantId = tenantContext.requireTenantId();
        return uomProvisioningService.ensureStandardUoms(tenantId).stream()
                .sorted(Comparator.comparing(UnitOfMeasure::getMeasureType, Comparator.nullsLast(String::compareTo))
                        .thenComparing(UnitOfMeasure::getCode, String.CASE_INSENSITIVE_ORDER))
                .map(IngredientService::toDto)
                .toList();
    }

    /**
     * Creates a house unit ("Case", "Bunch", "Sheet Pan") alongside the standard set.
     *
     * <p>Every field is validated here now that a screen actually calls this endpoint. Before that
     * it took whatever it was handed: a duplicate code hit {@code uq_uom_tenant_code_ci} and came
     * back as a constraint-violation 500, and an unknown or cross-dimension {@code baseUnitCode}
     * saved happily — producing a unit that {@code UomConverter} can never convert, so every recipe
     * line and receipt using it silently fails to cost.
     *
     * <p>The base unit is required for a derived unit and forbidden for a base one, which is the
     * invariant {@code RecipeCostPreviewService.dimensionMatches} reads: a null
     * {@code baseUnitCode} means "this IS the family base", so a unit claiming that while carrying
     * a factor of 12 is simply wrong.
     */
    @Transactional
    public UomDto createUom(CreateUomRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        String code = trimToNull(request.code());
        String measureType = requireMeasureType(request.measureType());

        Map<String, UnitOfMeasure> byCode = new HashMap<>();
        for (UnitOfMeasure uom : uomProvisioningService.ensureStandardUoms(tenantId)) {
            byCode.put(UomProvisioningService.normalize(uom.getCode()), uom);
        }

        UnitOfMeasure clash = byCode.get(UomProvisioningService.normalize(code));
        if (clash != null) {
            throw UomInvalidException.duplicateCode(clash.getCode(), clash.getName());
        }

        String baseUnitCode = null;
        if (trimToNull(request.baseUnitCode()) != null) {
            UnitOfMeasure base = require(byCode, request.baseUnitCode(), "the base unit");
            if (!measureType.equalsIgnoreCase(base.getMeasureType())) {
                throw UomInvalidException.dimensionMismatch(
                        "Base unit \"" + base.getCode() + "\" measures " + describe(base.getMeasureType())
                                + ", but this unit is set to " + describe(measureType) + ".");
            }
            if (base.getBaseUnitCode() != null) {
                throw UomInvalidException.conversionInvalid(
                        "\"" + base.getCode() + "\" is itself measured in \"" + base.getBaseUnitCode()
                                + "\". Convert to the base unit of the family directly.");
            }
            baseUnitCode = base.getCode();
        } else if (request.toBaseFactor().compareTo(BigDecimal.ONE) != 0) {
            throw UomInvalidException.conversionInvalid(
                    "A unit with no base unit is the base of its own family, so its factor must be 1 — got "
                            + request.toBaseFactor().stripTrailingZeros().toPlainString() + ".");
        }

        UnitOfMeasure uom = new UnitOfMeasure();
        uom.setTenantId(tenantId);
        uom.setCode(code);
        uom.setName(request.name().trim());
        uom.setMeasureType(measureType);
        uom.setBaseUnitCode(baseUnitCode);
        uom.setToBaseFactor(request.toBaseFactor());
        return toDto(uomRepository.save(uom));
    }

    // ---- helpers ----

    private List<Ingredient> fetchByStatus(UUID tenantId, String status) {
        String normalized = status == null ? "ACTIVE" : status.trim().toUpperCase(Locale.ROOT);
        return switch (normalized) {
            case "ARCHIVED" -> ingredientRepository.findByTenantIdOrderByNameAsc(tenantId).stream()
                    .filter(i -> i.getArchivedAt() != null)
                    .toList();
            case "ALL" -> ingredientRepository.findByTenantIdOrderByNameAsc(tenantId);
            default -> ingredientRepository.findByTenantIdAndArchivedAtIsNullOrderByNameAsc(tenantId);
        };
    }

    private boolean matchesSearch(Ingredient ingredient, String search) {
        if (search == null || search.isBlank()) {
            return true;
        }
        String needle = search.trim().toLowerCase(Locale.ROOT);
        boolean nameMatches = ingredient.getName() != null
                && ingredient.getName().toLowerCase(Locale.ROOT).contains(needle);
        boolean skuMatches = ingredient.getSku() != null
                && ingredient.getSku().toLowerCase(Locale.ROOT).contains(needle);
        return nameMatches || skuMatches;
    }

    private Ingredient requireIngredient(UUID tenantId, UUID id) {
        return ingredientRepository.findByTenantIdAndId(tenantId, id)
                .orElseThrow(() -> new ResourceNotFoundException("Ingredient", id));
    }

    /** D-02: the category must exist for THIS tenant (a foreign/nonexistent id is 404) and must
     * not be archived (an archived-but-tenant-owned id is 422 — it exists, but is not currently
     * assignable). */
    private void requireAssignableCategory(UUID tenantId, UUID categoryId) {
        ItemCategory category = itemCategoryRepository.findByTenantIdAndId(tenantId, categoryId)
                .orElseThrow(() -> new ResourceNotFoundException("ItemCategory", categoryId));
        if (category.getArchivedAt() != null) {
            throw new IngredientCategoryInvalidException(
                    "Can't assign \"" + category.getName() + "\" — this category is archived.");
        }
    }

    private boolean isMeasureTypeLocked(UUID tenantId, UUID ingredientId) {
        return movementRepository.existsByTenantIdAndIngredientId(tenantId, ingredientId)
                || stockLotRepository.existsByTenantIdAndIngredientId(tenantId, ingredientId);
    }

    /**
     * Resolves and validates every unit code on an ingredient write, returning the CANONICAL codes
     * to persist — i.e. each resolved {@code units_of_measure} row's own {@code code}, not the
     * casing the request happened to use. Storing the canonical form is what keeps
     * {@code RecipeCostPreviewService.dimensionMatches} and {@code UomConverter} able to line an
     * ingredient's stock unit up against a recipe line's unit later.
     *
     * <p>Rules, in order:
     * <ol>
     *   <li>The tenant's standard units are provisioned first, so a never-provisioned tenant
     *       self-heals rather than having every ingredient rejected.</li>
     *   <li>{@code baseUomCode} must resolve. This is the check whose absence let unknown unit
     *       codes save silently.</li>
     *   <li>A blank {@code measureType} is DERIVED from the stock unit rather than defaulting to
     *       {@code COUNT}. The old blind default is what produced the "Measure type: Count, stock
     *       unit: grams" rows — the request simply omitted the field and got COUNT regardless of
     *       what unit it paired with. An explicitly supplied measure type must agree.</li>
     *   <li>{@code recipeUomCode} is optional, must resolve when present, and must share the stock
     *       unit's dimension — a recipe cannot call for millilitres of an item stocked by weight.</li>
     *   <li>Both codes on every conversion row must resolve and must differ from each other.
     *       Cross-DIMENSION conversions are deliberately allowed here: "1 EACH = 0.18 KG" is the
     *       entire reason per-ingredient conversions exist, letting an item be purchased by count
     *       and stocked by weight.</li>
     * </ol>
     */
    private ResolvedUnits resolveUnits(UUID tenantId, String baseUomCode, String requestedMeasureType,
                                        String recipeUomCode, List<IngredientConversionDto> conversions) {
        Map<String, UnitOfMeasure> byCode = new HashMap<>();
        for (UnitOfMeasure uom : uomProvisioningService.ensureStandardUoms(tenantId)) {
            byCode.put(UomProvisioningService.normalize(uom.getCode()), uom);
        }

        UnitOfMeasure base = require(byCode, baseUomCode, "the stock unit");

        String measureType = trimToNull(requestedMeasureType);
        if (measureType == null) {
            measureType = base.getMeasureType();
        } else if (!measureType.equalsIgnoreCase(base.getMeasureType())) {
            throw UomInvalidException.dimensionMismatch(
                    "Stock unit \"" + base.getCode() + "\" measures " + describe(base.getMeasureType())
                            + ", but this ingredient is set to " + describe(measureType)
                            + ". Pick a " + describe(measureType) + " unit, or change the measure type.");
        }

        String resolvedRecipeUom = null;
        if (trimToNull(recipeUomCode) != null) {
            UnitOfMeasure recipeUom = require(byCode, recipeUomCode, "the recipe unit");
            if (!recipeUom.getMeasureType().equalsIgnoreCase(base.getMeasureType())) {
                throw UomInvalidException.dimensionMismatch(
                        "Recipe unit \"" + recipeUom.getCode() + "\" measures "
                                + describe(recipeUom.getMeasureType()) + ", but the stock unit \""
                                + base.getCode() + "\" measures " + describe(base.getMeasureType()) + ".");
            }
            resolvedRecipeUom = recipeUom.getCode();
        }

        List<IngredientConversionDto> resolvedConversions = new ArrayList<>();
        if (conversions != null) {
            for (IngredientConversionDto dto : conversions) {
                UnitOfMeasure from = require(byCode, dto.fromUomCode(), "a conversion's source unit");
                UnitOfMeasure to = require(byCode, dto.toUomCode(), "a conversion's target unit");
                if (from.getCode().equalsIgnoreCase(to.getCode())) {
                    throw UomInvalidException.conversionInvalid(
                            "A conversion can't go from \"" + from.getCode() + "\" to itself.");
                }
                resolvedConversions.add(new IngredientConversionDto(
                        from.getCode(), to.getCode(), dto.factor(), dto.note()));
            }
        }

        return new ResolvedUnits(base.getCode(), measureType.toUpperCase(Locale.ROOT),
                resolvedRecipeUom, resolvedConversions);
    }

    /** Canonical, validated unit codes for one ingredient write. */
    private record ResolvedUnits(String baseUomCode, String measureType, String recipeUomCode,
                                  List<IngredientConversionDto> conversions) {}

    private static UnitOfMeasure require(Map<String, UnitOfMeasure> byCode, String code, String field) {
        String normalized = UomProvisioningService.normalize(code);
        UnitOfMeasure uom = normalized == null ? null : byCode.get(normalized);
        if (uom == null) {
            throw UomInvalidException.notFound(field, code);
        }
        return uom;
    }

    /** Measure types read back to a manager as words, never as the stored enum token. */
    private static String describe(String measureType) {
        return switch (measureType == null ? "" : measureType.toUpperCase(Locale.ROOT)) {
            case "WEIGHT" -> "weight";
            case "VOLUME" -> "volume";
            case "COUNT" -> "count";
            default -> measureType;
        };
    }

    private static String requireMeasureType(String measureType) {
        String normalized = trimToNull(measureType);
        if (normalized == null) {
            return StandardUomCatalog.COUNT;
        }
        String upper = normalized.toUpperCase(Locale.ROOT);
        if (!StandardUomCatalog.WEIGHT.equals(upper)
                && !StandardUomCatalog.VOLUME.equals(upper)
                && !StandardUomCatalog.COUNT.equals(upper)) {
            throw UomInvalidException.dimensionMismatch(
                    "Measure type must be WEIGHT, VOLUME or COUNT — got \"" + measureType + "\".");
        }
        return upper;
    }

    private static String trimToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private void applyMasterDataFields(Ingredient ingredient, UUID tenantId, String shortName, String description,
                                        String itemType, UUID producedByRecipeId, String measureType,
                                        String recipeUomCode, BigDecimal defaultYieldPct, UUID storageLocationId,
                                        Integer shelfLifeDays, Boolean perishable, BigDecimal parLevel) {
        ProducedBy producedBy = resolveProducedBy(tenantId, itemType, producedByRecipeId);
        StorageLocation storageLocation = storageLocationService.resolveAssignable(tenantId, storageLocationId);

        ingredient.setShortName(shortName);
        ingredient.setDescription(description);
        ingredient.setItemType(producedBy.itemType());
        ingredient.setProducedByRecipeId(producedBy.recipeId());
        ingredient.setMeasureType(measureType);
        ingredient.setRecipeUomCode(recipeUomCode);
        ingredient.setDefaultYieldPct(defaultYieldPct != null ? defaultYieldPct : BigDecimal.valueOf(100));
        ingredient.setStorageLocationId(storageLocation == null ? null : storageLocation.getId());
        // The legacy free-text column stays written, mirroring the resolved location's name (V10).
        // V5 stopped writing ingredients.category for the same shape of change, but this one is
        // still read by reports and exports, so leaving it frozen at its pre-V10 value would make
        // it quietly disagree with the id beside it.
        ingredient.setStorageLocation(storageLocation == null ? null : storageLocation.getName());
        ingredient.setShelfLifeDays(shelfLifeDays);
        ingredient.setPerishable(Boolean.TRUE.equals(perishable));
        ingredient.setParLevel(parLevel != null ? parLevel : BigDecimal.ZERO);
    }

    /**
     * D-03: reconciles {@code itemType} with {@code producedByRecipeId}, which until now were both
     * accepted unvalidated — making {@code PREPARED}/{@code BOTH} a dead option that looked
     * meaningful on the form and meant nothing downstream.
     *
     * <p>A named recipe must exist and belong to this tenant. It is NOT required, though: the
     * recipe that produces a prep item references that item, so the item has to be creatable
     * first. Requiring the link up front would make the only correct authoring order impossible.
     */
    private ProducedBy resolveProducedBy(UUID tenantId, String itemType, UUID producedByRecipeId) {
        String resolved = trimToNull(itemType) == null
                ? "PURCHASED"
                : itemType.trim().toUpperCase(Locale.ROOT);
        if (!"PURCHASED".equals(resolved) && !"PREPARED".equals(resolved) && !"BOTH".equals(resolved)) {
            throw ItemTypeInvalidException.unknownItemType(itemType);
        }
        if (producedByRecipeId == null) {
            return new ProducedBy(resolved, null);
        }
        if ("PURCHASED".equals(resolved)) {
            throw ItemTypeInvalidException.recipeOnPurchasedItem();
        }
        recipeRepository.findByTenantIdAndId(tenantId, producedByRecipeId)
                .orElseThrow(() -> new ResourceNotFoundException("Recipe", producedByRecipeId));
        return new ProducedBy(resolved, producedByRecipeId);
    }

    private record ProducedBy(String itemType, UUID recipeId) {}

    /** Replaces the whole conversion set for one ingredient — delete-then-insert inside the
     * caller's transaction, never a partial merge. */
    private void replaceConversions(UUID tenantId, UUID ingredientId, List<IngredientConversionDto> conversions) {
        conversionRepository.deleteByTenantIdAndIngredientId(tenantId, ingredientId);
        if (conversions == null) {
            return;
        }
        for (IngredientConversionDto dto : conversions) {
            IngredientUomConversion conversion = new IngredientUomConversion();
            conversion.setTenantId(tenantId);
            conversion.setIngredientId(ingredientId);
            conversion.setFromUomCode(dto.fromUomCode());
            conversion.setToUomCode(dto.toUomCode());
            conversion.setFactor(dto.factor());
            conversion.setNote(dto.note());
            conversionRepository.save(conversion);
        }
    }

    /** Replaces the whole allergen set for one ingredient — delete-then-insert, same shape as
     * {@link #replaceConversions}. */
    private void replaceAllergens(UUID tenantId, UUID ingredientId, List<String> allergenCodes) {
        allergenRepository.deleteByTenantIdAndIngredientId(tenantId, ingredientId);
        if (allergenCodes == null) {
            return;
        }
        for (String code : allergenCodes) {
            IngredientAllergen allergen = new IngredientAllergen();
            allergen.setTenantId(tenantId);
            allergen.setIngredientId(ingredientId);
            allergen.setAllergenCode(code);
            allergenRepository.save(allergen);
        }
    }

    private Map<UUID, ItemCategory> categoriesById(UUID tenantId) {
        Map<UUID, ItemCategory> byId = new HashMap<>();
        for (ItemCategory category : itemCategoryRepository.findByTenantIdOrderBySortOrderAscNameAsc(tenantId)) {
            byId.put(category.getId(), category);
        }
        return byId;
    }

    private static String categoryName(ItemCategory category) {
        return category == null ? UNCATEGORIZED : category.getName();
    }

    /** Ancestor names joined root-to-leaf with " > " — walks {@code parentId} upward through the
     * same whole-tenant category map every caller already fetched once. */
    private static String categoryPath(ItemCategory category, Map<UUID, ItemCategory> byId) {
        if (category == null) {
            return UNCATEGORIZED;
        }
        List<String> names = new ArrayList<>();
        ItemCategory current = category;
        while (current != null) {
            names.add(0, current.getName());
            current = current.getParentId() == null ? null : byId.get(current.getParentId());
        }
        return String.join(" > ", names);
    }

    /**
     * Maps a batch of ingredients to DTOs, resolving categories, conversions, allergens and the
     * measure-type lock in a fixed, small number of queries regardless of batch size — never one
     * query per ingredient.
     */
    private List<IngredientDto> toDtos(List<Ingredient> ingredients, UUID tenantId) {
        if (ingredients.isEmpty()) {
            return List.of();
        }
        List<UUID> ids = ingredients.stream().map(Ingredient::getId).toList();

        Map<UUID, ItemCategory> categoriesById = categoriesById(tenantId);

        Map<UUID, List<IngredientConversionDto>> conversionsByIngredient = new HashMap<>();
        for (IngredientUomConversion c : conversionRepository.findByTenantIdAndIngredientIdIn(tenantId, ids)) {
            conversionsByIngredient
                    .computeIfAbsent(c.getIngredientId(), k -> new ArrayList<>())
                    .add(new IngredientConversionDto(c.getFromUomCode(), c.getToUomCode(), c.getFactor(), c.getNote()));
        }

        Map<UUID, List<String>> allergensByIngredient = new HashMap<>();
        for (IngredientAllergen a : allergenRepository.findByTenantIdAndIngredientIdIn(tenantId, ids)) {
            allergensByIngredient
                    .computeIfAbsent(a.getIngredientId(), k -> new ArrayList<>())
                    .add(a.getAllergenCode());
        }

        Set<UUID> lockedIds = new HashSet<>();
        lockedIds.addAll(movementRepository.findDistinctIngredientIdsByTenantIdAndIngredientIdIn(tenantId, ids));
        lockedIds.addAll(stockLotRepository.findDistinctIngredientIdsByTenantIdAndIngredientIdIn(tenantId, ids));

        List<IngredientDto> result = new ArrayList<>(ingredients.size());
        for (Ingredient ingredient : ingredients) {
            ItemCategory category = categoriesById.get(ingredient.getCategoryId());
            boolean measureTypeLocked = lockedIds.contains(ingredient.getId());
            result.add(new IngredientDto(
                    ingredient.getId(),
                    ingredient.getName(),
                    ingredient.getSku(),
                    ingredient.getBaseUomCode(),
                    ingredient.getCategoryId(),
                    categoryName(category),
                    categoryPath(category, categoriesById),
                    ingredient.getShortName(),
                    ingredient.getDescription(),
                    ingredient.getItemType(),
                    ingredient.getProducedByRecipeId(),
                    ingredient.getMeasureType(),
                    measureTypeLocked,
                    ingredient.getRecipeUomCode(),
                    ingredient.getDefaultYieldPct(),
                    ingredient.getStorageLocationId(),
                    ingredient.getStorageLocation(),
                    ingredient.getShelfLifeDays(),
                    ingredient.isPerishable(),
                    ingredient.getReorderPoint(),
                    ingredient.getParLevel(),
                    conversionsByIngredient.getOrDefault(ingredient.getId(), List.of()),
                    allergensByIngredient.getOrDefault(ingredient.getId(), List.of()),
                    ingredient.getArchivedAt(),
                    ingredient.isActive()));
        }
        return result;
    }

    private static UomDto toDto(UnitOfMeasure uom) {
        return new UomDto(
                uom.getId(),
                uom.getCode(),
                uom.getName(),
                uom.getMeasureType(),
                uom.getBaseUnitCode(),
                uom.getToBaseFactor());
    }
}
