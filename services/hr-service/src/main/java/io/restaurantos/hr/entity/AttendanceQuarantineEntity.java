package io.restaurantos.hr.entity;

import io.restaurantos.hr.entity.AttendancePunchEntity.PunchType;
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

/** A punch whose device_user_ref has no mapped employee — parked for admin resolution, not dropped. */
@Entity
@Table(name = "attendance_quarantine")
@Getter
@Setter
public class AttendanceQuarantineEntity {

    public enum Status { PENDING, RESOLVED }

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "device_id", nullable = false)
    private UUID deviceId;

    @Column(name = "device_user_ref", nullable = false)
    private String deviceUserRef;

    @Enumerated(EnumType.STRING)
    @Column(name = "punch_type")
    private PunchType punchType;

    @Column(name = "device_reported_at", nullable = false)
    private Instant deviceReportedAt;

    @Column(name = "raw_line")
    private String rawLine;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private Status status = Status.PENDING;

    @Column(name = "resolved_employee_id")
    private UUID resolvedEmployeeId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();
}
