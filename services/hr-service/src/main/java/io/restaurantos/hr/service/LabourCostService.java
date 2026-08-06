package io.restaurantos.hr.service;

import io.restaurantos.hr.entity.EmployeeEntity;
import io.restaurantos.hr.entity.ShiftAssignmentEntity;
import io.restaurantos.hr.feign.PosRevenueClient;
import io.restaurantos.hr.repository.EmployeeRepository;
import io.restaurantos.hr.repository.ShiftAssignmentRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.YearMonth;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * HR-06 labour cost as a % of revenue, by branch and by shift. Labour cost is the internal figure
 * (sum of active employees' pay); revenue is pulled ONLY via {@link PosRevenueClient}, never from
 * the caller. If revenue is unavailable the percentage is reported null (not fabricated).
 */
@Service
public class LabourCostService {

    private final EmployeeRepository employeeRepository;
    private final ShiftAssignmentRepository assignmentRepository;
    private final PosRevenueClient posRevenueClient;
    private final TenantContext tenantContext;

    public LabourCostService(EmployeeRepository employeeRepository, ShiftAssignmentRepository assignmentRepository,
                             PosRevenueClient posRevenueClient, TenantContext tenantContext) {
        this.employeeRepository = employeeRepository;
        this.assignmentRepository = assignmentRepository;
        this.posRevenueClient = posRevenueClient;
        this.tenantContext = tenantContext;
    }

    public record LabourCostByBranch(UUID branchId, int periodMonth, int periodYear, long labourCostPaisa,
                                     Long revenuePaisa, Double labourCostPct) {
    }

    public record LabourCostByShift(UUID shiftId, int periodMonth, int periodYear, long labourCostPaisa) {
    }

    @Transactional(readOnly = true)
    public LabourCostByBranch labourCostByBranch(UUID branchId, int month, int year) {
        long labourCost = employeeRepository.findAllByBranchId(branchId).stream()
                .filter(EmployeeEntity::isActive)
                .mapToLong(EmployeeEntity::getBasicSalaryPaisa).sum();
        YearMonth ym = YearMonth.of(year, month);
        Optional<Long> revenue = posRevenueClient.revenueForBranch(branchId, ym.atDay(1), ym.atEndOfMonth());
        Double pct = revenue.filter(r -> r > 0).map(r -> labourCost * 100.0 / r).orElse(null);
        return new LabourCostByBranch(branchId, month, year, labourCost, revenue.orElse(null), pct);
    }

    @Transactional(readOnly = true)
    public LabourCostByShift labourCostByShift(UUID shiftId, int month, int year) {
        UUID tenantId = tenantContext.getTenantId().orElseThrow(() -> new IllegalStateException("No tenant context"));
        YearMonth ym = YearMonth.of(year, month);
        LocalDate from = ym.atDay(1);
        LocalDate to = ym.atEndOfMonth();
        Set<UUID> employeeIds = assignmentRepository.findAllByWorkDateBetween(from, to).stream()
                .filter(a -> a.getShiftId().equals(shiftId))
                .map(ShiftAssignmentEntity::getEmployeeId)
                .collect(Collectors.toSet());
        long labourCost = employeeIds.stream()
                .map(id -> employeeRepository.findByIdAndTenantId(id, tenantId).orElse(null))
                .filter(e -> e != null && e.isActive())
                .mapToLong(EmployeeEntity::getBasicSalaryPaisa).sum();
        return new LabourCostByShift(shiftId, month, year, labourCost);
    }
}
