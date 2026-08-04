package io.restaurantos.inventory;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.inventory.domain.model.IngredientBranchStock;
import io.restaurantos.inventory.domain.model.InventoryMovement;
import io.restaurantos.inventory.domain.model.StockLot;
import io.restaurantos.inventory.dto.InventoryDtos.RecordOpeningBalanceRequest;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.InventoryMovementRepository;
import io.restaurantos.inventory.repository.StockLotRepository;
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
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * INV-07: recording an opening balance sets stock qty/MAC, creates exactly one OPENING_BALANCE
 * movement, and seeds a stock_lot with the given expiry. Non-positive qty is rejected 400
 * (T-8-NEGQTY). A JWT lacking inventory.item.manage is denied 403 with no movement written
 * (T-8-AC).
 */
class OpeningBalanceIT extends InventoryTestBase {

    @Autowired WebApplicationContext webApplicationContext;
    @Autowired TenantContext tenantContext;
    @Autowired ObjectMapper objectMapper;
    @Autowired IngredientRepository ingredientRepository;
    @Autowired IngredientBranchStockRepository stockRepository;
    @Autowired StockLotRepository lotRepository;
    @Autowired InventoryMovementRepository movementRepository;

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

        // ingredient_branch_stock.ingredient_id carries an FK to ingredients(id) — seed the
        // parent row first via InventoryFixtures (Task 1), same helper downstream feature ITs reuse.
        ingredientId = InventoryFixtures.seedIngredient(
                ingredientRepository, tenantId, "Flour", "SKU-OB-001", "KG", BigDecimal.ZERO).getId();
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
    void recordingOpeningBalance_setsStockAndCreatesMovementAndLot() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(true));

        RecordOpeningBalanceRequest request = new RecordOpeningBalanceRequest(
                ingredientId, branchId, BigDecimal.valueOf(25), 450L, LocalDate.of(2026, 12, 31));

        mockMvc.perform(post("/api/v1/inventory/opening-balance")
                        .with(asInventoryManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk());

        Optional<IngredientBranchStock> stock =
                stockRepository.findByBranchIdAndIngredientId(branchId, ingredientId);
        assertThat(stock).isPresent();
        assertThat(stock.get().getQtyOnHand()).isEqualByComparingTo(BigDecimal.valueOf(25));
        assertThat(stock.get().getAvgCostPaisa()).isEqualTo(450L);

        List<InventoryMovement> movements = movementRepository.findAll().stream()
                .filter(m -> m.getIngredientId().equals(ingredientId)
                        && "OPENING_BALANCE".equals(m.getMovementType()))
                .toList();
        assertThat(movements).hasSize(1);
        assertThat(movements.get(0).getQty()).isEqualByComparingTo(BigDecimal.valueOf(25));

        List<StockLot> lots = lotRepository.findByStockIdOrderByExpiryDateAsc(stock.get().getId());
        assertThat(lots).hasSize(1);
        assertThat(lots.get(0).getExpiryDate()).isEqualTo(LocalDate.of(2026, 12, 31));
        assertThat(lots.get(0).getReceiptUnitCostPaisa()).isEqualTo(450L);
    }

    @Test
    void nonPositiveOpeningQty_isRejected() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(true));

        RecordOpeningBalanceRequest request = new RecordOpeningBalanceRequest(
                ingredientId, branchId, BigDecimal.ZERO, 450L, null);

        mockMvc.perform(post("/api/v1/inventory/opening-balance")
                        .with(asInventoryManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void viewOnlyPrincipal_isDenied_andNoMovementWritten() throws Exception {
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(false));

        RecordOpeningBalanceRequest request = new RecordOpeningBalanceRequest(
                ingredientId, branchId, BigDecimal.valueOf(10), 300L, null);

        mockMvc.perform(post("/api/v1/inventory/opening-balance")
                        .with(asViewOnly())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isForbidden());

        long movementCount = movementRepository.findAll().stream()
                .filter(m -> m.getIngredientId().equals(ingredientId))
                .count();
        assertThat(movementCount).isZero();
    }
}
