package io.restaurantos.hr;

import io.restaurantos.hr.dto.EmployeeDtos.CreateEmployeeRequest;
import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import io.restaurantos.hr.entity.AttendanceDeviceEntity.ConnectionMode;
import io.restaurantos.hr.entity.AttendancePunchEntity;
import io.restaurantos.hr.entity.AttendancePunchEntity.PunchType;
import io.restaurantos.hr.entity.EmployeeEntity.EmploymentType;
import io.restaurantos.hr.entity.LeaveRequestEntity.Status;
import io.restaurantos.hr.repository.AttendanceDeviceRepository;
import io.restaurantos.hr.repository.AttendancePunchRepository;
import io.restaurantos.hr.service.AttendanceService.DailyAttendanceSummary;
import io.restaurantos.hr.service.AttendanceService;
import io.restaurantos.hr.service.EmployeeService;
import io.restaurantos.hr.service.LeaveService;
import io.restaurantos.hr.service.LeaveService.LeaveRequestResponse;
import io.restaurantos.hr.service.LeaveService.TypeResponse;
import io.restaurantos.hr.service.ShiftService;
import io.restaurantos.hr.service.ShiftService.AssignRequest;
import io.restaurantos.hr.service.ShiftService.CreateShiftRequest;
import io.restaurantos.hr.service.ShiftService.ShiftResponse;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** Late-arrival derivation vs an assigned shift, and the leave accrual → request → approve flow. */
class AttendanceLeaveIT extends HrTestBase {

    @Autowired ShiftService shiftService;
    @Autowired AttendanceService attendanceService;
    @Autowired LeaveService leaveService;
    @Autowired EmployeeService employeeService;
    @Autowired AttendancePunchRepository punchRepository;
    @Autowired AttendanceDeviceRepository deviceRepository;
    @Autowired TenantContext tenantContext;

    @Test
    void lateArrival_derivedAgainstAssignedShift() {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        tenantContext.set(tenant, branch, UUID.randomUUID(), null);
        try {
            UUID empId = employeeService.create(new CreateEmployeeRequest(
                    "EMP-LATE", "Late Emp", null, null, null, null, null,
                    EmploymentType.PERMANENT, LocalDate.of(2025, 1, 1), 0L, null)).id();

            ShiftResponse shift = shiftService.create(new CreateShiftRequest(
                    "Morning", "Waiter", LocalTime.of(9, 0), LocalTime.of(17, 0), List.of(1, 2, 3, 4, 5)));
            LocalDate today = LocalDate.now();
            shiftService.assign(new AssignRequest(shift.id(), empId, today));

            // Insert an IN punch at 09:30 (30 min after the shift start) at a fixed time.
            AttendanceDeviceEntity dev = new AttendanceDeviceEntity();
            dev.setTenantId(tenant);
            dev.setBranchId(branch);
            dev.setSerialNo("SN-late-" + UUID.randomUUID());
            dev.setConnectionMode(ConnectionMode.MANUAL);
            dev.setDeviceToken("x");
            dev.setActive(true);
            dev = deviceRepository.save(dev);

            AttendancePunchEntity punch = new AttendancePunchEntity();
            punch.setTenantId(tenant);
            punch.setBranchId(branch);
            punch.setDeviceId(dev.getId());
            punch.setEmployeeId(empId);
            punch.setDeviceUserRef("MANUAL:" + empId);
            punch.setPunchType(PunchType.IN);
            Instant nineThirty = today.atTime(9, 30).atZone(ZoneId.systemDefault()).toInstant();
            punch.setDeviceReportedAt(nineThirty);
            punch.setServerReceivedAt(Instant.now());
            punchRepository.save(punch);

            DailyAttendanceSummary summary = attendanceService.deriveLateEarly(empId, today);
            assertThat(summary.lateMinutes()).isEqualTo(30);
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void leave_accrue_request_approve_decrementsBalance() {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        int year = LocalDate.now().getYear();
        tenantContext.set(tenant, branch, UUID.randomUUID(), null);
        try {
            UUID empId = employeeService.create(new CreateEmployeeRequest(
                    "EMP-LV", "Leave Emp", null, null, null, null, null,
                    EmploymentType.PERMANENT, LocalDate.of(2025, 1, 1), 0L, null)).id();

            leaveService.ensureDefaultTypes();
            TypeResponse annual = leaveService.listTypes().stream()
                    .filter(t -> t.name().equals("Annual")).findFirst().orElseThrow();

            assertThat(leaveService.accrue(year, 1)).isPositive(); // Annual accrues 1.5 days/month
            assertThat(leaveService.balances(empId))
                    .anySatisfy(b -> assertThat(b.balanceDays()).isEqualByComparingTo(new BigDecimal("1.5")));

            // Re-running the SAME period must be a no-op. Before leave_accrual_log existed this
            // silently granted the days again — and because @Scheduled fires on every replica, an
            // N-replica deployment did exactly this N times every month.
            assertThat(leaveService.accrue(year, 1)).isZero();
            assertThat(leaveService.balances(empId))
                    .anySatisfy(b -> assertThat(b.balanceDays()).isEqualByComparingTo(new BigDecimal("1.5")));

            // A DIFFERENT period still accrues normally.
            assertThat(leaveService.accrue(year, 2)).isPositive();
            assertThat(leaveService.balances(empId))
                    .anySatisfy(b -> assertThat(b.balanceDays()).isEqualByComparingTo(new BigDecimal("3.0")));

            LocalDate day = LocalDate.of(year, 6, 2);
            LeaveRequestResponse req = leaveService.request(new LeaveService.RequestLeave(
                    empId, annual.id(), day, day, "Personal"));
            assertThat(req.status()).isEqualTo(Status.PENDING);

            LeaveRequestResponse approved = leaveService.approve(req.id());
            assertThat(approved.status()).isEqualTo(Status.APPROVED);

            // 3.0 accrued (Jan + Feb at 1.5/month; the duplicate Jan run added nothing) − 1 day
            // taken = 2.0 remaining.
            assertThat(leaveService.balances(empId))
                    .anySatisfy(b -> assertThat(b.balanceDays()).isEqualByComparingTo(new BigDecimal("2.0")));
        } finally {
            tenantContext.clear();
        }
    }
}
