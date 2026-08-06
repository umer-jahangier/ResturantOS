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
import java.util.UUID;

/** A leave category (e.g. Annual, Sick, Unpaid) with an optional monthly accrual rate. */
@Entity
@Table(name = "leave_types")
@Getter
@Setter
public class LeaveTypeEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "is_paid", nullable = false)
    private boolean paid = true;

    @Column(name = "accrual_days_per_month", nullable = false)
    private BigDecimal accrualDaysPerMonth = BigDecimal.ZERO;
}
