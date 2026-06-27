package io.restaurantos.finance.domain.model;

import io.restaurantos.finance.domain.enums.PeriodStatus;
import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(
    name = "accounting_periods",
    uniqueConstraints = @UniqueConstraint(columnNames = {"tenant_id", "fiscal_year", "period_no"})
)
@Getter
@Setter
public class AccountingPeriod extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "fiscal_year", nullable = false)
    private int fiscalYear;

    @Column(name = "period_no", nullable = false)
    private int periodNo;

    @Column(name = "start_date", nullable = false)
    private LocalDate startDate;

    @Column(name = "end_date", nullable = false)
    private LocalDate endDate;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 10)
    private PeriodStatus status = PeriodStatus.OPEN;

    @Column(name = "locked_by")
    private UUID lockedBy;

    @Column(name = "locked_at")
    private Instant lockedAt;
}
