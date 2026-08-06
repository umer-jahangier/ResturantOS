package io.restaurantos.hr.repository;

import io.restaurantos.hr.entity.LeaveRequestEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface LeaveRequestRepository extends JpaRepository<LeaveRequestEntity, UUID> {

    Optional<LeaveRequestEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    List<LeaveRequestEntity> findAllByEmployeeId(UUID employeeId);

    List<LeaveRequestEntity> findAllByTenantId(UUID tenantId);
}
