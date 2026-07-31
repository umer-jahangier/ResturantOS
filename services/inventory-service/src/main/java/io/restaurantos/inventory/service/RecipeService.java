package io.restaurantos.inventory.service;

import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.domain.model.MenuItemCatalog;
import io.restaurantos.inventory.domain.model.Recipe;
import io.restaurantos.inventory.domain.model.RecipeLine;
import io.restaurantos.inventory.domain.model.UnitOfMeasure;
import io.restaurantos.inventory.dto.RecipeDtos.CoverageResponse;
import io.restaurantos.inventory.dto.RecipeDtos.CoverageState;
import io.restaurantos.inventory.dto.RecipeDtos.CreateRecipeVersionRequest;
import io.restaurantos.inventory.dto.RecipeDtos.MenuItemCoverageDto;
import io.restaurantos.inventory.dto.RecipeDtos.MissingMenuItemDto;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeDto;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeLineDto;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeLineRequest;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeOptionDto;
import io.restaurantos.inventory.exception.IngredientCategoryInvalidException;
import io.restaurantos.inventory.exception.MenuItemNotFoundException;
import io.restaurantos.inventory.exception.UomInvalidException;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.MenuItemCatalogRepository;
import io.restaurantos.inventory.repository.RecipeLineRepository;
import io.restaurantos.inventory.repository.RecipeRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Versioned recipe/BOM CRUD (INV-02) + the D-01 effective-version resolution seam that depletion
 * (08-05) calls with the order's closedAt, not "now".
 */
@Service
@Transactional(readOnly = true)
public class RecipeService {

    private final RecipeRepository recipeRepository;
    private final RecipeLineRepository recipeLineRepository;
    private final MenuItemCatalogRepository menuItemCatalogRepository;
    private final IngredientRepository ingredientRepository;
    private final UomProvisioningService uomProvisioningService;
    private final TenantContext tenantContext;

    public RecipeService(RecipeRepository recipeRepository,
                          RecipeLineRepository recipeLineRepository,
                          MenuItemCatalogRepository menuItemCatalogRepository,
                          IngredientRepository ingredientRepository,
                          UomProvisioningService uomProvisioningService,
                          TenantContext tenantContext) {
        this.recipeRepository = recipeRepository;
        this.recipeLineRepository = recipeLineRepository;
        this.menuItemCatalogRepository = menuItemCatalogRepository;
        this.ingredientRepository = ingredientRepository;
        this.uomProvisioningService = uomProvisioningService;
        this.tenantContext = tenantContext;
    }

    /**
     * The current version of every menu item's recipe, labelled with the menu item's name — the
     * option list behind the ingredient form's "Produced by" picker. Two queries regardless of how
     * many recipes the tenant has, never one name lookup per recipe.
     */
    public List<RecipeOptionDto> listOptions() {
        UUID tenantId = tenantContext.requireTenantId();
        List<Recipe> recipes = recipeRepository.findByTenantIdAndCurrentTrue(tenantId);
        if (recipes.isEmpty()) {
            return List.of();
        }
        Map<UUID, String> namesByMenuItem = new HashMap<>();
        for (MenuItemCatalog item : menuItemCatalogRepository.findByTenantIdAndActiveTrueOrderByNameAsc(tenantId)) {
            namesByMenuItem.put(item.getMenuItemId(), item.getName());
        }
        return recipes.stream()
                .map(r -> new RecipeOptionDto(
                        r.getId(),
                        r.getMenuItemId(),
                        namesByMenuItem.getOrDefault(r.getMenuItemId(), "Unknown menu item"),
                        r.getName(),
                        r.getVersion()))
                .sorted(Comparator.comparing(RecipeOptionDto::menuItemName, String.CASE_INSENSITIVE_ORDER))
                .toList();
    }

    public List<RecipeDto> listVersions(UUID menuItemId) {
        UUID tenantId = tenantContext.requireTenantId();
        return recipeRepository.findByTenantIdAndMenuItemIdOrderByVersionDesc(tenantId, menuItemId).stream()
                .map(this::toDto)
                .toList();
    }

    /**
     * D-01: the version whose effective-from window covers {@code atInstant}, most-recent-first —
     * NOT the "is current" flag. A mid-service recipe edit must not retroactively change how an
     * already-placed order depletes; callers (e.g. 08-05's depletion consumer) pass the order's
     * closedAt here, never {@code Instant.now()}.
     */
    public Optional<Recipe> resolveEffectiveRecipe(UUID menuItemId, Instant atInstant) {
        UUID tenantId = tenantContext.requireTenantId();
        return recipeRepository.findEffectiveVersionsDesc(tenantId, menuItemId, atInstant).stream().findFirst();
    }

    public RecipeDto getEffectiveRecipe(UUID menuItemId, Instant atInstant) {
        Recipe recipe = resolveEffectiveRecipe(menuItemId, atInstant)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Effective recipe for menu item " + menuItemId + " at " + atInstant));
        return toDto(recipe);
    }

    /**
     * INV-15: three-state coverage report — {@code COVERED} / {@code SCHEDULED} / {@code
     * NO_RECIPE} — computed in exactly two repository calls (no N+1 across the active menu). A
     * single {@code now} is captured before classification so a slow report cannot classify two
     * items against different clocks. Coverage state is derived exclusively from {@code
     * effectiveFrom <= now} — {@link Recipe#isCurrent()} is never consulted here; that boolean is
     * exactly what disagreed with this definition and caused the origin bug (CONTEXT.md).
     */
    public CoverageResponse getCoverage() {
        UUID tenantId = tenantContext.requireTenantId();
        List<MenuItemCatalog> activeItems = menuItemCatalogRepository.findByTenantIdAndActiveTrueOrderByNameAsc(tenantId);

        List<UUID> menuItemIds = activeItems.stream().map(MenuItemCatalog::getMenuItemId).toList();
        Map<UUID, List<Recipe>> versionsByMenuItem = menuItemIds.isEmpty()
                ? Map.of()
                : recipeRepository.findByTenantIdAndMenuItemIdInOrderByEffectiveFromDesc(tenantId, menuItemIds)
                        .stream()
                        .collect(Collectors.groupingBy(Recipe::getMenuItemId, HashMap::new, Collectors.toList()));

        Instant now = Instant.now();
        List<MenuItemCoverageDto> items = new ArrayList<>();
        List<MissingMenuItemDto> missing = new ArrayList<>();
        int covered = 0;
        int scheduled = 0;
        int noRecipe = 0;

        for (MenuItemCatalog item : activeItems) {
            List<Recipe> versions = versionsByMenuItem.getOrDefault(item.getMenuItemId(), List.of());

            boolean hasEffective = versions.stream().anyMatch(r -> !r.getEffectiveFrom().isAfter(now));
            Instant earliestFuture = versions.stream()
                    .map(Recipe::getEffectiveFrom)
                    .filter(effectiveFrom -> effectiveFrom.isAfter(now))
                    .min(Instant::compareTo)
                    .orElse(null);

            if (hasEffective) {
                covered++;
                items.add(new MenuItemCoverageDto(item.getMenuItemId(), item.getName(), CoverageState.COVERED, null));
            } else if (earliestFuture != null) {
                scheduled++;
                items.add(new MenuItemCoverageDto(
                        item.getMenuItemId(), item.getName(), CoverageState.SCHEDULED, earliestFuture));
            } else {
                noRecipe++;
                items.add(new MenuItemCoverageDto(item.getMenuItemId(), item.getName(), CoverageState.NO_RECIPE, null));
                missing.add(new MissingMenuItemDto(item.getMenuItemId(), item.getName()));
            }
        }

        return new CoverageResponse(activeItems.size(), covered, scheduled, noRecipe, items, missing);
    }

    @Transactional
    public RecipeDto createVersion(CreateRecipeVersionRequest request) {
        UUID tenantId = tenantContext.requireTenantId();

        if (!menuItemCatalogRepository.existsByTenantIdAndMenuItemIdAndActiveTrue(tenantId, request.menuItemId())) {
            throw new MenuItemNotFoundException(request.menuItemId());
        }

        List<Recipe> priorVersions =
                recipeRepository.findByTenantIdAndMenuItemIdOrderByVersionDesc(tenantId, request.menuItemId());

        int nextVersion = priorVersions.stream().findFirst().map(r -> r.getVersion() + 1).orElse(1);

        priorVersions.stream()
                .filter(Recipe::isCurrent)
                .forEach(prior -> {
                    prior.setCurrent(false);
                    recipeRepository.save(prior);
                });

        Recipe recipe = new Recipe();
        recipe.setTenantId(tenantId);
        recipe.setMenuItemId(request.menuItemId());
        recipe.setVersion(nextVersion);
        recipe.setCurrent(true);
        recipe.setEffectiveFrom(request.effectiveFrom() != null ? request.effectiveFrom() : Instant.now());
        recipe.setYieldServings(request.yieldServings());
        recipe.setName(request.name());
        Recipe savedRecipe = recipeRepository.save(recipe);

        ResolvedLines resolved = resolveLines(tenantId, request.lines());

        List<RecipeLine> lines = new ArrayList<>(request.lines().size());
        for (int i = 0; i < request.lines().size(); i++) {
            RecipeLineRequest lineRequest = request.lines().get(i);
            RecipeLine line = new RecipeLine();
            line.setTenantId(tenantId);
            line.setRecipeId(savedRecipe.getId());
            line.setIngredientId(lineRequest.ingredientId());
            line.setQty(lineRequest.qty());
            // The RESOLVED unit's own casing, not whatever the request sent. UomConverter and
            // RecipeCostPreviewService.dimensionMatches both compare codes as stored, so persisting
            // "kg" against a tenant whose row is "KG" is how a line silently stops costing.
            line.setUomCode(resolved.uomCodes().get(i));
            line.setYieldPct(lineRequest.yieldPct() != null ? lineRequest.yieldPct() : BigDecimal.valueOf(100));
            lines.add(line);
        }
        recipeLineRepository.saveAll(lines);

        return toDto(savedRecipe, lines.stream().map(RecipeService::toDto).toList());
    }

    /**
     * Validates every line of a draft recipe version before a single row is written, and returns
     * the CANONICAL unit code to persist for each.
     *
     * <p>None of this existed before: {@code createVersion} took {@code ingredientId} and
     * {@code uomCode} entirely on trust, so a recipe could name an archived item, an item belonging
     * to another tenant, or 200 ml of something stocked by weight. The failure was invisible at
     * save time and surfaced later as a line the cost preview silently excluded and depletion
     * silently skipped — the same defect class the ingredient form's unit selects had.
     *
     * <p>Cross-dimension units are refused here, unlike on an ingredient's own conversion rows
     * where crossing is the whole point. A conversion says "1 EACH of this item weighs 0.18 KG",
     * which is item-specific knowledge; a recipe line saying "200 ML of chicken" is just wrong,
     * because nothing in the system knows the density of chicken.
     */
    private ResolvedLines resolveLines(UUID tenantId, List<RecipeLineRequest> lineRequests) {
        List<UUID> ingredientIds = lineRequests.stream().map(RecipeLineRequest::ingredientId).distinct().toList();
        Map<UUID, Ingredient> ingredientsById = new HashMap<>();
        for (Ingredient ingredient : ingredientRepository.findByTenantIdAndIdIn(tenantId, ingredientIds)) {
            ingredientsById.put(ingredient.getId(), ingredient);
        }

        Map<String, UnitOfMeasure> uomsByCode = new HashMap<>();
        for (UnitOfMeasure uom : uomProvisioningService.ensureStandardUoms(tenantId)) {
            uomsByCode.put(UomProvisioningService.normalize(uom.getCode()), uom);
        }

        List<String> uomCodes = new ArrayList<>(lineRequests.size());
        for (RecipeLineRequest lineRequest : lineRequests) {
            Ingredient ingredient = ingredientsById.get(lineRequest.ingredientId());
            if (ingredient == null) {
                throw new ResourceNotFoundException("Ingredient", lineRequest.ingredientId());
            }
            if (ingredient.getArchivedAt() != null) {
                throw new IngredientCategoryInvalidException(
                        "Can't use \"" + ingredient.getName() + "\" in a recipe — this item is archived.");
            }

            UnitOfMeasure uom = uomsByCode.get(UomProvisioningService.normalize(lineRequest.uomCode()));
            if (uom == null) {
                throw UomInvalidException.notFound(
                        "the \"" + ingredient.getName() + "\" line", lineRequest.uomCode());
            }
            if (!uom.getMeasureType().equalsIgnoreCase(ingredient.getMeasureType())) {
                throw UomInvalidException.dimensionMismatch(
                        "\"" + ingredient.getName() + "\" is measured by "
                                + describe(ingredient.getMeasureType()) + ", so a recipe line can't call for "
                                + uom.getCode() + ".");
            }
            uomCodes.add(uom.getCode());
        }
        return new ResolvedLines(uomCodes);
    }

    /** Canonical unit codes, positionally aligned with the request's line array. */
    private record ResolvedLines(List<String> uomCodes) {}

    /** Measure types read back to a chef as words, never as the stored enum token — same copy
     * rule as {@code IngredientService.describe}. */
    private static String describe(String measureType) {
        return switch (measureType == null ? "" : measureType.toUpperCase(Locale.ROOT)) {
            case "WEIGHT" -> "weight";
            case "VOLUME" -> "volume";
            case "COUNT" -> "count";
            default -> measureType;
        };
    }

    private RecipeDto toDto(Recipe recipe) {
        List<RecipeLineDto> lines = recipeLineRepository.findByRecipeId(recipe.getId()).stream()
                .map(RecipeService::toDto)
                .toList();
        return toDto(recipe, lines);
    }

    private static RecipeDto toDto(Recipe recipe, List<RecipeLineDto> lines) {
        return new RecipeDto(
                recipe.getId(),
                recipe.getMenuItemId(),
                recipe.getVersion(),
                recipe.isCurrent(),
                recipe.getEffectiveFrom(),
                recipe.getYieldServings(),
                recipe.getName(),
                lines);
    }

    private static RecipeLineDto toDto(RecipeLine line) {
        return new RecipeLineDto(
                line.getId(),
                line.getIngredientId(),
                line.getQty(),
                line.getUomCode(),
                line.getYieldPct());
    }
}
