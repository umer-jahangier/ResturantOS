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

/**
 * An attendance punch. BOTH manual clock-in/out (this plan) and biometric device pushes (11-11)
 * land here, so the two sources unify. Manual punches use a synthetic per-branch MANUAL device so
 * {@code device_id} stays NOT NULL.
 */
@Entity
@Table(name = "attendance_punches")
@Getter
@Setter
public class AttendancePunchEntity {

    public enum PunchType { IN, OUT, UNKNOWN }

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "device_id", nullable = false)
    private UUID deviceId;

    @Column(name = "employee_id")
    private UUID employeeId;

    @Column(name = "device_user_ref", nullable = false)
    private String deviceUserRef;

    @Enumerated(EnumType.STRING)
    @Column(name = "punch_type", nullable = false)
    private PunchType punchType;

    @Column(name = "device_reported_at", nullable = false)
    private Instant deviceReportedAt;

    @Column(name = "server_received_at", nullable = false)
    private Instant serverReceivedAt = Instant.now();

    @Column(name = "source_record_id")
    private String sourceRecordId;
}
