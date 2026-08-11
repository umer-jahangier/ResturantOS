package io.restaurantos.hr.service;

import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import io.restaurantos.hr.entity.AttendancePunchEntity.PunchType;
import io.restaurantos.hr.entity.AttendanceQuarantineEntity;
import io.restaurantos.hr.entity.AttendanceQuarantineEntity.Reason;
import io.restaurantos.hr.entity.EmployeeEntity;
import io.restaurantos.hr.repository.AttendanceDeviceRepository;
import io.restaurantos.hr.repository.AttendanceQuarantineRepository;
import io.restaurantos.hr.repository.EmployeeRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * The single ingest funnel for BOTH Mode A (ADMS/iClock) and Mode B (USB bridge).
 *
 * <h2>Three destinations and no fourth (D-25-03)</h2>
 *
 * Every line a device sends ends in exactly one of three places:
 *
 * <ol>
 *   <li>an <b>attendance punch</b>, when the device user reference resolves through the DURABLE
 *       {@code employees.device_user_ref} mapping;</li>
 *   <li>a <b>queue entry</b> — either because that reference maps to nobody, or because the parser
 *       could not interpret the line at all, the two cases distinguished by
 *       {@link Reason} rather than hidden in a second table nobody opens;</li>
 *   <li>a <b>recorded duplicate</b> of something already in one of the first two.</li>
 * </ol>
 *
 * <p>There is no fourth place and no way out except through one of them. That is the whole claim of
 * this class, and {@code PunchRetentionIT} asserts it as a sum rather than as a list of cases,
 * because a per-case assertion passes while a line quietly falls between two cases.
 *
 * <h2>Both tables get the same guarantee, which is new</h2>
 *
 * <p>The punch insert has always been {@code ON CONFLICT ... DO NOTHING} on
 * {@code (device_id, device_user_ref, device_reported_at)}. The queue insert was UNCONDITIONAL —
 * and that asymmetry is exactly what let a device replaying its offline buffer grow the queue
 * without bound, one row per unmapped punch per replay, each one work a person has to clear.
 * Changelog 034 gave the queue its own uniqueness key and both inserts now read alike.
 *
 * <p>An event is published only on a genuine punch insert. That rule and the punch uniqueness key
 * are the two lines every idempotency claim in phase 25 rests on; neither is touched here.
 *
 * <p>No raw biometric data is accepted or stored.
 */
@Service
public class PunchIngestService {

    private static final String HR_EXCHANGE = "hr.topic";

    private final EmployeeRepository employeeRepository;
    private final AttendanceQuarantineRepository quarantineRepository;
    private final AttendanceDeviceRepository deviceRepository;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;

    @PersistenceContext
    private EntityManager entityManager;

    public PunchIngestService(EmployeeRepository employeeRepository,
                              AttendanceQuarantineRepository quarantineRepository,
                              AttendanceDeviceRepository deviceRepository,
                              EventPublisher eventPublisher,
                              TenantContext tenantContext) {
        this.employeeRepository = employeeRepository;
        this.quarantineRepository = quarantineRepository;
        this.deviceRepository = deviceRepository;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
    }

    // ------------------------------------------------------------------ the deduplication key

    /**
     * The queue's deduplication key for a line that PARSED but whose reference maps to nobody.
     *
     * <p>Deliberately the same identity {@code uk_attendance_punch} uses, minus the device — the
     * device is the other half of {@code uk_attendance_quarantine_dedup}. So a punch deduplicates on
     * the same facts whether it lands in the punch table or in the queue, and a replayed offline
     * buffer grows neither.
     *
     * <p>Epoch millis rather than a rendered timestamp because changelog 034's backfill has to
     * produce a byte-identical string from Postgres, and a number cannot disagree with Java about
     * its own formatting across fractional seconds, offsets and locales.
     */
    static String dedupKeyForReference(String deviceUserRef, Instant deviceReportedAt) {
        return "REF:" + deviceUserRef + "@" + deviceReportedAt.toEpochMilli();
    }

    /**
     * The queue's deduplication key for a line NOBODY could interpret.
     *
     * <p>There is no identity to key on — that is what makes it uninterpretable — so the line itself
     * is the identity, hashed so a key column does not become a second copy of the evidence. The
     * line is hashed <b>verbatim</b>, untrimmed and unnormalised: two lines differing only in
     * whitespace are two different things a device sent, and collapsing them would hide the second.
     *
     * <p>SHA-256 rather than {@code String.hashCode}, whose 32 bits collide by accident at a few
     * tens of thousands of distinct values — well inside what one misconfigured terminal produces in
     * a week, and a collision here silently discards a line, which is the exact failure this whole
     * plan exists to remove.
     */
    static String dedupKeyForRawLine(String rawLine) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(rawLine.getBytes(StandardCharsets.UTF_8));
            return "RAW:" + HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required by every JVM specification", e);
        }
    }

    // ------------------------------------------------------------------ ingest

    /**
     * What became of one line.
     *
     * @see #ingest
     */
    public enum IngestResult {
        /** A new attendance punch. One event published. */
        INSERTED,
        /** The punch was already stored — an offline-buffer replay. No row, no event. */
        DUPLICATE,
        /** A new queue entry, for an unmapped reference or an uninterpretable line. */
        QUARANTINED,
        /** The queue entry was already there. The defect this plan fixes: before 034 this was a row. */
        QUARANTINE_DUPLICATE
    }

    @Transactional
    public IngestResult ingest(AttendanceDeviceEntity device, String deviceUserRef, Instant deviceReportedAt,
                               PunchType punchType, String workCode, String rawLine) {
        UUID tenantId = device.getTenantId();
        UUID branchId = device.getBranchId();

        Optional<EmployeeEntity> employee = employeeRepository.findByTenantIdAndDeviceUserRef(tenantId, deviceUserRef);
        if (employee.isEmpty()) {
            return insertQuarantine(device, Reason.UNMAPPED_DEVICE_USER, deviceUserRef, deviceReportedAt,
                    punchType, rawLine, dedupKeyForReference(deviceUserRef, deviceReportedAt));
        }

        UUID employeeId = employee.get().getId();
        int rows = entityManager.createNativeQuery(
                        "INSERT INTO attendance_punches (tenant_id, branch_id, device_id, employee_id, "
                                + "device_user_ref, punch_type, device_reported_at, server_received_at, work_code) "
                                + "VALUES (CAST(:tenantId AS uuid), CAST(:branchId AS uuid), CAST(:deviceId AS uuid), "
                                + "CAST(:employeeId AS uuid), :deviceUserRef, :punchType, CAST(:deviceReportedAt AS timestamptz), "
                                + "now(), :workCode) "
                                + "ON CONFLICT (device_id, device_user_ref, device_reported_at) DO NOTHING")
                .setParameter("tenantId", tenantId.toString())
                .setParameter("branchId", branchId.toString())
                .setParameter("deviceId", device.getId().toString())
                .setParameter("employeeId", employeeId.toString())
                .setParameter("deviceUserRef", deviceUserRef)
                .setParameter("punchType", punchType.name())
                .setParameter("deviceReportedAt", deviceReportedAt.toString())
                .setParameter("workCode", workCode)
                .executeUpdate();

        device.setLastSeenAt(Instant.now());
        deviceRepository.save(device);

        if (rows == 0) {
            return IngestResult.DUPLICATE; // offline-buffer replay — publish nothing
        }

        Map<String, Object> payload = new HashMap<>();
        payload.put("employeeId", employeeId);
        payload.put("deviceId", device.getId());
        payload.put("punchedAt", deviceReportedAt);
        payload.put("punchType", punchType.name());
        eventPublisher.publish(HR_EXCHANGE, "hr.attendance.punched", "ATTENDANCE_PUNCHED", branchId, payload);
        return IngestResult.INSERTED;
    }

    /**
     * The destination for a line the parser could not interpret — 25-05 gave the parser a named
     * {@code Rejection} instead of an empty {@code Optional}; this is where one goes.
     *
     * <p>It lands in the same queue an administrator already reads, distinguished by its reason.
     * Deliberately not a second table: a table nobody opens is where an unpaid hour goes to be
     * technically retained.
     *
     * @param rawLine the line exactly as received. Never trimmed, truncated or normalised — it is
     *                the only evidence of what the device actually sent.
     */
    @Transactional
    public IngestResult ingestRejection(AttendanceDeviceEntity device, Reason reason, String rawLine) {
        if (reason == Reason.UNMAPPED_DEVICE_USER) {
            throw new IllegalArgumentException(
                    "UNMAPPED_DEVICE_USER is not a parse rejection — use ingest(...), which carries the identity");
        }
        device.setLastSeenAt(Instant.now());
        deviceRepository.save(device);
        return insertQuarantine(device, reason, null, null, null, rawLine, dedupKeyForRawLine(rawLine));
    }

    /**
     * The queue's conflict-do-nothing insert, mirroring the punch insert above it. The two now read
     * alike because they are the same guarantee applied to two tables.
     *
     * <p>Written as a native insert rather than a repository {@code save} for one reason: JPA has no
     * way to express {@code ON CONFLICT DO NOTHING}, and a read-then-write in its place is a race
     * two concurrent polls from the same replaying terminal will lose. The absent columns are
     * emitted as literal {@code NULL} rather than bound as null parameters so that the statement's
     * types are never ambiguous — only the PRESENCE of a value varies here, never its content.
     */
    private IngestResult insertQuarantine(AttendanceDeviceEntity device, Reason reason, String deviceUserRef,
                                          Instant deviceReportedAt, PunchType punchType, String rawLine,
                                          String dedupKey) {
        String refExpr = deviceUserRef == null ? "NULL" : ":deviceUserRef";
        String atExpr = deviceReportedAt == null ? "NULL" : "CAST(:deviceReportedAt AS timestamptz)";
        String typeExpr = punchType == null ? "NULL" : ":punchType";
        String rawExpr = rawLine == null ? "NULL" : ":rawLine";

        Query query = entityManager.createNativeQuery(
                "INSERT INTO attendance_quarantine (tenant_id, device_id, device_user_ref, punch_type, "
                        + "device_reported_at, raw_line, reason, dedup_key, received_at, status, created_at) "
                        + "VALUES (CAST(:tenantId AS uuid), CAST(:deviceId AS uuid), " + refExpr + ", " + typeExpr
                        + ", " + atExpr + ", " + rawExpr + ", :reason, :dedupKey, now(), 'PENDING', now()) "
                        + "ON CONFLICT (device_id, dedup_key) DO NOTHING")
                .setParameter("tenantId", device.getTenantId().toString())
                .setParameter("deviceId", device.getId().toString())
                .setParameter("reason", reason.name())
                .setParameter("dedupKey", dedupKey);
        if (deviceUserRef != null) {
            query.setParameter("deviceUserRef", deviceUserRef);
        }
        if (deviceReportedAt != null) {
            query.setParameter("deviceReportedAt", deviceReportedAt.toString());
        }
        if (punchType != null) {
            query.setParameter("punchType", punchType.name());
        }
        if (rawLine != null) {
            query.setParameter("rawLine", rawLine);
        }
        return query.executeUpdate() == 0 ? IngestResult.QUARANTINE_DUPLICATE : IngestResult.QUARANTINED;
    }

    // ------------------------------------------------------------------ resolve and dismiss

    /**
     * What an administrator supplies to resolve an entry the parser could not read. Not a guess the
     * service makes — a parser that could not read a line must not be replaced by a service that
     * assumes one.
     */
    public record SuppliedInterpretation(String deviceUserRef, Instant deviceReportedAt, PunchType punchType) {
    }

    /**
     * Resolve a quarantined punch: persist the DURABLE {@code employees.device_user_ref} mapping so
     * every future punch for that ref auto-resolves (no quarantine loop), then re-ingest the parked
     * punch and mark the entry RESOLVED. Rejects if the ref is already mapped to another employee.
     */
    @Transactional
    public void resolveQuarantine(UUID quarantineId, UUID employeeId) {
        resolveQuarantine(quarantineId, employeeId, null);
    }

    /**
     * As above, and for an entry that carries no identity at all, with the identity the
     * administrator read off the raw line.
     *
     * @param supplied required when — and permitted only when — the entry has no reference of its
     *     own. Refused rather than guessed if absent; refused rather than trusted over the device's
     *     own evidence if the entry already has one.
     */
    @Transactional
    public void resolveQuarantine(UUID quarantineId, UUID employeeId, SuppliedInterpretation supplied) {
        UUID tenantId = tenantContext.getTenantId().orElseThrow(() -> new IllegalStateException("No tenant context"));
        AttendanceQuarantineEntity q = quarantineRepository.findByIdAndTenantId(quarantineId, tenantId)
                .orElseThrow(() -> new IllegalArgumentException("Quarantine not found: " + quarantineId));
        if (q.getStatus() == AttendanceQuarantineEntity.Status.RESOLVED) {
            return;
        }
        if (q.getStatus() == AttendanceQuarantineEntity.Status.DISMISSED) {
            throw new IllegalStateException("Quarantine entry was dismissed and cannot be resolved: " + quarantineId);
        }

        String deviceUserRef = q.getDeviceUserRef();
        Instant deviceReportedAt = q.getDeviceReportedAt();
        PunchType punchType = q.getPunchType();

        if (deviceUserRef == null || deviceReportedAt == null) {
            if (supplied == null || supplied.deviceUserRef() == null || supplied.deviceUserRef().isBlank()
                    || supplied.deviceReportedAt() == null || supplied.punchType() == null) {
                throw new IllegalArgumentException(
                        "Entry " + quarantineId + " was rejected as " + q.getReason() + " and carries no reference or "
                                + "instant. Supply a reference, an instant and a punch type read from the raw line — "
                                + "this service will not guess one.");
            }
            deviceUserRef = supplied.deviceUserRef();
            deviceReportedAt = supplied.deviceReportedAt();
            punchType = supplied.punchType();
        } else if (supplied != null) {
            throw new IllegalArgumentException(
                    "Entry " + quarantineId + " already carries the device's own reference and instant; an "
                            + "administrator-supplied interpretation must not override the device's evidence.");
        }

        final String ref = deviceUserRef;
        employeeRepository.findByTenantIdAndDeviceUserRef(tenantId, ref).ifPresent(existing -> {
            if (!existing.getId().equals(employeeId)) {
                throw new IllegalStateException(
                        "device_user_ref " + ref + " is already mapped to another employee");
            }
        });
        EmployeeEntity employee = employeeRepository.findByIdAndTenantId(employeeId, tenantId)
                .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + employeeId));
        employee.setDeviceUserRef(ref); // durable mapping
        employeeRepository.save(employee);

        AttendanceDeviceEntity device = deviceRepository.findById(q.getDeviceId())
                .orElseThrow(() -> new IllegalStateException("Quarantine device missing: " + q.getDeviceId()));
        ingest(device, ref, deviceReportedAt, punchType, null, q.getRawLine());

        q.setStatus(AttendanceQuarantineEntity.Status.RESOLVED);
        q.setResolvedEmployeeId(employeeId);
        quarantineRepository.save(q);
    }

    /**
     * Decide that an entry will NOT become a punch.
     *
     * <p>This is a decision not to pay somebody for time they may have worked, so it carries the
     * name of whoever made it and the reason they gave. Both are required here AND by
     * {@code ck_attendance_quarantine_dismissal} — the service check is a promise about one code
     * path; the constraint is a promise about the table.
     */
    @Transactional
    public void dismissQuarantine(UUID quarantineId, String reason) {
        UUID tenantId = tenantContext.getTenantId().orElseThrow(() -> new IllegalStateException("No tenant context"));
        UUID actor = tenantContext.getUserId().orElseThrow(() -> new IllegalStateException(
                "No acting user: an entry dismissed by nobody is an hour of somebody's work deleted by nobody"));
        if (reason == null || reason.isBlank()) {
            throw new IllegalArgumentException("A dismissal reason is required: dismissing "
                    + quarantineId + " with no reason is deleting a claim to paid time for nothing");
        }
        AttendanceQuarantineEntity q = quarantineRepository.findByIdAndTenantId(quarantineId, tenantId)
                .orElseThrow(() -> new IllegalArgumentException("Quarantine not found: " + quarantineId));
        if (q.getStatus() == AttendanceQuarantineEntity.Status.RESOLVED) {
            throw new IllegalStateException(
                    "Quarantine entry was already resolved into a punch and cannot be dismissed: " + quarantineId);
        }
        q.setStatus(AttendanceQuarantineEntity.Status.DISMISSED);
        q.setDismissedBy(actor);
        q.setDismissedAt(Instant.now());
        q.setDismissalReason(reason.trim());
        quarantineRepository.save(q);
    }
}
