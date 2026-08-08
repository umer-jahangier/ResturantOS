package io.restaurantos.hr.service;

import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import io.restaurantos.hr.entity.AttendanceDeviceEntity.ConnectionMode;
import io.restaurantos.hr.entity.AttendancePunchEntity;
import io.restaurantos.hr.entity.AttendancePunchEntity.PunchType;
import io.restaurantos.hr.entity.EmployeeEntity;
import io.restaurantos.hr.entity.ShiftAssignmentEntity;
import io.restaurantos.hr.entity.ShiftEntity;
import io.restaurantos.hr.repository.AttendanceDeviceRepository;
import io.restaurantos.hr.repository.AttendancePunchRepository;
import io.restaurantos.hr.repository.EmployeeRepository;
import io.restaurantos.hr.repository.ShiftAssignmentRepository;
import io.restaurantos.hr.repository.ShiftRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

/**
 * Manual clock-in/out into {@code attendance_punches} (unified with device punches, 11-11), plus
 * late-arrival / early-leave derivation against the employee's assigned shift. Manual punches use a
 * synthetic per-branch MANUAL device so device_id stays NOT NULL.
 */
@Service
public class AttendanceService {

    private static final ZoneId ZONE = ZoneId.systemDefault();

    private final AttendancePunchRepository punchRepository;
    private final AttendanceDeviceRepository deviceRepository;
    private final ShiftAssignmentRepository assignmentRepository;
    private final ShiftRepository shiftRepository;
    private final EmployeeRepository employeeRepository;
    private final TenantContext tenantContext;

    public AttendanceService(AttendancePunchRepository punchRepository, AttendanceDeviceRepository deviceRepository,
                             ShiftAssignmentRepository assignmentRepository, ShiftRepository shiftRepository,
                             EmployeeRepository employeeRepository, TenantContext tenantContext) {
        this.punchRepository = punchRepository;
        this.deviceRepository = deviceRepository;
        this.assignmentRepository = assignmentRepository;
        this.shiftRepository = shiftRepository;
        this.employeeRepository = employeeRepository;
        this.tenantContext = tenantContext;
    }

    public record DailyAttendanceSummary(UUID employeeId, LocalDate date, Instant firstIn, Instant lastOut,
                                         long lateMinutes, long earlyMinutes) {
    }

    @Transactional
    public AttendancePunchEntity clockIn(UUID employeeId) {
        return punch(employeeId, PunchType.IN);
    }

    @Transactional
    public AttendancePunchEntity clockOut(UUID employeeId) {
        return punch(employeeId, PunchType.OUT);
    }

    private AttendancePunchEntity punch(UUID employeeId, PunchType type) {
        UUID tenantId = requireTenant();
        EmployeeEntity employee = employeeRepository.findByIdAndTenantId(employeeId, tenantId)
                .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + employeeId));
        AttendanceDeviceEntity manual = ensureManualDevice(tenantId, employee.getBranchId());
        AttendancePunchEntity p = new AttendancePunchEntity();
        p.setTenantId(tenantId);
        p.setBranchId(employee.getBranchId());
        p.setDeviceId(manual.getId());
        p.setEmployeeId(employeeId);
        p.setDeviceUserRef("MANUAL:" + employeeId);
        p.setPunchType(type);
        p.setDeviceReportedAt(Instant.now());
        p.setServerReceivedAt(Instant.now());
        return punchRepository.save(p);
    }

    @Transactional(readOnly = true)
    public List<AttendancePunchEntity> punchesForDay(UUID employeeId, LocalDate date) {
        Instant start = date.atStartOfDay(ZONE).toInstant();
        Instant end = date.plusDays(1).atStartOfDay(ZONE).toInstant();
        return punchRepository.findAllByEmployeeIdAndDeviceReportedAtBetweenOrderByDeviceReportedAtAsc(employeeId, start, end);
    }

    /** Late-arrival / early-leave for an employee on a date, vs their assigned shift's start/end. */
    @Transactional(readOnly = true)
    public DailyAttendanceSummary deriveLateEarly(UUID employeeId, LocalDate date) {
        List<AttendancePunchEntity> punches = punchesForDay(employeeId, date);
        Instant firstIn = punches.stream().filter(p -> p.getPunchType() == PunchType.IN)
                .map(AttendancePunchEntity::getDeviceReportedAt).findFirst().orElse(null);
        Instant lastOut = punches.stream().filter(p -> p.getPunchType() == PunchType.OUT)
                .map(AttendancePunchEntity::getDeviceReportedAt).reduce((a, b) -> b).orElse(null);

        long lateMinutes = 0;
        long earlyMinutes = 0;
        List<ShiftAssignmentEntity> assignments = assignmentRepository.findAllByEmployeeIdAndWorkDate(employeeId, date);
        if (!assignments.isEmpty()) {
            ShiftEntity shift = shiftRepository.findById(assignments.get(0).getShiftId()).orElse(null);
            if (shift != null) {
                if (firstIn != null) {
                    LocalTime inTime = LocalTime.ofInstant(firstIn, ZONE);
                    long diff = java.time.Duration.between(shift.getStartTime(), inTime).toMinutes();
                    lateMinutes = Math.max(0, diff);
                }
                if (lastOut != null) {
                    LocalTime outTime = LocalTime.ofInstant(lastOut, ZONE);
                    long diff = java.time.Duration.between(outTime, shift.getEndTime()).toMinutes();
                    earlyMinutes = Math.max(0, diff);
                }
            }
        }
        return new DailyAttendanceSummary(employeeId, date, firstIn, lastOut, lateMinutes, earlyMinutes);
    }

    private AttendanceDeviceEntity ensureManualDevice(UUID tenantId, UUID branchId) {
        String serial = "MANUAL-" + branchId;
        return deviceRepository.findByTenantIdAndSerialNo(tenantId, serial).orElseGet(() -> {
            AttendanceDeviceEntity d = new AttendanceDeviceEntity();
            d.setTenantId(tenantId);
            d.setBranchId(branchId);
            d.setSerialNo(serial);
            d.setModel("Manual clock");
            d.setConnectionMode(ConnectionMode.MANUAL);
            d.setDeviceToken("manual-no-token"); // never used for auth; MANUAL punches are user-initiated
            d.setActive(true);
            return deviceRepository.save(d);
        });
    }

    private UUID requireTenant() {
        return tenantContext.getTenantId().orElseThrow(() -> new IllegalStateException("No tenant context"));
    }
}
