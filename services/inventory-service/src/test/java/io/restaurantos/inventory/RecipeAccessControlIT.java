package io.restaurantos.inventory;

import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.domain.model.ItemCategory;
import io.restaurantos.inventory.domain.model.MenuItemCatalog;
import io.restaurantos.inventory.dto.RecipeDtos.CreateRecipeVersionRequest;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeLineRequest;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.ItemCategoryRepository;
import io.restaurantos.inventory.repository.MenuItemCatalogRepository;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.feature.FeatureFlagService;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * T-8-AC: proves {@code RecipeController} actually calls {@link
 * io.restaurantos.inventory.authz.InventoryAuthorizationService} (real OPA enforcement) rather
 * than gating solely on {@code @RequiresFeature}. A principal holding {@code inventory.item.view}
 * but NOT {@code inventory.item.manage} — with the mocked OPA client returning deny — is rejected
 * 403 on POST /recipes (create-version); an INVENTORY_MANAGER (OPA returns allow) succeeds on the
 * same write and on a read.
 */
class RecipeAccessControlIT extends InventoryTestBase {

    @Autowired WebApplicationContext webApplicationContext;
    @Autowired TenantContext tenantContext;
    @Autowired ObjectMapper objectMapper;
    @Autowired MenuItemCatalogRepository menuItemCatalogRepository;
    @Autowired IngredientRepository ingredientRepository;
    @Autowired ItemCategoryRepository itemCategoryRepository;

    @MockitoBean FeatureFlagService featureFlagService;

    MockMvc mockMvc;
    UUID tenantId;
    UUID branchId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                // Binds TenantContext per REQUEST from the authenticated principal, the way
                // JwtAuthenticationFilter does in production. Without it every perform() after the
                // first runs with no tenant: the production filter clears on the way out, and it is
                // right to. See TenantContextBindingTestFilter.
                .addFilter(TenantContextBindingTestFilter.from(webApplicationContext), "/*")
                .build();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);
        when(featureFlagService.isEnabled(any(), any())).thenReturn(true);
    }

    private RequestPostProcessor asViewOnly() {
        JwtClaims claims = new JwtClaims(UUID.randomUUID(), tenantId, branchId,
                List.of("MANAGER"), List.of("inventory.item.view"), Map.of(), null);
        return SecurityMockMvcRequestPostProcessors.authentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }

    private RequestPostProcessor asInventoryManager() {
        JwtClaims claims = new JwtClaims(UUID.randomUUID(), tenantId, branchId,
                List.of("INVENTORY_MANAGER"),
                List.of("inventory.item.view", "inventory.item.manage"), Map.of(), null);
        return SecurityMockMvcRequestPostProcessors.authentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }

    private CreateRecipeVersionRequest newRecipeRequest() {
        return newRecipeRequest(UUID.randomUUID());
    }

    private CreateRecipeVersionRequest newRecipeRequest(UUID ingredientId) {
        return new CreateRecipeVersionRequest(
                UUID.randomUUID(),
                BigDecimal.TEN,
                null,
                "House Burger",
                List.of(new RecipeLineRequest(ingredientId, BigDecimal.valueOf(0.2), "KG", BigDecimal.valueOf(100))));
    }

    /**
     * A real, tenant-owned ingredient measured by weight. {@code createVersion} now validates every
     * line's ingredient and unit, so the random UUID this test used to send is refused (404) before
     * the OPA-authorization assertion it actually exists to make is ever reached — the same shape
     * of fixture gap the menu-item catalog row below already had to close.
     */
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

    @Test
    void viewOnlyPrincipal_isDenied_onRecipeVersionCreate() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(false));

        mockMvc.perform(post("/api/v1/inventory/recipes")
                        .with(asViewOnly())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(newRecipeRequest())))
                .andExpect(status().isForbidden());
    }

    @Test
    void inventoryManager_isAllowed_onRecipeVersionCreateAndRead() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(true));

        CreateRecipeVersionRequest request = newRecipeRequest(seedWeightIngredient());

        // Seed a catalog row for this request's menuItemId — RecipeService.createVersion now
        // validates menuItemId against the tenant's synced menu_item_catalog (08.1-02, INV-09)
        // and would otherwise 404 MENU_ITEM_NOT_FOUND before this test's OPA-authorization
        // assertion is ever reached.
        MenuItemCatalog catalogRow = new MenuItemCatalog();
        catalogRow.setTenantId(tenantId);
        catalogRow.setMenuItemId(request.menuItemId());
        catalogRow.setName("House Burger");
        catalogRow.setActive(true);
        menuItemCatalogRepository.save(catalogRow);

        mockMvc.perform(post("/api/v1/inventory/recipes")
                        .with(asInventoryManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/v1/inventory/recipes")
                        .with(asInventoryManager())
                        .param("menuItemId", request.menuItemId().toString()))
                .andExpect(status().isOk());
    }
}
