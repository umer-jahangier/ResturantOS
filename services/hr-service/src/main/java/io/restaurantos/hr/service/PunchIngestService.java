package io.restaurantos.hr.service;

import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import io.restaurantos.hr.entity.AttendancePunchEntity.PunchType;
import io.restaurantos.hr.entity.AttendanceQuarantineEntity;
import io.restaurantos.hr.entity.EmployeeEntity;
import io.restaurantos.hr.repository.AttendanceDeviceRepository;
import io.restaurantos.hr.repository.AttendanceQuarantineRepository;
import io.restaurantos.hr.repository.EmployeeRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * The single ingest funnel for BOTH Mode A (ADMS/iClock) and Mode B (USB bridge). Resolves the
 * employee through the DURABLE {@code employees.device_user_ref} mapping (not a per-punch decision),
 * inserts idempotently ({@code ON CONFLICT (device_id, device_user_ref, device_reported_at) DO NOTHING}),
 * quarantines an unmapped ref instead of dropping it, and publishes ATTENDANCE_PUNCHED only on a
 * genuine insert. No raw biometric data is accepted or stored.
 */
@Service
public class PunchIngestService {

    private static final String HR_EXCHANGE = "hr.topic";

    private final EmployeeRepository employeeRepository;
    private final AttendanceQuarantineRepository quarantineRepository;
    private final AttendanceDeviceRepository deviceRepository;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;

    @PersistenceContext
    private EntityManager entityManager;

    public PunchIngestService(EmployeeRepository employeeRepository,
                              AttendanceQuarantineRepository quarantineRepository,
                              AttendanceDeviceRepository deviceRepository,
                              EventPublisher eventPublisher,
                              TenantContext tenantContext) {
        this.employeeRepository = employeeRepository;
        this.quarantineRepository = quarantineRepository;
        this.deviceRepository = deviceRepository;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
    }

    /**
     * Resolve a quarantined punch: persist the DURABLE {@code employees.device_user_ref} mapping so
     * every future punch for that ref auto-resolves (no quarantine loop), then re-ingest the parked
     * punch and mark the quarantine RESOLVED. Rejects if the ref is already mapped to another employee.
     */
    @Transactional
    public void resolveQuarantine(UUID quarantineId, UUID employeeId) {
        UUID tenantId = tenantContext.getTenantId().orElseThrow(() -> new IllegalStateException("No tenant context"));
        AttendanceQuarantineEntity q = quarantineRepository.findByIdAndTenantId(quarantineId, tenantId)
                .orElseThrow(() -> new IllegalArgumentException("Quarantine not found: " + quarantineId));
        if (q.getStatus() == AttendanceQuarantineEntity.Status.RESOLVED) {
            return;
        }
        employeeRepository.findByTenantIdAndDeviceUserRef(tenantId, q.getDeviceUserRef()).ifPresent(existing -> {
            if (!existing.getId().equals(employeeId)) {
                throw new IllegalStateException(
                        "device_user_ref " + q.getDeviceUserRef() + " is already mapped to another employee");
            }
        });
        EmployeeEntity employee = employeeRepository.findByIdAndTenantId(employeeId, tenantId)
                .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + employeeId));
        employee.setDeviceUserRef(q.getDeviceUserRef()); // durable mapping
        employeeRepository.save(employee);

        AttendanceDeviceEntity device = deviceRepository.findById(q.getDeviceId())
                .orElseThrow(() -> new IllegalStateException("Quarantine device missing: " + q.getDeviceId()));
        ingest(device, q.getDeviceUserRef(), q.getDeviceReportedAt(), q.getPunchType(), null, q.getRawLine());

        q.setStatus(AttendanceQuarantineEntity.Status.RESOLVED);
        q.setResolvedEmployeeId(employeeId);
        quarantineRepository.save(q);
    }

    /**
     * The queue's deduplication key for a line that PARSED but whose reference maps to nobody.
     *
     * <p>Deliberately the same identity {@code uk_attendance_punch} uses, minus the device — the
     * device is the other half of {@code uk_attendance_quarantine_dedup}. So a punch deduplicates on
     * the same three facts whether it lands in the punch table or in the queue, and a replayed
     * offline buffer grows neither.
     *
     * <p>Epoch millis rather than a rendered timestamp because changelog 034's backfill has to
     * produce a byte-identical string from Postgres, and a number cannot disagree with Java about
     * its own formatting across fractional seconds, offsets and locales.
     */
    static String dedupKeyForReference(String deviceUserRef, Instant deviceReportedAt) {
        return "REF:" + deviceUserRef + "@" + deviceReportedAt.toEpochMilli();
    }

    public enum IngestResult { INSERTED, DUPLICATE, QUARANTINED }

    @Transactional
    public IngestResult ingest(AttendanceDeviceEntity device, String deviceUserRef, Instant deviceReportedAt,
                               PunchType punchType, String workCode, String rawLine) {
        UUID tenantId = device.getTenantId();
        UUID branchId = device.getBranchId();

        Optional<EmployeeEntity> employee = employeeRepository.findByTenantIdAndDeviceUserRef(tenantId, deviceUserRef);
        if (employee.isEmpty()) {
            AttendanceQuarantineEntity q = new AttendanceQuarantineEntity();
            q.setTenantId(tenantId);
            q.setDeviceId(device.getId());
            q.setDeviceUserRef(deviceUserRef);
            q.setPunchType(punchType);
            q.setDeviceReportedAt(deviceReportedAt);
            q.setRawLine(rawLine);
            q.setReason(AttendanceQuarantineEntity.Reason.UNMAPPED_DEVICE_USER);
            q.setDedupKey(dedupKeyForReference(deviceUserRef, deviceReportedAt));
            q.setReceivedAt(Instant.now());
            q.setStatus(AttendanceQuarantineEntity.Status.PENDING);
            quarantineRepository.save(q);
            return IngestResult.QUARANTINED;
        }

        UUID employeeId = employee.get().getId();
        int rows = entityManager.createNativeQuery(
                        "INSERT INTO attendance_punches (tenant_id, branch_id, device_id, employee_id, "
                                + "device_user_ref, punch_type, device_reported_at, server_received_at, work_code) "
                                + "VALUES (CAST(:tenantId AS uuid), CAST(:branchId AS uuid), CAST(:deviceId AS uuid), "
                                + "CAST(:employeeId AS uuid), :deviceUserRef, :punchType, CAST(:deviceReportedAt AS timestamptz), "
                                + "now(), :workCode) "
                                + "ON CONFLICT (device_id, device_user_ref, device_reported_at) DO NOTHING")
                .setParameter("tenantId", tenantId.toString())
                .setParameter("branchId", branchId.toString())
                .setParameter("deviceId", device.getId().toString())
                .setParameter("employeeId", employeeId.toString())
                .setParameter("deviceUserRef", deviceUserRef)
                .setParameter("punchType", punchType.name())
                .setParameter("deviceReportedAt", deviceReportedAt.toString())
                .setParameter("workCode", workCode)
                .executeUpdate();

        device.setLastSeenAt(Instant.now());
        deviceRepository.save(device);

        if (rows == 0) {
            return IngestResult.DUPLICATE; // offline-buffer replay — publish nothing
        }

        Map<String, Object> payload = new HashMap<>();
        payload.put("employeeId", employeeId);
        payload.put("deviceId", device.getId());
        payload.put("punchedAt", deviceReportedAt);
        payload.put("punchType", punchType.name());
        eventPublisher.publish(HR_EXCHANGE, "hr.attendance.punched", "ATTENDANCE_PUNCHED", branchId, payload);
        return IngestResult.INSERTED;
    }
}
