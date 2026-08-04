package io.restaurantos.inventory.service;

import io.restaurantos.inventory.repository.InventoryTenantRegistryRepository;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * Registers tenants into the RLS-exempt {@code inventory_tenant_registry} (V3 migration, D6
 * gap-closure — 08-VERIFICATION.md) so {@code ExpirySweepService}'s nightly {@code @Scheduled}
 * cron trigger — which has NO ambient {@code TenantContext} — can discover the full tenant set
 * without depending on any FORCE-RLS-protected domain table.
 *
 * <p>Call {@link #registerTenant(UUID)} from every write path that FIRST persists tenant-scoped
 * stock (opening balance, receipts, transfer-receive, stock-count adjust). The upsert is
 * idempotent ({@code ON CONFLICT DO NOTHING}) and deliberately carries NO {@code @Transactional}
 * annotation of its own — it MUST join the caller's already-open transaction (Spring's default
 * {@code REQUIRED} propagation) so registration and the stock write it accompanies commit or roll
 * back together, never in a separate/async transaction.
 *
 * <p>This does not weaken tenant isolation: the registry stores nothing but a tenant's existence
 * (no business data), no domain table's FORCE RLS is relaxed, and {@code inventory_user} gets no
 * BYPASSRLS grant anywhere.
 */
@Service
public class TenantRegistryService {

    private final InventoryTenantRegistryRepository registryRepository;

    public TenantRegistryService(InventoryTenantRegistryRepository registryRepository) {
        this.registryRepository = registryRepository;
    }

    public void registerTenant(UUID tenantId) {
        registryRepository.upsertTenant(tenantId);
    }
}
