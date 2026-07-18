package io.restaurantos.inventory;

import io.restaurantos.inventory.dto.ReceiptDtos.ReceiptResultDto;
import io.restaurantos.inventory.dto.ReceiptDtos.ReceiveStockRequest;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.InventoryTenantRegistryRepository;
import io.restaurantos.inventory.service.ExpirySweepService;
import io.restaurantos.inventory.service.ReceiptService;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * D6 gap-closure (08-VERIFICATION.md): proves {@link ExpirySweepService#sweep}'s REAL cron-trigger
 * path — {@code nightlySweep()}'s actual invocation shape, with NO ambient {@link TenantContext} —
 * discovers and alerts across MULTIPLE tenants under inventory-service's production
 * {@code NOSUPERUSER NOBYPASSRLS} role constraint.
 *
 * <p>Testcontainers runs its Postgres connection as a superuser, so a naive test could pass purely
 * because RLS is inert in that environment — masking exactly the production bug this fix closes.
 * To avoid that false-positive, this test does two things a row-visibility-only test would not:
 * <ol>
 *   <li>Seeds each tenant's stock through the REAL application write path
 *       ({@link ReceiptService#receive}), never a direct-repository test fixture, so the
 *       registry-upsert hook ({@code TenantRegistryService}) is genuinely exercised.</li>
 *   <li>Asserts the {@code inventory_tenant_registry} table itself contains both tenants BEFORE
 *       calling {@code sweep(...)} with zero ambient context — proving discovery is mechanism-driven
 *       (the registry), not an artifact of the superuser connection bypassing RLS.</li>
 * </ol>
 */
class ExpirySweepCronPathIT extends InventoryTestBase {

    @Autowired TenantContext tenantContext;
    @Autowired ReceiptService receiptService;
    @Autowired IngredientRepository ingredientRepository;
    @Autowired ExpirySweepService expirySweepService;
    @Autowired OutboxRepository outboxRepository;
    @Autowired InventoryTenantRegistryRepository tenantRegistryRepository;

    @Test
    void nightlySweep_withNoAmbientTenantContext_discoversAllTenantsViaRegistry_andAlertsEachOne() {
        LocalDate today = LocalDate.of(2026, 7, 19);
        int leadDays = 3;

        UUID tenantA = UUID.randomUUID();
        UUID branchA = UUID.randomUUID();
        UUID tenantB = UUID.randomUUID();
        UUID branchB = UUID.randomUUID();

        // Seed tenant A via the REAL write path (ReceiptService.receive) with one lot inside the
        // expiry window — this is what upserts inventory_tenant_registry in production, not a
        // direct-repository test fixture.
        tenantContext.set(tenantA, branchA, null, null);
        UUID ingredientA = InventoryFixtures.seedIngredient(
                ingredientRepository, tenantA, "Cream", "SKU-CRON-A", "L", BigDecimal.ZERO).getId();
        ReceiptResultDto receiptA = receiptService.receive(new ReceiveStockRequest(
                ingredientA, branchA, BigDecimal.TEN, 200L, today.plusDays(2)));
        assertThat(receiptA.lotId()).isNotNull();
        tenantContext.clear();

        // Seed tenant B via the same real write path with a lot BEYOND the expiry window — must
        // register the tenant but must NOT produce an EXPIRY_ALERT.
        tenantContext.set(tenantB, branchB, null, null);
        UUID ingredientB = InventoryFixtures.seedIngredient(
                ingredientRepository, tenantB, "Butter", "SKU-CRON-B", "KG", BigDecimal.ZERO).getId();
        receiptService.receive(new ReceiveStockRequest(
                ingredientB, branchB, BigDecimal.valueOf(5), 300L, today.plusDays(30)));
        tenantContext.clear();

        // Prove the MECHANISM (registry), not row-visibility under a superuser test connection:
        // both tenants must already be present before sweep() ever runs.
        List<UUID> registeredTenants = tenantRegistryRepository.findAllTenantIds();
        assertThat(registeredTenants).contains(tenantA, tenantB);

        // The real cron entry path: NO ambient tenant context whatsoever on this thread.
        assertThat(tenantContext.getTenantId()).isEmpty();
        expirySweepService.sweep(today, leadDays);

        List<OutboxEntry> tenantAAlerts = outboxRepository.findAll().stream()
                .filter(e -> tenantA.equals(e.getTenantId()) && "EXPIRY_ALERT".equals(e.getEventType()))
                .toList();
        assertThat(tenantAAlerts).hasSize(1);

        List<OutboxEntry> tenantBAlerts = outboxRepository.findAll().stream()
                .filter(e -> tenantB.equals(e.getTenantId()) && "EXPIRY_ALERT".equals(e.getEventType()))
                .toList();
        assertThat(tenantBAlerts).isEmpty();

        // The sweep must not leak a tenant context back onto this thread once it's done running
        // with none to start with (ExpirySweepService.sweepTenant's finally-block contract).
        assertThat(tenantContext.getTenantId()).isEmpty();
    }
}
