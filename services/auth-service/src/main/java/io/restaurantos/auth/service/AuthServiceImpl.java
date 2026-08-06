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
import java.util.List;
import java.util.UUID;

@Service
public class AuthServiceImpl implements AuthService {

    private static final int MAX_FAILED_ATTEMPTS = 5;
    private static final String DUMMY_HASH =
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
        this.stepUpEnabled = stepUpEnabled;
    }

    @Override
    @Transactional(noRollbackFor = {AuthenticationFailedException.class, AccountLockedException.class, TotpRequiredException.class})
    public LoginResult login(LoginRequest request, String userAgent, String ip) {
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

            UserEntity user = userRepository.findByEmail(request.email().toLowerCase()).orElse(null);
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

            user.setFailedLoginCount(0);
            user.setLockedUntil(null);
            user.setLastLoginAt(Instant.now());
            userRepository.save(user);

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

        UserEntity user = userRepository.findByEmail(email.toLowerCase()).orElse(null);
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
        return user;
    }

    private void setTenantGuc(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
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
            throw new TotpEnrollmentRequiredException(
                "Two-factor authentication is required for this account but has not been set up");
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
