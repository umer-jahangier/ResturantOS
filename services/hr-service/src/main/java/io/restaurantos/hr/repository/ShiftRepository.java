package io.restaurantos.hr.repository;

import io.restaurantos.hr.entity.ShiftEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ShiftRepository extends JpaRepository<ShiftEntity, UUID> {

    Optional<ShiftEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    List<ShiftEntity> findAllByBranchId(UUID branchId);
}
