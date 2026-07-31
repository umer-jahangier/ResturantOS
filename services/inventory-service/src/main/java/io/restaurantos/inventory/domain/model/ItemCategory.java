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

    /**
     * The three {@code *_account_code} columns are a DISPLAY CACHE of the account each
     * {@code *_account_id} beside them points at (V8). The id is the authoritative reference —
     * account codes get renumbered by chart-of-accounts restructures, ids do not. Both are written
     * together by {@code ItemCategoryService}, from the account it resolved through
     * finance-service, so the cached code is always that account's real code and never free text.
     *
     * <p>Rows predating V8 have a code but no id (the migration could not translate one into the
     * other — {@code chart_of_accounts} lives in a different service's database). Every read path
     * falls back to the code, and the id is filled in the next time the category is saved.
     */
    @Column(name = "default_inventory_account_code", length = 20)
    private String defaultInventoryAccountCode;

    @Column(name = "default_inventory_account_id")
    private UUID defaultInventoryAccountId;

    @Column(name = "default_cost_account_code", length = 20)
    private String defaultCostAccountCode;

    @Column(name = "default_cost_account_id")
    private UUID defaultCostAccountId;

    @Column(name = "default_waste_account_code", length = 20)
    private String defaultWasteAccountCode;

    @Column(name = "default_waste_account_id")
    private UUID defaultWasteAccountId;

    @Column(name = "variance_cap_pct", precision = 6, scale = 2)
    private BigDecimal varianceCapPct;

    @Column(name = "exclude_from_po_suggestions", nullable = false)
    private boolean excludeFromPoSuggestions = false;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder = 0;

    @Column(name = "archived_at")
    private Instant archivedAt;
}
