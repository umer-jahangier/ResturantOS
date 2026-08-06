package io.restaurantos.hr.repository;

import io.restaurantos.hr.entity.AttendanceQuarantineEntity;
import io.restaurantos.hr.entity.AttendanceQuarantineEntity.Status;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AttendanceQuarantineRepository extends JpaRepository<AttendanceQuarantineEntity, UUID> {

    Optional<AttendanceQuarantineEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    List<AttendanceQuarantineEntity> findAllByTenantIdAndStatus(UUID tenantId, Status status);
}
