package io.restaurantos.inventory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.dto.RecipeDtos.PreviewRecipeCostRequest;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeLineRequest;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.RecipeLineRepository;
import io.restaurantos.inventory.repository.RecipeRepository;
import io.restaurantos.inventory.repository.UnitOfMeasureRepository;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.feature.FeatureFlagService;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * INV-15: HTTP-level, DB-backed proof of {@code POST /api/v1/inventory/recipes/preview} — a real
 * {@code ingredient_branch_stock} row seeded through the production write path
 * ({@code InventoryFixtures.seedStock}), the batch-cost figure it produces, and the three
 * threat-model mitigations (T-08.2-071/072/073): manage-level authorization, branch pinning, and
 * zero persistence. See {@code RecipeCostPreviewTest} for the pure-arithmetic/degradation unit
 * coverage.
 */
class RecipeCostPreviewIT extends InventoryTestBase {

    @Autowired WebApplicationContext webApplicationContext;
    @Autowired TenantContext tenantContext;
    @Autowired ObjectMapper objectMapper;
    @Autowired IngredientRepository ingredientRepository;
    @Autowired UnitOfMeasureRepository unitOfMeasureRepository;
    @Autowired IngredientBranchStockRepository stockRepository;
    @Autowired RecipeRepository recipeRepository;
    @Autowired RecipeLineRepository recipeLineRepository;

    @MockitoBean FeatureFlagService featureFlagService;

    MockMvc mockMvc;
    UUID tenantId;
    UUID branchId;
    UUID ingredientId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                .build();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);
        when(featureFlagService.isEnabled(any(), any())).thenReturn(true);
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(true));

        Ingredient ingredient =
                InventoryFixtures.seedIngredient(ingredientRepository, tenantId, "Flour", "SKU-CP-001", "KG", BigDecimal.ZERO);
        ingredientId = ingredient.getId();
        InventoryFixtures.seedUom(unitOfMeasureRepository, tenantId, "KG", "Kilogram", BigDecimal.ONE);
        InventoryFixtures.seedStock(stockRepository, tenantId, branchId, ingredientId, BigDecimal.TEN, 500L);
    }

    private RequestPostProcessor asManager() {
        JwtClaims claims = new JwtClaims(UUID.randomUUID(), tenantId, branchId,
                List.of("INVENTORY_MANAGER"),
                List.of("inventory.item.view", "inventory.item.manage"), Map.of(), null);
        return SecurityMockMvcRequestPostProcessors.authentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }

    private RequestPostProcessor asViewOnly() {
        JwtClaims claims = new JwtClaims(UUID.randomUUID(), tenantId, branchId,
                List.of("MANAGER"), List.of("inventory.item.view"), Map.of(), null);
        return SecurityMockMvcRequestPostProcessors.authentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }

    private PreviewRecipeCostRequest previewRequest(UUID requestBranchId) {
        return new PreviewRecipeCostRequest(requestBranchId, null, BigDecimal.valueOf(10),
                List.of(new RecipeLineRequest(ingredientId, BigDecimal.valueOf(2), "KG", null)));
    }

    @Test
    void previewReturnsHandComputedBatchCost() throws Exception {
        // effectiveBaseQty = 2*1*1 / (1*10) = 0.2 -> lineCost = 0.2*500 = 100 -> batchCostPaisa = 100.
        var result = mockMvc.perform(post("/api/v1/inventory/recipes/preview")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(previewRequest(branchId))))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        assertThat(data.path("batchCostPaisa").asLong()).isEqualTo(100L);
        assertThat(data.path("portionCostPaisa").asLong()).isEqualTo(10L);
        assertThat(data.path("excludedLineCount").asInt()).isZero();
        assertThat(data.path("lines").get(0).path("sharePctOfBatch").asInt()).isEqualTo(100);
    }

    @Test
    void previewDoesNotPersistAnything() throws Exception {
        long recipeCountBefore = recipeRepository.count();
        long recipeLineCountBefore = recipeLineRepository.count();

        mockMvc.perform(post("/api/v1/inventory/recipes/preview")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(previewRequest(branchId))))
                .andExpect(status().isOk());

        assertThat(recipeRepository.count()).isEqualTo(recipeCountBefore);
        assertThat(recipeLineRepository.count()).isEqualTo(recipeLineCountBefore);
    }

    @Test
    void previewRejectsAForeignBranchId() throws Exception {
        UUID foreignBranchId = UUID.randomUUID();

        mockMvc.perform(post("/api/v1/inventory/recipes/preview")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(previewRequest(foreignBranchId))))
                .andExpect(status().isForbidden());
    }

    @Test
    void viewOnlyPrincipalCannotPreview() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(false));

        mockMvc.perform(post("/api/v1/inventory/recipes/preview")
                        .with(asViewOnly())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(previewRequest(branchId))))
                .andExpect(status().isForbidden());
    }
}
