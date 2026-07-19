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

import java.util.UUID;

/**
 * Maps to {@code menu_item_catalog} (V4 migration) — a tenant-scoped read-model of the
 * pos-service menu catalog, synced from MENU_ITEM_UPSERTED/MENU_ITEM_DELETED events (D-02).
 * D-07: soft-delete only — {@code active=false}, the row is never removed, so historical
 * recipes/movements referencing {@code menuItemId} stay resolvable.
 */
@Entity
@Table(name = "menu_item_catalog")
@Getter
@Setter
public class MenuItemCatalog extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "menu_item_id", nullable = false)
    private UUID menuItemId;

    @Column(name = "name", length = 160, nullable = false)
    private String name;

    @Column(name = "category_id")
    private UUID categoryId;

    @Column(name = "category_name", length = 160)
    private String categoryName;

    @Column(name = "active", nullable = false)
    private boolean active = true;

    @Column(name = "base_price_paisa", nullable = false)
    private long basePricePaisa;
}
