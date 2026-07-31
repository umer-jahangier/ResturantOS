package io.restaurantos.inventory;

import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.domain.model.ItemCategory;
import io.restaurantos.inventory.domain.model.MenuItemCatalog;
import io.restaurantos.inventory.dto.RecipeDtos.CreateRecipeVersionRequest;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeDto;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeLineRequest;
import io.restaurantos.inventory.exception.MenuItemNotFoundException;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.ItemCategoryRepository;
import io.restaurantos.inventory.repository.MenuItemCatalogRepository;
import io.restaurantos.inventory.service.RecipeService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Proves the INV-09 gate added to {@code RecipeService.createVersion}: a recipe can only be
 * authored against a {@code menuItemId} that exists AND is active in the caller's tenant-scoped
 * {@code menu_item_catalog} (D-02).
 */
class RecipeMenuItemValidationIT extends InventoryTestBase {

    @Autowired RecipeService recipeService;
    @Autowired MenuItemCatalogRepository menuItemCatalogRepository;
    @Autowired IngredientRepository ingredientRepository;
    @Autowired ItemCategoryRepository itemCategoryRepository;
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
    void createVersion_rejectsUnknownMenuItemId() {
        UUID menuItemId = UUID.randomUUID(); // never seeded into the catalog

        assertThatThrownBy(() -> recipeService.createVersion(newRequest(menuItemId)))
                .isInstanceOf(MenuItemNotFoundException.class);
    }

    @Test
    void createVersion_rejectsInactiveMenuItemId() {
        UUID menuItemId = UUID.randomUUID();
        seedCatalogRow(menuItemId, false);

        assertThatThrownBy(() -> recipeService.createVersion(newRequest(menuItemId)))
                .isInstanceOf(MenuItemNotFoundException.class);
    }

    @Test
    void createVersion_succeeds_forActiveCatalogEntry() {
        UUID menuItemId = UUID.randomUUID();
        seedCatalogRow(menuItemId, true);

        RecipeDto result = recipeService.createVersion(newRequest(menuItemId));

        assertThat(result).isNotNull();
        assertThat(result.version()).isEqualTo(1);
        assertThat(result.menuItemId()).isEqualTo(menuItemId);
    }

    private void seedCatalogRow(UUID menuItemId, boolean active) {
        MenuItemCatalog row = new MenuItemCatalog();
        row.setTenantId(tenantId);
        row.setMenuItemId(menuItemId);
        row.setName("House Burger");
        row.setActive(active);
        menuItemCatalogRepository.save(row);
    }

    /**
     * The line's ingredient is now REAL. {@code createVersion} validates every line's ingredient
     * and unit, so the random UUID this used to send would 404 before the menu-item gate under
     * test is even reached — and the two rejections-that-happen-not-to-fire tests above would then
     * pass for the wrong reason.
     */
    private CreateRecipeVersionRequest newRequest(UUID menuItemId) {
        return new CreateRecipeVersionRequest(
                menuItemId,
                BigDecimal.TEN,
                null,
                "House Burger",
                List.of(new RecipeLineRequest(
                        seedWeightIngredient(), BigDecimal.valueOf(0.2), "KG", BigDecimal.valueOf(100))));
    }

    private UUID seedWeightIngredient() {
        ItemCategory category = new ItemCategory();
        category.setTenantId(tenantId);
        category.setName("Proteins " + UUID.randomUUID());
        category.setLevel((short) 1);
        itemCategoryRepository.save(category);

        Ingredient ingredient = new Ingredient();
        ingredient.setTenantId(tenantId);
        ingredient.setName("Chicken");
        ingredient.setSku("ING-" + UUID.randomUUID());
        ingredient.setBaseUomCode("KG");
        ingredient.setMeasureType("WEIGHT");
        ingredient.setCategoryId(category.getId());
        ingredient.setReorderPoint(BigDecimal.ZERO);
        return ingredientRepository.save(ingredient).getId();
    }
}
