package io.restaurantos.inventory;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.inventory.domain.model.InventoryMovement;
import io.restaurantos.inventory.dto.ReceiptDtos.ReceiveStockRequest;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.InventoryMovementRepository;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.event.OutboxRepository;
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
 * INV-04: {@code POST /api/v1/inventory/receipts}, driven over real HTTP (MockMvc + Spring
 * Security) so {@code @Valid}/{@code GlobalExceptionHandler} behavior is proven honestly —
 * mirrors {@code OpeningBalanceIT}'s precedent. A receipt writes exactly one {@code RECEIPT}
 * movement and publishes {@code STOCK_RECEIVED} through the transactional outbox; a non-positive
 * qty or unit cost is rejected 400 (T-8-NEGQTY).
 */
class ReceiptServiceIT extends InventoryTestBase {

    @Autowired WebApplicationContext webApplicationContext;
    @Autowired TenantContext tenantContext;
    @Autowired ObjectMapper objectMapper;
    @Autowired IngredientRepository ingredientRepository;
    @Autowired InventoryMovementRepository movementRepository;
    @Autowired OutboxRepository outboxRepository;

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

        ingredientId = InventoryFixtures.seedIngredient(
                ingredientRepository, tenantId, "Sugar", "SKU-RCV-001", "KG", BigDecimal.ZERO).getId();
    }

    private RequestPostProcessor asInventoryManager() {
        JwtClaims claims = new JwtClaims(UUID.randomUUID(), tenantId, branchId,
                List.of("INVENTORY_MANAGER"),
                List.of("inventory.item.view", "inventory.item.manage"), Map.of(), null);
        return SecurityMockMvcRequestPostProcessors.authentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }

    @Test
    void receivingStock_writesExactlyOneReceiptMovement_andPublishesStockReceived() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(true));

        ReceiveStockRequest request = new ReceiveStockRequest(
                ingredientId, branchId, BigDecimal.valueOf(15), 400L, null);

        mockMvc.perform(post("/api/v1/inventory/receipts")
                        .with(asInventoryManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk());

        List<InventoryMovement> movements = movementRepository.findAll().stream()
                .filter(m -> m.getIngredientId().equals(ingredientId) && "RECEIPT".equals(m.getMovementType()))
                .toList();
        assertThat(movements).hasSize(1);

        List<OutboxEntry> stockReceivedEntries = outboxRepository.findAll().stream()
                .filter(e -> "STOCK_RECEIVED".equals(e.getEventType()))
                .toList();
        assertThat(stockReceivedEntries).hasSize(1);
    }

    @Test
    void nonPositiveReceiptQty_isRejected() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(true));

        ReceiveStockRequest request = new ReceiveStockRequest(
                ingredientId, branchId, BigDecimal.ZERO, 400L, null);

        mockMvc.perform(post("/api/v1/inventory/receipts")
                        .with(asInventoryManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void nonPositiveReceiptUnitCost_isRejected() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(true));

        ReceiveStockRequest request = new ReceiveStockRequest(
                ingredientId, branchId, BigDecimal.TEN, 0L, null);

        mockMvc.perform(post("/api/v1/inventory/receipts")
                        .with(asInventoryManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }
}
