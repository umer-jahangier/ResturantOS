package io.restaurantos.auth.service;

import io.restaurantos.auth.config.AuthJwtProperties;
import io.restaurantos.auth.dto.request.LoginRequest;
import io.restaurantos.auth.dto.response.LoginResponse;
import io.restaurantos.auth.dto.response.TokenResponse;
import io.restaurantos.auth.entity.AuthTenantEntity;
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
    private final boolean stepUpEnabled;

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
                           @Value("${restaurantos.auth.step-up-enabled:true}") boolean stepUpEnabled) {
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
        this.stepUpEnabled = stepUpEnabled;
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
            return platformLoginResult(verdict);
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
            return platformLoginResult(resolution.platform());
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
     * Mint the tenant-less control-plane token for a verified platform user.
     *
     * <p>No refresh session and no cookie, matching {@code POST /api/v1/platform/auth/login} exactly:
     * a control-plane token lives 15 minutes and has no renewal path, which is the only bound on a
     * leaked SuperAdmin credential while {@code platform_users} still has no second-factor column.
     * Issuing a 30-day refresh token here to make the console more comfortable would quietly remove
     * that bound.
     */
    private LoginResult platformLoginResult(io.restaurantos.auth.client.PlatformCredentialClient.Verdict verdict) {
        PlatformTokenService.PlatformTokenResult minted =
            platformTokenService.mint(verdict.platformUserId(), verdict.role());
        LoginResponse body = new LoginResponse(
            minted.token(), minted.expiresIn(), verdict.platformUserId(), null, null,
            minted.tokenType());
        return new LoginResult(body, null);
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
            return new LoginResult(body, refreshToken);
        } finally {
            tenantContext.clear();
        }
    }

    @Override
    @Transactional
    public TokenResponse refresh(String rawRefreshToken) {
        try {
            RefreshSessionEntity session = refreshSessionService.validate(rawRefreshToken);
            setTenantGuc(session.getTenantId());
            tenantContext.set(session.getTenantId(), session.getBranchId(), session.getUserId(), null);

            ResolvedBranchAuth resolved = permissionResolver.resolve(session.getUserId(), session.getBranchId());
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
            return new TokenResponse(accessToken, jwtProperties.getAccessTtlSeconds());
        } finally {
            tenantContext.clear();
        }
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
