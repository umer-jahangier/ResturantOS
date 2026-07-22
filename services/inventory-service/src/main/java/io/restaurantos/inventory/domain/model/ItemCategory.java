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
 * Maps to {@code item_categories} (V5 migration). D-02: self-referencing, hard-capped at 3
 * levels by {@code trg_item_category_depth}; D-04: archived via {@code archived_at}, never
 * deleted. {@code parentId} is a plain {@link UUID} rather than a {@code @ManyToOne} — the
 * tree is walked explicitly by {@link io.restaurantos.inventory.service.ItemCategoryService}
 * and a lazy-loaded association would fight that depth/cycle logic.
 */
@Entity
@Table(name = "item_categories")
@Getter
@Setter
public class ItemCategory extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "parent_id")
    private UUID parentId;

    @Column(name = "level", nullable = false)
    private short level;

    @Column(name = "code", length = 40)
    private String code;

    @Column(name = "name", nullable = false, length = 160)
    private String name;

    @Column(name = "default_inventory_account_code", length = 20)
    private String defaultInventoryAccountCode;

    @Column(name = "default_cost_account_code", length = 20)
    private String defaultCostAccountCode;

    @Column(name = "default_waste_account_code", length = 20)
    private String defaultWasteAccountCode;

    @Column(name = "variance_cap_pct", precision = 6, scale = 2)
    private BigDecimal varianceCapPct;

    @Column(name = "exclude_from_po_suggestions", nullable = false)
    private boolean excludeFromPoSuggestions = false;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder = 0;

    @Column(name = "archived_at")
    private Instant archivedAt;
}
