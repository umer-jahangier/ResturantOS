package io.restaurantos.inventory;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.inventory.dto.StockCountDtos.CountLineRequest;
import io.restaurantos.inventory.dto.StockCountDtos.CreateStockCountRequest;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.InventoryMovementRepository;
import io.restaurantos.shared.authz.OpaDecision;
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
 * T-8-AC: {@code StockCountController} enforces {@code inventory.item.manage} via
 * {@code InventoryAuthorizationService} on {@code POST /counts}. A JWT carrying only
 * {@code inventory.item.view} is denied 403 with no COUNT_VARIANCE movement / no
 * COUNT_VARIANCE_POSTED outbox row written; an INVENTORY_MANAGER JWT succeeds (2xx). Mirrors
 * {@code TransferAccessControlIT}'s MockMvc + real Spring Security dispatch pattern (needed to
 * assert literal HTTP status codes, per 08-03's key-decision).
 */
class StockCountAccessControlIT extends InventoryTestBase {

    @Autowired WebApplicationContext webApplicationContext;
    @Autowired TenantContext tenantContext;
    @Autowired ObjectMapper objectMapper;
    @Autowired IngredientRepository ingredientRepository;
    @Autowired IngredientBranchStockRepository stockRepository;
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
                ingredientRepository, tenantId, "Cooking Oil", "SKU-AC-COUNT-001", "L", BigDecimal.ZERO).getId();
        InventoryFixtures.seedStock(stockRepository, tenantId, branchId, ingredientId,
                BigDecimal.valueOf(20), 500L);
    }

    private RequestPostProcessor asInventoryManager() {
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

    @Test
    void viewOnlyPrincipal_isDeniedOnPostCount_andNoCountVarianceMovementWritten() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(false));

        CreateStockCountRequest request = new CreateStockCountRequest(
                branchId, List.of(new CountLineRequest(ingredientId, BigDecimal.valueOf(25))));

        mockMvc.perform(post("/api/v1/inventory/counts")
                        .with(asViewOnly())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isForbidden());

        long countVarianceMovements = movementRepository.findAll().stream()
                .filter(m -> m.getIngredientId().equals(ingredientId) && "COUNT_VARIANCE".equals(m.getMovementType()))
                .count();
        assertThat(countVarianceMovements).isZero();

        long countPostedOutboxCount = outboxRepository.findAll().stream()
                .filter(e -> tenantId.equals(e.getTenantId()) && "COUNT_VARIANCE_POSTED".equals(e.getEventType()))
                .count();
        assertThat(countPostedOutboxCount).isZero();
    }

    @Test
    void inventoryManager_succeedsOnPostCount() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(true));

        CreateStockCountRequest request = new CreateStockCountRequest(
                branchId, List.of(new CountLineRequest(ingredientId, BigDecimal.valueOf(25))));

        mockMvc.perform(post("/api/v1/inventory/counts")
                        .with(asInventoryManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk());

        long countVarianceMovements = movementRepository.findAll().stream()
                .filter(m -> m.getIngredientId().equals(ingredientId) && "COUNT_VARIANCE".equals(m.getMovementType()))
                .count();
        assertThat(countVarianceMovements).isEqualTo(1);
    }
}
