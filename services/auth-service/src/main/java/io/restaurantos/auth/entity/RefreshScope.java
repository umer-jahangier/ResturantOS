package io.restaurantos.auth.entity;

import java.util.UUID;

/**
 * What KIND of session a {@link RefreshSessionEntity} is, and the reserved tenant id a
 * control-plane one carries (16b-01).
 *
 * <p>This is a discriminator, not a permission. Nothing here grants anything — its only job is to
 * make "a platform refresh token may mint only a platform access token, and a tenant refresh token
 * may mint only a tenant access token" a decision the code states out loud rather than infers.
 *
 * <p>The values are plain strings rather than an enum because they are also a CHECK constraint in
 * changeset 084; keeping the Java and the SQL spelled identically means a mismatch is a failed
 * INSERT at the first attempt rather than a silent divergence discovered later.
 */
public final class RefreshScope {

    private RefreshScope() {}

    /** An ordinary tenant user's session. Carries a real {@code auth_tenants.id}. */
    public static final String TENANT = "TENANT";

    /** A platform (SuperAdmin) session. Carries {@link #PLATFORM_TENANT_SENTINEL}. */
    public static final String PLATFORM = "PLATFORM";

    /**
     * The reserved tenant id every {@link #PLATFORM} row carries.
     *
     * <p><b>This is not an RLS bypass — it is a tenant namespace of exactly one.</b>
     * {@code refresh_sessions} is FORCE ROW LEVEL SECURITY under
     * {@code tenant_id = current_setting('app.current_tenant_id')::uuid}, and that policy is left
     * completely untouched by 16b-01. Because {@code gen_random_uuid()} cannot produce the nil UUID
     * and no {@code auth_tenants} row holds it, a platform session is invisible from inside every
     * real tenant and every real tenant's sessions are invisible from the platform context. The
     * isolation the policy provides is unchanged in both directions.
     *
     * <p>NULL was the obvious alternative and is wrong: {@code NULL = <uuid>} is NULL, which RLS
     * reads as false, so a NULL-tenant row would be invisible to everything forever — and
     * {@code auth_lookup_refresh_tenant} would return NULL, which
     * {@link io.restaurantos.auth.service.RefreshSessionService} treats as "invalid refresh
     * session". See changeset 084 for the full reasoning, including what it would do to
     * {@code deploy/scripts/verify-security-definer-owners.sh}.
     */
    public static final UUID PLATFORM_TENANT_SENTINEL =
        UUID.fromString("00000000-0000-0000-0000-000000000000");

    /** True when this session may mint a control-plane token and nothing else. */
    public static boolean isPlatform(RefreshSessionEntity session) {
        return PLATFORM.equals(session.getScope());
    }
}
