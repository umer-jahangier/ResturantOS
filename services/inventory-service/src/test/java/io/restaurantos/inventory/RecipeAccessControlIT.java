package io.restaurantos.inventory;

import io.restaurantos.inventory.dto.RecipeDtos.CreateRecipeVersionRequest;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeLineRequest;
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

    @MockitoBean FeatureFlagService featureFlagService;

    MockMvc mockMvc;
    UUID tenantId;
    UUID branchId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(SecurityMockMvcConfigurers.springSecurity())
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
        return new CreateRecipeVersionRequest(
                UUID.randomUUID(),
                BigDecimal.TEN,
                null,
                "House Burger",
                List.of(new RecipeLineRequest(UUID.randomUUID(), BigDecimal.valueOf(0.2), "KG", BigDecimal.valueOf(100))));
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

        CreateRecipeVersionRequest request = newRecipeRequest();
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
