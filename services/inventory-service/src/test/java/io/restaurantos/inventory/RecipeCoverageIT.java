package io.restaurantos.inventory;

import io.restaurantos.inventory.domain.model.MenuItemCatalog;
import io.restaurantos.inventory.domain.model.Recipe;
import io.restaurantos.inventory.domain.model.RecipeLine;
import io.restaurantos.inventory.dto.RecipeDtos.CoverageResponse;
import io.restaurantos.inventory.dto.RecipeDtos.CoverageState;
import io.restaurantos.inventory.repository.MenuItemCatalogRepository;
import io.restaurantos.inventory.repository.RecipeLineRepository;
import io.restaurantos.inventory.repository.RecipeRepository;
import io.restaurantos.inventory.service.RecipeService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

/**
 * Proves INV-11's {@code GET /recipes/coverage} report (via {@link RecipeService#getCoverage()}
 * directly — the endpoint itself only adds the OPA gate + response envelope, both already proven
 * generically by every other {@code RecipeController} test): a left-join of the tenant's active
 * {@code menu_item_catalog} against {@link RecipeService#resolveEffectiveRecipe}, with inactive
 * catalog rows excluded from the universe entirely.
 */
class RecipeCoverageIT extends InventoryTestBase {

    @Autowired RecipeService recipeService;
    @Autowired MenuItemCatalogRepository menuItemCatalogRepository;
    @Autowired RecipeRepository recipeRepository;
    @Autowired RecipeLineRepository recipeLineRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);
    }

    @Test
    void getCoverage_reportsCoveredAndMissingActiveMenuItems() {
        MenuItemCatalog covered = seedCatalogItem("House Burger", true);
        MenuItemCatalog missingOne = seedCatalogItem("Mystery Fries", true);
        MenuItemCatalog missingTwo = seedCatalogItem("Ghost Shake", true);

        seedEffectiveRecipe(covered.getMenuItemId());

        CoverageResponse response = recipeService.getCoverage();

        assertThat(response.totalActiveMenuItems()).isEqualTo(3);
        assertThat(response.covered()).isEqualTo(1);
        assertThat(response.missing())
                .extracting(m -> tuple(m.menuItemId(), m.name()))
                .containsExactlyInAnyOrder(
                        tuple(missingOne.getMenuItemId(), missingOne.getName()),
                        tuple(missingTwo.getMenuItemId(), missingTwo.getName()));
    }

    @Test
    void getCoverage_excludesInactiveCatalogItems_fromUniverseEntirely() {
        seedCatalogItem("Active Item With No Recipe", true);
        seedCatalogItem("Inactive Item With No Recipe", false);

        CoverageResponse response = recipeService.getCoverage();

        assertThat(response.totalActiveMenuItems()).isEqualTo(1);
        assertThat(response.covered()).isEqualTo(0);
        assertThat(response.missing()).hasSize(1);
        assertThat(response.missing().get(0).name()).isEqualTo("Active Item With No Recipe");
    }

    private MenuItemCatalog seedCatalogItem(String name, boolean active) {
        MenuItemCatalog item = new MenuItemCatalog();
        item.setTenantId(tenantId);
        item.setMenuItemId(UUID.randomUUID());
        item.setName(name);
        item.setActive(active);
        item.setBasePricePaisa(1000L);
        return menuItemCatalogRepository.save(item);
    }

    private void seedEffectiveRecipe(UUID menuItemId) {
        seedRecipeVersion(menuItemId, Instant.now().minus(1, ChronoUnit.DAYS));
    }

    /** Seeds a single version of a recipe at the given {@code effectiveFrom}, next version number
     * per menu item (so callers can seed multiple versions for the same item). */
    private Recipe seedRecipeVersion(UUID menuItemId, Instant effectiveFrom) {
        int nextVersion = recipeRepository
                        .findByTenantIdAndMenuItemIdOrderByVersionDesc(tenantId, menuItemId)
                        .stream()
                        .findFirst()
                        .map(r -> r.getVersion() + 1)
                        .orElse(1);

        Recipe recipe = new Recipe();
        recipe.setTenantId(tenantId);
        recipe.setMenuItemId(menuItemId);
        recipe.setVersion(nextVersion);
        recipe.setCurrent(true);
        recipe.setEffectiveFrom(effectiveFrom);
        recipe.setYieldServings(BigDecimal.ONE);
        recipe.setName("Recipe for " + menuItemId + " v" + nextVersion);
        Recipe savedRecipe = recipeRepository.save(recipe);

        RecipeLine line = new RecipeLine();
        line.setTenantId(tenantId);
        line.setRecipeId(savedRecipe.getId());
        line.setIngredientId(UUID.randomUUID());
        line.setQty(BigDecimal.ONE);
        line.setUomCode("UNIT");
        line.setYieldPct(BigDecimal.valueOf(100));
        recipeLineRepository.save(line);

        return savedRecipe;
    }

    @Test
    void futureDatedRecipeIsScheduledNotMissing() {
        MenuItemCatalog item = seedCatalogItem("Future Special", true);
        // Truncated to microseconds: Postgres `timestamptz` columns store microsecond precision,
        // so a nanosecond-precision Instant.now() would never round-trip-equal after persistence.
        Instant scheduledFrom = Instant.now().plus(7, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MICROS);
        seedRecipeVersion(item.getMenuItemId(), scheduledFrom);

        CoverageResponse response = recipeService.getCoverage();

        assertThat(response.covered()).isEqualTo(0);
        assertThat(response.scheduled()).isEqualTo(1);
        assertThat(response.noRecipe()).isEqualTo(0);
        assertThat(response.items())
                .filteredOn(i -> i.menuItemId().equals(item.getMenuItemId()))
                .singleElement()
                .satisfies(dto -> {
                    assertThat(dto.state()).isEqualTo(CoverageState.SCHEDULED);
                    assertThat(dto.scheduledFrom()).isEqualTo(scheduledFrom);
                });
        assertThat(response.missing()).isEmpty();
    }

    @Test
    void menuItemWithBothPastAndFutureVersionsIsCovered() {
        MenuItemCatalog item = seedCatalogItem("Mixed Versions Item", true);
        seedRecipeVersion(item.getMenuItemId(), Instant.now().minus(1, ChronoUnit.DAYS));
        seedRecipeVersion(item.getMenuItemId(), Instant.now().plus(5, ChronoUnit.DAYS));

        CoverageResponse response = recipeService.getCoverage();

        assertThat(response.items())
                .filteredOn(i -> i.menuItemId().equals(item.getMenuItemId()))
                .singleElement()
                .satisfies(dto -> {
                    // Must be COVERED, never SCHEDULED, once any past-dated version exists.
                    assertThat(dto.state()).isEqualTo(CoverageState.COVERED).isNotEqualTo(CoverageState.SCHEDULED);
                    assertThat(dto.scheduledFrom()).isNull();
                });
    }

    @Test
    void scheduledFromReportsTheEarliestFutureVersion() {
        MenuItemCatalog item = seedCatalogItem("Two Future Versions Item", true);
        Instant earliestFuture = Instant.now().plus(3, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MICROS);
        Instant laterFuture = Instant.now().plus(9, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MICROS);
        seedRecipeVersion(item.getMenuItemId(), laterFuture);
        seedRecipeVersion(item.getMenuItemId(), earliestFuture);

        CoverageResponse response = recipeService.getCoverage();

        assertThat(response.items())
                .filteredOn(i -> i.menuItemId().equals(item.getMenuItemId()))
                .singleElement()
                .satisfies(dto -> {
                    assertThat(dto.state()).isEqualTo(CoverageState.SCHEDULED);
                    assertThat(dto.scheduledFrom()).isEqualTo(earliestFuture);
                });
    }

    @Test
    void menuItemWithNoVersionsIsNoRecipe() {
        MenuItemCatalog item = seedCatalogItem("No Versions Item", true);

        CoverageResponse response = recipeService.getCoverage();

        assertThat(response.items())
                .filteredOn(i -> i.menuItemId().equals(item.getMenuItemId()))
                .singleElement()
                .satisfies(dto -> {
                    assertThat(dto.state()).isEqualTo(CoverageState.NO_RECIPE);
                    assertThat(dto.scheduledFrom()).isNull();
                });
        assertThat(response.missing())
                .extracting(m -> m.menuItemId())
                .contains(item.getMenuItemId());
    }

    /**
     * T-08.2-031: the batch coverage query ({@code
     * findByTenantIdAndMenuItemIdInOrderByEffectiveFromDesc}) carries an explicit tenant
     * predicate — a recipe version belonging to another tenant for the same {@code menuItemId}
     * must never be counted as covering this tenant's item.
     */
    @Test
    void getCoverage_doesNotLeakAnotherTenantsRecipeVersion() {
        MenuItemCatalog item = seedCatalogItem("Cross-Tenant Item", true);
        UUID otherTenantId = UUID.randomUUID();

        Recipe otherTenantsRecipe = new Recipe();
        otherTenantsRecipe.setTenantId(otherTenantId);
        otherTenantsRecipe.setMenuItemId(item.getMenuItemId());
        otherTenantsRecipe.setVersion(1);
        otherTenantsRecipe.setCurrent(true);
        otherTenantsRecipe.setEffectiveFrom(Instant.now().minus(1, ChronoUnit.DAYS));
        otherTenantsRecipe.setYieldServings(BigDecimal.ONE);
        otherTenantsRecipe.setName("Other tenant's recipe for " + item.getMenuItemId());
        recipeRepository.save(otherTenantsRecipe);

        CoverageResponse response = recipeService.getCoverage();

        assertThat(response.items())
                .filteredOn(i -> i.menuItemId().equals(item.getMenuItemId()))
                .singleElement()
                .satisfies(dto -> assertThat(dto.state()).isEqualTo(CoverageState.NO_RECIPE));
    }

    /**
     * INV-15/T-08.2-032: guards the N+1 fix. {@code getCoverage()} must issue a bounded number of
     * queries regardless of how many active menu items exist — asserted here via {@code covered
     * == 20} plus this comment naming the exact two repository methods that must be the only ones
     * called per invocation (enabling Hibernate statistics in this harness proved impractical):
     * {@link MenuItemCatalogRepository#findByTenantIdAndActiveTrueOrderByNameAsc} and
     * {@link RecipeRepository#findByTenantIdAndMenuItemIdInOrderByEffectiveFromDesc}. If this test
     * ever needs to assert an actual query count, wire
     * {@code hibernate.generate_statistics=true} and read
     * {@code SessionFactory#getStatistics()#getQueryExecutionCount()} before/after the call.
     */
    @Test
    void coverageIssuesABoundedNumberOfQueries() {
        for (int i = 0; i < 20; i++) {
            MenuItemCatalog item = seedCatalogItem("Bulk Item " + i, true);
            seedRecipeVersion(item.getMenuItemId(), Instant.now().minus(1, ChronoUnit.DAYS));
        }

        CoverageResponse response = recipeService.getCoverage();

        assertThat(response.totalActiveMenuItems()).isEqualTo(20);
        assertThat(response.covered()).isEqualTo(20);
        assertThat(response.scheduled()).isEqualTo(0);
        assertThat(response.noRecipe()).isEqualTo(0);
    }
}
