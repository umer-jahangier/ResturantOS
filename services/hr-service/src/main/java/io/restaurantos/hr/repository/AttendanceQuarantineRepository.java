package io.restaurantos.hr.repository;

import io.restaurantos.hr.entity.AttendanceQuarantineEntity;
import io.restaurantos.hr.entity.AttendanceQuarantineEntity.Reason;
import io.restaurantos.hr.entity.AttendanceQuarantineEntity.Status;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AttendanceQuarantineRepository extends JpaRepository<AttendanceQuarantineEntity, UUID> {

    Optional<AttendanceQuarantineEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    /** The whole pending queue for a tenant. Backed by idx_attendance_quarantine_status (010). */
    List<AttendanceQuarantineEntity> findAllByTenantIdAndStatus(UUID tenantId, Status status);

    /**
     * The pending queue narrowed to one reason — "show me only the lines nobody could read" is a
     * different job from "show me the people I have not mapped yet", and 25-12 gives them separate
     * filters. Backed by idx_attendance_quarantine_reason (034).
     */
    List<AttendanceQuarantineEntity> findAllByTenantIdAndStatusAndReason(
            UUID tenantId, Status status, Reason reason);

    /**
     * The pending queue for one terminal — the question asked from a device's own screen, and the
     * one that distinguishes "this device knows nobody" from "this tenant has a backlog". Backed by
     * idx_attendance_quarantine_device (034).
     */
    List<AttendanceQuarantineEntity> findAllByTenantIdAndStatusAndDeviceId(
            UUID tenantId, Status status, UUID deviceId);
}
