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

/** Maps to {@code units_of_measure} (V1 migration). */
@Entity
@Table(name = "units_of_measure")
@Getter
@Setter
public class UnitOfMeasure extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "code", nullable = false, length = 20)
    private String code;

    @Column(name = "name", nullable = false, length = 120)
    private String name;

    @Column(name = "base_unit_code", length = 20)
    private String baseUnitCode;

    @Column(name = "to_base_factor", nullable = false, precision = 18, scale = 8)
    private BigDecimal toBaseFactor = BigDecimal.ONE;

    /**
     * WEIGHT / VOLUME / COUNT — the physical dimension this unit measures (V7 migration, CHECK
     * constrained). Shares its vocabulary with {@link Ingredient#getMeasureType()} so the two can
     * be compared directly: {@code IngredientService} rejects an ingredient whose declared measure
     * type disagrees with its stock unit's, and the ingredient form filters both unit selects on
     * it. Before V7 the dimension was only implicit in the {@link #baseUnitCode} chain, which the
     * UI could not see.
     */
    @Column(name = "measure_type", nullable = false, length = 10)
    private String measureType = "COUNT";

    /**
     * Retired: hidden from every picker, still resolvable by every conversion path (V13).
     *
     * <p>Never a delete. This unit's CODE is a foreign key by value from
     * {@code ingredients.base_uom_code}, {@code ingredients.recipe_uom_code},
     * {@code ingredient_uom_conversions} on both sides, and — across a database boundary —
     * {@code purchasing_db.vendor_items.pack_uom}. None of those references can be followed
     * backwards, so a delete orphans all of them silently and makes a historical receipt in this
     * unit stop converting, which makes the stock valuation it produced unreproducible.
     */
    @Column(name = "archived_at")
    private java.time.Instant archivedAt;
}
