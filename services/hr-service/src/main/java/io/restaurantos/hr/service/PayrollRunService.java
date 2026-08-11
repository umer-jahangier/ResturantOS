package io.restaurantos.hr.service;

import io.restaurantos.hr.entity.EmployeeEntity;
import io.restaurantos.hr.authz.HrAuthorizationService;
import io.restaurantos.hr.entity.PayrollRunEntity;
import io.restaurantos.hr.entity.PayrollRunEntity.Status;
import io.restaurantos.hr.entity.PayslipEntity;
import io.restaurantos.hr.exception.TotpRequiredException;
import io.restaurantos.hr.payroll.tax.EobiCalculator;
import io.restaurantos.hr.payroll.tax.FiscalYear;
import io.restaurantos.hr.payroll.tax.SlabTaxCalculator;
import io.restaurantos.hr.payroll.tax.TaxConfigService;
import io.restaurantos.hr.payroll.tax.TaxConfigService.ActiveTaxConfig;
import io.restaurantos.hr.repository.EmployeeRepository;
import io.restaurantos.hr.repository.PayrollRunRepository;
import io.restaurantos.hr.repository.PayslipRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.event.payload.HrEventContract;
import io.restaurantos.shared.exception.DuplicateValueException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
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

    private final PayrollRunRepository runRepository;
    private final PayslipRepository payslipRepository;
    private final EmployeeRepository employeeRepository;
    private final TaxConfigService taxConfigService;
    private final SlabTaxCalculator slabTaxCalculator;
    private final EobiCalculator eobiCalculator;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;
    private final LateArrivalDeductionService lateArrivalDeductionService;
    private final HrAuthorizationService authorization;

    public PayrollRunService(PayrollRunRepository runRepository, PayslipRepository payslipRepository,
                             EmployeeRepository employeeRepository, TaxConfigService taxConfigService,
                             SlabTaxCalculator slabTaxCalculator, EobiCalculator eobiCalculator,
                             EventPublisher eventPublisher, TenantContext tenantContext,
                             LateArrivalDeductionService lateArrivalDeductionService,
                             HrAuthorizationService authorization) {
        this.runRepository = runRepository;
        this.payslipRepository = payslipRepository;
        this.employeeRepository = employeeRepository;
        this.taxConfigService = taxConfigService;
        this.slabTaxCalculator = slabTaxCalculator;
        this.eobiCalculator = eobiCalculator;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
        this.lateArrivalDeductionService = lateArrivalDeductionService;
        this.authorization = authorization;
    }

    @Transactional
    public PayrollRunEntity create(int periodMonth, int periodYear) {
        UUID tenantId = requireTenant();
        authorization.authorizePayrollRun(null, tenantId, requireBranch());
        runRepository.findByTenantIdAndPeriodMonthAndPeriodYear(tenantId, periodMonth, periodYear)
                .ifPresent(r -> {
                    throw new DuplicateValueException("periodMonth",
                            "A payroll run already exists for " + periodMonth + "/" + periodYear
                                    + ". Open that run instead of creating a second one.");
                });
        PayrollRunEntity run = new PayrollRunEntity();
        run.setTenantId(tenantId);
        // Must be required, not optional (EmployeeService.requireBranch() already does this). A run
        // created from a token with no branch claim used to persist branchId=null, which then made
        // calculate() call findAllByBranchId(null) -> zero payslips, totals 0, and approve() publish
        // branchId=null -> AutoPostingRecipeEngine throws "branchId required" and dead-letters the
        // message. The whole cycle failed silently, downstream of the real cause.
        run.setBranchId(requireBranch());
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
        authorizePayrollRunOn(runId);
        PayrollRunEntity run = load(runId);
        if (run.getStatus() != Status.DRAFT && run.getStatus() != Status.CALCULATED) {
            // Own code, not the generic STATE_INVALID: the payroll screen must be able to tell
            // "this run is already approved" from "this run has no branch" without reading prose,
            // because the two have different next actions.
            throw new StateInvalidException("PAYROLL_RUN_NOT_CALCULABLE",
                    "This run is " + run.getStatus().name().toLowerCase()
                            + " and can no longer be calculated. Only a draft or an already-calculated"
                            + " run can be recalculated.");
        }
        // Guard rows created before create() required a branch: findAllByBranchId(null) matches no
        // employees, which would otherwise produce a zero-total run that looks successful.
        if (run.getBranchId() == null) {
            throw new StateInvalidException("PAYROLL_RUN_NO_BRANCH",
                    "This run was created without a branch and cannot be calculated."
                            + " Create a new run while signed in to the branch you are paying.");
        }
        // FiscalYear.forPeriod, not the ternary that was here. Identical arithmetic — asserted for
        // every month of seven years in FiscalYearTest — but the tax-configuration screen now asks
        // the same question, and two implementations of a statutory convention drift into a screen
        // that configures FY2026 while payroll refuses because FY2027 is missing, with both halves
        // apparently working.
        int fiscalYear = FiscalYear.forPeriod(run.getPeriodMonth(), run.getPeriodYear());
        ActiveTaxConfig cfg = taxConfigService.getActiveConfig(fiscalYear);
        long eobiEmployee = eobiCalculator.employeeContribution(cfg.eobiWageBasePaisa(), cfg.eobiEmployeeRatePct());

        payslipRepository.deleteAllByRunId(runId);

        List<EmployeeEntity> employees = employeeRepository.findAllByBranchId(run.getBranchId()).stream()
                .filter(EmployeeEntity::isActive).toList();

        long totalGross = 0;
        long totalNet = 0;
        long totalTax = 0;
        long totalEobi = 0;
        long totalAdvances = 0;
        long totalLateArrival = 0;
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

            // DECISION: reject the payslip (and with it the whole run), do NOT clamp net at 0.
            //
            // Clamping was the other option on the table and it is the wrong one here, because the
            // ledger identity finance posts against is
            //     net + tax + eobi + advances == gross - lateArrival
            // Raising a negative net to 0 breaks that identity by exactly the shortfall, so the
            // approved journal entry would no longer balance and the deferred balance trigger would
            // reject it — turning a data problem in ONE employee's row into a dead-lettered message
            // with a diagnostic pointing at finance. Clamping also quietly writes off money the
            // employee still owes (an advance larger than the month's pay does not evaporate).
            //
            // Failing the run rather than skipping the employee is deliberate too: a payroll run is
            // an all-or-nothing document, and silently omitting someone means they are not paid and
            // nobody is told. This throws with the employee and the numbers, so the fix is obvious.
            if (net < 0) {
                // Keeps its full arithmetic breakdown — it is aimed at an operator who has to find
                // the wrong number — but stops being reported as a server fault. 409, not 500: the
                // data is wrong, the server is not.
                throw new StateInvalidException("PAYSLIP_NET_NEGATIVE",
                        "Payslip for employee " + emp.getId() + " (" + emp.getEmployeeNo() + ") in run "
                                + runId + " has a negative net of " + net + " paisa: gross=" + gross
                                + ", incomeTax=" + incomeTaxMonth + ", eobi=" + eobiEmployee
                                + ", advances=" + advances + ", lateArrival=" + lateArrival
                                + ". Correct the salary, the advance or the attendance policy and recalculate.");
            }

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
            totalTax += incomeTaxMonth;
            totalEobi += eobiEmployee;
            totalAdvances += advances;
            totalLateArrival += lateArrival;
        }

        run.setTotalGrossPaisa(totalGross);
        run.setTotalNetPaisa(totalNet);
        run.setTotalTaxPaisa(totalTax);
        run.setTotalEobiPaisa(totalEobi);
        run.setTotalAdvancesPaisa(totalAdvances);
        run.setTotalLateArrivalPaisa(totalLateArrival);
        run.setStatus(Status.CALCULATED);
        return runRepository.save(run);
    }

    @Transactional
    public PayrollRunEntity approve(UUID runId, boolean totpVerified) {
        if (!totpVerified) {
            throw new TotpRequiredException();
        }
        PayrollRunEntity run = load(runId);
        authorization.authorizePayrollApprove(run.getId(), run.getTenantId(), run.getBranchId());
        if (run.getStatus() != Status.CALCULATED) {
            throw new StateInvalidException("PAYROLL_RUN_NOT_CALCULATED",
                    "This run is " + run.getStatus().name().toLowerCase()
                            + " and cannot be approved. Calculate it first.");
        }
        run.setStatus(Status.APPROVED);
        run.setApprovedBy(tenantContext.getUserId().orElse(null));
        run = runRepository.save(run);

        // The typed contract record, not a HashMap. The gross alone is not enough for finance to
        // post correctly — see HrEventContract for why, and for the invariant these six numbers
        // satisfy. A rename on either side is now a compile error rather than a silent zero.
        HrEventContract.PayrollApprovedPayload payload = new HrEventContract.PayrollApprovedPayload(
                run.getId(),
                run.getBranchId(),
                run.getPeriodMonth(),
                run.getPeriodYear(),
                run.getTotalGrossPaisa(),
                run.getTotalNetPaisa(),
                run.getTotalTaxPaisa(),
                run.getTotalEobiPaisa(),
                run.getTotalAdvancesPaisa(),
                run.getTotalLateArrivalPaisa());
        eventPublisher.publish(HrEventContract.EXCHANGE, HrEventContract.PAYROLL_RUN_APPROVED_KEY,
                HrEventContract.PAYROLL_RUN_APPROVED, run.getBranchId(), payload);
        return run;
    }

    @Transactional
    public PayrollRunEntity pay(UUID runId) {
        PayrollRunEntity run = load(runId);
        authorization.authorizePayrollApprove(run.getId(), run.getTenantId(), run.getBranchId());
        if (run.getStatus() != Status.APPROVED) {
            throw new StateInvalidException("PAYROLL_RUN_NOT_APPROVED",
                    "This run is " + run.getStatus().name().toLowerCase()
                            + " and cannot be marked paid. Approve it first.");
        }
        run.setStatus(Status.PAID);
        run.setPaidAt(Instant.now());
        run = runRepository.save(run);

        HrEventContract.PayrollPaidPayload payload = new HrEventContract.PayrollPaidPayload(
                run.getId(),
                run.getBranchId(),
                run.getPeriodMonth(),
                run.getPeriodYear(),
                run.getTotalNetPaisa());
        eventPublisher.publish(HrEventContract.EXCHANGE, HrEventContract.PAYROLL_RUN_PAID_KEY,
                HrEventContract.PAYROLL_RUN_PAID, run.getBranchId(), payload);
        return run;
    }

    @Transactional(readOnly = true)
    public PayrollRunEntity get(UUID runId) {
        PayrollRunEntity run = load(runId);
        authorization.authorizePayrollView(run.getTenantId(), run.getBranchId());
        return run;
    }

    @Transactional(readOnly = true)
    public List<PayrollRunEntity> list() {
        authorization.authorizePayrollView(requireTenant(), requireBranch());
        return runRepository.findAllByTenantId(requireTenant());
    }

    @Transactional(readOnly = true)
    public List<PayslipEntity> payslips(UUID runId) {
        PayrollRunEntity run = load(runId); // tenant-scoped; hr.rego applies the branch test
        authorization.authorizePayrollView(run.getTenantId(), run.getBranchId());
        return payslipRepository.findAllByRunId(runId);
    }

    /**
     * {@code payroll_run} on the run's OWN branch. {@link #load(UUID)} is tenant-scoped, exactly as
     * {@code EmployeeService.load} is, so without this a run belonging to another branch was
     * readable and mutable from anywhere in the tenant.
     */
    private void authorizePayrollRunOn(UUID runId) {
        PayrollRunEntity run = load(runId);
        authorization.authorizePayrollRun(run.getId(), run.getTenantId(), run.getBranchId());
    }

    private PayrollRunEntity load(UUID runId) {
        return runRepository.findByIdAndTenantId(runId, requireTenant())
                .orElseThrow(() -> new ResourceNotFoundException("Payroll run", runId));
    }

    // Raw IllegalStateException deliberately: no tenant/branch/user in context is a filter-chain
    // invariant breach, not caller input. See the note in EmployeeService.
    private UUID requireTenant() {
        return tenantContext.getTenantId().orElseThrow(() -> new IllegalStateException("No tenant context"));
    }

    private UUID requireBranch() {
        return tenantContext.getBranchId()
                .orElseThrow(() -> new IllegalStateException(
                        "No branch context — a payroll run must be scoped to a branch"));
    }
}
