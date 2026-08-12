package io.restaurantos.auth.repository;

import io.restaurantos.auth.entity.UserBranchRoleEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface UserBranchRoleRepository extends JpaRepository<UserBranchRoleEntity, UUID> {

    List<UserBranchRoleEntity> findByUserIdAndActiveTrue(UUID userId);

    /**
     * Active assignments for a user at one branch.
     *
     * <p>Returns a list, not an {@code Optional}, even though a partial unique index now permits at
     * most one row. The {@code Optional} form is what turned a duplicated row into
     * {@code IncorrectResultSizeDataAccessException} on the login path — a 500 rather than a login
     * — and it would do so again for any row that predates the index, arrives through a repair
     * script, or survives a future migration that drops it. The caller decides what to do with a
     * surplus row; the repository does not get to throw about it.
     */
    List<UserBranchRoleEntity> findByUserIdAndBranchIdAndActiveTrue(UUID userId, UUID branchId);

    /** The user's default branch at login. At most one row, held by a partial unique index. */
    Optional<UserBranchRoleEntity> findFirstByUserIdAndActiveTrueAndPrimaryTrue(UUID userId);

    Optional<UserBranchRoleEntity> findByUserIdAndBranchIdAndRoleCode(UUID userId, UUID branchId, String roleCode);

    /**
     * How many people in this tenant currently hold a role (S3).
     *
     * <p>DISTINCT on the user, not a row count: one person assigned the same role at three branches
     * is one person to an administrator reading "held by 3 people", and a row count would tell them
     * to go and find two colleagues who do not exist.
     *
     * <p>Carries the {@code tenantId} predicate itself rather than leaning on the FORCE RLS policy
     * on {@code user_branch_roles}, because the policy is inert under the SUPERUSER every
     * integration test connects as — an untested isolation control is not one.
     */
    @Query("""
        SELECT COUNT(DISTINCT ubr.userId) FROM UserBranchRoleEntity ubr
         WHERE ubr.tenantId = :tenantId AND ubr.roleCode = :roleCode AND ubr.active = true
        """)
    long countByTenantIdAndRoleCodeAndActiveTrue(@Param("tenantId") UUID tenantId,
                                                 @Param("roleCode") String roleCode);

    /**
     * The same count for every role at once, so a roles list is one query rather than one per row.
     *
     * <p>Roles nobody holds are simply ABSENT from the result; the caller reads a missing key as
     * zero. Returning explicit zeroes would need a join against {@code roles}, which lives behind a
     * different RLS policy, and would make this query's correctness depend on that one.
     */
    @Query("""
        SELECT ubr.roleCode AS roleCode, COUNT(DISTINCT ubr.userId) AS holders
          FROM UserBranchRoleEntity ubr
         WHERE ubr.tenantId = :tenantId AND ubr.roleCode IN :roleCodes AND ubr.active = true
         GROUP BY ubr.roleCode
        """)
    List<RoleHolderCount> countHoldersByRole(@Param("tenantId") UUID tenantId,
                                             @Param("roleCodes") Collection<String> roleCodes);

    /** Projection for {@link #countHoldersByRole(UUID, Collection)}. */
    interface RoleHolderCount {
        String getRoleCode();

        long getHolders();
    }
}
