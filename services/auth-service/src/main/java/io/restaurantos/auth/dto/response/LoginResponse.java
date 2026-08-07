package io.restaurantos.auth.dto.response;

import java.util.UUID;

/**
 * The login success body.
 *
 * <h3>Why {@code tenantId} and {@code branchId} became nullable in 16a-01</h3>
 * <p>{@code POST /api/v1/auth/login} now serves platform (SuperAdmin) users too, and a platform user
 * belongs to no tenant — that is the point of {@code platform_db.platform_users}, and the reason the
 * gateway's {@code TENANT_OPTIONAL_PATHS} exists at all. Inventing a tenant id for them would put a
 * lie in a signed-adjacent response and would make a client's "which console do I open?" question
 * unanswerable from the body.
 *
 * <p>{@code tokenType} is the discriminator, and it is the SAME string the JWT carries in its
 * {@code token_type} claim ({@code "platform"} for control-plane tokens; absent/{@code "access"} for
 * tenant ones). A client must be able to route without decoding the token, and the two must agree —
 * so this field is populated from the mint, never assembled independently.
 *
 * @param tenantId null for a platform login, non-null for every tenant login
 * @param branchId null for a platform login, non-null for every tenant login
 */
public record LoginResponse(
    String accessToken,
    long expiresInSeconds,
    UUID userId,
    UUID tenantId,
    UUID branchId,
    String tokenType
) {

    /** The discriminator value for an ordinary tenant login. */
    public static final String TENANT_TOKEN_TYPE = "access";

    /**
     * The pre-16a-01 shape. Every existing tenant caller constructs it this way and gets exactly the
     * body it got before, plus {@code tokenType:"access"} — an additive field, which is why no
     * consumer had to change to keep working.
     */
    public LoginResponse(String accessToken, long expiresInSeconds, UUID userId, UUID tenantId, UUID branchId) {
        this(accessToken, expiresInSeconds, userId, tenantId, branchId, TENANT_TOKEN_TYPE);
    }
}
