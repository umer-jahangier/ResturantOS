package io.restaurantos.platform.service;

import io.restaurantos.platform.client.AuthInternalClient;
import io.restaurantos.platform.dto.PlatformDtos.PlatformLoginResponse;
import io.restaurantos.platform.entity.PlatformUserEntity;
import io.restaurantos.platform.entity.PlatformUserEntity.PlatformRole;
import io.restaurantos.platform.exception.PlatformAuthenticationFailedException;
import io.restaurantos.platform.repository.PlatformUserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Verifies a platform (SuperAdmin) credential against {@code platform_users} and exchanges it for a
 * signed, tenant-less control-plane token — the third and final cause of audit blocker B1.
 *
 * <h3>Why this class exists here and not in auth-service (D-26)</h3>
 * <p>PLATFORM-07 states that only platform-admin-service connects to {@code platform_db}. A login in
 * auth-service would need either a second datasource onto the control plane or a cross-service
 * credential read, and both break that boundary. The responsibility is split instead: this service
 * verifies the password because it owns the table, and auth-service signs the token because it owns
 * the RSA private key and the JWKS contract. A platform login is therefore two hops, and the
 * internal shared secret on the second hop is load-bearing — see {@link AuthInternalClient#platformToken}.
 *
 * <h3>Why every refusal looks the same</h3>
 * <p>An unknown email, a wrong password, a deactivated account, a non-SuperAdmin role and a locked
 * account all throw {@link PlatformAuthenticationFailedException}, which renders as one constant
 * body. They also all perform <b>exactly one bcrypt comparison</b> — against the account's real hash
 * where one was found, and against {@link #DUMMY_HASH} where one was not. Without the dummy
 * comparison an unknown email returns in microseconds while a wrong password takes the ~250ms a
 * cost-12 hash costs, and that difference alone enumerates the platform user table. This mirrors
 * {@code AuthServiceImpl}'s idiom exactly, deliberately: two credential paths that agree on day one
 * and drift afterwards is the recurring finding of the audit that produced this phase.
 *
 * <p>Note the ordering consequence: the password is verified <i>before</i> the active flag and the
 * role are examined. That is intentional. Checking them first would let an attacker learn that an
 * address belongs to a deactivated or SUPPORT-role account without knowing its password, because
 * those checks are free and the bcrypt comparison is not.
 *
 * <h3>Lockout lives in Redis, and what that costs</h3>
 * <p>{@code platform_users} has no {@code failed_login_count} / {@code locked_until} columns, unlike
 * the tenant {@code users} table. Rather than migrate the control-plane credential table for this,
 * the counter is held in Redis under {@link #FAIL_KEY_PREFIX} keyed on the lowercased email, with
 * the same 15-minute window auth-service applies to tenant users.
 *
 * <p><b>The consequence, stated rather than discovered later:</b> the counter is not durable. A
 * Redis flush, failover or eviction resets every platform account's lockout state. That is accepted
 * here because the gateway's dedicated {@code platform-auth-route} rate limit is an independent
 * brake that does not share this failure mode, and because platform accounts are few and watched. A
 * durable column is the correct follow-up, and it should land together with platform MFA — {@code
 * platform_users} has no TOTP column either, so platform accounts have no second factor at all
 * today (13-CONTEXT defers this; it is a named, accepted gap, not an oversight).
 *
 * <p>Redis being unreachable makes the lockout check pass and the counter write a no-op, logged at
 * WARN. Failing closed would convert a cache outage into a total control-plane lockout with no way
 * back in — the platform API is the tool an operator would use to fix things. Failing open loses one
 * of two independent brute-force brakes for the duration of the outage; the rate limiter keeps
 * working, since it is enforced at the gateway against a different Redis usage entirely.
 */
@Service
public class PlatformAuthService {

    private static final Logger log = LoggerFactory.getLogger(PlatformAuthService.class);

    /**
     * Compared against on every path where no real hash is available, so that the time a refusal
     * takes does not reveal whether the account exists. Cost 12, matching the real encoder — a
     * cheaper dummy would reintroduce the timing difference it exists to remove. It is the hash of a
     * random value that was never recorded, so nothing can present a password that matches it.
     */
    private static final String DUMMY_HASH =
        "$2b$12$2cHEoGRC6hS2NnwhmJMHxeji6UhBanqRSYVyBG2X7KNORGFWfQxCq";

    /** Redis key prefix for the per-account failure counter. Asserted by {@code PlatformAuthIT}. */
    public static final String FAIL_KEY_PREFIX = "platform:auth:fail:";

    /** Matches {@code AuthServiceImpl.MAX_FAILED_ATTEMPTS} for tenant users. */
    static final int MAX_FAILED_ATTEMPTS = 5;

    /** Matches the 15-minute window {@code AuthServiceImpl.handleFailedPassword} applies. */
    static final Duration LOCKOUT_WINDOW = Duration.ofMinutes(15);

    /**
     * The only platform role this phase mints a token for. SUPPORT and BILLING personas are
     * explicitly deferred to Phase 14 (13-CONTEXT, "Deferred Ideas"), and until their own
     * authorization model exists they must not receive a token that satisfies
     * {@code @PreAuthorize("hasAuthority('SUPER_ADMIN')")} — which, given
     * {@code JwtSigningService.signPlatformToken} carries the role in both the {@code roles} and
     * {@code permissions} claims, is exactly what minting one for them would do.
     */
    static final PlatformRole MINTABLE_ROLE = PlatformRole.SUPER_ADMIN;

    private final PlatformUserRepository platformUserRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuthInternalClient authInternalClient;
    private final StringRedisTemplate redis;
    private final long fallbackTtlSeconds;

    public PlatformAuthService(PlatformUserRepository platformUserRepository,
                               PasswordEncoder passwordEncoder,
                               AuthInternalClient authInternalClient,
                               StringRedisTemplate redis,
                               @Value("${restaurantos.platform.token-ttl-seconds:900}") long fallbackTtlSeconds) {
        this.platformUserRepository = platformUserRepository;
        this.passwordEncoder = passwordEncoder;
        this.authInternalClient = authInternalClient;
        this.redis = redis;
        this.fallbackTtlSeconds = fallbackTtlSeconds;
    }

    /**
     * @param sourceAddress the caller's address, for the audit line only — never used for any
     *                      authorization decision, since it is derived from a client-supplied
     *                      {@code X-Forwarded-For} when one is present
     * @throws PlatformAuthenticationFailedException on every failure, with no distinguishing detail
     */
    @Transactional(readOnly = true)
    public PlatformLoginResponse login(String email, String password, String sourceAddress) {
        PlatformUserEntity user = verifyCredential(email, password, sourceAddress);

        // A signer outage is NOT a credential failure and must never be reported as one: a Feign
        // error propagates to GlobalExceptionHandler as a 500. Telling a SuperAdmin with the correct
        // password that their credential is invalid would send them to rotate a password that works.
        MintedToken minted = mint(user);

        log.info("[platform-auth] success — platformUserId={} role={} source={} ttl={}s",
            user.getId(), user.getRole(), sourceAddress, minted.expiresIn());

        return new PlatformLoginResponse(
            minted.token(), minted.expiresIn(), minted.tokenType(), user.getId(), user.getRole().name());
    }

    /**
     * Every credential check {@link #login} performs, and nothing else — extracted by 16a-01 so the
     * unified email-first login in auth-service can ask "is this a platform credential?" over the
     * internal channel and get an answer produced by <b>this exact code</b>.
     *
     * <h3>Why extraction rather than a second implementation</h3>
     * <p>The whole complaint that produced phase 13 is that two credential paths which agreed on day
     * one drifted afterwards. A unified login that re-derived the lockout window, the dummy-hash
     * comparison, the active check and the mintable-role check would be a third such path. There is
     * one method; {@link #login} and
     * {@link io.restaurantos.platform.controller.PlatformInternalAuthController} both call it.
     *
     * <p><b>The refusal is still an exception, not a boolean.</b> A method that returned
     * {@code Optional.empty()} for "wrong password" invites a caller to branch on emptiness and,
     * eventually, to say something different for the empty case than the exception path says. The
     * internal controller catches it and renders one constant {@code {"matched": false}} — it does
     * not, and must not, forward the reason.
     *
     * @return the verified platform user; never null
     * @throws PlatformAuthenticationFailedException on every failure, with no distinguishing detail
     */
    @Transactional(readOnly = true)
    public PlatformUserEntity verifyCredential(String email, String password, String sourceAddress) {
        String normalized = normalize(email);

        if (isLockedOut(normalized)) {
            passwordEncoder.matches(password, DUMMY_HASH);
            log.warn("[platform-auth] refused: locked out — email={} source={}", normalized, sourceAddress);
            throw new PlatformAuthenticationFailedException();
        }

        PlatformUserEntity user = platformUserRepository.findByEmail(normalized).orElse(null);
        if (user == null) {
            passwordEncoder.matches(password, DUMMY_HASH);
            recordFailure(normalized);
            log.warn("[platform-auth] refused: no such platform user — email={} source={}",
                normalized, sourceAddress);
            throw new PlatformAuthenticationFailedException();
        }

        if (!passwordEncoder.matches(password, user.getPasswordHash())) {
            recordFailure(normalized);
            log.warn("[platform-auth] refused: bad password — platformUserId={} source={}",
                user.getId(), sourceAddress);
            throw new PlatformAuthenticationFailedException();
        }

        // Deliberately neither increments nor clears the counter. Incrementing would let a correct
        // password lock an account out; clearing would make "the counter reset" an oracle telling
        // the caller their password was right for an account they are not allowed to use.
        if (!user.isActive()) {
            log.warn("[platform-auth] refused: account deactivated — platformUserId={} source={}",
                user.getId(), sourceAddress);
            throw new PlatformAuthenticationFailedException();
        }
        if (user.getRole() != MINTABLE_ROLE) {
            log.warn("[platform-auth] refused: role {} is not mintable — platformUserId={} source={}",
                user.getRole(), user.getId(), sourceAddress);
            throw new PlatformAuthenticationFailedException();
        }

        clearFailures(normalized);
        return user;
    }

    // --- Minting -------------------------------------------------------------------------------

    private MintedToken mint(PlatformUserEntity user) {
        Map<String, Object> response = authInternalClient.platformToken(Map.of(
            "platformUserId", user.getId().toString(),
            "platformRole", user.getRole().name()));

        Object data = response != null ? response.get("data") : null;
        if (!(data instanceof Map<?, ?> map)) {
            throw new IllegalStateException("platform-token response had no data envelope");
        }
        Object token = map.get("token");
        if (token == null || token.toString().isBlank()) {
            throw new IllegalStateException("platform-token response carried no token");
        }
        long expiresIn = map.get("expiresIn") instanceof Number n ? n.longValue() : fallbackTtlSeconds;
        String tokenType = map.get("tokenType") != null ? map.get("tokenType").toString() : "platform";
        return new MintedToken(token.toString(), expiresIn, tokenType);
    }

    private record MintedToken(String token, long expiresIn, String tokenType) {}

    // --- Lockout -------------------------------------------------------------------------------

    /**
     * Lowercased and trimmed, so the Redis counter and the table lookup agree on what "the same
     * account" means. If they disagreed, {@code Admin@x} and {@code admin@x} would each get their
     * own five attempts and the lockout would be trivially bypassed by varying the case.
     */
    private static String normalize(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }

    private static String failKey(String normalizedEmail) {
        return FAIL_KEY_PREFIX + normalizedEmail;
    }

    private boolean isLockedOut(String normalizedEmail) {
        try {
            String raw = redis.opsForValue().get(failKey(normalizedEmail));
            return raw != null && Integer.parseInt(raw) >= MAX_FAILED_ATTEMPTS;
        } catch (DataAccessException | NumberFormatException e) {
            log.warn("[platform-auth] lockout check unavailable ({}); allowing the attempt — the "
                + "gateway rate limit is the remaining brake", e.toString());
            return false;
        }
    }

    private void recordFailure(String normalizedEmail) {
        try {
            Long count = redis.opsForValue().increment(failKey(normalizedEmail));
            // Re-arm the window on every failure rather than only on the first, so a patient
            // attacker cannot pace guesses to keep an ageing counter alive without ever locking.
            redis.expire(failKey(normalizedEmail), LOCKOUT_WINDOW);
            if (count != null && count == MAX_FAILED_ATTEMPTS) {
                log.warn("[platform-auth] account locked for {} minutes after {} failures — email={}",
                    LOCKOUT_WINDOW.toMinutes(), MAX_FAILED_ATTEMPTS, normalizedEmail);
            }
        } catch (DataAccessException e) {
            log.warn("[platform-auth] failure counter not recorded ({}); lockout is degraded", e.toString());
        }
    }

    private void clearFailures(String normalizedEmail) {
        try {
            redis.delete(failKey(normalizedEmail));
        } catch (DataAccessException e) {
            log.warn("[platform-auth] failure counter not cleared ({}); it will expire on its own", e.toString());
        }
    }
}
