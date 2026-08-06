package io.restaurantos.hr.entity;

import io.restaurantos.shared.security.EncryptedStringConverter;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
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
 * Biometric attendance device registry (HR-07). {@code deviceToken} is the device's shared secret,
 * field-encrypted (AES-256-GCM) into a {@code bytea} column exactly like employee PII. The serial
 * number is globally unique and is the lookup key the device-authenticated ingest path resolves
 * tenant/branch from — never client-supplied tenant headers.
 */
@Entity
@Table(name = "attendance_devices")
@Getter
@Setter
public class AttendanceDeviceEntity {

    public enum ConnectionMode { NETWORK_ADMS, USB_BRIDGE }

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "serial_no", nullable = false)
    private String serialNo;

    @Column(name = "model")
    private String model;

    @Enumerated(EnumType.STRING)
    @Column(name = "connection_mode", nullable = false)
    private ConnectionMode connectionMode;

    @Convert(converter = EncryptedStringConverter.class)
    @Column(name = "device_token", columnDefinition = "bytea", nullable = false)
    private String deviceToken;

    @Column(name = "last_seen_at")
    private Instant lastSeenAt;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;
}
