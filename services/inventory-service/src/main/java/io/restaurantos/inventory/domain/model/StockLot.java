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
import java.time.LocalDate;
import java.util.UUID;

/**
 * Maps to {@code stock_lots} (V1 migration, D-04) — the FEFO source of truth. A row's
 * {@code stockId} references the owning {@link IngredientBranchStock} row.
 */
@Entity
@Table(name = "stock_lots")
@Getter
@Setter
public class StockLot extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "ingredient_id", nullable = false)
    private UUID ingredientId;

    @Column(name = "stock_id", nullable = false)
    private UUID stockId;

    @Column(name = "qty", nullable = false, precision = 18, scale = 4)
    private BigDecimal qty = BigDecimal.ZERO;

    /** Nullable — non-perishable lots sort last under FEFO (Postgres default: NULLS LAST on ASC). */
    @Column(name = "expiry_date")
    private LocalDate expiryDate;

    @Column(name = "receipt_unit_cost_paisa", nullable = false)
    private long receiptUnitCostPaisa;

    @Column(name = "received_at", nullable = false)
    private Instant receivedAt = Instant.now();

    @Column(name = "source_movement_id")
    private UUID sourceMovementId;
}
