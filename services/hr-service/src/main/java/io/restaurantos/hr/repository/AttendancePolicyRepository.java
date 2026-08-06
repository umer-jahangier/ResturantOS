package io.restaurantos.hr.repository;

import io.restaurantos.hr.entity.AttendancePolicyEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface AttendancePolicyRepository extends JpaRepository<AttendancePolicyEntity, UUID> {

    Optional<AttendancePolicyEntity> findByTenantIdAndBranchId(UUID tenantId, UUID branchId);

    Optional<AttendancePolicyEntity> findFirstByTenantIdAndBranchIdIsNull(UUID tenantId);
}
