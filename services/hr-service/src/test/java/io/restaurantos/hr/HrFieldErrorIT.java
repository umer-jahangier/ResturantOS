package io.restaurantos.hr;

import io.restaurantos.hr.dto.EmployeeDtos.CreateEmployeeRequest;
import io.restaurantos.hr.dto.EmployeeDtos.EmployeeResponse;
import io.restaurantos.hr.entity.EmployeeEntity.EmploymentType;
import io.restaurantos.hr.service.EmployeeService;
import io.restaurantos.hr.service.LeaveService;
import io.restaurantos.hr.service.PayrollRunService;
import io.restaurantos.hr.service.ShiftService;
import io.restaurantos.shared.exception.DuplicateValueException;
import io.restaurantos.shared.exception.FieldValidationException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.RestaurantOsException;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

/**
 * Every HR refusal a user can cause names its field, or explains why it has none (D-35-03).
 *
 * <h2>What was wrong</h2>
 *
 * <p>These eight situations all produced {@code 500 INTERNAL_ERROR — "An unexpected error
 * occurred"}, because every one of them was an {@code IllegalStateException} or an
 * {@code IllegalArgumentException} and the shared advice has no handler for either. A duplicate
 * employee number, a leave range typed backwards and a genuine server crash were indistinguishable
 * to the client, so no form could bind any of them to an input and no dashboard could tell an
 * ordinary user mistake from a real fault.
 *
 * <h2>What is asserted</h2>
 *
 * <p>The exception type, the code, and the field path — because those three are the contract the
 * wave-4 and wave-5 frontend plans bind to. A test that only asserted "it threw" would let the
 * field path drift silently, which is the one thing that would quietly break every form.
 *
 * <p>Every expected type here extends {@link RestaurantOsException}, which is itself handled by
 * {@code GlobalExceptionHandler#handleBase}. That is the structural proof of the eighth behaviour:
 * none of these can reach {@code handleUnexpected}, because a handler for a supertype already
 * claims them.
 */
class HrFieldErrorIT extends HrTestBase {

    @Autowired EmployeeService employeeService;
    @Autowired ShiftService shiftService;
    @Autowired LeaveService leaveService;
    @Autowired PayrollRunService payrollRunService;
    @Autowired TenantContext tenantContext;

    // ── Behaviour 1: duplicate employee number ─────────────────────────────────

    @Test
    void duplicateEmployeeNumber_is409DuplicateValue_namingEmployeeNo() {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        tenantContext.set(tenant, branch, UUID.randomUUID(), null);
        try {
            employeeService.create(newEmployee("EMP-DUP", "First Person", branch));

            DuplicateValueException thrown = catchThrowableOfType(DuplicateValueException.class,
                    () -> employeeService.create(newEmployee("EMP-DUP", "Second Person", branch)));

            assertThat(thrown).isNotNull();
            assertThat(thrown.getCode()).isEqualTo("DUPLICATE_VALUE");
            assertThat(thrown.getField()).isEqualTo("employeeNo");
            assertThat(thrown.getMessage()).contains("EMP-DUP");
        } finally {
            tenantContext.clear();
        }
    }

    // ── Behaviour 2: leave range runs backwards ────────────────────────────────

    /**
     * Named on {@code endDate}, deliberately. When a range runs backwards the start date is
     * usually the one the user meant, so blaming it would send them to change the correct value.
     */
    @Test
    void leaveEndBeforeStart_is422_namingEndDateAndNotStartDate() {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        tenantContext.set(tenant, branch, UUID.randomUUID(), null);
        try {
            EmployeeResponse employee = employeeService.create(newEmployee("EMP-LR", "Leave Range", branch));
            var type = leaveService.createType(
                    new LeaveService.CreateTypeRequest("Unpaid Range", false, BigDecimal.ZERO));

            FieldValidationException thrown = catchThrowableOfType(FieldValidationException.class,
                    () -> leaveService.request(new LeaveService.RequestLeave(
                            employee.id(), type.id(),
                            LocalDate.of(2027, 3, 10), LocalDate.of(2027, 3, 4), "typo")));

            assertThat(thrown).isNotNull();
            assertThat(thrown.getCode()).isEqualTo("LEAVE_RANGE_INVALID");
            assertThat(thrown.getViolations()).singleElement()
                    .satisfies(v -> assertThat(v.field()).isEqualTo("endDate"));
            assertThat(thrown.getViolations())
                    .extracting(FieldValidationException.Violation::field)
                    .doesNotContain("startDate");
        } finally {
            tenantContext.clear();
        }
    }

    // ── Behaviour 3: leave beyond the remaining balance ────────────────────────

    /** The instruction must carry the numbers; "insufficient balance" alone is unactionable. */
    @Test
    void leaveBeyondBalance_is422_namingLeaveTypeAndStatingTheDaysRemaining() {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        tenantContext.set(tenant, branch, UUID.randomUUID(), null);
        try {
            EmployeeResponse employee = employeeService.create(newEmployee("EMP-BAL", "Balance Person", branch));
            var paidType = leaveService.createType(
                    new LeaveService.CreateTypeRequest("Annual Balance", true, new BigDecimal("1.5")));

            FieldValidationException thrown = catchThrowableOfType(FieldValidationException.class,
                    () -> leaveService.request(new LeaveService.RequestLeave(
                            employee.id(), paidType.id(),
                            LocalDate.of(2027, 4, 1), LocalDate.of(2027, 4, 5), "holiday")));

            assertThat(thrown).isNotNull();
            assertThat(thrown.getCode()).isEqualTo("LEAVE_BALANCE_INSUFFICIENT");
            assertThat(thrown.getViolations()).singleElement()
                    .satisfies(v -> {
                        assertThat(v.field()).isEqualTo("leaveTypeId");
                        // 0 days remain, 5 requested — both numbers must be in the sentence.
                        assertThat(v.instruction()).contains("0").contains("5");
                    });
        } finally {
            tenantContext.clear();
        }
    }

    // ── Behaviour 4: cross-branch shift assignment ─────────────────────────────

    @Test
    void assigningAnEmployeeToAnotherBranchesShift_is422_namingTheShift() {
        UUID tenant = UUID.randomUUID();
        UUID branchWithEmployee = UUID.randomUUID();
        UUID branchWithShift = UUID.randomUUID();

        UUID employeeId;
        tenantContext.set(tenant, branchWithEmployee, UUID.randomUUID(), null);
        try {
            employeeId = employeeService.create(newEmployee("EMP-XB", "Other Branch", branchWithEmployee)).id();
        } finally {
            tenantContext.clear();
        }

        tenantContext.set(tenant, branchWithShift, UUID.randomUUID(), null);
        try {
            var shift = shiftService.create(new ShiftService.CreateShiftRequest(
                    "Evening", "Waiter", LocalTime.of(17, 0), LocalTime.of(23, 0), List.of(1, 2, 3)));

            final UUID finalEmployeeId = employeeId;
            FieldValidationException thrown = catchThrowableOfType(FieldValidationException.class,
                    () -> shiftService.assign(new ShiftService.AssignRequest(
                            shift.id(), finalEmployeeId, LocalDate.of(2027, 5, 4))));

            assertThat(thrown).isNotNull();
            assertThat(thrown.getCode()).isEqualTo("SHIFT_BRANCH_MISMATCH");
            assertThat(thrown.getViolations()).singleElement()
                    .satisfies(v -> assertThat(v.field()).isEqualTo("shiftId"));
        } finally {
            tenantContext.clear();
        }
    }

    // ── Behaviour 5: approving a request that is not PENDING ───────────────────

    /**
     * 409 with NO field path. The fault is the record's state, and there is no input on the form
     * that would change it — inventing a path here would send the user to edit something
     * irrelevant, which the plan forbids explicitly.
     */
    @Test
    void approvingANonPendingRequest_is409StateInvalid_withNoFieldPath() {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        tenantContext.set(tenant, branch, UUID.randomUUID(), null);
        try {
            EmployeeResponse employee = employeeService.create(newEmployee("EMP-AP", "Approve Twice", branch));
            var unpaid = leaveService.createType(
                    new LeaveService.CreateTypeRequest("Unpaid Approve", false, BigDecimal.ZERO));
            var request = leaveService.request(new LeaveService.RequestLeave(
                    employee.id(), unpaid.id(), LocalDate.of(2027, 6, 1), LocalDate.of(2027, 6, 2), null));
            leaveService.approve(request.id());

            StateInvalidException thrown = catchThrowableOfType(StateInvalidException.class,
                    () -> leaveService.approve(request.id()));

            assertThat(thrown).isNotNull();
            assertThat(thrown.getCode()).isEqualTo("LEAVE_NOT_PENDING");
            assertThat(thrown).isNotInstanceOf(FieldValidationException.class);
            assertThat(thrown.getMessage()).contains("approved");
        } finally {
            tenantContext.clear();
        }
    }

    // ── Behaviour 6: payroll state transitions carry distinct codes ────────────

    /**
     * Distinct codes matter here more than anywhere else in HR. The payroll screen has to offer a
     * different next action for each of these, and it cannot if all three answer STATE_INVALID.
     */
    @Test
    void payrollStateRefusals_are409_eachWithItsOwnCode() {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        tenantContext.set(tenant, branch, UUID.randomUUID(), null);
        try {
            var run = payrollRunService.create(9, 2027);

            StateInvalidException approveTooEarly = catchThrowableOfType(StateInvalidException.class,
                    () -> payrollRunService.approve(run.getId(), true));
            StateInvalidException payTooEarly = catchThrowableOfType(StateInvalidException.class,
                    () -> payrollRunService.pay(run.getId()));

            assertThat(approveTooEarly).isNotNull();
            assertThat(approveTooEarly.getCode()).isEqualTo("PAYROLL_RUN_NOT_CALCULATED");
            assertThat(payTooEarly).isNotNull();
            assertThat(payTooEarly.getCode()).isEqualTo("PAYROLL_RUN_NOT_APPROVED");
            assertThat(approveTooEarly.getCode()).isNotEqualTo(payTooEarly.getCode());
            assertThat(approveTooEarly.getCode()).isNotEqualTo("STATE_INVALID");

            // A second run for the same period collides, and the collision names a field.
            DuplicateValueException duplicatePeriod = catchThrowableOfType(DuplicateValueException.class,
                    () -> payrollRunService.create(9, 2027));
            assertThat(duplicatePeriod).isNotNull();
            assertThat(duplicatePeriod.getField()).isEqualTo("periodMonth");
        } finally {
            tenantContext.clear();
        }
    }

    // ── Behaviour 7: absent records answer 404, not 500 ────────────────────────

    @Test
    void lookingUpRecordsThatDoNotExist_isNotFound_notAServerFault() {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        UUID absent = UUID.randomUUID();
        tenantContext.set(tenant, branch, UUID.randomUUID(), null);
        try {
            assertThatThrownBy(() -> employeeService.get(absent))
                    .isInstanceOf(ResourceNotFoundException.class);
            assertThatThrownBy(() -> shiftService.delete(absent))
                    .isInstanceOf(ResourceNotFoundException.class);
            assertThatThrownBy(() -> shiftService.unassign(absent))
                    .isInstanceOf(ResourceNotFoundException.class);
            assertThatThrownBy(() -> leaveService.approve(absent))
                    .isInstanceOf(ResourceNotFoundException.class);
            assertThatThrownBy(() -> payrollRunService.get(absent))
                    .isInstanceOf(ResourceNotFoundException.class);
        } finally {
            tenantContext.clear();
        }
    }

    // ── Behaviour 8: none of the above can reach the catch-all ─────────────────

    /**
     * Structural, not incidental. {@code GlobalExceptionHandler} declares a handler for
     * {@link RestaurantOsException}; Spring resolves by exception-type depth, so anything
     * extending it is claimed before {@code handleUnexpected(Exception)} is considered. Asserting
     * the family membership therefore proves the routing for every subtype at once — including
     * ones added after this test was written.
     */
    @Test
    void everyForeseeableHrRefusalIsInTheHandledFamily() {
        assertThat(RestaurantOsException.class)
                .isAssignableFrom(FieldValidationException.class)
                .isAssignableFrom(DuplicateValueException.class)
                .isAssignableFrom(StateInvalidException.class)
                .isAssignableFrom(ResourceNotFoundException.class);
    }

    private static CreateEmployeeRequest newEmployee(String employeeNo, String name, UUID branch) {
        return new CreateEmployeeRequest(
                employeeNo, name, null, null, null, null, null,
                EmploymentType.PERMANENT, LocalDate.of(2026, 1, 1), 5_000_000L, null);
    }
}
