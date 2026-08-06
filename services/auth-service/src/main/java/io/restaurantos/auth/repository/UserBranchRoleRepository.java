package io.restaurantos.auth.repository;

import io.restaurantos.auth.entity.UserBranchRoleEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

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
}
