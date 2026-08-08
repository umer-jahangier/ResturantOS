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

    @Column(name = "run_by", nullable = false)
    private UUID runBy;

    @Column(name = "approved_by")
    private UUID approvedBy;

    @Column(name = "paid_at")
    private Instant paidAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();
}
