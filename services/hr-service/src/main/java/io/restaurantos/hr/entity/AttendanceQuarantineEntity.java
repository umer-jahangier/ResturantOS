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

/**
 * A line a device sent that could not become a punch — retained and surfaced, never dropped
 * (D-25-03). There are exactly two ways in: the device user reference maps to no employee, or the
 * parser could not interpret the line at all. {@link #reason} says which.
 *
 * <h2>The uniqueness key is the whole point of this class after 25-06</h2>
 *
 * <p>Before changelog 034 this table had no uniqueness constraint of any kind while the punch table
 * beside it had one, and the ingest service inserted into the punch table conditionally and into
 * this one unconditionally. A device replaying its offline buffer therefore produced one fresh row
 * here per unmapped punch per replay, without bound. {@link #dedupKey} plus {@code device_id} is the
 * constraint that ends that; the key is computed in
 * {@code PunchIngestService#dedupKeyFor} so its rule lives in one readable place.
 */
@Entity
@Table(name = "attendance_quarantine")
@Getter
@Setter
public class AttendanceQuarantineEntity {

    /**
     * PENDING until somebody acts. RESOLVED means it became a punch. DISMISSED means a named person
     * decided, for a recorded reason, that it should not — which is a decision not to pay someone,
     * hence the name and the reason are required by the database and not only by the service.
     */
    public enum Status { PENDING, RESOLVED, DISMISSED }

    /**
     * Why the line is here. The union of the pre-existing unmapped case and 25-05's
     * {@code AttlogParseOutcome.Rejection.Reason}, mirrored by
     * {@code ck_attendance_quarantine_reason} in changelog 034.
     *
     * <p>Adding a value here means adding it to that check constraint AND deciding whether the new
     * reason carries a device-user reference and an instant — {@code
     * ck_attendance_quarantine_unmapped_has_identity} is written so that decision cannot be skipped.
     */
    public enum Reason {
        /** The device user reference maps to no employee. The line parsed perfectly. */
        UNMAPPED_DEVICE_USER,
        /** Null, empty, or whitespace only. */
        BLANK_LINE,
        /** Fewer than two tab-separated fields — not even a reference and a time. */
        TOO_FEW_FIELDS,
        /** The device user reference was empty. */
        MISSING_DEVICE_USER_REF,
        /** Neither the device-local pattern nor a Unix epoch. */
        UNPARSEABLE_TIMESTAMP
    }

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "device_id", nullable = false)
    private UUID deviceId;

    /**
     * Null only for a line the parser could not interpret — an uninterpretable line has no
     * reference, which is part of what makes it uninterpretable. Required by the database for every
     * reason that claims to carry one.
     */
    @Column(name = "device_user_ref")
    private String deviceUserRef;

    @Enumerated(EnumType.STRING)
    @Column(name = "punch_type")
    private PunchType punchType;

    /** Null for the same reason, and under the same database constraint, as {@link #deviceUserRef}. */
    @Column(name = "device_reported_at")
    private Instant deviceReportedAt;

    /**
     * The line exactly as received, including leading and trailing whitespace. It is the only
     * evidence of what the device actually sent and an administrator resolving an uninterpretable
     * entry reads it character by character — never trim, truncate or normalise it.
     */
    @Column(name = "raw_line")
    private String rawLine;

    @Enumerated(EnumType.STRING)
    @Column(name = "reason", nullable = false)
    private Reason reason = Reason.UNMAPPED_DEVICE_USER;

    /**
     * The queue's half of the idempotency guarantee D-25-05 already gives punches. Unique per
     * device. See {@code PunchIngestService#dedupKeyFor} for the two forms.
     */
    @Column(name = "dedup_key", nullable = false)
    private String dedupKey;

    /** When the server received it — a position in time even for an entry with no device instant. */
    @Column(name = "received_at", nullable = false)
    private Instant receivedAt = Instant.now();

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private Status status = Status.PENDING;

    @Column(name = "resolved_employee_id")
    private UUID resolvedEmployeeId;

    /** Machine-written, deliberately not {@link #dismissalReason}, so an audit can tell them apart. */
    @Column(name = "resolution_note")
    private String resolutionNote;

    @Column(name = "dismissed_by")
    private UUID dismissedBy;

    @Column(name = "dismissed_at")
    private Instant dismissedAt;

    @Column(name = "dismissal_reason")
    private String dismissalReason;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();
}
