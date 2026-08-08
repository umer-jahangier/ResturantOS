package io.restaurantos.hr.repository;

import io.restaurantos.hr.entity.EmployeeEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface EmployeeRepository extends JpaRepository<EmployeeEntity, UUID> {

    Optional<EmployeeEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    List<EmployeeEntity> findAllByBranchId(UUID branchId);

    boolean existsByTenantIdAndEmployeeNo(UUID tenantId, String employeeNo);

    /** Used by 11-11 PunchIngestService to resolve a device PIN to an employee. */
    Optional<EmployeeEntity> findByTenantIdAndDeviceUserRef(UUID tenantId, String deviceUserRef);
}
