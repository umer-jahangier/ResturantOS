package io.restaurantos.hr.repository;

import io.restaurantos.hr.entity.LeaveAccrualLogEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface LeaveAccrualLogRepository extends JpaRepository<LeaveAccrualLogEntity, UUID> {

    boolean existsByTenantIdAndEmployeeIdAndLeaveTypeIdAndPeriodYearAndPeriodMonth(
            UUID tenantId, UUID employeeId, UUID leaveTypeId, int periodYear, int periodMonth);
}
