package io.restaurantos.pos.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

/**
 * Where a whole CATEGORY goes, at one branch (28-05).
 *
 * <p>Not a convenience. "Everything in Drinks goes to the bar" is how this is actually configured
 * in a restaurant; expressing it per item would be two hundred checkbox clicks that then drift
 * every time an item is added to the category. A per-item route overrides it, so the exception
 * ("the alcohol-free mojito is made at the pantry") is still expressible.
 *
 * <p>Unique on (tenant, branch, category).
 */
@Entity
@Table(name = "menu_category_station_routes")
@Getter
@Setter
public class MenuCategoryStationRoute extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "category_id", nullable = false)
    private UUID categoryId;

    @Column(name = "station_id", nullable = false)
    private UUID stationId;
}
