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
import io.restaurantos.auth.repository.AuthTenantRepository;
import io.restaurantos.auth.repository.UserRepository;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
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

    public AuthServiceImpl(AuthTenantRepository authTenantRepository,
                           UserRepository userRepository,
                           EntityManager entityManager,
                           TenantContext tenantContext,
                           PasswordEncoder passwordEncoder,
                           PermissionResolver permissionResolver,
                           JwtSigningService jwtSigningService,
                           RefreshSessionService refreshSessionService,
                           LoginEventPublisher loginEventPublisher,
                           AuthJwtProperties jwtProperties) {
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
    }

    @Override
    @Transactional(noRollbackFor = {AuthenticationFailedException.class, AccountLockedException.class})
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
            JwtClaims claims = new JwtClaims(
                user.getId(), tenantId, resolved.branchId(),
                resolved.roles(), resolved.permissions(), resolved.attributes(), null);
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

    private void setTenantGuc(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
    }
}
