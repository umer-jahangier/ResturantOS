package io.restaurantos.inventory;

import io.restaurantos.inventory.dto.InventoryDtos.CreateIngredientRequest;
import io.restaurantos.inventory.dto.InventoryDtos.CreateUomRequest;
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
 * T-8-AC: proves the master-data endpoints actually call {@code InventoryAuthorizationService}
 * (real OPA enforcement) rather than gating solely on {@code @RequiresFeature}. A principal
 * holding {@code inventory.item.view} but NOT {@code inventory.item.manage} — with the mocked
 * OPA client returning deny for a manage decision — is rejected 403 on every master-data write;
 * an INVENTORY_MANAGER (OPA returns allow) succeeds on the same writes and on a read.
 */
class InventoryAccessControlIT extends InventoryTestBase {

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

    @Test
    void viewOnlyPrincipal_isDenied_onIngredientCreate() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(false));

        CreateIngredientRequest request = new CreateIngredientRequest(
                "Flour", "SKU-FLOUR-001", "KG", "Grains", BigDecimal.valueOf(5));

        mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asViewOnly())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isForbidden());
    }

    @Test
    void viewOnlyPrincipal_isDenied_onUomCreate() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(false));

        CreateUomRequest request = new CreateUomRequest("LTR", "Liter", "LTR", BigDecimal.ONE);

        mockMvc.perform(post("/api/v1/inventory/uom")
                        .with(asViewOnly())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isForbidden());
    }

    @Test
    void inventoryManager_isAllowed_onIngredientCreateAndUomCreateAndRead() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(true));

        CreateIngredientRequest ingredientRequest = new CreateIngredientRequest(
                "Sugar", "SKU-SUGAR-001", "KG", "Grocery", BigDecimal.valueOf(20));
        mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asInventoryManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(ingredientRequest)))
                .andExpect(status().isOk());

        CreateUomRequest uomRequest = new CreateUomRequest("GRM", "Gram", "KG", BigDecimal.valueOf(0.001));
        mockMvc.perform(post("/api/v1/inventory/uom")
                        .with(asInventoryManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(uomRequest)))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/v1/inventory/ingredients").with(asInventoryManager()))
                .andExpect(status().isOk());
    }
}
