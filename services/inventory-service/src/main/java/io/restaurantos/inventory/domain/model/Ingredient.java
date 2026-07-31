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

/** Maps to {@code ingredients} (V1 migration, expanded by V5/V6 — 08.2-01/08.2-09). */
@Entity
@Table(name = "ingredients")
@Getter
@Setter
public class Ingredient extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "name", nullable = false, length = 160)
    private String name;

    @Column(name = "sku", length = 60)
    private String sku;

    @Column(name = "base_uom_code", nullable = false, length = 20)
    private String baseUomCode;

    /**
     * Legacy free-text category (V1). Kept mapped so pre-existing rows stay readable, but
     * {@link io.restaurantos.inventory.service.IngredientService} stops writing it as of
     * 08.2-09 — {@link #categoryId} is the sole source of truth for category assignment.
     */
    @Column(name = "category", length = 80)
    private String category;

    /**
     * FK to {@code item_categories.id} (V5 migration, 08.2-01). NOT NULL at the DB level and, as
     * of 08.2-09, a required field on the create/update request contract too (D-02's "exactly
     * one deterministic answer" rule).
     */
    @Column(name = "category_id", nullable = false)
    private UUID categoryId;

    @Column(name = "reorder_point", nullable = false, precision = 18, scale = 4)
    private BigDecimal reorderPoint = BigDecimal.ZERO;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    @Column(name = "short_name", length = 80)
    private String shortName;

    @Column(name = "description")
    private String description;

    /** {@code PURCHASED}, {@code PREPARED} or {@code BOTH} (V6 CHECK constraint, D-03). */
    @Column(name = "item_type", nullable = false, length = 20)
    private String itemType = "PURCHASED";

    /** D-03: set when {@link #itemType} is {@code PREPARED}/{@code BOTH} — the prep/sub-recipe
     * that produces this item. Authoring UI is explicitly deferred out of this phase. */
    @Column(name = "produced_by_recipe_id")
    private UUID producedByRecipeId;

    /** {@code WEIGHT}, {@code VOLUME} or {@code COUNT} (V6 CHECK constraint, D-06). Locked once
     * any inventory movement or stock lot exists for this ingredient — see
     * {@link io.restaurantos.inventory.service.IngredientService#createIngredient}. */
    @Column(name = "measure_type", nullable = false, length = 10)
    private String measureType = "COUNT";

    @Column(name = "recipe_uom_code", length = 20)
    private String recipeUomCode;

    /**
     * D-07: the item-level AP-to-EP trim yield — one of D-07's three distinct yield numbers.
     * Never confused with the per-recipe-line waste percentage or the recipe-header net yield.
     */
    @Column(name = "default_yield_pct", nullable = false, precision = 6, scale = 2)
    private BigDecimal defaultYieldPct = BigDecimal.valueOf(100);

    @Column(name = "par_level", nullable = false, precision = 18, scale = 4)
    private BigDecimal parLevel = BigDecimal.ZERO;

    /**
     * Legacy free-text label (V6). Retained and kept in sync with {@link #storageLocationId}'s
     * name by {@code IngredientService} — same treatment V5 gave {@link #category}, except that
     * this one stays written so anything still reading the text keeps working.
     */
    @Column(name = "storage_location", length = 80)
    private String storageLocation;

    /** FK to {@code storage_locations.id} (V10) — the source of truth. Nullable by design: a
     * storage location is genuinely optional, unlike {@link #categoryId}. */
    @Column(name = "storage_location_id")
    private UUID storageLocationId;

    @Column(name = "shelf_life_days")
    private Integer shelfLifeDays;

    @Column(name = "is_perishable", nullable = false)
    private boolean perishable = false;

    /** D-04: archive, never hard-delete. NULL = live/active. */
    @Column(name = "archived_at")
    private Instant archivedAt;
}
