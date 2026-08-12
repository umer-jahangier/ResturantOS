package io.restaurantos.auth.repository;

import io.restaurantos.auth.entity.UserMenuCategoryAssignmentEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Menu-category assignments, read on the login path and written by the user-admin path.
 *
 * <p>Every finder carries an explicit {@code tenantId} predicate <em>in addition</em> to the
 * row-level-security policy on the table, for the reason
 * {@link UserStationAssignmentRepository} spells out and which is sharper here:
 * {@code user_menu_category_assignments} is FORCE ROW LEVEL SECURITY, so a query that reaches the
 * database without the tenant GUC on the connection returns ZERO ROWS rather than erroring — and
 * zero rows in THIS table does not read as a wiring break. It reads as "this user may ring the whole
 * menu", which is a legitimate, overwhelmingly common state and the permissive one. A missing GUC
 * would therefore silently UNSCOPE a confined cashier rather than lock anyone out, and nothing on
 * any screen would say so.
 *
 * <p>The predicate is also the only part of the isolation CI can assert, because Testcontainers'
 * Postgres user is a superuser and superusers bypass row security entirely.
 */
@Repository
public interface UserMenuCategoryAssignmentRepository
        extends JpaRepository<UserMenuCategoryAssignmentEntity, UUID> {

    /** The categories this user may ring at this branch. The lookup made on every token mint. */
    List<UserMenuCategoryAssignmentEntity> findByTenantIdAndUserIdAndBranchIdAndActiveTrue(
        UUID tenantId, UUID userId, UUID branchId);

    /**
     * Every row for a user at a branch, active or not.
     *
     * <p>The write path needs the inactive rows too: a replace that re-adds a category the user was
     * previously removed from must reactivate the existing row rather than insert a second one,
     * which the {@code (tenant_id, user_id, branch_id, category_id)} unique constraint would reject.
     */
    List<UserMenuCategoryAssignmentEntity> findByTenantIdAndUserIdAndBranchId(
        UUID tenantId, UUID userId, UUID branchId);

    /** Every active assignment a user holds, across branches — the read endpoint's source. */
    List<UserMenuCategoryAssignmentEntity> findByTenantIdAndUserIdAndActiveTrue(UUID tenantId, UUID userId);
}
