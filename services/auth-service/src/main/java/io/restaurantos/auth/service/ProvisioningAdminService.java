package io.restaurantos.auth.service;

import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.repository.UserRepository;
import io.restaurantos.shared.security.JwtClaims;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.util.UUID;

/**
 * Handles provisioning-time and impersonation operations for platform-admin service (FD-1).
 * All endpoints are under /internal/auth/** — gated by InternalServiceFilter (03-03 gate, reused).
 */
@Service
public class ProvisioningAdminService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final PermissionResolver permissionResolver;
    private final JwtSigningService jwtSigningService;

    public ProvisioningAdminService(UserRepository userRepository,
                                    PasswordEncoder passwordEncoder,
                                    PermissionResolver permissionResolver,
                                    JwtSigningService jwtSigningService) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.permissionResolver = permissionResolver;
        this.jwtSigningService = jwtSigningService;
    }

    /**
     * Creates the initial Tenant Admin user in auth_db for the given tenant (FD-1 step 3).
     * Generates a temporary password; the user must change it on first login (mustChangePassword=true).
     * Returns {userId, tempPassword} — tempPassword is returned once and never stored plaintext.
     */
    @Transactional
    public ProvisionAdminResult provisionAdmin(UUID tenantId, String email) {
        // Generate temp password
        String tempPassword = generateTempPassword();

        UserEntity user = new UserEntity();
        user.setId(UUID.randomUUID());
        user.setTenantId(tenantId);
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode(tempPassword));
        user.setMustChangePassword(true);
        user.setActive(true);
        user.setTotpEnabled(false);
        user.setFailedLoginCount(0);
        userRepository.saveAndFlush(user);

        return new ProvisionAdminResult(user.getId(), tempPassword);
    }

    /**
     * Issues a service JWT for server-initiated internal calls (Doc 4 §4.1).
     * TTL defaults to 5 minutes; the token has roles=["INTERNAL_SERVICE"].
     */
    public String signServiceToken(String service) {
        return jwtSigningService.signServiceToken(service, Duration.ofSeconds(300));
    }

    /**
     * Issues a 30-minute impersonation JWT stamped with impersonated_by (PLATFORM-05).
     * Loads the target user's active branch/permissions via PermissionResolver.
     * The token is NOT refreshable — expiry is hard-set at issuance.
     */
    public ImpersonateResult impersonate(UUID targetUserId, UUID impersonatedBy, int expiresInSeconds) {
        UserEntity target = userRepository.findById(targetUserId)
            .orElseThrow(() -> new IllegalArgumentException("Target user not found: " + targetUserId));

        ResolvedBranchAuth auth;
        try {
            auth = permissionResolver.resolveDefault(targetUserId);
        } catch (IllegalStateException e) {
            // User has no branch assignments yet — issue minimal impersonation token
            auth = new ResolvedBranchAuth(null, java.util.List.of(), java.util.List.of(), java.util.Map.of());
        }

        UUID branchId = auth.branchId() != null ? auth.branchId() : UUID.fromString("00000000-0000-0000-0000-000000000000");
        JwtClaims targetClaims = new JwtClaims(
            target.getId(),
            target.getTenantId(),
            branchId,
            auth.roles(),
            auth.permissions(),
            auth.attributes(),
            null
        );

        Duration ttl = Duration.ofSeconds(expiresInSeconds);
        String token = jwtSigningService.signImpersonationToken(targetClaims, impersonatedBy, ttl);
        return new ImpersonateResult(token, expiresInSeconds);
    }

    private String generateTempPassword() {
        // 16-char alphanumeric random temp password
        String chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#";
        StringBuilder sb = new StringBuilder(16);
        java.util.Random rng = new java.security.SecureRandom();
        for (int i = 0; i < 16; i++) {
            sb.append(chars.charAt(rng.nextInt(chars.length())));
        }
        return sb.toString();
    }

    public record ProvisionAdminResult(UUID userId, String tempPassword) {}
    public record ImpersonateResult(String token, int expiresIn) {}
}
