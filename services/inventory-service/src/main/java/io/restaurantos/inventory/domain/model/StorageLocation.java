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

import java.time.Instant;
import java.util.UUID;

/**
 * Maps to {@code storage_locations} (V10 migration) — the tenant-managed replacement for
 * {@code ingredients.storage_location}'s free text.
 *
 * <p>Flat by design, unlike {@link ItemCategory}: a walk-in cooler does not inherit anything from
 * a dry store, so the tree machinery (depth trigger, most-specific-wins resolution) that category
 * needs would be pure ceremony here.
 *
 * <p>Archived via {@code archivedAt}, never deleted — same D-04 convention as categories and
 * ingredients, and the reason the FK V10 adds is {@code ON DELETE RESTRICT}.
 */
@Entity
@Table(name = "storage_locations")
@Getter
@Setter
public class StorageLocation extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "name", nullable = false, length = 80)
    private String name;

    @Column(name = "description", length = 255)
    private String description;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder = 0;

    @Column(name = "archived_at")
    private Instant archivedAt;
}
