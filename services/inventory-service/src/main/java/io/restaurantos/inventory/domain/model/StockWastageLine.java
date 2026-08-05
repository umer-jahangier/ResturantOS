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
import java.util.UUID;

/** Maps to {@code stock_wastage_lines} (V11) — one ingredient written off. */
@Entity
@Table(name = "stock_wastage_lines")
@Getter
@Setter
public class StockWastageLine extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "wastage_id", nullable = false)
    private UUID wastageId;

    @Column(name = "ingredient_id", nullable = false)
    private UUID ingredientId;

    @Column(name = "qty", nullable = false)
    private BigDecimal qty;

    /**
     * The moving-average cost at write-off time — wastage is valued at MAC, never at lot cost.
     * A rate per stock unit, in paisa (V12: NUMERIC(18,4)).
     */
    @Column(name = "unit_cost_paisa", nullable = false, precision = 18, scale = 4)
    private BigDecimal unitCostPaisa = BigDecimal.ZERO;

    @Column(name = "line_cost_paisa", nullable = false)
    private long lineCostPaisa;
}
