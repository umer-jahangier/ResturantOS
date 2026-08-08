package io.restaurantos.hr.repository;

import io.restaurantos.hr.entity.LeaveBalanceEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface LeaveBalanceRepository extends JpaRepository<LeaveBalanceEntity, UUID> {

    Optional<LeaveBalanceEntity> findByTenantIdAndEmployeeIdAndLeaveTypeIdAndPeriodYear(
            UUID tenantId, UUID employeeId, UUID leaveTypeId, int periodYear);

    List<LeaveBalanceEntity> findAllByTenantIdAndPeriodYear(UUID tenantId, int periodYear);

    List<LeaveBalanceEntity> findAllByEmployeeId(UUID employeeId);
}
