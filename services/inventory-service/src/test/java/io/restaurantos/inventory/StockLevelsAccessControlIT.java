package io.restaurantos.inventory;

import io.restaurantos.shared.testsupport.TenantContextBindingTestFilter;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.feature.FeatureFlagService;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * T-08.2-021/022/023: a caller lacking {@code inventory.item.view} is refused before any data is
 * read, and a manager cannot read a sibling branch's stock by editing the {@code branchId} query
 * parameter — proves must_haves.prohibitions #2 ({@code branchId} is never trusted from the
 * request, only validated against the caller's JWT branch claim).
 */
class StockLevelsAccessControlIT extends InventoryTestBase {

    @Autowired WebApplicationContext webApplicationContext;
    @Autowired TenantContext tenantContext;
    @Autowired ObjectMapper objectMapper;
    @Autowired IngredientRepository ingredientRepository;
    @Autowired IngredientBranchStockRepository stockRepository;

    @MockitoBean FeatureFlagService featureFlagService;

    MockMvc mockMvc;
    UUID tenantId;
    UUID branchA;
    UUID branchB;

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
        branchA = UUID.randomUUID();
        branchB = UUID.randomUUID();
        tenantContext.set(tenantId, branchA, null, null);
        when(featureFlagService.isEnabled(any(), any())).thenReturn(true);
    }

    private RequestPostProcessor asManager(UUID branchId) {
        JwtClaims claims = new JwtClaims(UUID.randomUUID(), tenantId, branchId,
                List.of("INVENTORY_MANAGER"),
                List.of("inventory.item.view", "inventory.item.manage"), Map.of(), null);
        return SecurityMockMvcRequestPostProcessors.authentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }

    @Test
    void viewerWithoutPermissionIsRefused() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(false));

        mockMvc.perform(get("/api/v1/inventory/stock")
                        .param("branchId", branchA.toString())
                        .with(asManager(branchA)))
                .andExpect(status().isForbidden());
    }

    @Test
    void cannotReadAnotherBranchesStock() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(true));

        Ingredient branchBIngredient = InventoryFixtures.seedIngredient(
                ingredientRepository, tenantId, "Branch B Exclusive Spice", "SKU-BEXC-001", "KG", BigDecimal.ZERO);

        // Seed a real branch-B stock row so this proves data-leak safety, not just an empty body.
        tenantContext.set(tenantId, branchB, null, null);
        InventoryFixtures.seedStock(
                stockRepository, tenantId, branchB, branchBIngredient.getId(), BigDecimal.TEN, 100L);
        tenantContext.set(tenantId, branchA, null, null);

        String responseBody = mockMvc.perform(get("/api/v1/inventory/stock")
                        .param("branchId", branchB.toString())
                        .with(asManager(branchA)))
                .andExpect(status().isForbidden())
                .andReturn().getResponse().getContentAsString();

        assertThat(responseBody).doesNotContain("Branch B Exclusive Spice");
    }
}
