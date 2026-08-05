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

/** Maps to {@code ingredient_branch_stock} (V1 migration) — the per-branch on-hand + MAC row. */
@Entity
@Table(name = "ingredient_branch_stock")
@Getter
@Setter
public class IngredientBranchStock extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "ingredient_id", nullable = false)
    private UUID ingredientId;

    @Column(name = "qty_on_hand", nullable = false, precision = 18, scale = 4)
    private BigDecimal qtyOnHand = BigDecimal.ZERO;

    /**
     * Moving-average cost of ONE stock unit, in paisa (V12: NUMERIC(18,4)).
     *
     * <p>A rate, not an amount — which is why it is not a whole paisa like a total is. An
     * ingredient stocked in grams and bought by the kilogram has a genuinely fractional per-gram
     * cost: PKR 62/kg is 6.2 paisa/g, and rounding that to 6 mis-valued the stock by 3.2%.
     */
    @Column(name = "avg_cost_paisa", nullable = false, precision = 18, scale = 4)
    private BigDecimal avgCostPaisa = BigDecimal.ZERO;

    @Column(name = "last_counted_at")
    private Instant lastCountedAt;
}
