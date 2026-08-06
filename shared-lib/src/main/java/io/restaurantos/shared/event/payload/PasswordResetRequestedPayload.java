package io.restaurantos.shared.event.payload;

import java.util.UUID;

/**
 * THE wire contract for {@code PASSWORD_RESET_REQUESTED} on {@code auth.topic}.
 *
 * <p><b>What this record deliberately does NOT carry, and why that is the whole point.</b> Until
 * plan 13-09 this event was an untyped {@code Map} carrying {@code {userId, email, token}} — the
 * <i>raw</i> reset token, in plaintext, in the same row as auth-service's own SHA-256 of it. The
 * hashing was therefore decorative: anyone with read access to {@code event_outbox}, to a backup of
 * it, to a replica, or to the broker it is relayed onto could take over any account that had ever
 * requested a reset, without ever touching {@code password_reset_tokens}. The audit rates it the
 * most serious finding in its password section (D-19), and ROADMAP SC4 names it explicitly.
 *
 * <p><b>{@link #tokenId} is a row identifier, not a credential.</b> It is the primary key of the
 * {@code password_reset_tokens} row this request created. It confers nothing on its own: redeeming
 * requires the raw token, and the raw token exists only in the return value of
 * {@code PasswordPolicyService.issueSingleUseToken}, which auth-service hands to exactly one
 * recipient and never persists. Reading the token from the handle requires database access to
 * auth_db — which is already the trust level required to read the hash, so the handle widens
 * nothing (threat T-13-09-G, accepted). What it buys is that a future delivery consumer can
 * correlate the event with the row and fetch what it needs over an internal channel, instead of
 * being handed the credential in a durable, replicated, backed-up table.
 *
 * <p><b>Why a typed record and not a {@code Map}.</b> The 2026-08-02 integration repair moved every
 * cross-service payload onto shared records because untyped maps plus consumer-side ITs that
 * hand-authored their own guessed key names produced "green tests over four dead seams". This event
 * has no consumer at all today — {@code notification-service} is an active Maven module with zero
 * source files (D-31; see {@code docs/known-gaps/notification-delivery.md}) — which makes the type
 * more important rather than less: the seam is dead, so nothing would fail if a producer-side rename
 * silently changed the shape. With this record, the day someone writes that consumer, a rename is a
 * compile error rather than a field that quietly reads null.
 *
 * @param userId  the account the reset was requested for
 * @param email   the address the token must be delivered to
 * @param tokenId the {@code password_reset_tokens} row handle — NOT the token
 * @see HrEventContract for why these records are shared rather than duplicated
 */
public record PasswordResetRequestedPayload(UUID userId, String email, UUID tokenId) {

    public static final String EXCHANGE = "auth.topic";
    public static final String ROUTING_KEY = "auth.user.password_reset_requested";
    public static final String EVENT_TYPE = "PASSWORD_RESET_REQUESTED";
}
