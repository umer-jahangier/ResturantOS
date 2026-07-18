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

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Maps to {@code inventory_movements} (V1 migration) — the typed ledger. {@code movementType}
 * mirrors the DB CHECK constraint: OPENING_BALANCE, RECEIPT, DEPLETION, TRANSFER_OUT,
 * TRANSFER_IN, COUNT_VARIANCE, WASTAGE, TRANSFER_VARIANCE.
 */
@Entity
@Table(name = "inventory_movements")
@Getter
@Setter
public class InventoryMovement extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "ingredient_id", nullable = false)
    private UUID ingredientId;

    @Column(name = "movement_type", nullable = false, length = 24)
    private String movementType;

    @Column(name = "qty", nullable = false, precision = 18, scale = 4)
    private BigDecimal qty;

    @Column(name = "unit_cost_paisa", nullable = false)
    private long unitCostPaisa;

    @Column(name = "total_cost_paisa", nullable = false)
    private long totalCostPaisa;

    @Column(name = "reference_type", length = 40)
    private String referenceType;

    @Column(name = "reference_id")
    private UUID referenceId;

    @Column(name = "movement_at", nullable = false)
    private Instant movementAt = Instant.now();
}
