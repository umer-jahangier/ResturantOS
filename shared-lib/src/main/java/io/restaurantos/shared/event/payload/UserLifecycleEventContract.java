package io.restaurantos.shared.event.payload;

import java.time.Instant;
import java.util.UUID;

/**
 * THE wire contract for the user-lifecycle and privilege events on {@code auth.topic} (15-01).
 *
 * <h2>Why these exist</h2>
 *
 * <p>They did not, until 15-01. A user could be created, granted a role, have that role revoked and
 * be deactivated, and none of it produced an event, an audit row, or any central record at all. The
 * only trace was the mutated row itself, which records the current state and not who changed it or
 * when — so "who gave this cashier the ability to approve refunds, and when" had no answer anywhere
 * in the platform. These are the highest-privilege operations the product exposes to a non-platform
 * user and they were the least observable.
 *
 * <h2>Where they are published from, and why not from user-service</h2>
 *
 * <p>From <b>auth-service</b>, inside the {@code @Transactional} method that performs the write.
 * user-service is where a tenant administrator's request arrives, but it owns none of this data:
 * {@code users} and {@code user_branch_roles} live in {@code auth_db}, and every user-service write
 * is a Feign delegation to auth-service ({@code UserAdminService} documents that ownership at
 * length). Publishing from user-service would mean publishing <em>after</em> a remote call has
 * already committed — outside any transaction that could make the event and the write agree. That
 * produces exactly two failure modes, and the trail cannot distinguish either from the truth: an
 * event for a write that was rolled back, and a committed write whose event was lost when the
 * publisher died in between.
 *
 * <p>Published from auth-service, the outbox INSERT and the row change share one transaction and
 * one commit. It also means the trail captures writes that never pass through user-service at all —
 * tenant provisioning creates the first OWNER by calling auth-service directly.
 *
 * <h2>What these records must never carry</h2>
 *
 * <p><b>No password, no hash, no token, no reset handle, no TOTP secret.</b> {@code event_outbox} is
 * a durable, replicated, backed-up plain-text table, it is relayed onto a broker with consumers this
 * service does not control, and {@code audit_events} is retained for seven years and is append-only
 * — a credential written into any of them cannot be redacted afterwards, only deleted along with the
 * audit history that is the point of the table. 13-09 (D-19) already removed a raw reset token from
 * {@code event_outbox} for this reason. {@code CreatedUser} carries the generated temporary password
 * back to the calling administrator in the HTTP response and it exists nowhere else; nothing here
 * has a field it could go in, and {@code UserLifecycleEventPayloadTest} asserts that reflectively
 * over every record in this file so a future field cannot quietly become one.
 *
 * <p>Email is present and is a deliberate call: it is the identifier an auditor reads the row by,
 * it is already in {@code USER_LOGIN_SUCCEEDED}, and an audit row that can only be understood by
 * joining against a table whose rows may since have changed is a row nobody reads. No other personal
 * data appears — no name, no phone, no CNIC, no bank detail, no salary.
 */
public final class UserLifecycleEventContract {

    private UserLifecycleEventContract() {}

    public static final String EXCHANGE = "auth.topic";

    public static final String USER_CREATED = "USER_CREATED";
    public static final String USER_UPDATED = "USER_UPDATED";
    public static final String USER_DEACTIVATED = "USER_DEACTIVATED";
    public static final String USER_REACTIVATED = "USER_REACTIVATED";
    public static final String ROLE_GRANTED = "ROLE_GRANTED";
    public static final String ROLE_REVOKED = "ROLE_REVOKED";

    public static final String USER_CREATED_KEY = "auth.user.created";
    public static final String USER_UPDATED_KEY = "auth.user.updated";
    public static final String USER_DEACTIVATED_KEY = "auth.user.deactivated";
    public static final String USER_REACTIVATED_KEY = "auth.user.reactivated";
    public static final String ROLE_GRANTED_KEY = "auth.role.granted";
    public static final String ROLE_REVOKED_KEY = "auth.role.revoked";

    /**
     * An account was created.
     *
     * @param targetUserId  the account that now exists
     * @param targetEmail   its address, normalised (lower-cased, trimmed) as stored
     * @param actingUserId  WHO created it — the subject of a verified JWT, never a request field
     * @param initialRole   the role granted at creation, or null if the account was created with
     *                      none. Present because "created with OWNER" and "created, then given
     *                      OWNER a week later" are different facts and both are worth being able
     *                      to tell apart in the trail
     * @param initialBranchId the branch that role applies to, or null
     * @param occurredAt    when
     */
    public record UserCreatedPayload(
        UUID targetUserId,
        String targetEmail,
        UUID actingUserId,
        String initialRole,
        UUID initialBranchId,
        Instant occurredAt
    ) {}

    /**
     * A profile field changed. Never a password — that path publishes {@code PASSWORD_CHANGED} or
     * {@code ADMIN_PASSWORD_RESET}, and {@code UserLifecycleService.update} refuses a body carrying
     * a password field rather than ignoring it.
     *
     * @param changedFields the names of the fields that changed, never their values. An auditor
     *                      needs to know that a locale was edited; storing what it was edited to
     *                      would put arbitrary user-supplied strings into an append-only table that
     *                      cannot be redacted
     */
    public record UserUpdatedPayload(
        UUID targetUserId,
        String targetEmail,
        UUID actingUserId,
        java.util.List<String> changedFields,
        Instant occurredAt
    ) {}

    /**
     * An account was deactivated or reactivated.
     *
     * <p>One record for both directions, with {@link #active} saying which — they are the same
     * operation on the same field and splitting them into two shapes invites the two to drift.
     * The event TYPE differs ({@code USER_DEACTIVATED} / {@code USER_REACTIVATED}) so a query can
     * still filter on one without reading payloads.
     *
     * @param sessionsRevoked how many refresh sessions were revoked as part of this. Zero on
     *                        reactivation, which deliberately does not restore them
     */
    public record UserActivationChangedPayload(
        UUID targetUserId,
        String targetEmail,
        UUID actingUserId,
        boolean active,
        int sessionsRevoked,
        Instant occurredAt
    ) {}

    /**
     * A role was granted at a branch — a privilege escalation, and the single most audit-relevant
     * write in the product.
     *
     * @param displacedRoleCode the role this one replaced at that branch, or null. One active role
     *                          per user per branch is a 13-02 invariant, so a grant is frequently
     *                          also a revocation, and a trail that records only the new role cannot
     *                          answer what the person could do yesterday
     * @param approvalLimitPaisa the spending authority attached to the assignment, or null. This is
     *                           the {@code attributes} claim OPA bounds expense and PO approvals
     *                           with, so a change to it is a change to how much money this person
     *                           can move
     */
    public record RoleGrantedPayload(
        UUID targetUserId,
        UUID actingUserId,
        UUID branchId,
        String roleCode,
        String displacedRoleCode,
        Long approvalLimitPaisa,
        boolean primary,
        Instant occurredAt
    ) {}

    /**
     * A role was revoked at a branch.
     *
     * <p>{@code actingUserId} is nullable here and on nothing else in this file, because the revoke
     * path reaches auth-service without an acting-user header today
     * ({@code AuthInternalClient.revokeBranchRole} sends none, unlike every other write). A null is
     * recorded honestly rather than substituted with the target's own id — a trail that names the
     * wrong actor is worse than one that admits it does not know, which is the D-34 defect that put
     * every user in {@code impersonation_logs} down as their own impersonator. Closing that gap is
     * follow-up W-15-02.
     */
    public record RoleRevokedPayload(
        UUID targetUserId,
        UUID actingUserId,
        UUID branchId,
        String roleCode,
        Instant occurredAt
    ) {}
}
