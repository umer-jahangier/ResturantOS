package io.restaurantos.auth.service;

import io.restaurantos.auth.dto.response.TotpSetupResponse;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.exception.AuthenticationFailedException;
import io.restaurantos.auth.exception.TotpAlreadyEnrolledException;
import io.restaurantos.auth.repository.UserRepository;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class TwoFactorService {

    private final UserRepository userRepository;
    private final TotpService totpService;
    private final TenantContext tenantContext;
    private final EntityManager entityManager;

    public TwoFactorService(UserRepository userRepository,
                            TotpService totpService,
                            TenantContext tenantContext,
                            EntityManager entityManager) {
        this.userRepository = userRepository;
        this.totpService = totpService;
        this.tenantContext = tenantContext;
        this.entityManager = entityManager;
    }

    @Transactional
    public TotpSetupResponse setup() {
        UserEntity user = loadCurrentUser();
        String secret = totpService.generateSecret();
        user.setTotpSecret(secret);
        user.setTotpEnabled(false);
        userRepository.save(user);
        return new TotpSetupResponse(totpService.otpauthUri(secret, user.getEmail()));
    }

    @Transactional
    public void verify(String code) {
        UserEntity user = loadCurrentUser();
        if (user.getTotpSecret() == null || !totpService.verify(user.getTotpSecret(), code)) {
            throw new AuthenticationFailedException("Invalid TOTP code");
        }
        user.setTotpEnabled(true);
        userRepository.save(user);
    }

    /**
     * Issues a TOTP secret to a user who is required to use one but has never enrolled, proving
     * identity with the password rather than a bearer token.
     *
     * <p>{@code AuthServiceImpl.enforceTotpStepUp} demands a code from anyone holding
     * {@code rbac.manage} or {@code finance.period.close} — whether or not they ever enrolled — and
     * {@code /2fa/setup} needs a session to reach. A freshly provisioned OWNER therefore held both
     * halves of a deadlock: no token without a code, no code without a token, and no way to enrol.
     * That is not a theoretical state; two of the three seeded tenant owners were in it.
     *
     * <p>This is the only enrolment path that does not need a session, so it is deliberately
     * narrow: it refuses outright once a secret exists. Re-enrolment stays behind
     * {@link #setup()}, where a live token is required — otherwise a stolen password would be
     * enough to re-point someone's second factor, and the second factor would be worth nothing.
     */
    @Transactional
    public TotpSetupResponse bootstrap(UserEntity user) {
        if (user.getTotpSecret() != null) {
            throw new TotpAlreadyEnrolledException("Two-factor authentication is already set up");
        }
        String secret = totpService.generateSecret();
        user.setTotpSecret(secret);
        user.setTotpEnabled(false);
        userRepository.save(user);
        return new TotpSetupResponse(totpService.otpauthUri(secret, user.getEmail()));
    }

    /** Activates a secret issued by {@link #bootstrap}, again on the strength of the password. */
    @Transactional
    public void bootstrapVerify(UserEntity user, String code) {
        if (user.getTotpSecret() == null || !totpService.verify(user.getTotpSecret(), code)) {
            throw new AuthenticationFailedException("Invalid TOTP code");
        }
        user.setTotpEnabled(true);
        userRepository.save(user);
    }

    @Transactional
    public void disable(String code) {
        UserEntity user = loadCurrentUser();
        if (user.getTotpSecret() == null || !totpService.verify(user.getTotpSecret(), code)) {
            throw new AuthenticationFailedException("Invalid TOTP code");
        }
        user.setTotpSecret(null);
        user.setTotpEnabled(false);
        userRepository.save(user);
    }

    private UserEntity loadCurrentUser() {
        UUID userId = currentUserId();
        return userRepository.findById(userId)
            .orElseThrow(() -> new AuthenticationFailedException("User not found"));
    }

    private UUID currentUserId() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof JwtClaims claims)) {
            throw new AuthenticationFailedException("Not authenticated");
        }
        tenantContext.set(claims.tenantId(), claims.branchId(), claims.subject(), claims.impersonatedBy());
        if (claims.tenantId() != null) {
            entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
                .setParameter("tid", claims.tenantId().toString())
                .getSingleResult();
        }
        return claims.subject();
    }
}
