package io.restaurantos.inventory.service;

import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.domain.model.IngredientAllergen;
import io.restaurantos.inventory.domain.model.IngredientUomConversion;
import io.restaurantos.inventory.domain.model.ItemCategory;
import io.restaurantos.inventory.domain.model.UnitOfMeasure;
import io.restaurantos.inventory.dto.InventoryDtos.CreateIngredientRequest;
import io.restaurantos.inventory.dto.InventoryDtos.CreateUomRequest;
import io.restaurantos.inventory.dto.InventoryDtos.IngredientCategoryLookupDto;
import io.restaurantos.inventory.dto.InventoryDtos.IngredientConversionDto;
import io.restaurantos.inventory.dto.InventoryDtos.IngredientDto;
import io.restaurantos.inventory.dto.InventoryDtos.UomDto;
import io.restaurantos.inventory.dto.InventoryDtos.UpdateIngredientRequest;
import io.restaurantos.inventory.exception.IngredientCategoryInvalidException;
import io.restaurantos.inventory.repository.IngredientAllergenRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.IngredientUomConversionRepository;
import io.restaurantos.inventory.repository.InventoryMovementRepository;
import io.restaurantos.inventory.repository.ItemCategoryRepository;
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
    private final TenantContext tenantContext;

    public IngredientService(IngredientRepository ingredientRepository,
                              UnitOfMeasureRepository uomRepository,
                              IngredientUomConversionRepository conversionRepository,
                              IngredientAllergenRepository allergenRepository,
                              ItemCategoryRepository itemCategoryRepository,
                              InventoryMovementRepository movementRepository,
                              StockLotRepository stockLotRepository,
                              TenantContext tenantContext) {
        this.ingredientRepository = ingredientRepository;
        this.uomRepository = uomRepository;
        this.conversionRepository = conversionRepository;
        this.allergenRepository = allergenRepository;
        this.itemCategoryRepository = itemCategoryRepository;
        this.movementRepository = movementRepository;
        this.stockLotRepository = stockLotRepository;
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

        Ingredient ingredient = new Ingredient();
        ingredient.setTenantId(tenantId);
        ingredient.setName(request.name());
        ingredient.setSku(request.sku());
        ingredient.setBaseUomCode(request.baseUomCode());
        ingredient.setCategoryId(request.categoryId());
        applyMasterDataFields(ingredient, request.shortName(), request.description(), request.itemType(),
                request.producedByRecipeId(), request.measureType(), request.recipeUomCode(),
                request.defaultYieldPct(), request.storageLocation(), request.shelfLifeDays(),
                request.perishable(), request.parLevel());
        ingredient.setReorderPoint(request.reorderPoint());
        ingredient.setActive(true);

        Ingredient saved = ingredientRepository.save(ingredient);
        replaceConversions(tenantId, saved.getId(), request.conversions());
        replaceAllergens(tenantId, saved.getId(), request.allergenCodes());

        return toDtos(List.of(saved), tenantId).get(0);
    }

    @Transactional
    public IngredientDto updateIngredient(UUID id, UpdateIngredientRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        Ingredient ingredient = requireIngredient(tenantId, id);
        requireAssignableCategory(tenantId, request.categoryId());

        String requestedMeasureType = normalizeMeasureType(request.measureType());
        boolean measureTypeLocked = isMeasureTypeLocked(tenantId, id);
        if (!Objects.equals(ingredient.getMeasureType(), requestedMeasureType) && measureTypeLocked) {
            throw new StateInvalidException(MEASURE_TYPE_LOCK_MESSAGE);
        }

        ingredient.setName(request.name());
        ingredient.setBaseUomCode(request.baseUomCode());
        ingredient.setCategoryId(request.categoryId());
        applyMasterDataFields(ingredient, request.shortName(), request.description(), request.itemType(),
                request.producedByRecipeId(), requestedMeasureType, request.recipeUomCode(),
                request.defaultYieldPct(), request.storageLocation(), request.shelfLifeDays(),
                request.perishable(), request.parLevel());
        ingredient.setReorderPoint(request.reorderPoint());
        ingredient.setActive(request.active());

        Ingredient saved = ingredientRepository.save(ingredient);
        replaceConversions(tenantId, saved.getId(), request.conversions());
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

    public List<UomDto> listUoms() {
        return uomRepository.findAll().stream().map(IngredientService::toDto).toList();
    }

    @Transactional
    public UomDto createUom(CreateUomRequest request) {
        UnitOfMeasure uom = new UnitOfMeasure();
        uom.setTenantId(tenantContext.requireTenantId());
        uom.setCode(request.code());
        uom.setName(request.name());
        uom.setBaseUnitCode(request.baseUnitCode());
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

    private void applyMasterDataFields(Ingredient ingredient, String shortName, String description, String itemType,
                                        UUID producedByRecipeId, String measureType, String recipeUomCode,
                                        BigDecimal defaultYieldPct, String storageLocation, Integer shelfLifeDays,
                                        Boolean perishable, BigDecimal parLevel) {
        ingredient.setShortName(shortName);
        ingredient.setDescription(description);
        ingredient.setItemType(itemType == null || itemType.isBlank() ? "PURCHASED" : itemType);
        ingredient.setProducedByRecipeId(producedByRecipeId);
        ingredient.setMeasureType(normalizeMeasureType(measureType));
        ingredient.setRecipeUomCode(recipeUomCode);
        ingredient.setDefaultYieldPct(defaultYieldPct != null ? defaultYieldPct : BigDecimal.valueOf(100));
        ingredient.setStorageLocation(storageLocation);
        ingredient.setShelfLifeDays(shelfLifeDays);
        ingredient.setPerishable(Boolean.TRUE.equals(perishable));
        ingredient.setParLevel(parLevel != null ? parLevel : BigDecimal.ZERO);
    }

    private static String normalizeMeasureType(String measureType) {
        return measureType == null || measureType.isBlank() ? "COUNT" : measureType;
    }

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
                uom.getBaseUnitCode(),
                uom.getToBaseFactor());
    }
}
