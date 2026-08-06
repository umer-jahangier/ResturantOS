package io.restaurantos.hr.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * One row per (employee, leave type, month) that has already been accrued.
 *
 * <p>This is the idempotency marker for {@code LeaveService.accrue}. Its unique constraint
 * {@code (tenant_id, employee_id, leave_type_id, period_year, period_month)} also serves as the
 * distributed lock: the accrual inserts the marker in the same transaction as the balance
 * increment, so a second replica racing on the same period loses the insert and skips the
 * increment rather than granting the days twice.
 */
@Entity
@Table(name = "leave_accrual_log")
@Getter
@Setter
public class LeaveAccrualLogEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Column(name = "leave_type_id", nullable = false)
    private UUID leaveTypeId;

    @Column(name = "period_year", nullable = false)
    private int periodYear;

    @Column(name = "period_month", nullable = false)
    private int periodMonth;

    @Column(name = "accrued_days", nullable = false)
    private BigDecimal accruedDays = BigDecimal.ZERO;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();
}
