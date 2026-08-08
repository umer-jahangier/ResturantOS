package io.restaurantos.hr.repository;

import io.restaurantos.hr.entity.AttendancePunchEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface AttendancePunchRepository extends JpaRepository<AttendancePunchEntity, UUID> {

    List<AttendancePunchEntity> findAllByEmployeeIdAndDeviceReportedAtBetweenOrderByDeviceReportedAtAsc(
            UUID employeeId, Instant start, Instant end);
}
