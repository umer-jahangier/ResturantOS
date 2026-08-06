package io.restaurantos.hr.entity;

import io.restaurantos.hr.payroll.tax.TaxSlab;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * One row per (tenant, fiscal year) holding the FBR income-tax slab table and EOBI parameters —
 * the single source of truth for payroll math so an accountant can correct figures without a deploy.
 * {@code income_tax_slabs} is a JSONB array mapped straight to {@code List<TaxSlab>}.
 */
@Entity
@Table(name = "tax_config")
public class TaxConfigEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "fiscal_year", nullable = false)
    private Integer fiscalYear;

    @Column(name = "effective_from", nullable = false)
    private LocalDate effectiveFrom;

    @Column(name = "effective_to")
    private LocalDate effectiveTo;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "income_tax_slabs", nullable = false, columnDefinition = "jsonb")
    private List<TaxSlab> incomeTaxSlabs;

    @Column(name = "surcharge_threshold_paisa", nullable = false)
    private long surchargeThresholdPaisa;

    @Column(name = "surcharge_rate_pct", nullable = false)
    private double surchargeRatePct;

    @Column(name = "eobi_employer_rate_pct", nullable = false)
    private double eobiEmployerRatePct;

    @Column(name = "eobi_employee_rate_pct", nullable = false)
    private double eobiEmployeeRatePct;

    @Column(name = "eobi_wage_base_paisa", nullable = false)
    private long eobiWageBasePaisa;

    @Column(name = "proration_method", nullable = false)
    private String prorationMethod;

    @Column(name = "is_active", nullable = false)
    private boolean active;

    protected TaxConfigEntity() {
    }

    public UUID getId() {
        return id;
    }

    public UUID getTenantId() {
        return tenantId;
    }

    public Integer getFiscalYear() {
        return fiscalYear;
    }

    public LocalDate getEffectiveFrom() {
        return effectiveFrom;
    }

    public LocalDate getEffectiveTo() {
        return effectiveTo;
    }

    public List<TaxSlab> getIncomeTaxSlabs() {
        return incomeTaxSlabs;
    }

    public long getSurchargeThresholdPaisa() {
        return surchargeThresholdPaisa;
    }

    public double getSurchargeRatePct() {
        return surchargeRatePct;
    }

    public double getEobiEmployerRatePct() {
        return eobiEmployerRatePct;
    }

    public double getEobiEmployeeRatePct() {
        return eobiEmployeeRatePct;
    }

    public long getEobiWageBasePaisa() {
        return eobiWageBasePaisa;
    }

    public String getProrationMethod() {
        return prorationMethod;
    }

    public boolean isActive() {
        return active;
    }
}
