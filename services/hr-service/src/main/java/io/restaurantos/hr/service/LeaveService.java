package io.restaurantos.hr.service;

import io.restaurantos.hr.entity.EmployeeEntity;
import io.restaurantos.hr.entity.LeaveBalanceEntity;
import io.restaurantos.hr.entity.LeaveRequestEntity;
import io.restaurantos.hr.entity.LeaveRequestEntity.Status;
import io.restaurantos.hr.entity.LeaveTypeEntity;
import io.restaurantos.hr.repository.EmployeeRepository;
import io.restaurantos.hr.repository.LeaveBalanceRepository;
import io.restaurantos.hr.repository.LeaveRequestRepository;
import io.restaurantos.hr.repository.LeaveTypeRepository;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
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
    private final TenantContext tenantContext;

    @PersistenceContext
    private EntityManager entityManager;

    public LeaveService(LeaveTypeRepository typeRepository, LeaveRequestRepository requestRepository,
                        LeaveBalanceRepository balanceRepository, EmployeeRepository employeeRepository,
                        TenantContext tenantContext) {
        this.typeRepository = typeRepository;
        this.requestRepository = requestRepository;
        this.balanceRepository = balanceRepository;
        this.employeeRepository = employeeRepository;
        this.tenantContext = tenantContext;
    }

    public record CreateTypeRequest(String name, boolean paid, BigDecimal accrualDaysPerMonth) {
    }

    public record TypeResponse(UUID id, String name, boolean paid, BigDecimal accrualDaysPerMonth) {
    }

    public record RequestLeave(UUID employeeId, UUID leaveTypeId, LocalDate startDate, LocalDate endDate, String reason) {
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
                .orElseThrow(() -> new IllegalArgumentException("Leave type not found: " + req.leaveTypeId()));
        long days = ChronoUnit.DAYS.between(req.startDate(), req.endDate()) + 1;
        if (days <= 0) {
            throw new IllegalArgumentException("endDate must be on or after startDate");
        }
        if (type.isPaid()) {
            LeaveBalanceEntity balance = getOrCreateBalance(tenantId, req.employeeId(), type.getId(), req.startDate().getYear());
            if (balance.getBalanceDays().compareTo(BigDecimal.valueOf(days)) < 0) {
                throw new IllegalStateException("Insufficient leave balance for " + type.getName());
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
        if (r.getStatus() != Status.PENDING) {
            throw new IllegalStateException("Only a PENDING request can be approved; is " + r.getStatus());
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
        LeaveRequestEntity r = loadRequest(requestId, requireTenant());
        if (r.getStatus() != Status.PENDING) {
            throw new IllegalStateException("Only a PENDING request can be rejected; is " + r.getStatus());
        }
        r.setStatus(Status.REJECTED);
        r.setApprovedBy(tenantContext.getUserId().orElse(null));
        return toRequest(requestRepository.save(r));
    }

    @Transactional(readOnly = true)
    public List<LeaveRequestResponse> listRequests(UUID employeeId) {
        UUID tenantId = requireTenant();
        List<LeaveRequestEntity> rows = employeeId != null
                ? requestRepository.findAllByEmployeeId(employeeId)
                : requestRepository.findAllByTenantId(tenantId);
        return rows.stream().map(LeaveService::toRequest).toList();
    }

    @Transactional(readOnly = true)
    public List<BalanceResponse> balances(UUID employeeId) {
        return balanceRepository.findAllByEmployeeId(employeeId).stream()
                .map(b -> new BalanceResponse(b.getLeaveTypeId(), b.getPeriodYear(), b.getBalanceDays())).toList();
    }

    /**
     * Accrue one month's worth of each paid leave type onto every active employee's balance for the
     * given year. Called for the current tenant. NOTE: the cross-tenant @Scheduled trigger below is
     * a deploy concern (needs per-tenant iteration under RLS, like the outbox relay) — deferred.
     */
    @Transactional
    public void accrue(int year) {
        UUID tenantId = requireTenant();
        List<LeaveTypeEntity> paidTypes = typeRepository.findAllByTenantId(tenantId).stream()
                .filter(t -> t.isPaid() && t.getAccrualDaysPerMonth().signum() > 0).toList();
        List<EmployeeEntity> employees = employeeRepository.findAll().stream()
                .filter(EmployeeEntity::isActive).toList();
        for (LeaveTypeEntity type : paidTypes) {
            for (EmployeeEntity emp : employees) {
                LeaveBalanceEntity balance = getOrCreateBalance(tenantId, emp.getId(), type.getId(), year);
                balance.setBalanceDays(balance.getBalanceDays().add(type.getAccrualDaysPerMonth()));
                balanceRepository.save(balance);
            }
        }
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
                .orElseThrow(() -> new IllegalArgumentException("Leave request not found: " + id));
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
