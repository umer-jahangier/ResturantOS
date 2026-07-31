package io.restaurantos.inventory.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * Maps to the V3 {@code inventory_tenant_registry} table — RLS-EXEMPT (no {@code tenant_id}
 * isolation policy), mirroring {@code ProcessedEventEntity}'s non-RLS shared-infra convention.
 * Read by {@code ExpirySweepService} to discover the full tenant set with NO ambient
 * {@code TenantContext} required (D6 gap-closure, 08-VERIFICATION.md); written (idempotently) by
 * {@code TenantRegistryService} from every write path that first persists tenant-scoped stock.
 */
@Entity
@Table(name = "inventory_tenant_registry")
@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class InventoryTenantRegistryEntity {

    @Id
    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "first_seen", nullable = false)
    @Builder.Default
    private Instant firstSeen = Instant.now();
}
