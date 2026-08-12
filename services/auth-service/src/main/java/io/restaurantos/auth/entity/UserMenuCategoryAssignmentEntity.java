package io.restaurantos.auth.entity;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

/**
 * One menu category a user may RING, at one branch (Program A).
 *
 * <p>A user with rows here may add items from those categories and no others — enforced by
 * {@code pos.rego}'s {@code pos.order.add_item} rules, not by the grid. A user with NO rows may ring
 * the whole menu, which is what every user in the product has today and must keep having; see
 * {@code PermissionResolver.putMenuCategoryScope} for why that default is encoded as an ABSENT claim
 * key rather than an empty list.
 *
 * <p>{@link #categoryId} is pos_db's {@code menu_categories.id}, and unlike its neighbour
 * {@link UserStationAssignmentEntity} — which stores a station CODE — that is deliberate rather than
 * inconsistent. 086 chose the code because the code is the routing key downstream and because
 * {@code StationServiceImpl.updateStation} cannot change one. Neither holds here:
 * {@code menu_categories} has no code column at all, its {@code name} is renameable
 * ({@code MenuServiceImpl.updateCategory} sets it unconditionally), and the UUID is what every
 * downstream reader already keys on — {@code menu_items.category_id},
 * {@code menu_category_station_routes.category_id}, and MenuController's own {@code ?categoryId=}.
 *
 * <p>It is not, and cannot be, a declared foreign key: auth_db and pos_db are separate databases.
 * That is the one reason 086 gave that still applies, and it applies identically to a name. The
 * consequence is stated rather than hidden — a stale id scopes the user to a category that no longer
 * exists, visible on their own screen within a shift, and self-correcting.
 *
 * <p>Rows are deactivated rather than deleted, matching {@link UserBranchRoleEntity} and
 * {@link UserStationAssignmentEntity}, so an audit reader can still see that a cashier used to be
 * confined to the bar.
 */
@Entity
@Table(name = "user_menu_category_assignments")
@Getter
@Setter
public class UserMenuCategoryAssignmentEntity extends TenantAuditableEntity {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    /**
     * The branch this assignment applies at. NOT NULL by construction.
     *
     * <p>Categories are tenant-scoped in pos_db, so a tenant-wide scope would have been expressible
     * — and would have been wrong. A person already holds different roles at different branches and
     * the resolver mints one token per branch assignment, so a tenant-wide row could not say "runs
     * the bar at one site and the whole floor at another", which is the ordinary multi-site case
     * this feature exists for.
     */
    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "category_id", nullable = false)
    private UUID categoryId;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;
}
