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
 * Maps to {@code ingredient_uom_conversions} (V6 migration, D-06/D-08) — an item-scoped
 * cross-dimension bridge (density, each-weight, pack size). {@code factor} converts one unit of
 * {@code fromUomCode} into {@code toUomCode}; conversions always resolve source -> base -> target
 * in exactly two multiplications (D-08), never chained through a third intermediate unit.
 */
@Entity
@Table(name = "ingredient_uom_conversions")
@Getter
@Setter
public class IngredientUomConversion extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "ingredient_id", nullable = false)
    private UUID ingredientId;

    @Column(name = "from_uom_code", nullable = false, length = 20)
    private String fromUomCode;

    @Column(name = "to_uom_code", nullable = false, length = 20)
    private String toUomCode;

    @Column(name = "factor", nullable = false, precision = 18, scale = 9)
    private BigDecimal factor;

    @Column(name = "note", length = 160)
    private String note;
}
