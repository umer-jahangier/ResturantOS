package io.restaurantos.shared.event.payload;

import java.time.Instant;
import java.util.UUID;

/**
 * THE wire contract for {@code ADMIN_PASSWORD_RESET} on {@code auth.topic} (13-13, D-16).
 *
 * <p>An administrator taking over another account's credential is the single most sensitive
 * operation this platform exposes to a non-platform user, and the only durable evidence that it
 * happened is this record. It exists to answer three questions after the fact: <b>who</b> did it,
 * <b>to whom</b>, and <b>why</b>.
 *
 * <h2>{@link #actingAdministratorId} and {@link #targetUserId} are separate fields with unambiguous
 * names, and that is not decoration</h2>
 *
 * <p>The 2026-08-06 audit found {@code PlatformAdminController.impersonate} passing the TARGET user
 * in both the target and the acting-administrator positions, so every row of
 * {@code impersonation_log} recorded a user as their own impersonator and the trail could not
 * answer who impersonated whom (D-34, closed by 13-14). That defect survived because the two
 * arguments had the same type and a plausible name. The same shape of mistake is available here —
 * an admin reset has exactly two user ids in it — so they are named for the ROLE they play rather
 * than for what they are, and a test asserts they hold different values in a case where the two are
 * genuinely different people.
 *
 * <p>The acting id is only ever the subject of a signature-verified JWT, asserted by the calling
 * service. It is never read from a request body: the whole value of a repudiation control is that
 * the subject of the record cannot choose what it says.
 *
 * <h2>What this record deliberately does NOT carry</h2>
 *
 * <p><b>No password material of any kind.</b> Not the temporary password, not its hash, not a
 * handle from which one could be fetched. {@code event_outbox} is a durable, replicated,
 * backed-up plain-text table and is relayed onto a broker with consumers this service does not
 * control — 13-09 (D-19) removed a raw reset token from exactly this table for exactly that reason,
 * and nothing here may put one back. The temporary password crosses back to the calling
 * administrator in the HTTP response and exists nowhere else.
 *
 * <p>{@link #reason} is required at the producer. A reset used to lock a rival out of their own
 * account (T-13-13-E) is indistinguishable from a legitimate one without it, and an audit row that
 * cannot say why is a row somebody has to interpret rather than read.
 *
 * @param tenantId               the tenant the target belongs to
 * @param actingAdministratorId  WHO performed the reset — a {@code users.id} at the tenant tier, a
 *                               {@code platform_users.id} at the platform tier
 * @param actorTier              {@code TENANT} or {@code PLATFORM}; it says which id space
 *                               {@code actingAdministratorId} lives in, and it is what makes the
 *                               two tiers separable in the trail
 * @param targetUserId           WHOSE password was reset — always a {@code users.id}
 * @param targetEmail            the target's address, so the row is legible without a join
 * @param reason                 why, supplied by the administrator and required
 * @param resetAt                when
 * @see PasswordResetRequestedPayload for the self-service event, and for why these are typed
 *      records rather than maps
 */
public record AdminPasswordResetPayload(
    UUID tenantId,
    UUID actingAdministratorId,
    String actorTier,
    UUID targetUserId,
    String targetEmail,
    String reason,
    Instant resetAt
) {

    public static final String EXCHANGE = "auth.topic";
    public static final String ROUTING_KEY = "auth.user.password_reset_by_admin";
    public static final String EVENT_TYPE = "ADMIN_PASSWORD_RESET";
}
