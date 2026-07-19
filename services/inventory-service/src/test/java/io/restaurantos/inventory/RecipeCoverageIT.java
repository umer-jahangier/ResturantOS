package io.restaurantos.inventory;

import io.restaurantos.inventory.domain.model.MenuItemCatalog;
import io.restaurantos.inventory.domain.model.Recipe;
import io.restaurantos.inventory.domain.model.RecipeLine;
import io.restaurantos.inventory.dto.RecipeDtos.CoverageResponse;
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
        Recipe recipe = new Recipe();
        recipe.setTenantId(tenantId);
        recipe.setMenuItemId(menuItemId);
        recipe.setVersion(1);
        recipe.setCurrent(true);
        recipe.setEffectiveFrom(Instant.now().minus(1, ChronoUnit.DAYS));
        recipe.setYieldServings(BigDecimal.ONE);
        recipe.setName("Recipe for " + menuItemId);
        Recipe savedRecipe = recipeRepository.save(recipe);

        RecipeLine line = new RecipeLine();
        line.setTenantId(tenantId);
        line.setRecipeId(savedRecipe.getId());
        line.setIngredientId(UUID.randomUUID());
        line.setQty(BigDecimal.ONE);
        line.setUomCode("UNIT");
        line.setYieldPct(BigDecimal.valueOf(100));
        recipeLineRepository.save(line);
    }
}
