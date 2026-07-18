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

/**
 * Maps to {@code stock_count_lines} (V1 migration, INV-06) — a single ingredient's counted-vs-system
 * variance within a {@link StockCount}. {@code varianceCostPaisa} = {@code round(varianceQty x
 * avg_cost_paisa)} HALF_UP, mirrors {@code DepletionService}/{@code TransferService}'s cost-rounding
 * convention — never re-derived from a lot's own receipt cost.
 */
@Entity
@Table(name = "stock_count_lines")
@Getter
@Setter
public class StockCountLine extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "count_id", nullable = false)
    private UUID countId;

    @Column(name = "ingredient_id", nullable = false)
    private UUID ingredientId;

    @Column(name = "system_qty", nullable = false, precision = 18, scale = 4)
    private BigDecimal systemQty = BigDecimal.ZERO;

    @Column(name = "counted_qty", nullable = false, precision = 18, scale = 4)
    private BigDecimal countedQty = BigDecimal.ZERO;

    @Column(name = "variance_qty", nullable = false, precision = 18, scale = 4)
    private BigDecimal varianceQty = BigDecimal.ZERO;

    @Column(name = "variance_cost_paisa", nullable = false)
    private long varianceCostPaisa;
}
