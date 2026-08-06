package io.restaurantos.hr.repository;

import io.restaurantos.hr.entity.LeaveTypeEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface LeaveTypeRepository extends JpaRepository<LeaveTypeEntity, UUID> {

    Optional<LeaveTypeEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    List<LeaveTypeEntity> findAllByTenantId(UUID tenantId);

    boolean existsByTenantId(UUID tenantId);
}
