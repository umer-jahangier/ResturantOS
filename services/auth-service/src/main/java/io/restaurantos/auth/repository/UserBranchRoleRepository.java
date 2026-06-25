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

    Optional<UserBranchRoleEntity> findByUserIdAndBranchIdAndActiveTrue(UUID userId, UUID branchId);

    Optional<UserBranchRoleEntity> findByUserIdAndBranchIdAndRoleCode(UUID userId, UUID branchId, String roleCode);
}
