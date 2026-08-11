package io.restaurantos.inventory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.dto.InventoryDtos.RecordOpeningBalanceRequest;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.service.OpeningBalanceService;
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
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
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
 * INV-15: proves {@code GET /api/v1/inventory/stock} is {@code ingredient_branch_stock}'s first
 * real read path — an ingredient that has never been received still appears (at zero on-hand,
 * so it does not look like it vanished), a received ingredient's real qty/avgCost/stockValue
 * round-trip through {@link OpeningBalanceService}, reorder-breach/non-positive flags are
 * server-derived, and the {@code search} filter narrows the list.
 */
class StockLevelsReadModelIT extends InventoryTestBase {

    @Autowired WebApplicationContext webApplicationContext;
    @Autowired TenantContext tenantContext;
    @Autowired ObjectMapper objectMapper;
    @Autowired IngredientRepository ingredientRepository;
    @Autowired OpeningBalanceService openingBalanceService;

    @MockitoBean FeatureFlagService featureFlagService;

    MockMvc mockMvc;
    UUID tenantId;
    UUID branchId;
    UUID receivedIngredientId;
    UUID neverReceivedIngredientId;

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
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(true));

        // reorderPoint (30) is intentionally above the opening-balance qty (25) recorded below so
        // this ingredient exercises the belowReorderPoint=true branch.
        Ingredient received = InventoryFixtures.seedIngredient(
                ingredientRepository, tenantId, "Basmati Rice", "SKU-RICE-001", "KG", BigDecimal.valueOf(30));
        receivedIngredientId = received.getId();

        Ingredient neverReceived = InventoryFixtures.seedIngredient(
                ingredientRepository, tenantId, "Saffron", "SKU-SAFFRON-001", "GRM", BigDecimal.valueOf(5));
        neverReceivedIngredientId = neverReceived.getId();

        openingBalanceService.recordOpeningBalance(new RecordOpeningBalanceRequest(
                receivedIngredientId, branchId, BigDecimal.valueOf(25), 450L, LocalDate.of(2026, 12, 31)));
    }

    private RequestPostProcessor asManager() {
        JwtClaims claims = new JwtClaims(UUID.randomUUID(), tenantId, branchId,
                List.of("INVENTORY_MANAGER"),
                List.of("inventory.item.view", "inventory.item.manage"), Map.of(), null);
        return SecurityMockMvcRequestPostProcessors.authentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }

    private JsonNode fetchStockData() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v1/inventory/stock")
                        .param("branchId", branchId.toString())
                        .with(asManager()))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    @Test
    void listsBothIngredients_neverReceivedAppearsAtZeroOnHand() throws Exception {
        JsonNode data = fetchStockData();

        assertThat(data.path("items").size()).isEqualTo(2);

        JsonNode neverReceived = findByIngredientId(data, neverReceivedIngredientId);
        assertThat(neverReceived.path("qtyOnHand").decimalValue()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(neverReceived.path("avgCostPaisa").asLong()).isZero();
        assertThat(neverReceived.path("lastCountedAt").isNull()).isTrue();
    }

    @Test
    void receivedIngredient_reportsRealQtyAndCostAndStockValue() throws Exception {
        JsonNode data = fetchStockData();

        JsonNode received = findByIngredientId(data, receivedIngredientId);
        assertThat(received.path("qtyOnHand").decimalValue()).isEqualByComparingTo(BigDecimal.valueOf(25));
        assertThat(received.path("avgCostPaisa").asLong()).isEqualTo(450L);

        long expectedStockValue = BigDecimal.valueOf(25)
                .multiply(BigDecimal.valueOf(450L))
                .setScale(0, RoundingMode.HALF_UP)
                .longValueExact();
        assertThat(received.path("stockValuePaisa").asLong()).isEqualTo(expectedStockValue);
    }

    @Test
    void reorderAndNonPositiveFlags_areServerDerived() throws Exception {
        JsonNode data = fetchStockData();

        JsonNode received = findByIngredientId(data, receivedIngredientId);
        assertThat(received.path("belowReorderPoint").asBoolean())
                .as("qtyOnHand 25 <= reorderPoint 30").isTrue();
        assertThat(received.path("nonPositive").asBoolean()).isFalse();

        JsonNode neverReceived = findByIngredientId(data, neverReceivedIngredientId);
        assertThat(neverReceived.path("nonPositive").asBoolean()).isTrue();
    }

    @Test
    void searchFilter_narrowsList() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v1/inventory/stock")
                        .param("branchId", branchId.toString())
                        .param("search", "saffron")
                        .with(asManager()))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");

        assertThat(data.path("items").size()).isEqualTo(1);
        assertThat(data.path("items").get(0).path("ingredientName").asText()).isEqualTo("Saffron");
    }

    private static JsonNode findByIngredientId(JsonNode data, UUID ingredientId) {
        for (JsonNode item : data.path("items")) {
            if (ingredientId.toString().equals(item.path("ingredientId").asText())) {
                return item;
            }
        }
        throw new AssertionError("ingredientId " + ingredientId + " not found in response: " + data);
    }
}
