package io.restaurantos.inventory.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * Maps to {@code stock_wastage} (V11) — the header for a write-off. Its {@code id} is the
 * {@code wastageId} finance dedupes the WASTAGE journal entry on.
 */
@Entity
@Table(name = "stock_wastage")
@Getter
@Setter
public class StockWastage extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "reason", nullable = false, length = 32)
    private String reason;

    @Column(name = "notes")
    private String notes;

    @Column(name = "total_cost_paisa", nullable = false)
    private long totalCostPaisa;

    @Column(name = "recorded_at", nullable = false)
    private Instant recordedAt = Instant.now();
}
