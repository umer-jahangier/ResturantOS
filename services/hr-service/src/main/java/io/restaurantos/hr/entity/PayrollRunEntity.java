package io.restaurantos.hr.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/** A monthly payroll run: DRAFT -> CALCULATED -> APPROVED -> PAID (REVERSED reserved). */
@Entity
@Table(name = "payroll_runs")
@Getter
@Setter
public class PayrollRunEntity {

    public enum Status { DRAFT, CALCULATED, APPROVED, PAID, REVERSED }

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "branch_id")
    private UUID branchId;

    @Column(name = "period_month", nullable = false)
    private int periodMonth;

    @Column(name = "period_year", nullable = false)
    private int periodYear;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private Status status = Status.DRAFT;

    @Column(name = "total_gross_paisa", nullable = false)
    private long totalGrossPaisa;

    @Column(name = "total_net_paisa", nullable = false)
    private long totalNetPaisa;

    // The components of (gross - net), persisted so PAYROLL_RUN_APPROVED can carry the split.
    // finance credits each to its own statutory account instead of dumping the whole gross on
    // Wages Payable and clearing only the net — which left the difference on 2300 forever.
    // Invariant, established per payslip in calculate():
    //     totalNet + totalTax + totalEobi + totalAdvances == totalGross - totalLateArrival

    @Column(name = "total_tax_paisa", nullable = false)
    private long totalTaxPaisa;

    @Column(name = "total_eobi_paisa", nullable = false)
    private long totalEobiPaisa;

    @Column(name = "total_advances_paisa", nullable = false)
    private long totalAdvancesPaisa;

    @Column(name = "total_late_arrival_paisa", nullable = false)
    private long totalLateArrivalPaisa;

    @Column(name = "run_by", nullable = false)
    private UUID runBy;

    @Column(name = "approved_by")
    private UUID approvedBy;

    @Column(name = "paid_at")
    private Instant paidAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();
}
