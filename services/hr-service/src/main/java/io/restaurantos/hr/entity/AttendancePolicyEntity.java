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

import java.util.UUID;

/** Late-arrival deduction policy. branch_id NULL = the tenant-wide default. */
@Entity
@Table(name = "attendance_policies")
@Getter
@Setter
public class AttendancePolicyEntity {

    public enum DeductionMode { PER_MINUTE, PER_OCCURRENCE }

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "branch_id")
    private UUID branchId;

    @Column(name = "late_grace_minutes", nullable = false)
    private int lateGraceMinutes;

    @Enumerated(EnumType.STRING)
    @Column(name = "deduction_mode", nullable = false)
    private DeductionMode deductionMode = DeductionMode.PER_MINUTE;

    @Column(name = "deduction_rate_paisa", nullable = false)
    private long deductionRatePaisa;
}
