package io.restaurantos.inventory;

import io.restaurantos.inventory.domain.model.StockLot;
import io.restaurantos.inventory.entity.InventoryTenantRegistryEntity;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.InventoryTenantRegistryRepository;
import io.restaurantos.inventory.repository.StockLotRepository;
import io.restaurantos.inventory.service.ExpirySweepService;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * INV-06 / D-04: {@link ExpirySweepService#sweep} publishes {@code EXPIRY_ALERT} only for lots
 * with {@code expiry_date <= today + leadDays} AND {@code qty > 0} — lots beyond the window or
 * with {@code qty=0} produce none. Invoked directly with a fixed {@code today} (no cron wait),
 * per the plan's acceptance criteria; the test's own {@code tenantContext.set(...)} in
 * {@code @BeforeEach} scopes the direct fixture writes below to this test's tenant (RLS/Hibernate
 * {@code tenantFilter}).
 *
 * <p>D6 gap-closure (08-VERIFICATION.md): discovery no longer depends on that ambient context —
 * {@code sweep()} now discovers tenants from the RLS-exempt {@code inventory_tenant_registry} (see
 * {@code ExpirySweepService}'s javadoc). Because {@link InventoryFixtures#seedStock} writes
 * directly via the repository (bypassing the application services that upsert the registry in
 * production), this test registers the tenant explicitly in {@code @BeforeEach} to mirror what a
 * real opening-balance/receipt/transfer-receive/count call would already have done.
 */
class ExpirySweepIT extends InventoryTestBase {

    @Autowired TenantContext tenantContext;
    @Autowired ExpirySweepService expirySweepService;
    @Autowired IngredientRepository ingredientRepository;
    @Autowired IngredientBranchStockRepository stockRepository;
    @Autowired StockLotRepository lotRepository;
    @Autowired OutboxRepository outboxRepository;
    @Autowired InventoryTenantRegistryRepository tenantRegistryRepository;

    UUID tenantId;
    UUID branchId;
    UUID ingredientId;
    UUID stockId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);

        ingredientId = InventoryFixtures.seedIngredient(
                ingredientRepository, tenantId, "Milk", "SKU-EXP-001", "L", BigDecimal.ZERO).getId();
        stockId = InventoryFixtures.seedStock(stockRepository, tenantId, branchId, ingredientId,
                BigDecimal.valueOf(100), 100L).getId();
        // D6 gap-closure: production write paths (OpeningBalanceService/ReceiptService/...) upsert
        // the registry themselves inside their own @Transactional method; this direct-fixture seed
        // has no surrounding transaction, so it uses save() (a base CRUD method — implicitly
        // transactional via SimpleJpaRepository) rather than the custom @Modifying upsertTenant
        // query, which requires an already-active transaction.
        tenantRegistryRepository.save(
                InventoryTenantRegistryEntity.builder().tenantId(tenantId).build());
    }

    @Test
    void sweep_publishesExpiryAlert_onlyForLotsWithinLeadDaysWindow_andQtyGreaterThanZero() {
        LocalDate today = LocalDate.of(2026, 7, 19);
        int leadDays = 3;

        // Within window (today + 2 <= today + 3), qty > 0 -> alert.
        StockLot withinWindow = InventoryFixtures.seedLot(lotRepository, tenantId, branchId, ingredientId,
                stockId, BigDecimal.valueOf(10), today.plusDays(2), 100L);

        // Exactly at the boundary (today + 3 <= today + 3), qty > 0 -> alert (<=, not <).
        StockLot atBoundary = InventoryFixtures.seedLot(lotRepository, tenantId, branchId, ingredientId,
                stockId, BigDecimal.valueOf(5), today.plusDays(3), 100L);

        // Beyond the window (today + 10 > today + 3) -> no alert.
        InventoryFixtures.seedLot(lotRepository, tenantId, branchId, ingredientId,
                stockId, BigDecimal.valueOf(20), today.plusDays(10), 100L);

        // Within window but qty=0 (already fully depleted) -> no alert.
        InventoryFixtures.seedLot(lotRepository, tenantId, branchId, ingredientId,
                stockId, BigDecimal.ZERO, today.plusDays(1), 100L);

        expirySweepService.sweep(today, leadDays);

        List<OutboxEntry> expiryAlerts = outboxRepository.findAll().stream()
                .filter(e -> tenantId.equals(e.getTenantId()) && "EXPIRY_ALERT".equals(e.getEventType()))
                .toList();
        assertThat(expiryAlerts).hasSize(2);
    }

    @Test
    void sweep_withNoQualifyingLots_publishesNoExpiryAlert() {
        LocalDate today = LocalDate.of(2026, 7, 19);

        InventoryFixtures.seedLot(lotRepository, tenantId, branchId, ingredientId,
                stockId, BigDecimal.valueOf(15), today.plusDays(30), 100L);

        expirySweepService.sweep(today, 3);

        long expiryAlertCount = outboxRepository.findAll().stream()
                .filter(e -> tenantId.equals(e.getTenantId()) && "EXPIRY_ALERT".equals(e.getEventType()))
                .count();
        assertThat(expiryAlertCount).isZero();
    }
}
