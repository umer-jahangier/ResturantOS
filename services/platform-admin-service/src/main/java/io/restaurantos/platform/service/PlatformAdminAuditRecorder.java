package io.restaurantos.platform.service;

import io.restaurantos.platform.entity.PlatformAdminAuditEntity;
import io.restaurantos.platform.entity.PlatformAdminAuditEntity.Outcome;
import io.restaurantos.platform.entity.PlatformAdminAuditEntity.PlatformAdminAction;
import io.restaurantos.platform.repository.PlatformAdminAuditRepository;
import io.restaurantos.platform.repository.PlatformUserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

/**
 * Writes {@code platform_admin_audit} — the one place a platform operator's mutations are recorded
 * with the operator's own identity (superadmin plan).
 *
 * <h2>Why every mutation goes through here</h2>
 *
 * <p>The tenant-side events these operations publish deliberately carry <b>no platform id in any
 * actor column</b>: a {@code platform_users} id in {@code audit_events.user_id} would be resolved
 * by every consumer against {@code auth_db.users} and would name somebody who does not exist in
 * that tenant — the D-34 defect one layer up. Two of the operations (unlock, revoke-sessions)
 * publish no tenant event at all. So without this recorder, the answer to "which SuperAdmin
 * deactivated this account, and why" is nowhere in the product.
 *
 * <h2>Refusals are recorded, and that is the point</h2>
 *
 * <p>{@link #recordRefusal} exists because an operator repeatedly attempting something they are
 * refused is exactly the pattern an abuse review looks for, and a trail of successes cannot show
 * it. It is also why every method here runs {@code REQUIRES_NEW}: the refusal path is reached from
 * a {@code catch} block, and a record that rolls back with the failure it is describing is not a
 * record. There is no local transaction to join anyway — these operations are HTTP calls to
 * auth-service, not database writes in this service — so a new one costs one connection and buys
 * the guarantee outright.
 *
 * <h2>What must never reach a row</h2>
 *
 * <p><b>No credential.</b> The platform password reset returns a temporary password to the operator
 * and it exists nowhere else — not in a log, not in an event, and not in {@code detail}. The
 * lesson is already paid for in this service: {@code idempotency_keys.response_json} is plain text
 * that nothing purges, which is why {@code POST .../reset-password} takes no idempotency key
 * (13-10). This column has the same property and the same rule.
 *
 * <h2>A failure to record does not become a failure to act — and is not silent either</h2>
 *
 * <p>These methods are called after the upstream operation has already happened. Throwing here
 * would report a failure for a mutation that took effect, sending an operator to retry something
 * already done. So a write failure is caught, logged at ERROR with everything the row would have
 * carried, and swallowed. That is a real gap and it is stated rather than hidden: the log line is
 * the fallback record, and losing this table's write means losing the durable half.
 */
@Service
public class PlatformAdminAuditRecorder {

    private static final Logger log = LoggerFactory.getLogger(PlatformAdminAuditRecorder.class);

    /**
     * {@code detail} is {@code VARCHAR(1000)}. Truncated here rather than left to fail the INSERT:
     * an upstream message long enough to overflow the column is exactly the interesting case, and
     * losing the whole row to keep the tail of a message is the wrong trade.
     */
    private static final int MAX_DETAIL = 1000;

    private final PlatformAdminAuditRepository auditRepository;
    private final PlatformUserRepository platformUserRepository;

    public PlatformAdminAuditRecorder(PlatformAdminAuditRepository auditRepository,
                                      PlatformUserRepository platformUserRepository) {
        this.auditRepository = auditRepository;
        this.platformUserRepository = platformUserRepository;
    }

    /** The action took effect. {@code detail} says what changed, never what was issued. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordSuccess(PlatformAdminAction action, UUID platformUserId, UUID tenantId,
                              UUID targetUserId, String reason, String detail) {
        write(action, Outcome.SUCCEEDED, platformUserId, tenantId, targetUserId, reason, detail);
    }

    /**
     * The action was refused — by this service (unknown tenant) or upstream (unknown user, an
     * upstream refusal code). Recorded with the same weight as a success.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordRefusal(PlatformAdminAction action, UUID platformUserId, UUID tenantId,
                              UUID targetUserId, String reason, String why) {
        write(action, Outcome.REFUSED, platformUserId, tenantId, targetUserId, reason, why);
    }

    private void write(PlatformAdminAction action, Outcome outcome, UUID platformUserId,
                       UUID tenantId, UUID targetUserId, String reason, String detail) {
        try {
            PlatformAdminAuditEntity row = new PlatformAdminAuditEntity();
            row.setOccurredAt(Instant.now());
            row.setPlatformUserId(platformUserId);
            // Resolved at write time and stored, not joined at read time. See the entity: the
            // SuperAdmin credential is rotated by changeset 910, and a trail that re-resolves its
            // own actors changes its own history.
            row.setPlatformUserEmail(platformUserRepository.findById(platformUserId)
                .map(user -> user.getEmail())
                .orElse(null));
            row.setAction(action);
            row.setTenantId(tenantId);
            row.setTargetUserId(targetUserId);
            row.setReason(trim(reason, 500));
            row.setOutcome(outcome);
            row.setDetail(trim(detail, MAX_DETAIL));
            auditRepository.save(row);
        } catch (RuntimeException recordingFailed) {
            // Never rethrown: the mutation has already happened upstream and reporting a failure
            // for it would send an operator to repeat it. The log line is the fallback record and
            // carries every field the row would have.
            log.error("[platform-admin][AUDIT-WRITE-FAILED] action={} outcome={} operator={} "
                    + "tenant={} target={} reason={} detail={}",
                action, outcome, platformUserId, tenantId, targetUserId, reason, detail,
                recordingFailed);
        }
    }

    private static String trim(String value, int max) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        return trimmed.length() <= max ? trimmed : trimmed.substring(0, max);
    }
}
