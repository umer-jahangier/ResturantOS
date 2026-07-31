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

/** Maps to {@code recipe_lines} (V1 migration) — a single BOM ingredient line for a {@link Recipe} version. */
@Entity
@Table(name = "recipe_lines")
@Getter
@Setter
public class RecipeLine extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "recipe_id", nullable = false)
    private UUID recipeId;

    @Column(name = "ingredient_id", nullable = false)
    private UUID ingredientId;

    @Column(name = "qty", nullable = false, precision = 18, scale = 4)
    private BigDecimal qty;

    @Column(name = "uom_code", nullable = false, length = 20)
    private String uomCode;

    @Column(name = "yield_pct", nullable = false, precision = 6, scale = 2)
    private BigDecimal yieldPct = BigDecimal.valueOf(100);
}
