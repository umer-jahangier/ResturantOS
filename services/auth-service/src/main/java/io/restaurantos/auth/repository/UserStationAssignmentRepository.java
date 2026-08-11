package io.restaurantos.auth.repository;

import io.restaurantos.auth.entity.UserStationAssignmentEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Station assignments, read on the login path and written by the user-admin path.
 *
 * <p>Every finder carries an explicit {@code tenantId} predicate <em>in addition</em> to the
 * row-level-security policy on the table. That is not belt-and-braces for its own sake. auth_db's
 * {@code user_station_assignments} is FORCE ROW LEVEL SECURITY, so a query that reaches the
 * database without the tenant GUC on the connection returns ZERO ROWS rather than erroring. Zero
 * rows here does not surface as a wiring break — it surfaces as "this user has no stations", which
 * is a legitimate and extremely common state, and it gets triaged as a configuration question for a
 * week. The predicate is also the only part of the isolation that CI can assert, because
 * Testcontainers' Postgres user is a superuser and superusers bypass row security entirely.
 */
@Repository
public interface UserStationAssignmentRepository extends JpaRepository<UserStationAssignmentEntity, UUID> {

    /** The stations this user works at this branch. The lookup made on every token mint. */
    List<UserStationAssignmentEntity> findByTenantIdAndUserIdAndBranchIdAndActiveTrue(
        UUID tenantId, UUID userId, UUID branchId);

    /**
     * Every row for a user at a branch, active or not.
     *
     * <p>The write path needs the inactive rows too: a replace that re-adds a station the user was
     * previously removed from must reactivate the existing row rather than insert a second one,
     * which the {@code (tenant_id, user_id, branch_id, station_code)} unique constraint would
     * reject.
     */
    List<UserStationAssignmentEntity> findByTenantIdAndUserIdAndBranchId(
        UUID tenantId, UUID userId, UUID branchId);

    /** Every active assignment a user holds, across branches — the read endpoint's source. */
    List<UserStationAssignmentEntity> findByTenantIdAndUserIdAndActiveTrue(UUID tenantId, UUID userId);
}
