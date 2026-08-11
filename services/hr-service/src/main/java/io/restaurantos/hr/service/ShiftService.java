package io.restaurantos.hr.service;

import io.restaurantos.hr.entity.EmployeeEntity;
import io.restaurantos.hr.entity.ShiftAssignmentEntity;
import io.restaurantos.hr.entity.ShiftEntity;
import io.restaurantos.hr.repository.EmployeeRepository;
import io.restaurantos.hr.repository.ShiftAssignmentRepository;
import io.restaurantos.hr.repository.ShiftRepository;
import io.restaurantos.shared.exception.DuplicateValueException;
import io.restaurantos.shared.exception.FieldValidationException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

/** Shift templates + date assignments per branch, plus the week-grid the drag-drop calendar consumes. */
@Service
public class ShiftService {

    private final ShiftRepository shiftRepository;
    private final ShiftAssignmentRepository assignmentRepository;
    private final EmployeeRepository employeeRepository;
    private final TenantContext tenantContext;

    public ShiftService(ShiftRepository shiftRepository, ShiftAssignmentRepository assignmentRepository,
                        EmployeeRepository employeeRepository, TenantContext tenantContext) {
        this.shiftRepository = shiftRepository;
        this.assignmentRepository = assignmentRepository;
        this.employeeRepository = employeeRepository;
        this.tenantContext = tenantContext;
    }

    /**
     * The constraints the service already assumed, now declared where the client can read them.
     *
     * <p>{@code endTime} vs {@code startTime}: the only rule enforced is that they must DIFFER.
     * An end BEFORE a start is a legitimate overnight shift — 22:00 to 06:00 is the most ordinary
     * shift a restaurant runs — so rejecting it would remove working behaviour. Equal times are a
     * zero-length shift, which is always a mistake. That cross-field rule cannot be stated
     * declaratively on a record, so it lives in {@link #validateTimes} and is applied by both
     * create and update, expressed once so the two cannot disagree.
     */
    public record CreateShiftRequest(
            @NotBlank(message = "Enter a name for this shift") String name,
            String roleDesignation,
            @NotNull(message = "Choose a start time") LocalTime startTime,
            @NotNull(message = "Choose an end time") LocalTime endTime,
            @NotEmpty(message = "Choose at least one day this shift runs")
            @Size(max = 7, message = "A week has seven days")
            List<@NotNull @Min(value = 1, message = "Days run from 1 (Monday) to 7 (Sunday)")
                 @Max(value = 7, message = "Days run from 1 (Monday) to 7 (Sunday)") Integer> daysOfWeek) {
    }

    public record ShiftResponse(UUID id, UUID branchId, String name, String roleDesignation,
                                LocalTime startTime, LocalTime endTime, List<Integer> daysOfWeek) {
    }

    public record AssignRequest(
            @NotNull(message = "Choose a shift") UUID shiftId,
            @NotNull(message = "Choose an employee") UUID employeeId,
            @NotNull(message = "Choose a date") LocalDate workDate) {
    }

    public record AssignmentResponse(UUID id, UUID shiftId, UUID employeeId, LocalDate workDate) {
    }

    public record WeekGrid(List<ShiftResponse> shifts, List<AssignmentResponse> assignments) {
    }

    /**
     * A shift that starts and ends at the same moment is zero minutes long and is always a typo.
     *
     * <p>Bound to {@code endTime}: the start time is the one the user set first and meant. Note
     * what is deliberately ALLOWED — an end earlier than the start, which is an overnight shift
     * crossing midnight. Forbidding that would have made it impossible to schedule a closing shift.
     */
    private static void validateTimes(CreateShiftRequest req) {
        if (req.startTime() != null && req.startTime().equals(req.endTime())) {
            throw new FieldValidationException("SHIFT_TIMES_INVALID", "endTime",
                    "A shift cannot start and end at the same time."
                            + " For a shift that runs past midnight, set an end time before the start time.");
        }
    }

    @Transactional
    public ShiftResponse create(CreateShiftRequest req) {
        validateTimes(req);
        ShiftEntity shift = new ShiftEntity();
        shift.setTenantId(requireTenant());
        shift.setBranchId(requireBranch());
        shift.setName(req.name());
        shift.setRoleDesignation(req.roleDesignation());
        shift.setStartTime(req.startTime());
        shift.setEndTime(req.endTime());
        shift.setDaysOfWeek(req.daysOfWeek() == null ? new Integer[0] : req.daysOfWeek().toArray(new Integer[0]));
        return toShiftResponse(shiftRepository.save(shift));
    }

    @Transactional
    public ShiftResponse update(UUID id, CreateShiftRequest req) {
        validateTimes(req);
        ShiftEntity shift = loadShift(id);
        shift.setName(req.name());
        shift.setRoleDesignation(req.roleDesignation());
        shift.setStartTime(req.startTime());
        shift.setEndTime(req.endTime());
        shift.setDaysOfWeek(req.daysOfWeek() == null ? new Integer[0] : req.daysOfWeek().toArray(new Integer[0]));
        return toShiftResponse(shiftRepository.save(shift));
    }

    @Transactional
    public void delete(UUID id) {
        shiftRepository.delete(loadShift(id));
    }

    @Transactional
    public AssignmentResponse assign(AssignRequest req) {
        UUID tenantId = requireTenant();
        ShiftEntity shift = loadShift(req.shiftId());
        EmployeeEntity employee = employeeRepository.findByIdAndTenantId(req.employeeId(), tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Employee", req.employeeId()));
        if (!employee.getBranchId().equals(shift.getBranchId())) {
            // Bound to the shift, not the employee. The scheduling screen is a branch's own roster
            // and the employee is the thing the user just picked deliberately; the shift is the
            // value that can be wrong without the user noticing which branch it belongs to.
            throw new FieldValidationException("SHIFT_BRANCH_MISMATCH", "shiftId",
                    employee.getFullName() + " works at a different branch from this shift."
                            + " Pick a shift at their own branch, or move the employee first.");
        }
        if (assignmentRepository.existsByTenantIdAndShiftIdAndEmployeeIdAndWorkDate(
                tenantId, req.shiftId(), req.employeeId(), req.workDate())) {
            throw new DuplicateValueException("employeeId",
                    employee.getFullName() + " is already on this shift on " + req.workDate()
                            + ". Choose another employee, or another date.");
        }
        ShiftAssignmentEntity a = new ShiftAssignmentEntity();
        a.setTenantId(tenantId);
        a.setShiftId(req.shiftId());
        a.setEmployeeId(req.employeeId());
        a.setWorkDate(req.workDate());
        return toAssignmentResponse(assignmentRepository.save(a));
    }

    @Transactional
    public void unassign(UUID assignmentId) {
        ShiftAssignmentEntity a = assignmentRepository.findByIdAndTenantId(assignmentId, requireTenant())
                .orElseThrow(() -> new ResourceNotFoundException("Shift assignment", assignmentId));
        assignmentRepository.delete(a);
    }

    /** Drag-drop move = unassign the old cell + assign the new shift/date for the same employee. */
    @Transactional
    public AssignmentResponse move(UUID assignmentId, UUID newShiftId, LocalDate newWorkDate) {
        ShiftAssignmentEntity a = assignmentRepository.findByIdAndTenantId(assignmentId, requireTenant())
                .orElseThrow(() -> new ResourceNotFoundException("Shift assignment", assignmentId));
        UUID employeeId = a.getEmployeeId();
        assignmentRepository.delete(a);
        return assign(new AssignRequest(newShiftId, employeeId, newWorkDate));
    }

    @Transactional(readOnly = true)
    public WeekGrid weekGrid(LocalDate weekStart) {
        LocalDate weekEnd = weekStart.plusDays(6);
        List<ShiftResponse> shifts = shiftRepository.findAllByBranchId(requireBranch()).stream()
                .map(ShiftService::toShiftResponse).toList();
        List<AssignmentResponse> assignments = assignmentRepository.findAllByWorkDateBetween(weekStart, weekEnd).stream()
                .map(ShiftService::toAssignmentResponse).toList();
        return new WeekGrid(shifts, assignments);
    }

    private ShiftEntity loadShift(UUID id) {
        return shiftRepository.findByIdAndTenantId(id, requireTenant())
                .orElseThrow(() -> new ResourceNotFoundException("Shift", id));
    }

    // Raw IllegalStateException deliberately: no tenant/branch in context is a filter-chain
    // invariant breach, not caller input. See the note in EmployeeService.
    private UUID requireTenant() {
        return tenantContext.getTenantId().orElseThrow(() -> new IllegalStateException("No tenant context"));
    }

    private UUID requireBranch() {
        return tenantContext.getBranchId().orElseThrow(() -> new IllegalStateException("No branch context"));
    }

    private static ShiftResponse toShiftResponse(ShiftEntity s) {
        return new ShiftResponse(s.getId(), s.getBranchId(), s.getName(), s.getRoleDesignation(),
                s.getStartTime(), s.getEndTime(), List.of(s.getDaysOfWeek()));
    }

    private static AssignmentResponse toAssignmentResponse(ShiftAssignmentEntity a) {
        return new AssignmentResponse(a.getId(), a.getShiftId(), a.getEmployeeId(), a.getWorkDate());
    }
}
