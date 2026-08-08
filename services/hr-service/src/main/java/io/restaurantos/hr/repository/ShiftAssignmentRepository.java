package io.restaurantos.hr.repository;

import io.restaurantos.hr.entity.ShiftAssignmentEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ShiftAssignmentRepository extends JpaRepository<ShiftAssignmentEntity, UUID> {

    Optional<ShiftAssignmentEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    List<ShiftAssignmentEntity> findAllByWorkDateBetween(LocalDate start, LocalDate end);

    List<ShiftAssignmentEntity> findAllByEmployeeIdAndWorkDate(UUID employeeId, LocalDate workDate);

    boolean existsByTenantIdAndShiftIdAndEmployeeIdAndWorkDate(UUID tenantId, UUID shiftId, UUID employeeId, LocalDate workDate);
}
