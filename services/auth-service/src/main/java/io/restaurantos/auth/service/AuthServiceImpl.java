package io.restaurantos.auth.service;

import io.restaurantos.auth.client.PlatformCredentialClient;
import io.restaurantos.auth.config.AuthJwtProperties;
import io.restaurantos.auth.dto.request.LoginRequest;
import io.restaurantos.auth.dto.response.LoginResponse;
import io.restaurantos.auth.dto.response.TokenResponse;
import io.restaurantos.auth.entity.AuthTenantEntity;
import io.restaurantos.auth.entity.RefreshScope;
import io.restaurantos.auth.entity.RefreshSessionEntity;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.exception.AccountLockedException;
import io.restaurantos.auth.exception.AuthenticationFailedException;
import io.restaurantos.auth.exception.PasswordChangeRequiredException;
import io.restaurantos.auth.exception.TenantSelectionRequiredException;
import io.restaurantos.auth.exception.TotpEnrollmentRequiredException;
import io.restaurantos.auth.exception.TotpRequiredException;
import io.restaurantos.auth.repository.AuthTenantRepository;
import io.restaurantos.auth.repository.UserRepository;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class AuthServiceImpl implements AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthServiceImpl.class);

    /**
     * The reserved chooser value meaning "the platform console", used where a tenant slug would
     * otherwise go. Not a slug and deliberately not slug-shaped: {@code auth_tenants.slug} is
     * {@code varchar(100)} of the usual kebab-case, and a leading {@code @} cannot collide with one.
     */
    public static final String PLATFORM_CHOICE = "@platform";

    private static final int MAX_FAILED_ATTEMPTS = 5;
    /**
     * Compared against whenever no real hash is available, so a refusal costs the same time whether
     * or not the account exists. Package-visible since 16a-01 because {@link LoginIdentityResolver}
     * needs the SAME constant for the same reason on the unified path — a second dummy at a
     * different cost factor would reintroduce the timing difference both exist to remove.
     */
    static final String DUMMY_HASH =
        "$2a$12$HvDkD2g7oob7I/NXk3Oo/u6lcPoOVcBVa.Tb.dgQgCoiCua/fkII6";

    private final AuthTenantRepository authTenantRepository;
    private final UserRepository userRepository;
    private final EntityManager entityManager;
    private final TenantContext tenantContext;
    private final PasswordEncoder passwordEncoder;
    private final PermissionResolver permissionResolver;
    private final JwtSigningService jwtSigningService;
    private final RefreshSessionService refreshSessionService;
    private final LoginEventPublisher loginEventPublisher;
    private final AuthJwtProperties jwtProperties;
    private final TotpService totpService;
    private final PasswordPolicyService passwordPolicyService;
    private final LoginIdentityResolver loginIdentityResolver;
    private final PlatformTokenService platformTokenService;
    private final PlatformCredentialClient platformCredentialClient;
    private final boolean stepUpEnabled;
    /**
     * 30 minutes (16b-01), against the tenant path's 7 days — see {@link #platformLoginResult} for
     * why this number and not that one. A SEPARATE property rather than a reuse of
     * {@code refresh-ttl-seconds} precisely so that giving a control-plane session the tenant
     * lifetime would have to be someone typing 604800 into a field named for the platform.
     */
    private final long platformRefreshTtlSeconds;

    public AuthServiceImpl(AuthTenantRepository authTenantRepository,
                           UserRepository userRepository,
                           EntityManager entityManager,
                           TenantContext tenantContext,
                           PasswordEncoder passwordEncoder,
                           PermissionResolver permissionResolver,
                           JwtSigningService jwtSigningService,
                           RefreshSessionService refreshSessionService,
                           LoginEventPublisher loginEventPublisher,
                           AuthJwtProperties jwtProperties,
                           TotpService totpService,
                           PasswordPolicyService passwordPolicyService,
                           LoginIdentityResolver loginIdentityResolver,
                           PlatformTokenService platformTokenService,
                           PlatformCredentialClient platformCredentialClient,
                           @Value("${restaurantos.auth.step-up-enabled:true}") boolean stepUpEnabled,
                           @Value("${restaurantos.auth.platform-refresh-ttl-seconds:1800}")
                               long platformRefreshTtlSeconds) {
        this.authTenantRepository = authTenantRepository;
        this.userRepository = userRepository;
        this.entityManager = entityManager;
        this.tenantContext = tenantContext;
        this.passwordEncoder = passwordEncoder;
        this.permissionResolver = permissionResolver;
        this.jwtSigningService = jwtSigningService;
        this.refreshSessionService = refreshSessionService;
        this.loginEventPublisher = loginEventPublisher;
        this.jwtProperties = jwtProperties;
        this.totpService = totpService;
        this.passwordPolicyService = passwordPolicyService;
        this.loginIdentityResolver = loginIdentityResolver;
        this.platformTokenService = platformTokenService;
        this.platformCredentialClient = platformCredentialClient;
        this.stepUpEnabled = stepUpEnabled;
        this.platformRefreshTtlSeconds = platformRefreshTtlSeconds;
    }

    /**
     * {@code PasswordChangeRequiredException} is in {@code noRollbackFor} and it has to be. The
     * forced-change branch throws AFTER it has minted and persisted a change token and AFTER the
     * failed-login counter has been reset. Without it listed here, Spring would roll both writes
     * back on the way out, and the caller would receive a token that does not exist in the database
     * — a refusal that can never be satisfied, on every login, for every provisioned account.
     */
    @Override
    @Transactional(noRollbackFor = {AuthenticationFailedException.class, AccountLockedException.class,
        TotpRequiredException.class, PasswordChangeRequiredException.class,
        TenantSelectionRequiredException.class})
    public LoginResult login(LoginRequest request, String userAgent, String ip) {
        // A slug supplied by a subdomain or ?tenant= takes the path it always took, byte for byte.
        // The unified branch is reached only when the caller named no tenant, so 16a-01 cannot
        // change the behaviour of any existing client, script or test that names one.
        if (!request.hasTenantHint()) {
            return unifiedLogin(request, userAgent, ip);
        }
        // The chooser's platform option comes back here as the reserved value. It is routed to the
        // platform path rather than looked up in auth_tenants — where it would 401 as an unknown
        // slug and leave a SuperAdmin who picked the right option unable to sign in.
        //
        // It re-verifies the credential from scratch through platform-admin-service. Choosing an
        // option is not itself authorisation: the second request must earn its token exactly as the
        // first would have, which is also why no selection state is held between them.
        if (PLATFORM_CHOICE.equals(request.tenantHint())) {
            var verdict = loginIdentityResolver.verifyPlatformOnly(request.email(), request.password(), ip);
            if (!verdict.matched()) {
                throw new AuthenticationFailedException("Invalid credentials");
            }
            return platformLoginResult(verdict, userAgent, ip);
        }
        return loginToTenant(request.withTenantSlug(request.tenantHint()), userAgent, ip);
    }

    /**
     * Email-first login: verify the credential, THEN decide where it authenticated (16a-01).
     *
     * <h3>Why this resolves and then re-enters {@link #loginToTenant} rather than reimplementing it</h3>
     *
     * <p>Everything that makes a tenant login correct happens after the password check — the
     * deactivation refusal, the forced-password-change gate, the TOTP step-up, the failed-count
     * reset, the refresh session, the login-succeeded event. A unified path that duplicated any of
     * it would be a second credential path, and the recurring finding of the audit that produced
     * phase 13 is that two credential paths agree on day one and drift after. So this method does
     * exactly one thing — turn "no slug" into "this slug" — and then hands over.
     *
     * <p><b>The cost, stated:</b> the winning candidate's password is bcrypt-compared twice, once to
     * resolve and once to log in, so a unified login takes about twice as long as a slug-bearing one
     * (~500ms rather than ~250ms at cost 12). That is the price of having one credential path
     * instead of two, and it is the right trade: the alternative is a "trust me, it was already
     * checked" flag threaded into the login, which is precisely the kind of shortcut that later
     * becomes an authentication bypass when someone sets it from the wrong place.
     *
     * <h3>The four outcomes</h3>
     * <ul>
     *   <li><b>nothing matched</b> → the same generic {@code 401 UNAUTHENTICATED} an unknown address
     *       and a wrong password have always produced. Identical status, identical body;</li>
     *   <li><b>exactly one tenant</b> → re-enter the ordinary login with that slug;</li>
     *   <li><b>only the platform</b> → mint a tenant-less control-plane token here (auth-service
     *       already holds the key; PLATFORM-07 is satisfied because the CREDENTIAL was verified by
     *       platform-admin-service, not by this service);</li>
     *   <li><b>more than one</b> → {@link TenantSelectionRequiredException}, naming only the tenants
     *       that actually matched.</li>
     * </ul>
     */
    private LoginResult unifiedLogin(LoginRequest request, String userAgent, String ip) {
        LoginIdentityResolver.Resolution resolution;
        try {
            resolution = loginIdentityResolver.resolve(
                request.email(), request.password(), ip,
                // Lockout accounting for candidates whose password did not match, through the very
                // method the slug-bearing path uses. Without this, omitting the slug would be a
                // brute-force bypass — guesses that never increment a counter and never lock.
                this::handleFailedPassword);
        } finally {
            tenantContext.clear();
        }

        if (resolution.isEmpty()) {
            if (resolution.lockedMatch()) {
                // Reported only to a caller who has just PROVEN the password. Someone who has not
                // gets the generic refusal below, so this cannot be used to discover that an
                // address exists. Same rule as refuseDeactivatedAccount.
                throw new AccountLockedException("Account is temporarily locked");
            }
            // Audit line only — the address and the source, never the password. The RESPONSE
            // deliberately says nothing about how many candidates were considered, whether the
            // address is known anywhere, or whether the control plane was reachable.
            loginEventPublisher.logUnifiedRefusal(request.email(), ip);
            throw new AuthenticationFailedException("Invalid credentials");
        }

        if (resolution.isSolePlatform()) {
            return platformLoginResult(resolution.platform(), userAgent, ip);
        }

        if (resolution.isSoleTenant()) {
            return loginToTenant(
                request.withTenantSlug(resolution.matches().get(0).slug()), userAgent, ip);
        }

        throw new TenantSelectionRequiredException(chooserOptions(resolution));
    }

    /**
     * The chooser list.
     *
     * <p>Built ONLY from {@code resolution.matches()} — tenants whose stored hash the submitted
     * password matched. A tenant that holds the address under a different password is absent, and
     * absence here is indistinguishable from never having heard of the address.
     *
     * <p>A platform match alongside tenant matches is presented as one more option, because the
     * human's question ("which of these am I signing into?") is the same question. Its slug is the
     * reserved {@link #PLATFORM_CHOICE} rather than a tenant slug, which
     * {@link #loginToTenant} would never resolve — so a client echoing it back cannot accidentally
     * be routed into a tenant login.
     */
    private List<TenantSelectionRequiredException.Option> chooserOptions(
            LoginIdentityResolver.Resolution resolution) {
        List<TenantSelectionRequiredException.Option> options = new ArrayList<>();
        if (resolution.platform().matched()) {
            options.add(new TenantSelectionRequiredException.Option(
                PLATFORM_CHOICE, "RestaurantOS Platform Console"));
        }
        for (LoginIdentityResolver.TenantMatch match : resolution.matches()) {
            options.add(new TenantSelectionRequiredException.Option(
                match.slug(), match.name() != null ? match.name() : match.slug()));
        }
        return options;
    }

    /**
     * Mint the tenant-less control-plane token for a verified platform user, and open a SHORT-LIVED,
     * SINGLE-USE-ROTATING refresh session to go with it (16b-01).
     *
     * <h3>What this used to say, and why it changed</h3>
     *
     * <p>Until 16b-01 this method issued no refresh session at all, and the comment here said a
     * control-plane token "lives 15 minutes and has no renewal path, which is the only bound on a
     * leaked SuperAdmin credential while {@code platform_users} still has no second-factor column".
     * <b>That was true and it is no longer true</b>, so it is replaced rather than left standing: a
     * stale security comment is worse than none, because the next reader trusts it.
     *
     * <p>The half of it that remains true is the important half. {@code platform_users} STILL has no
     * TOTP column — {@link JwtSigningService#signPlatformToken} hard-codes {@code totp_verified:
     * false} for exactly that reason — so there is still no second factor behind a SuperAdmin
     * password.
     *
     * <p>What the old comment did not work through is the browser. It was written for 13-05, when
     * the SuperAdmin had no browser path at all; the platform console did not exist, so
     * "re-authenticate rather than refresh" cost nothing. Since 16a-01 and 19c it costs a full
     * password round trip on <b>every reload, every deep link and every new tab</b>, because the
     * access token is memory-only and there was nothing to rehydrate from. That is not a comfort
     * problem. A credential a human retypes a dozen times an hour is a credential that ends up in a
     * password manager's autofill, on a sticky note, or shoulder-surfed.
     *
     * <h3>The bound now, stated exactly</h3>
     *
     * <p>Not the 30-day refresh the old comment warned about — that number is 1,440× larger than the
     * one chosen and would genuinely have removed the bound. Instead:
     *
     * <ul>
     *   <li><b>{@code platform-refresh-ttl-seconds} = 1800 (30 minutes)</b>, against the tenant
     *       path's 7 days. A stolen cookie is worthless half an hour after the session goes idle;</li>
     *   <li><b>single-use rotation</b> — redeeming a platform refresh token revokes it and issues a
     *       new one, so a copied cookie and the genuine operator cannot both keep using it;</li>
     *   <li><b>reuse revokes the family</b> — a replayed token is refused AND every live session for
     *       that platform user is revoked ({@link #refresh}). The theft therefore costs the
     *       attacker the session and announces itself to the victim, rather than running quietly
     *       beside them.</li>
     * </ul>
     *
     * <p>So the exposure on a leaked SuperAdmin credential goes from "15 minutes, nothing to renew
     * with" to "30 minutes of idle life, renewable only by a party that has not been detected
     * racing the real operator". That is a deliberate, modest widening, accepted in exchange for a
     * console a human can actually use, and it is a bridge — <b>TOTP for {@code platform_users} is
     * the follow-up phase that replaces this reasoning with a real second factor.</b> Until it
     * lands, rotation-with-reuse-detection is the compensating control, not the TTL alone.
     *
     * <p>The cookie is written by {@link io.restaurantos.auth.controller.AuthController} with the
     * identical properties the tenant path uses — {@code HttpOnly}, {@code SameSite=Strict},
     * {@code Path=/api/v1/auth}, {@code Secure} per {@code cookieProperties} — differing only in
     * {@code Max-Age}, which carries the 30 minutes above.
     */
    private LoginResult platformLoginResult(
            io.restaurantos.auth.client.PlatformCredentialClient.Verdict verdict,
            String userAgent, String ip) {
        PlatformTokenService.PlatformTokenResult minted =
            platformTokenService.mint(verdict.platformUserId(), verdict.role());
        String refreshToken = refreshSessionService.issuePlatform(
            verdict.platformUserId(), platformRefreshTtlSeconds, userAgent, ip);
        LoginResponse body = new LoginResponse(
            minted.token(), minted.expiresIn(), verdict.platformUserId(), null, null,
            minted.tokenType());
        return new LoginResult(body, refreshToken, platformRefreshTtlSeconds);
    }

    /**
     * The original, unchanged tenant login. Every line below this point behaved exactly this way
     * before 16a-01; only its name changed, so that {@link #login} could branch above it.
     */
    private LoginResult loginToTenant(LoginRequest request, String userAgent, String ip) {
        try {
            AuthTenantEntity tenant = authTenantRepository.findBySlug(request.tenantSlug())
                .filter(t -> "ACTIVE".equals(t.getStatus()))
                .orElse(null);
            if (tenant == null) {
                if (authTenantRepository.findBySlug(request.tenantSlug()).isEmpty()) {
                    loginEventPublisher.logUnknownTenant(request.tenantSlug(), request.email(), ip);
                }
                throw new AuthenticationFailedException("Invalid credentials");
            }

            UUID tenantId = tenant.getId();
            setTenantGuc(tenantId);
            tenantContext.set(tenantId, null, null, null);

            // Tenant-scoped in the query as well as by the RLS policy — see
            // UserRepository.findByTenantAndEmail for why the policy alone was not enough.
            UserEntity user = userRepository
                .findByTenantAndEmail(tenantId, request.email().toLowerCase()).orElse(null);
            if (user == null) {
                passwordEncoder.matches(request.password(), DUMMY_HASH);
                loginEventPublisher.publishFailed(tenantId, null, request.email(), ip);
                throw new AuthenticationFailedException("Invalid credentials");
            }

            if (user.getLockedUntil() != null && user.getLockedUntil().isAfter(Instant.now())) {
                loginEventPublisher.publishFailed(tenantId, user.getId(), request.email(), ip);
                throw new AccountLockedException("Account is temporarily locked");
            }

            if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
                handleFailedPassword(user, tenantId, request.email(), ip);
                throw new AuthenticationFailedException("Invalid credentials");
            }

            refuseDeactivatedAccount(user, tenantId, request.email(), ip);

            user.setFailedLoginCount(0);
            user.setLockedUntil(null);
            user.setLastLoginAt(Instant.now());
            userRepository.save(user);

            enforceForcedPasswordChange(user, tenantId, request.email(), ip);

            ResolvedBranchAuth resolved = permissionResolver.resolveDefault(user.getId());
            boolean totpVerified =
                enforceTotpStepUp(user, request, resolved.permissions(), tenantId, request.email(), ip);

            JwtClaims claims = new JwtClaims(
                user.getId(), tenantId, resolved.branchId(),
                resolved.roles(), resolved.permissions(), resolved.attributes(), null, totpVerified);
            String accessToken = jwtSigningService.signAccessToken(claims);
            tenantContext.set(tenantId, resolved.branchId(), user.getId(), null);

            String refreshToken = refreshSessionService.issue(
                user.getId(), tenantId, resolved.branchId(), userAgent, ip);
            loginEventPublisher.publishSucceeded(tenantId, resolved.branchId(), user.getId(), request.email(), ip);

            LoginResponse body = new LoginResponse(
                accessToken, jwtProperties.getAccessTtlSeconds(),
                user.getId(), tenantId, resolved.branchId());
            return new LoginResult(body, refreshToken, jwtProperties.getRefreshTtlSeconds());
        } finally {
            tenantContext.clear();
        }
    }

    /**
     * Exchange a refresh token for a new access token.
     *
     * <h3>The one invariant this method exists to hold (16b-01)</h3>
     *
     * <p><b>A platform refresh token may mint ONLY a platform token, and a tenant refresh token may
     * mint ONLY a tenant token.</b> Since 16b-01 both kinds of session live in {@code
     * refresh_sessions}, so this is the single place where a mix-up could happen and the single
     * place it is prevented. The branch is on the explicit {@code scope} column and happens BEFORE
     * anything else reads the session — no permission resolution, no tenant GUC, no claim
     * construction runs until the kind of session is settled.
     *
     * <p>Three independent things have to fail together for a cross-mint:
     * <ol>
     *   <li>this branch, which reads a NOT NULL discriminator;</li>
     *   <li>{@code chk_refresh_sessions_scope} (changeset 084), which makes a row whose {@code scope}
     *       and {@code tenant_id} disagree unstorable;</li>
     *   <li>the RLS policy, under which a tenant-context read cannot see a platform row at all
     *       (its tenant is a sentinel no real tenant holds) and vice versa.</li>
     * </ol>
     *
     * <p>The tenant branch below is byte-for-byte what it was before 16b-01, including the
     * deliberate dropping of the step-up marker and the absence of rotation. Rotating tenant tokens
     * is a separate decision with its own multi-tab failure modes; this phase does not take it.
     */
    /**
     * <h3>{@code noRollbackFor} is load-bearing, and it was a live defect without it</h3>
     *
     * <p>{@link #refreshPlatform} responds to a detected token replay by revoking every live session
     * for that platform user and THEN refusing. {@code AuthenticationFailedException} is a
     * {@code RuntimeException}, so without this attribute Spring rolls the transaction back on the
     * way out and <b>un-revokes the sessions the method just revoked</b> — leaving the reuse
     * detection as a log line and a 401 with no effect on the credential that was replayed.
     *
     * <p>Measured, not theorised. Against the live stack, before this was added: replaying a spent
     * token correctly returned 401, and its successor then still returned <b>200</b>. The alarm
     * fired and nothing happened. The same shape as the {@code PasswordChangeRequiredException}
     * entry on {@link #login} above, and found the same way — by exercising the real thing rather
     * than by a test. No unit test could have caught it: mocks record that the revocation was
     * called, which it was.
     */
    @Override
    @Transactional(noRollbackFor = AuthenticationFailedException.class)
    public RefreshResult refresh(String rawRefreshToken) {
        RefreshSessionEntity peek = refreshSessionService.findForRedemption(rawRefreshToken)
            .orElseThrow(() -> new AuthenticationFailedException("Invalid refresh session"));
        if (RefreshScope.isPlatform(peek)) {
            return refreshPlatform(rawRefreshToken, peek);
        }
        try {
            RefreshSessionEntity session = refreshSessionService.validate(rawRefreshToken);
            setTenantGuc(session.getTenantId());
            tenantContext.set(session.getTenantId(), session.getBranchId(), session.getUserId(), null);

            ResolvedBranchAuth resolved = resolveForSession(session);
            // totp_verified is deliberately NOT carried across refresh (the 7-arg constructor mints
            // it false). A refresh token lives 30 days; an access token lives 1 hour. Re-minting the
            // step-up marker here would bind an hour-grade proof of possession to a month-long
            // bearer credential, so a stolen refresh token would silently regain the payroll-approval
            // capability this gate exists to withhold. A step-up-gated action after the access token
            // has rotated costs one re-login with a code — which is what step-up means.
            JwtClaims claims = new JwtClaims(
                session.getUserId(), session.getTenantId(), resolved.branchId(),
                resolved.roles(), resolved.permissions(), resolved.attributes(), null);
            String accessToken = jwtSigningService.signAccessToken(claims);
            // No rotated token: the tenant path's refresh cookie is unchanged by a refresh, exactly
            // as it was before 16b-01. AuthController writes no Set-Cookie when this is null.
            return new RefreshResult(
                new TokenResponse(accessToken, jwtProperties.getAccessTtlSeconds()), null, 0);
        } finally {
            tenantContext.clear();
        }
    }

    /**
     * Resolve the session's active branch, refusing rather than exploding when that branch is no
     * longer the user's to work on.
     *
     * <h3>Why this is not just the {@code permissionResolver.resolve} call it replaced</h3>
     *
     * <p>{@code PermissionResolver.resolveAtBranch} throws {@link IllegalStateException} when a user
     * has no active assignment at the branch it is asked about — correct for its other callers,
     * where being asked about a branch the user cannot work on is a programming error. On THIS path
     * it is an ordinary event: a session stores a branch, and an administrator may revoke that
     * assignment at any time afterwards. The result was a bare {@code 500 INTERNAL_ERROR} on
     * {@code POST /auth/refresh}, i.e. on every page load, measured against the live stack:
     * grant a second branch, switch to it, revoke it, reload → 500.
     *
     * <p>The honest answer is 401. The session's stored branch is a fact about the past; the
     * assignment is the authority, and once it is gone this credential no longer entitles the
     * holder to anything at that branch. {@code AuthenticationFailedException} is what the SPA and
     * every other client already handle — the bootstrap clears the session and sends the user to
     * sign in, and they come back on whatever branch they still hold.
     *
     * <p>Deliberately NOT a silent fallback to the user's default branch. Quietly re-pointing a
     * session at a different branch than the one it was on is the exact failure S1-16 exists to
     * remove; doing it here in the name of robustness would reintroduce it through the back door.
     *
     * <p>The exception is caught by type rather than pre-checked with a second query so that this
     * cannot drift out of agreement with the resolver's own rule about what "assigned" means. The
     * cause is logged rather than wrapped because {@code AuthenticationFailedException} carries no
     * cause constructor — and the reason a user was signed out must not be inferable only from a
     * stack trace nobody keeps.
     */
    private ResolvedBranchAuth resolveForSession(RefreshSessionEntity session) {
        try {
            return permissionResolver.resolve(session.getUserId(), session.getBranchId());
        } catch (IllegalStateException e) {
            log.warn("Refusing refresh for user {}: session branch {} is no longer assigned ({})",
                session.getUserId(), session.getBranchId(), e.getMessage());
            throw new AuthenticationFailedException("Session branch is no longer assigned to this user");
        }
    }

    /**
     * Redeem a platform refresh token: single use, rotate, and treat a replay as a compromise
     * (16b-01).
     *
     * <h3>Order of operations, and why it is this order</h3>
     *
     * <ol>
     *   <li><b>Expiry first.</b> An expired token is refused as expired. Checked before the
     *       spend attempt so that a token which simply timed out is never misreported as a replay,
     *       and never triggers the family revocation below — that alarm has to mean something.</li>
     *   <li><b>Spend it, atomically.</b> {@code claimForRotation} is a single conditional UPDATE
     *       ({@code ... WHERE token_hash = ? AND revoked_at IS NULL}). Exactly one caller can win
     *       it. A read-then-write here would let two concurrent redemptions of the same token both
     *       succeed, which is the replay this method refuses, passing silently under load.</li>
     *   <li><b>Losing the race IS the detection.</b> The token exists (step 1 found the row) and was
     *       already spent, so it has been presented twice. One of the two presenters is not the
     *       operator. There is no way to tell which, so BOTH lose: every live platform session for
     *       this user is revoked, and this call is refused.</li>
     *   <li>Only then mint, and open the successor session.</li>
     * </ol>
     *
     * <p>The refusal is the same generic {@code AuthenticationFailedException} every other failure
     * uses. The detail — that this was a replay and what it cost — goes to the log, not to the
     * caller: an attacker holding a stolen cookie learns nothing from the response about whether
     * they were detected.
     */
    private RefreshResult refreshPlatform(String rawRefreshToken, RefreshSessionEntity session) {
        if (session.getExpiresAt().isBefore(Instant.now())) {
            throw new AuthenticationFailedException("Invalid refresh session");
        }

        if (!refreshSessionService.claimForRotation(rawRefreshToken)) {
            int revoked = refreshSessionService.revokeAllLiveSessions(
                session.getUserId(), RefreshScope.PLATFORM);
            log.warn("[platform-refresh] REUSE DETECTED for platform user {} — a refresh token was "
                + "presented after it had already been redeemed. Revoked {} live platform "
                + "session(s); the operator and any holder of the copied cookie must both "
                + "re-authenticate.", session.getUserId(), revoked);
            throw new AuthenticationFailedException("Invalid refresh session");
        }

        // Is this operator still allowed to hold a token AT ALL, and as what?
        //
        // Asked on every rotation, of the control plane, because a rotating session never logs in
        // again — so verifyCredential's is_active check, the ONLY thing that has ever ended a
        // deactivated SuperAdmin's access, would otherwise never run for them again. The role comes
        // back from platform_db rather than from this row, so a demotion takes effect at the next
        // rotation instead of being frozen for the life of the session. Fails closed on an outage:
        // see PlatformCredentialClient.standing for why that is right HERE and wrong on login.
        //
        // Note the ordering: the old token has ALREADY been spent above. A refusal here therefore
        // leaves the session dead rather than replayable, which is the safe direction — a revoked
        // operator does not get to keep the token they just presented.
        PlatformCredentialClient.Standing standing =
            platformCredentialClient.standing(session.getUserId());
        if (!standing.renewable()) {
            refreshSessionService.revokeAllLiveSessions(session.getUserId(), RefreshScope.PLATFORM);
            log.warn("[platform-refresh] renewal refused by the control plane for platform user {}; "
                + "all live platform sessions revoked", session.getUserId());
            throw new AuthenticationFailedException("Invalid refresh session");
        }

        // mint() re-validates the role against the three values chk_platform_users_role permits, so
        // a role that could not exist in platform_db cannot be renewed into existence here either.
        PlatformTokenService.PlatformTokenResult minted =
            platformTokenService.mint(session.getUserId(), standing.role());

        String rotated = refreshSessionService.issuePlatform(
            session.getUserId(), platformRefreshTtlSeconds, session.getUserAgent(), session.getIp());

        return new RefreshResult(
            new TokenResponse(minted.token(), minted.expiresIn()),
            rotated,
            platformRefreshTtlSeconds);
    }

    @Override
    @Transactional
    public void logout(String rawRefreshToken) {
        if (rawRefreshToken == null || rawRefreshToken.isBlank()) {
            return;
        }
        try {
            RefreshSessionEntity session = refreshSessionService.validate(rawRefreshToken);
            setTenantGuc(session.getTenantId());
            refreshSessionService.revoke(rawRefreshToken);
        } catch (IllegalArgumentException ignored) {
            refreshSessionService.revoke(rawRefreshToken);
        } finally {
            tenantContext.clear();
        }
    }

    /**
     * A deactivated (or tombstoned) account does not get a token — 13-11, and it was a live defect.
     *
     * <p>{@code users.is_active} has existed since changeset 020 and <b>login never read it</b>.
     * Deactivating a user therefore did nothing to their ability to log in; only revoking their
     * refresh sessions did, and that merely shortened the window to the next successful password
     * login. 13-11 makes deactivation the way a tenant removes someone's access, so the flag has to
     * mean something. Found by reading this method while writing the deactivate operation, not by a
     * test — no test asserted it, because until now nothing set the flag.
     *
     * <h2>Why it runs AFTER the password comparison</h2>
     *
     * <p>Placed before it, a deactivated account would be refused without a bcrypt hash ever being
     * computed, and the several-hundred-millisecond difference is a reliable oracle for
     * "this address had an account here and it was switched off" — usable by anyone, with no
     * credential at all. This method is only reached once the password has been verified, so the
     * work done is identical either way. The message is the same {@code "Invalid credentials"}
     * every other refusal uses, for the same reason.
     *
     * <p>The failure IS published, with the user id, because unlike a wrong password this one names
     * a real account whose correct password someone just supplied — which is exactly the event an
     * operator wants to see after removing an employee.
     *
     * <p>{@code deleted_at} is checked alongside {@code is_active}: changeset 058's duplicate repair
     * tombstones rows without deactivating anything else about them, and a tombstone must not be an
     * account.
     */
    private void refuseDeactivatedAccount(UserEntity user, UUID tenantId, String email, String ip) {
        if (user.isActive() && !user.isDeleted()) {
            return;
        }
        loginEventPublisher.publishFailed(tenantId, user.getId(), email, ip);
        throw new AuthenticationFailedException("Invalid credentials");
    }

    private void handleFailedPassword(UserEntity user, UUID tenantId, String email, String ip) {
        int failures = user.getFailedLoginCount() + 1;
        user.setFailedLoginCount(failures);
        if (failures >= MAX_FAILED_ATTEMPTS) {
            user.setLockedUntil(Instant.now().plusSeconds(15 * 60L));
            user.setFailedLoginCount(0);
        }
        userRepository.save(user);
        loginEventPublisher.publishFailed(tenantId, user.getId(), email, ip);
    }

    /**
     * Verifies email/password/tenant for the unauthenticated TOTP bootstrap and returns the user,
     * applying the same tenant resolution, RLS GUC, lockout check and failure accounting as
     * {@link #login}. Extracted rather than reimplemented so the bootstrap can never drift into a
     * weaker check than the login it stands in for.
     */
    @Override
    @Transactional(noRollbackFor = {AuthenticationFailedException.class, AccountLockedException.class})
    public UserEntity authenticateForTotpBootstrap(String tenantSlug, String email, String password, String ip) {
        AuthTenantEntity tenant = authTenantRepository.findBySlug(tenantSlug)
            .filter(t -> "ACTIVE".equals(t.getStatus()))
            .orElseThrow(() -> new AuthenticationFailedException("Invalid credentials"));

        UUID tenantId = tenant.getId();
        setTenantGuc(tenantId);
        tenantContext.set(tenantId, null, null, null);

        // Same two-control lookup as login: the bootstrap stands in for a login and must not be
        // reachable through a weaker check than the one it replaces.
        UserEntity user = userRepository.findByTenantAndEmail(tenantId, email.toLowerCase()).orElse(null);
        if (user == null) {
            passwordEncoder.matches(password, DUMMY_HASH);
            loginEventPublisher.publishFailed(tenantId, null, email, ip);
            throw new AuthenticationFailedException("Invalid credentials");
        }
        if (user.getLockedUntil() != null && user.getLockedUntil().isAfter(Instant.now())) {
            throw new AccountLockedException("Account is temporarily locked");
        }
        if (!passwordEncoder.matches(password, user.getPasswordHash())) {
            handleFailedPassword(user, tenantId, email, ip);
            throw new AuthenticationFailedException("Invalid credentials");
        }
        // Same refusal as login, in the same position, for the reason this method's javadoc gives:
        // a bootstrap that accepted a deactivated account would let a removed employee enrol a
        // second factor on it, which is a stronger foothold than the login it stands in for.
        refuseDeactivatedAccount(user, tenantId, email, ip);
        return user;
    }

    private void setTenantGuc(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
    }

    /**
     * The forced-change gate (D-17).
     *
     * <p>Before this plan {@code must_change_password} was written at provisioning and read
     * nowhere, so every temporary credential the platform issued was a permanent one. 13-06 sets
     * the flag on every provisioned admin and 13-11 sets it on every created user, which without
     * this method would make it universally set and universally inert.
     *
     * <p><b>Where this sits in the sequence is the whole design, so it is spelled out.</b>
     *
     * <ul>
     *   <li><b>After the password comparison</b>, and after the failed-count reset. This is what
     *       stops the flag being an account-existence oracle: an attacker who guesses wrong gets
     *       the ordinary generic 401 whether the account is flagged, unflagged or absent. Only
     *       someone who already knows the password learns that a change is due, and they could have
     *       logged in anyway.</li>
     *   <li><b>Before {@code permissionResolver.resolveDefault}</b>. A freshly provisioned user
     *       whose branch assignment somehow did not land would otherwise die with "user has no
     *       active branch assignments" — and 13-CONTEXT's entire complaint is that a bad password,
     *       a missing assignment and a stale temporary credential were previously indistinguishable
     *       to an operator. Refusing here means the forced-change answer is never masked by an
     *       unrelated failure, and (because a missing assignment still surfaces on the NEXT login)
     *       nothing is hidden either.</li>
     *   <li><b>Before the TOTP step-up gate</b>, which necessarily runs after permission
     *       resolution. An account can genuinely need both — a provisioned OWNER holds
     *       {@code rbac.manage} with no enrolled factor (D-29a) and also carries the change flag.
     *       It meets them one at a time and in this order: {@code 403 PASSWORD_CHANGE_REQUIRED}
     *       first, then, once the password is its own, {@code 401 TOTP_ENROLLMENT_REQUIRED} on the
     *       next attempt. That order is the right one — enrolling a second factor while the first
     *       is still a temporary password known to whoever provisioned the account binds the factor
     *       under a credential the user does not exclusively control.</li>
     * </ul>
     *
     * <p>The login-succeeded event still fires, because the credential really was correct. Treating
     * a forced change as a failed login would inflate the lockout counter this method has just
     * reset — locking users out for doing exactly what they were told — and would put a lie in the
     * audit trail.
     *
     * @throws PasswordChangeRequiredException carrying a fresh single-use change token; no access
     *         token, no refresh session and no cookie are produced, because the method that would
     *         create them is never reached
     */
    private void enforceForcedPasswordChange(UserEntity user, UUID tenantId, String email, String ip) {
        if (!user.isMustChangePassword()) {
            return;
        }
        PasswordPolicyService.IssuedToken changeToken = passwordPolicyService.issueSingleUseToken(
            tenantId, user.getId(), PasswordPolicyService.TokenPurpose.FORCED_CHANGE);
        loginEventPublisher.publishSucceeded(tenantId, null, user.getId(), email, ip);
        throw new PasswordChangeRequiredException(changeToken.rawToken(), changeToken.expiresAt());
    }

    /**
     * @return true only when a TOTP code was actually presented and verified during this login.
     *         That boolean is the sole source of the {@code totp_verified} access-token claim, so
     *         "step-up was not required" and "step-up was disabled" both correctly yield false —
     *         a token may only claim a second factor that really happened.
     */
    private boolean enforceTotpStepUp(UserEntity user, LoginRequest request, List<String> permissions,
                                      UUID tenantId, String email, String ip) {
        if (!stepUpEnabled || !requiresTotpStepUp(permissions, user.isTotpEnabled())) {
            return false;
        }
        // No secret at all is a different situation from a missing or wrong code: the user cannot
        // produce a code from anything, and answering "TOTP code required" sends them to a prompt
        // with no way out. Point them at enrolment instead.
        if (user.getTotpSecret() == null) {
            loginEventPublisher.publishFailed(tenantId, user.getId(), email, ip);
            // The slug rides along so the client can actually reach /2fa/bootstrap, which requires
            // one — see TotpEnrollmentRequiredException's javadoc for why the browser has none of
            // its own after 16a-01, and for the disclosure rule that makes this safe here.
            // `request` is guaranteed to carry it: loginToTenant is only ever entered with an
            // explicit slug (the unified path re-enters via withTenantSlug).
            throw new TotpEnrollmentRequiredException(
                "Two-factor authentication is required for this account but has not been set up",
                request.tenantSlug());
        }
        if (request.totpCode() == null
            || request.totpCode().isBlank()
            || !totpService.verify(user.getTotpSecret(), request.totpCode())) {
            loginEventPublisher.publishFailed(tenantId, user.getId(), email, ip);
            throw new TotpRequiredException("TOTP code required");
        }
        return true;
    }

    /**
     * Which logins must present a second factor.
     *
     * <p>Every code listed here is one that some downstream service refuses to honour without a
     * verified step-up, so the two lists have to agree: a permission gated downstream but missing
     * here produces a holder who is challenged for nothing and can therefore never perform the
     * action, and a permission listed here but gated nowhere is pure friction.
     *
     * <p>{@code hr.payroll.approve} joins the list because hr-service refuses payroll approval
     * without step-up. It is granted to OWNER and TENANT_ADMIN only, and both already hold
     * {@code finance.period.close} (030 grants TENANT_ADMIN every permission except
     * {@code rbac.manage}), so no user is newly forced into TOTP by this line — it changes the
     * reason existing step-up users are challenged, not who is challenged.
     *
     * <p>Deliberately NOT added: {@code finance.expense.approve}, {@code vendor.po.approve} and
     * {@code pos.order.refund}. They are money-adjacent, but MANAGER and CASHIER hold them, no
     * service gates them on step-up, and those personas are seeded with no TOTP secret — listing
     * them would throw {@link TotpEnrollmentRequiredException} at every manager and cashier login
     * for a gate that does not exist downstream. Gate them downstream first, then add them here.
     */
    private static boolean requiresTotpStepUp(List<String> permissions, boolean totpEnabled) {
        return totpEnabled
            || permissions.contains("rbac.manage")
            || permissions.contains("finance.period.close")
            || permissions.contains("hr.payroll.approve");
    }
}
