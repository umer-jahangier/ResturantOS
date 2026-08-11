package io.restaurantos.pos.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

/**
 * Where ONE menu item goes, at ONE branch (28-05).
 *
 * <p>This row exists because {@code menu_items} has no branch — it hangs off a tenant-unique
 * category — so a two-branch tenant has one row for "Chicken Karahi" and one {@code station_id} on
 * it. Assigning that item to Branch B's grill silently re-pointed the same item for Branch A. Each
 * write passed its own branch guard; nothing guarded against the last writer winning ACROSS
 * branches, because the row was not branch-scoped at all.
 *
 * <p>Unique on (tenant, branch, item): one destination per item per branch. Wins over the
 * category-level route for the same branch — see {@code StationRoutingResolver}.
 */
@Entity
@Table(name = "menu_item_station_routes")
@Getter
@Setter
public class MenuItemStationRoute extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "menu_item_id", nullable = false)
    private UUID menuItemId;

    @Column(name = "station_id", nullable = false)
    private UUID stationId;
}
