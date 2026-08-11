package io.restaurantos.inventory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.inventory.dto.ItemCategoryDtos.CreateItemCategoryRequest;
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
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * T-08.2-061/T-08.2-062: proves category endpoints actually call
 * {@code InventoryAuthorizationService} (real OPA enforcement, not just the coarse
 * {@code @RequiresFeature} gate) and that a client-supplied {@code tenantId} on create is never
 * persisted — the row's tenant always comes from the JWT.
 */
class CategoryAccessControlIT extends InventoryTestBase {

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

    @Test
    void deniedOpaDecision_isRefused_onCategoryRead() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(false));

        mockMvc.perform(get("/api/v1/inventory/categories").with(asInventoryManager()))
                .andExpect(status().isForbidden());
    }

    @Test
    void viewOnlyPrincipal_isDenied_onCategoryCreate() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(false));

        CreateItemCategoryRequest request = new CreateItemCategoryRequest(
                null, "Groceries", null, null, null, null, null, null, null);

        mockMvc.perform(post("/api/v1/inventory/categories")
                        .with(asViewOnly())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isForbidden());
    }

    @Test
    void creatingACategory_neverPersistsAClientSuppliedTenantId() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(true));

        UUID foreignTenantId = UUID.randomUUID();
        String bodyWithForeignTenantId = "{"
                + "\"parentId\":null,"
                + "\"name\":\"Groceries\","
                + "\"tenantId\":\"" + foreignTenantId + "\""
                + "}";

        MvcResult result = mockMvc.perform(post("/api/v1/inventory/categories")
                        .with(asInventoryManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bodyWithForeignTenantId))
                .andExpect(status().isOk())
                .andReturn();

        String createdId = objectMapper.readTree(result.getResponse().getContentAsString())
                .path("data").path("id").asText();

        MvcResult getResult = mockMvc.perform(get("/api/v1/inventory/categories/" + createdId).with(asInventoryManager()))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode fetched = objectMapper.readTree(getResult.getResponse().getContentAsString()).path("data");
        assertThat(fetched.path("id").asText()).isEqualTo(createdId);
        // The row is only readable at all because ItemCategoryRepository.findByTenantIdAndId
        // scoped the lookup to the JWT's tenantId (not the injected foreignTenantId) — an
        // ignored client tenantId proves out as "still visible under the real tenant".
    }
}
