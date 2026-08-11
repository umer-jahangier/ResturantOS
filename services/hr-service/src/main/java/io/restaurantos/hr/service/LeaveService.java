package io.restaurantos.hr.service;

import io.restaurantos.hr.entity.EmployeeEntity;
import io.restaurantos.hr.entity.LeaveAccrualLogEntity;
import io.restaurantos.hr.authz.HrAuthorizationService;
import io.restaurantos.hr.entity.LeaveBalanceEntity;
import io.restaurantos.hr.entity.LeaveRequestEntity;
import io.restaurantos.hr.entity.LeaveRequestEntity.Status;
import io.restaurantos.hr.entity.LeaveTypeEntity;
import io.restaurantos.hr.repository.EmployeeRepository;
import io.restaurantos.hr.repository.LeaveAccrualLogRepository;
import io.restaurantos.hr.repository.LeaveBalanceRepository;
import io.restaurantos.hr.repository.LeaveRequestRepository;
import io.restaurantos.hr.repository.LeaveTypeRepository;
import io.restaurantos.shared.exception.FieldValidationException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

/**
 * Leave types + monthly accrual + a request/approve/reject workflow with per-year balances.
 * Approving a paid leave decrements the balance. Accrual increments balances by the type's
 * monthly rate.
 */
@Service
public class LeaveService {

    private final LeaveTypeRepository typeRepository;
    private final LeaveRequestRepository requestRepository;
    private final LeaveBalanceRepository balanceRepository;
    private final EmployeeRepository employeeRepository;
    private final LeaveAccrualLogRepository accrualLogRepository;
    private final TenantContext tenantContext;
    private final HrAuthorizationService authorization;

    @PersistenceContext
    private EntityManager entityManager;

    public LeaveService(LeaveTypeRepository typeRepository, LeaveRequestRepository requestRepository,
                        LeaveBalanceRepository balanceRepository, EmployeeRepository employeeRepository,
                        LeaveAccrualLogRepository accrualLogRepository,
                        TenantContext tenantContext, HrAuthorizationService authorization) {
        this.typeRepository = typeRepository;
        this.requestRepository = requestRepository;
        this.balanceRepository = balanceRepository;
        this.employeeRepository = employeeRepository;
        this.accrualLogRepository = accrualLogRepository;
        this.tenantContext = tenantContext;
        this.authorization = authorization;
    }

    public record CreateTypeRequest(
            @NotBlank(message = "Enter a name for this leave type") String name,
            boolean paid,
            @PositiveOrZero(message = "Accrual cannot be negative — use 0 for a type that does not accrue")
            BigDecimal accrualDaysPerMonth) {
    }

    public record TypeResponse(UUID id, String name, boolean paid, BigDecimal accrualDaysPerMonth) {
    }

    /**
     * Every missing field is reported in ONE response, which is what bean validation does by
     * default. The service must not short-circuit it by re-checking one field and throwing before
     * the rest are collected.
     *
     * <p>The date-ORDER rule is not here: it is cross-field, so it lives in {@link #request} as a
     * FieldValidationException bound to {@code endDate}.
     */
    public record RequestLeave(
            @NotNull(message = "Choose an employee") UUID employeeId,
            @NotNull(message = "Choose a leave type") UUID leaveTypeId,
            @NotNull(message = "Choose a start date") LocalDate startDate,
            @NotNull(message = "Choose an end date") LocalDate endDate,
            String reason) {
    }

    public record LeaveRequestResponse(UUID id, UUID employeeId, UUID leaveTypeId, LocalDate startDate,
                                       LocalDate endDate, Status status, UUID approvedBy, String reason) {
    }

    public record BalanceResponse(UUID leaveTypeId, int periodYear, BigDecimal balanceDays) {
    }

    /** Idempotently seed the default leave types for a tenant that has none. */
    @Transactional
    public void ensureDefaultTypes() {
        UUID tenantId = requireTenant();
        if (typeRepository.existsByTenantId(tenantId)) {
            return;
        }
        createTypeRow(tenantId, "Annual", true, new BigDecimal("1.5"));
        createTypeRow(tenantId, "Sick", true, new BigDecimal("1.0"));
        createTypeRow(tenantId, "Unpaid", false, BigDecimal.ZERO);
    }

    @Transactional
    public TypeResponse createType(CreateTypeRequest req) {
        LeaveTypeEntity t = createTypeRow(requireTenant(), req.name(), req.paid(),
                req.accrualDaysPerMonth() == null ? BigDecimal.ZERO : req.accrualDaysPerMonth());
        return toType(t);
    }

    @Transactional(readOnly = true)
    public List<TypeResponse> listTypes() {
        return typeRepository.findAllByTenantId(requireTenant()).stream().map(LeaveService::toType).toList();
    }

    @Transactional
    public LeaveRequestResponse request(RequestLeave req) {
        UUID tenantId = requireTenant();
        LeaveTypeEntity type = typeRepository.findByIdAndTenantId(req.leaveTypeId(), tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Leave type", req.leaveTypeId()));
        long days = ChronoUnit.DAYS.between(req.startDate(), req.endDate()) + 1;
        if (days <= 0) {
            // Bound to endDate, not startDate. When a range runs backwards the start date is
            // usually the one the user meant; sending them to edit it would have them change the
            // value that was already right.
            throw new FieldValidationException("LEAVE_RANGE_INVALID", "endDate",
                    "The end date must be on or after " + req.startDate() + ".");
        }
        if (type.isPaid()) {
            LeaveBalanceEntity balance = getOrCreateBalance(tenantId, req.employeeId(), type.getId(), req.startDate().getYear());
            if (balance.getBalanceDays().compareTo(BigDecimal.valueOf(days)) < 0) {
                // The number is the whole point. "Insufficient leave balance" tells the user
                // nothing they can act on; the balance and the request together tell them exactly
                // how much shorter the request has to be.
                throw new FieldValidationException("LEAVE_BALANCE_INSUFFICIENT", "leaveTypeId",
                        "Only " + balance.getBalanceDays().stripTrailingZeros().toPlainString()
                                + " days of " + type.getName() + " leave remain, and this request is "
                                + days + " days. Shorten the request or choose an unpaid leave type.");
            }
        }
        LeaveRequestEntity r = new LeaveRequestEntity();
        r.setTenantId(tenantId);
        r.setEmployeeId(req.employeeId());
        r.setLeaveTypeId(type.getId());
        r.setStartDate(req.startDate());
        r.setEndDate(req.endDate());
        r.setStatus(Status.PENDING);
        r.setReason(req.reason());
        return toRequest(requestRepository.save(r));
    }

    @Transactional
    public LeaveRequestResponse approve(UUID requestId) {
        UUID tenantId = requireTenant();
        LeaveRequestEntity r = loadRequest(requestId, tenantId);
        authorization.authorizeLeaveApprove(r.getId(), tenantId, branchOfEmployee(tenantId, r.getEmployeeId()));
        if (r.getStatus() != Status.PENDING) {
            // No field path: the fault is the record's state, not any input the user typed, so
            // there is nothing on the form to bind it to.
            throw new StateInvalidException("LEAVE_NOT_PENDING",
                    "This request is already " + r.getStatus().name().toLowerCase()
                            + " and can no longer be approved.");
        }
        LeaveTypeEntity type = typeRepository.findByIdAndTenantId(r.getLeaveTypeId(), tenantId).orElseThrow();
        long days = ChronoUnit.DAYS.between(r.getStartDate(), r.getEndDate()) + 1;
        if (type.isPaid()) {
            LeaveBalanceEntity balance = getOrCreateBalance(tenantId, r.getEmployeeId(), type.getId(), r.getStartDate().getYear());
            balance.setBalanceDays(balance.getBalanceDays().subtract(BigDecimal.valueOf(days)));
            balanceRepository.save(balance);
        }
        r.setStatus(Status.APPROVED);
        r.setApprovedBy(tenantContext.getUserId().orElse(null));
        return toRequest(requestRepository.save(r));
    }

    @Transactional
    public LeaveRequestResponse reject(UUID requestId) {
        UUID tenantId = requireTenant();
        LeaveRequestEntity r = loadRequest(requestId, tenantId);
        authorization.authorizeLeaveApprove(r.getId(), tenantId, branchOfEmployee(tenantId, r.getEmployeeId()));
        if (r.getStatus() != Status.PENDING) {
            throw new StateInvalidException("LEAVE_NOT_PENDING",
                    "This request is already " + r.getStatus().name().toLowerCase()
                            + " and can no longer be rejected.");
        }
        r.setStatus(Status.REJECTED);
        r.setApprovedBy(tenantContext.getUserId().orElse(null));
        return toRequest(requestRepository.save(r));
    }

    @Transactional(readOnly = true)
    public List<LeaveRequestResponse> listRequests(UUID employeeId) {
        UUID tenantId = requireTenant();
        authorization.authorizeLeaveView(tenantId, employeeId != null
                ? branchOfEmployee(tenantId, employeeId)
                : requireBranch());
        List<LeaveRequestEntity> rows = employeeId != null
                ? requestRepository.findAllByEmployeeId(employeeId)
                : requestRepository.findAllByTenantId(tenantId);
        return rows.stream().map(LeaveService::toRequest).toList();
    }

    @Transactional(readOnly = true)
    public List<BalanceResponse> balances(UUID employeeId) {
        UUID tenantId = requireTenant();
        authorization.authorizeLeaveView(tenantId, branchOfEmployee(tenantId, employeeId));
        return balanceRepository.findAllByEmployeeId(employeeId).stream()
                .map(b -> new BalanceResponse(b.getLeaveTypeId(), b.getPeriodYear(), b.getBalanceDays())).toList();
    }

    /**
     * Accrue one month's leave for every active employee, exactly once per period.
     *
     * <p>Idempotent and replica-safe. Each (employee, leave type, year, month) writes a marker row
     * into {@code leave_accrual_log} in the SAME transaction as the balance increment, and that
     * table's unique constraint is the distributed lock — a second replica racing on the same
     * period loses the insert and skips the increment.
     *
     * <p>This replaces a version that took only a year and did a bare
     * {@code balance += accrualDaysPerMonth}, whose javadoc claimed "the cron IS the idempotency".
     * It was not: {@code @Scheduled} fires on every replica, so N replicas granted N x the leave,
     * and any manual re-trigger or retry double-accrued with no way to detect it after the fact.
     *
     * @return the number of (employee, leave type) pairs actually accrued — 0 means this period was
     *         already done, which is a normal outcome and not an error.
     */
    // Load-bearing: the marker insert and the balance increment MUST commit together, or a crash
    // between them either grants days that can never be re-granted or blocks a period that never
    // accrued. The method previously carried no transaction at all.
    @Transactional
    public int accrue(int year, int month) {
        if (month < 1 || month > 12) {
            throw new FieldValidationException("ACCRUAL_MONTH_INVALID", "month",
                    "Month must be between 1 and 12.");
        }
        UUID tenantId = requireTenant();
        List<LeaveTypeEntity> paidTypes = typeRepository.findAllByTenantId(tenantId).stream()
                .filter(t -> t.isPaid() && t.getAccrualDaysPerMonth().signum() > 0).toList();
        List<EmployeeEntity> employees = employeeRepository.findAll().stream()
                .filter(EmployeeEntity::isActive).toList();
        int accrued = 0;
        for (LeaveTypeEntity type : paidTypes) {
            for (EmployeeEntity emp : employees) {
                if (accrualLogRepository
                        .existsByTenantIdAndEmployeeIdAndLeaveTypeIdAndPeriodYearAndPeriodMonth(
                                tenantId, emp.getId(), type.getId(), year, month)) {
                    continue;
                }
                LeaveAccrualLogEntity marker = new LeaveAccrualLogEntity();
                marker.setTenantId(tenantId);
                marker.setEmployeeId(emp.getId());
                marker.setLeaveTypeId(type.getId());
                marker.setPeriodYear(year);
                marker.setPeriodMonth(month);
                marker.setAccruedDays(type.getAccrualDaysPerMonth());
                // Flush now so a concurrent replica's duplicate insert fails HERE, before we touch
                // the balance — the exists() check above only narrows the race, it cannot close it.
                accrualLogRepository.saveAndFlush(marker);

                LeaveBalanceEntity balance = getOrCreateBalance(tenantId, emp.getId(), type.getId(), year);
                balance.setBalanceDays(balance.getBalanceDays().add(type.getAccrualDaysPerMonth()));
                balanceRepository.save(balance);
                accrued++;
            }
        }
        return accrued;
    }

    /** Distinct tenant_ids with employees, via the SECURITY DEFINER function — for the scheduler,
     *  which has no tenant context and would otherwise see nothing under FORCE RLS. */
    @Transactional(readOnly = true)
    public List<UUID> listTenantIdsForAccrual() {
        List<?> rows = entityManager.createNativeQuery("SELECT tenant_id FROM hr_tenant_ids()").getResultList();
        return rows.stream().map(o -> UUID.fromString(o.toString())).toList();
    }

    private LeaveBalanceEntity getOrCreateBalance(UUID tenantId, UUID employeeId, UUID leaveTypeId, int year) {
        return balanceRepository
                .findByTenantIdAndEmployeeIdAndLeaveTypeIdAndPeriodYear(tenantId, employeeId, leaveTypeId, year)
                .orElseGet(() -> {
                    LeaveBalanceEntity b = new LeaveBalanceEntity();
                    b.setTenantId(tenantId);
                    b.setEmployeeId(employeeId);
                    b.setLeaveTypeId(leaveTypeId);
                    b.setPeriodYear(year);
                    b.setBalanceDays(BigDecimal.ZERO);
                    return balanceRepository.save(b);
                });
    }

    private LeaveTypeEntity createTypeRow(UUID tenantId, String name, boolean paid, BigDecimal accrual) {
        LeaveTypeEntity t = new LeaveTypeEntity();
        t.setTenantId(tenantId);
        t.setName(name);
        t.setPaid(paid);
        t.setAccrualDaysPerMonth(accrual);
        return typeRepository.save(t);
    }

    private LeaveRequestEntity loadRequest(UUID id, UUID tenantId) {
        return requestRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Leave request", id));
    }

    /**
     * A leave request carries no branch of its own — it inherits the employee's. Resolving it here
     * is what lets hr.rego apply same_tenant_and_branch to leave at all.
     */
    private UUID branchOfEmployee(UUID tenantId, UUID employeeId) {
        return employeeRepository.findByIdAndTenantId(employeeId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Employee", employeeId))
                .getBranchId();
    }

    // Raw IllegalStateException deliberately: no tenant/branch in context is a filter-chain
    // invariant breach, not caller input. See the note in EmployeeService.
    private UUID requireBranch() {
        return tenantContext.getBranchId()
                .orElseThrow(() -> new IllegalStateException("No branch context"));
    }

    private UUID requireTenant() {
        return tenantContext.getTenantId().orElseThrow(() -> new IllegalStateException("No tenant context"));
    }

    private static TypeResponse toType(LeaveTypeEntity t) {
        return new TypeResponse(t.getId(), t.getName(), t.isPaid(), t.getAccrualDaysPerMonth());
    }

    private static LeaveRequestResponse toRequest(LeaveRequestEntity r) {
        return new LeaveRequestResponse(r.getId(), r.getEmployeeId(), r.getLeaveTypeId(), r.getStartDate(),
                r.getEndDate(), r.getStatus(), r.getApprovedBy(), r.getReason());
    }
}
