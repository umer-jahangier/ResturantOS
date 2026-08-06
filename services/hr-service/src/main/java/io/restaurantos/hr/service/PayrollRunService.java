package io.restaurantos.hr.service;

import io.restaurantos.hr.entity.EmployeeEntity;
import io.restaurantos.hr.entity.PayrollRunEntity;
import io.restaurantos.hr.entity.PayrollRunEntity.Status;
import io.restaurantos.hr.entity.PayslipEntity;
import io.restaurantos.hr.exception.TotpRequiredException;
import io.restaurantos.hr.payroll.tax.EobiCalculator;
import io.restaurantos.hr.payroll.tax.SlabTaxCalculator;
import io.restaurantos.hr.payroll.tax.TaxConfigService;
import io.restaurantos.hr.payroll.tax.TaxConfigService.ActiveTaxConfig;
import io.restaurantos.hr.repository.EmployeeRepository;
import io.restaurantos.hr.repository.PayrollRunRepository;
import io.restaurantos.hr.repository.PayslipRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Payroll run lifecycle (HR-02/03 producer side). Computes payslips from the config-driven tax +
 * EOBI (11-05) and publishes PAYROLL_RUN_APPROVED / PAYROLL_RUN_PAID for finance to auto-post
 * (11-08). HR NEVER writes the ledger — it only emits events.
 */
@Service
public class PayrollRunService {

    private static final String HR_EXCHANGE = "hr.topic";

    private final PayrollRunRepository runRepository;
    private final PayslipRepository payslipRepository;
    private final EmployeeRepository employeeRepository;
    private final TaxConfigService taxConfigService;
    private final SlabTaxCalculator slabTaxCalculator;
    private final EobiCalculator eobiCalculator;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;
    private final LateArrivalDeductionService lateArrivalDeductionService;

    public PayrollRunService(PayrollRunRepository runRepository, PayslipRepository payslipRepository,
                             EmployeeRepository employeeRepository, TaxConfigService taxConfigService,
                             SlabTaxCalculator slabTaxCalculator, EobiCalculator eobiCalculator,
                             EventPublisher eventPublisher, TenantContext tenantContext,
                             LateArrivalDeductionService lateArrivalDeductionService) {
        this.runRepository = runRepository;
        this.payslipRepository = payslipRepository;
        this.employeeRepository = employeeRepository;
        this.taxConfigService = taxConfigService;
        this.slabTaxCalculator = slabTaxCalculator;
        this.eobiCalculator = eobiCalculator;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
        this.lateArrivalDeductionService = lateArrivalDeductionService;
    }

    @Transactional
    public PayrollRunEntity create(int periodMonth, int periodYear) {
        UUID tenantId = requireTenant();
        runRepository.findByTenantIdAndPeriodMonthAndPeriodYear(tenantId, periodMonth, periodYear)
                .ifPresent(r -> {
                    throw new IllegalStateException(
                            "A payroll run already exists for " + periodMonth + "/" + periodYear);
                });
        PayrollRunEntity run = new PayrollRunEntity();
        run.setTenantId(tenantId);
        run.setBranchId(tenantContext.getBranchId().orElse(null));
        run.setPeriodMonth(periodMonth);
        run.setPeriodYear(periodYear);
        run.setStatus(Status.DRAFT);
        run.setRunBy(tenantContext.getUserId()
                .orElseThrow(() -> new IllegalStateException("No user context to attribute the run to")));
        run.setCreatedAt(Instant.now());
        return runRepository.save(run);
    }

    /** Generate a payslip per active employee; idempotent (replaces this run's payslips in one tx). */
    @Transactional
    public PayrollRunEntity calculate(UUID runId) {
        PayrollRunEntity run = load(runId);
        if (run.getStatus() != Status.DRAFT && run.getStatus() != Status.CALCULATED) {
            throw new IllegalStateException("Only a DRAFT/CALCULATED run can be calculated; is " + run.getStatus());
        }
        int fiscalYear = run.getPeriodMonth() >= 7 ? run.getPeriodYear() + 1 : run.getPeriodYear();
        ActiveTaxConfig cfg = taxConfigService.getActiveConfig(fiscalYear);
        long eobiEmployee = eobiCalculator.employeeContribution(cfg.eobiWageBasePaisa(), cfg.eobiEmployeeRatePct());

        payslipRepository.deleteAllByRunId(runId);

        List<EmployeeEntity> employees = employeeRepository.findAllByBranchId(run.getBranchId()).stream()
                .filter(EmployeeEntity::isActive).toList();

        long totalGross = 0;
        long totalNet = 0;
        for (EmployeeEntity emp : employees) {
            long basic = emp.getBasicSalaryPaisa();
            long gross = basic; // allowances/overtime placeholder 0 for now

            long annualTaxable = basic * 12L; // annualize the REGULAR monthly rate (Pitfall 5)
            long annualTax = slabTaxCalculator.computeAnnualTax(annualTaxable, cfg.slabs());
            long surcharge = slabTaxCalculator.computeSurcharge(
                    annualTax, annualTaxable, cfg.surchargeThresholdPaisa(), cfg.surchargeRatePct());
            long incomeTaxMonth = (annualTax + surcharge) / 12;

            long advances = 0;
            long lateArrival = lateArrivalDeductionService.computeMonthlyDeduction(
                    emp.getId(), run.getPeriodMonth(), run.getPeriodYear());
            long net = gross - incomeTaxMonth - eobiEmployee - advances - lateArrival;

            PayslipEntity slip = new PayslipEntity();
            slip.setTenantId(run.getTenantId());
            slip.setRunId(run.getId());
            slip.setEmployeeId(emp.getId());
            slip.setBasicPaisa(basic);
            slip.setAllowancesJson(new HashMap<>());
            slip.setGrossPaisa(gross);
            Map<String, Long> deductions = new HashMap<>();
            deductions.put("income_tax_paisa", incomeTaxMonth);
            deductions.put("eobi_employee_paisa", eobiEmployee);
            deductions.put("advances_paisa", advances);
            deductions.put("late_arrival_paisa", lateArrival);
            deductions.put("other", 0L);
            slip.setDeductionsJson(deductions);
            slip.setNetPaisa(net);
            payslipRepository.save(slip);

            totalGross += gross;
            totalNet += net;
        }

        run.setTotalGrossPaisa(totalGross);
        run.setTotalNetPaisa(totalNet);
        run.setStatus(Status.CALCULATED);
        return runRepository.save(run);
    }

    @Transactional
    public PayrollRunEntity approve(UUID runId, boolean totpVerified) {
        if (!totpVerified) {
            throw new TotpRequiredException();
        }
        PayrollRunEntity run = load(runId);
        if (run.getStatus() != Status.CALCULATED) {
            throw new IllegalStateException("Only a CALCULATED run can be approved; is " + run.getStatus());
        }
        run.setStatus(Status.APPROVED);
        run.setApprovedBy(tenantContext.getUserId().orElse(null));
        run = runRepository.save(run);

        Map<String, Object> payload = new HashMap<>();
        payload.put("runId", run.getId());
        payload.put("branchId", run.getBranchId());
        payload.put("periodMonth", run.getPeriodMonth());
        payload.put("periodYear", run.getPeriodYear());
        payload.put("totalGrossPaisa", run.getTotalGrossPaisa());
        eventPublisher.publish(HR_EXCHANGE, "hr.payroll.approved", "PAYROLL_RUN_APPROVED", run.getBranchId(), payload);
        return run;
    }

    @Transactional
    public PayrollRunEntity pay(UUID runId) {
        PayrollRunEntity run = load(runId);
        if (run.getStatus() != Status.APPROVED) {
            throw new IllegalStateException("Only an APPROVED run can be paid; is " + run.getStatus());
        }
        run.setStatus(Status.PAID);
        run.setPaidAt(Instant.now());
        run = runRepository.save(run);

        Map<String, Object> payload = new HashMap<>();
        payload.put("runId", run.getId());
        payload.put("branchId", run.getBranchId());
        payload.put("totalNetPaisa", run.getTotalNetPaisa());
        eventPublisher.publish(HR_EXCHANGE, "hr.payroll.paid", "PAYROLL_RUN_PAID", run.getBranchId(), payload);
        return run;
    }

    @Transactional(readOnly = true)
    public PayrollRunEntity get(UUID runId) {
        return load(runId);
    }

    @Transactional(readOnly = true)
    public List<PayrollRunEntity> list() {
        return runRepository.findAllByTenantId(requireTenant());
    }

    @Transactional(readOnly = true)
    public List<PayslipEntity> payslips(UUID runId) {
        load(runId); // tenant-scoped existence check
        return payslipRepository.findAllByRunId(runId);
    }

    private PayrollRunEntity load(UUID runId) {
        return runRepository.findByIdAndTenantId(runId, requireTenant())
                .orElseThrow(() -> new IllegalArgumentException("Payroll run not found: " + runId));
    }

    private UUID requireTenant() {
        return tenantContext.getTenantId().orElseThrow(() -> new IllegalStateException("No tenant context"));
    }
}
