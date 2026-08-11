package io.restaurantos.hr.payroll.tax;

import io.restaurantos.hr.authz.HrAuthorizationService;
import io.restaurantos.hr.dto.TaxConfigDtos.CurrentFiscalYearResponse;
import io.restaurantos.hr.dto.TaxConfigDtos.SaveTaxConfigRequest;
import io.restaurantos.hr.dto.TaxConfigDtos.SlabRequest;
import io.restaurantos.hr.dto.TaxConfigDtos.SlabResponse;
import io.restaurantos.hr.dto.TaxConfigDtos.TaxConfigResponse;
import io.restaurantos.hr.dto.TaxConfigDtos.TaxConfigSummary;
import io.restaurantos.hr.entity.TaxConfigEntity;
import io.restaurantos.hr.exception.TaxConfigNotConfiguredException;
import io.restaurantos.hr.repository.TaxConfigRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

/**
 * The tenant's income-tax and EOBI parameters — readable by payroll, writable by an accountant.
 *
 * <h2>What changed in 35-06</h2>
 *
 * <p>This class used to have exactly one method, {@code getActiveConfig}, and there was no write
 * path anywhere in the service: {@link TaxConfigEntity} had a protected constructor and not one
 * setter. So {@code hr_db.tax_config} held one row — written by a Liquibase seed, for the
 * placeholder tenant {@code 00000000-…-0001}, for fiscal year 2026 — and payroll for August 2026
 * asks for fiscal year 2027, for a real tenant. Payroll could not run, for anybody, and the only
 * remedy was an INSERT typed by a developer.
 *
 * <h2>No fallback. None.</h2>
 *
 * <p>There is deliberately no default rate, no substitution of last year's table, and no empty
 * slab list standing in for a missing one. A wrong payslip is worse than a refused payroll run: the
 * refusal is noticed the same morning and the wrong payslip is noticed by the employee, later, and
 * has to be unwound across a tax filing. {@link TaxConfigNotConfiguredException} is the whole
 * behaviour for an absent year.
 */
@Service
public class TaxConfigService {

    private final TaxConfigRepository repository;
    private final TenantContext tenantContext;
    private final HrAuthorizationService authorization;
    private final Clock clock;

    /**
     * @param fiscalYearZone the zone whose calendar decides when the fiscal year turns over. NOT
     *                       UTC: the fiscal year begins on 1 July local time, and in Pakistan
     *                       (UTC+5) a UTC clock would call the first five hours of every 1 July the
     *                       old year — one morning a year in which the screen and payroll disagree
     *                       about which year needs configuring.
     */
    // @Autowired explicitly: there are TWO constructors, so Spring cannot infer which to use and
    // fails with "No default constructor found" — a message that names neither constructor and
    // sends you looking for a missing no-arg one that should not exist.
    @org.springframework.beans.factory.annotation.Autowired
    public TaxConfigService(TaxConfigRepository repository,
                            TenantContext tenantContext,
                            HrAuthorizationService authorization,
                            @Value("${restaurantos.hr.fiscal-year-zone:Asia/Karachi}") String fiscalYearZone) {
        this(repository, tenantContext, authorization, Clock.system(ZoneId.of(fiscalYearZone)));
    }

    /** Clock-injecting constructor, so the June-to-July boundary is assertable in a test. */
    TaxConfigService(TaxConfigRepository repository,
                     TenantContext tenantContext,
                     HrAuthorizationService authorization,
                     Clock clock) {
        this.repository = repository;
        this.tenantContext = tenantContext;
        this.authorization = authorization;
        this.clock = clock;
    }

    // ── the payroll read path ────────────────────────────────────────────────

    /**
     * What {@code PayrollRunService.calculate} asks for.
     *
     * <p>Deliberately NOT authorization-gated on {@code hr.config.view}: the caller here is payroll,
     * already gated on {@code hr.payroll.run}, and requiring the config permission as well would
     * mean a payroll operator could not run payroll without also being able to read the tax table
     * through the settings API. RLS still scopes the read to the caller's tenant.
     */
    @Transactional(readOnly = true)
    public ActiveTaxConfig getActiveConfig(int fiscalYear) {
        UUID tenantId = requireTenant();
        TaxConfigEntity e = repository.findByTenantIdAndFiscalYearAndActiveTrue(tenantId, fiscalYear)
                // Named, not IllegalStateException. See TaxConfigNotConfiguredException for why the
                // old throw reached the operator as "An unexpected error occurred".
                .orElseThrow(() -> new TaxConfigNotConfiguredException(fiscalYear));
        return new ActiveTaxConfig(
                e.getIncomeTaxSlabs(),
                e.getSurchargeThresholdPaisa(),
                e.getSurchargeRatePct(),
                e.getEobiEmployerRatePct(),
                e.getEobiEmployeeRatePct(),
                e.getEobiWageBasePaisa());
    }

    // ── the settings-screen read path ────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<TaxConfigSummary> list() {
        UUID tenantId = requireTenant();
        authorization.authorizeConfigView(tenantId);
        return repository.findAllByTenantIdOrderByFiscalYearDesc(tenantId).stream()
                .map(e -> new TaxConfigSummary(e.getId(), e.getFiscalYear(), e.getEffectiveFrom(),
                        e.getEffectiveTo(), e.isActive(),
                        e.getIncomeTaxSlabs() == null ? 0 : e.getIncomeTaxSlabs().size()))
                .toList();
    }

    /** An absent year is the named refusal, never an empty success — see class javadoc. */
    @Transactional(readOnly = true)
    public TaxConfigResponse getByFiscalYear(int fiscalYear) {
        UUID tenantId = requireTenant();
        authorization.authorizeConfigView(tenantId);
        return toResponse(require(tenantId, fiscalYear));
    }

    /**
     * Which fiscal year today falls in, and whether it has been configured.
     *
     * <p>The screen asks rather than computing, so {@link FiscalYear}'s July rule has exactly one
     * implementation in the product. See that class for why a TypeScript copy would be a defect
     * whose symptom is two apparently-working halves disagreeing about the year.
     */
    @Transactional(readOnly = true)
    public CurrentFiscalYearResponse currentFiscalYear() {
        UUID tenantId = requireTenant();
        authorization.authorizeConfigView(tenantId);
        int fy = FiscalYear.current(clock);
        boolean configured = repository.findByTenantIdAndFiscalYearAndActiveTrue(tenantId, fy).isPresent();
        return new CurrentFiscalYearResponse(fy, LocalDate.of(fy - 1, 7, 1), LocalDate.of(fy, 6, 30),
                configured);
    }

    // ── writes ───────────────────────────────────────────────────────────────

    /**
     * Create or replace a fiscal year's configuration.
     *
     * <p>Create-or-replace rather than separate create and update endpoints because
     * {@code uk_tax_config_tenant_fy} is UNIQUE on (tenant_id, fiscal_year): a year has at most one
     * row by construction, so "create" and "update" are the same operation seen from two sides, and
     * offering both would let a screen POST onto an existing year and get a bare constraint
     * violation instead of an edit.
     *
     * <p>The same uniqueness is why there is no "deactivate the other rows for this year" loop:
     * there are no other rows for this year. Activation is a property of the single row.
     */
    @Transactional
    public TaxConfigResponse save(int fiscalYear, SaveTaxConfigRequest req) {
        UUID tenantId = requireTenant();
        authorization.authorizeConfigManage(tenantId);
        TaxSlabTableValidator.validate(req.slabs());

        TaxConfigEntity e = repository.findByTenantIdAndFiscalYear(tenantId, fiscalYear)
                .orElseGet(TaxConfigEntity::new);
        e.setTenantId(tenantId);
        e.setFiscalYear(fiscalYear);
        e.setEffectiveFrom(req.effectiveFrom());
        e.setEffectiveTo(req.effectiveTo());
        e.setIncomeTaxSlabs(TaxSlabTableValidator.inAscendingOrder(req.slabs()).stream()
                .map(s -> new TaxSlab(s.minPaisa(), s.maxPaisa(), s.baseTaxPaisa(), s.ratePct()))
                .toList());
        e.setSurchargeThresholdPaisa(req.surchargeThresholdPaisa());
        e.setSurchargeRatePct(req.surchargeRatePct());
        e.setEobiEmployerRatePct(req.eobiEmployerRatePct());
        e.setEobiEmployeeRatePct(req.eobiEmployeeRatePct());
        e.setEobiWageBasePaisa(req.eobiWageBasePaisa());
        e.setProrationMethod(req.prorationMethod());
        e.setActive(Boolean.TRUE.equals(req.active()));
        return toResponse(repository.save(e));
    }

    @Transactional
    public TaxConfigResponse setActive(int fiscalYear, boolean active) {
        UUID tenantId = requireTenant();
        authorization.authorizeConfigManage(tenantId);
        TaxConfigEntity e = require(tenantId, fiscalYear);
        e.setActive(active);
        return toResponse(repository.save(e));
    }

    /**
     * Last year's figures, as an UNSAVED draft for a new year.
     *
     * <p>It deliberately does not write. Retyping six slabs, two EOBI rates and a surcharge every
     * July is how a wrong slab gets in, so carrying them forward is worth doing — but silently
     * creating next year's table from last year's rates is how a rate superseded by a Finance Act
     * survives into a year it does not apply to, invisibly, because nobody was ever shown it. The
     * accountant sees the figures on screen and presses save; that press is the confirmation.
     *
     * <p>{@code active} comes back false for the same reason: a draft that arrived pre-activated
     * would be in force from the moment it was saved, whether or not it was read.
     */
    @Transactional(readOnly = true)
    public SaveTaxConfigRequest copyForward(int fromFiscalYear, int toFiscalYear) {
        UUID tenantId = requireTenant();
        authorization.authorizeConfigManage(tenantId);
        TaxConfigEntity source = require(tenantId, fromFiscalYear);
        return new SaveTaxConfigRequest(
                LocalDate.of(toFiscalYear - 1, 7, 1),
                LocalDate.of(toFiscalYear, 6, 30),
                source.getIncomeTaxSlabs().stream()
                        .map(s -> new SlabRequest(s.minPaisa(), s.maxPaisa(), s.baseTaxPaisa(), s.ratePct()))
                        .toList(),
                source.getSurchargeThresholdPaisa(),
                source.getSurchargeRatePct(),
                source.getEobiEmployerRatePct(),
                source.getEobiEmployeeRatePct(),
                source.getEobiWageBasePaisa(),
                source.getProrationMethod(),
                false);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /**
     * Regardless of the active flag: the settings screen must be able to open an entered-but-not-yet
     * -active year in order to activate it. Payroll's read is the one that insists on active.
     */
    private TaxConfigEntity require(UUID tenantId, int fiscalYear) {
        return repository.findByTenantIdAndFiscalYear(tenantId, fiscalYear)
                .orElseThrow(() -> new TaxConfigNotConfiguredException(fiscalYear));
    }

    private static TaxConfigResponse toResponse(TaxConfigEntity e) {
        List<SlabResponse> slabs = (e.getIncomeTaxSlabs() == null ? List.<TaxSlab>of() : e.getIncomeTaxSlabs())
                .stream()
                .map(s -> new SlabResponse(s.minPaisa(), s.maxPaisa(), s.baseTaxPaisa(), s.ratePct()))
                .toList();
        return new TaxConfigResponse(e.getId(), e.getFiscalYear(), e.getEffectiveFrom(),
                e.getEffectiveTo(), slabs, e.getSurchargeThresholdPaisa(), e.getSurchargeRatePct(),
                e.getEobiEmployerRatePct(), e.getEobiEmployeeRatePct(), e.getEobiWageBasePaisa(),
                e.getProrationMethod(), e.isActive());
    }

    // Raw IllegalStateException deliberately: no tenant in context is a filter-chain invariant
    // breach, not caller input. See the note in EmployeeService.
    private UUID requireTenant() {
        return tenantContext.getTenantId()
                .orElseThrow(() -> new IllegalStateException("No tenant context for tax_config lookup"));
    }

    /** Parsed, ready-to-compute view of a tax_config row. */
    public record ActiveTaxConfig(
            List<TaxSlab> slabs,
            long surchargeThresholdPaisa,
            BigDecimal surchargeRatePct,
            BigDecimal eobiEmployerRatePct,
            BigDecimal eobiEmployeeRatePct,
            long eobiWageBasePaisa) {
    }
}
