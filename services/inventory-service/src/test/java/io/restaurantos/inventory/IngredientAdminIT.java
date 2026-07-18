package io.restaurantos.inventory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.inventory.dto.InventoryDtos.CreateIngredientRequest;
import io.restaurantos.inventory.dto.InventoryDtos.CreateUomRequest;
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
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * An INVENTORY_MANAGER can create/list/get ingredients and UOM over real HTTP dispatch (proving
 * {@code @Valid} + {@code GlobalExceptionHandler} + the OPA seam all actually fire); negative
 * reorder point and non-positive UOM factor are rejected 400 at the API boundary (T-8-NEGQTY).
 */
class IngredientAdminIT extends InventoryTestBase {

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
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(true));
    }

    private RequestPostProcessor asManager() {
        JwtClaims claims = new JwtClaims(UUID.randomUUID(), tenantId, branchId,
                List.of("INVENTORY_MANAGER"),
                List.of("inventory.item.view", "inventory.item.manage"), Map.of(), null);
        var authentication = new UsernamePasswordAuthenticationToken(claims, null, List.of());
        return SecurityMockMvcRequestPostProcessors.authentication(authentication);
    }

    @Test
    void managerCanCreateListAndGetIngredient() throws Exception {
        CreateIngredientRequest request = new CreateIngredientRequest(
                "Basmati Rice", "SKU-RICE-001", "KG", "Grains", BigDecimal.valueOf(10));

        MvcResult createResult = mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.sku").value("SKU-RICE-001"))
                .andReturn();

        JsonNode created = objectMapper.readTree(createResult.getResponse().getContentAsString()).path("data");
        assertThat(created.path("name").asText()).isEqualTo("Basmati Rice");
        assertThat(created.path("reorderPoint").decimalValue()).isEqualByComparingTo(BigDecimal.valueOf(10));
        String id = created.path("id").asText();

        MvcResult listResult = mockMvc.perform(get("/api/v1/inventory/ingredients").with(asManager()))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode list = objectMapper.readTree(listResult.getResponse().getContentAsString()).path("data");
        boolean found = false;
        for (JsonNode node : list) {
            if (id.equals(node.path("id").asText())) {
                found = true;
            }
        }
        assertThat(found).as("created ingredient should appear in the list response").isTrue();

        mockMvc.perform(get("/api/v1/inventory/ingredients/" + id).with(asManager()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.sku").value("SKU-RICE-001"));
    }

    @Test
    void negativeReorderPoint_isRejected() throws Exception {
        CreateIngredientRequest request = new CreateIngredientRequest(
                "Bad Ingredient", "SKU-BAD-001", "KG", "Grains", BigDecimal.valueOf(-1));

        mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void nonPositiveToBaseFactor_isRejected() throws Exception {
        CreateUomRequest request = new CreateUomRequest("BAD", "Bad Unit", "KG", BigDecimal.ZERO);

        mockMvc.perform(post("/api/v1/inventory/uom")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }
}
