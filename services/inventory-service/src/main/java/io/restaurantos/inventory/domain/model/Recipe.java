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
 * Maps to {@code recipes} (V1 migration) — a versioned BOM for a menu item (INV-02).
 * Resolution of "which version applies at order time" (D-01) is done by
 * {@code RecipeRepository.findEffectiveVersionsDesc}, which filters on {@code effective_from}
 * against the order's closedAt — never on {@code is_current}.
 */
@Entity
@Table(name = "recipes")
@Getter
@Setter
public class Recipe extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "menu_item_id", nullable = false)
    private UUID menuItemId;

    @Column(name = "version", nullable = false)
    private int version;

    @Column(name = "is_current", nullable = false)
    private boolean current = true;

    @Column(name = "effective_from", nullable = false)
    private Instant effectiveFrom;

    @Column(name = "yield_servings", nullable = false, precision = 18, scale = 4)
    private BigDecimal yieldServings = BigDecimal.ONE;

    @Column(name = "name", length = 160)
    private String name;
}
