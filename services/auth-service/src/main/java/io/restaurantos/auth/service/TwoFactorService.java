package io.restaurantos.auth.service;

import io.restaurantos.auth.dto.response.TotpSetupResponse;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.exception.AuthenticationFailedException;
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
