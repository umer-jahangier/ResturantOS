package io.restaurantos.auth.service;

import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.repository.UserRepository;
import io.restaurantos.shared.security.JwtClaims;
import jakarta.persistence.EntityManager;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
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
    private final EntityManager entityManager;

    public ProvisioningAdminService(UserRepository userRepository,
                                    PasswordEncoder passwordEncoder,
                                    PermissionResolver permissionResolver,
                                    JwtSigningService jwtSigningService,
                                    EntityManager entityManager) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.permissionResolver = permissionResolver;
        this.jwtSigningService = jwtSigningService;
        this.entityManager = entityManager;
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
    @Transactional
    public ImpersonateResult impersonate(UUID tenantId, UUID targetUserId, UUID impersonatedBy, int expiresInSeconds) {
        // RLS tenant GUC MUST be set as the first statement inside this transaction, before
        // findById, so the GUC and the RLS-scoped SELECT share one connection (2099ac0 bug class).
        if (tenantId != null) {
            setTenantGuc(tenantId);
        }

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

    private void setTenantGuc(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
    }

    // Ambiguous glyphs (I/l/1, O/0) are excluded throughout: these are read off a screen and typed
    // by hand, often from a support call, and a temp password that cannot be transcribed reliably
    // generates exactly the reset request it was meant to avoid.
    private static final String UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
    private static final String LOWER = "abcdefghjkmnpqrstuvwxyz";
    private static final String DIGIT = "23456789";
    private static final String SYMBOL = "!@#$%&*?";
    private static final String ALL = UPPER + LOWER + DIGIT + SYMBOL;
    private static final int TEMP_PASSWORD_LENGTH = 16;

    /**
     * A temporary password that satisfies {@code @StrongPassword} by construction.
     *
     * <p>The previous version drew all 16 characters uniformly from one alphabet that contained
     * just three symbols. That does not guarantee the required character classes — measured over
     * 200k draws, roughly 42% of outputs contained no symbol at all. It did not matter while the
     * only consumer wrote a bcrypt hash straight to the database, because no validator ever saw the
     * value. It matters as soon as a temp password is handed to a user who must then submit it
     * through the forced-change or reset endpoints, where the shared constraint applies: a
     * coin-flip's worth of provisioned admins would have been issued a credential the platform's
     * own API rejects.
     *
     * <p>So one character is drawn from each required class first, the remainder from the union,
     * and the result is shuffled with the same {@link SecureRandom} — without the shuffle the class
     * of each leading character would be fixed and the search space correspondingly smaller.
     */
    // Package-private and static so the policy-compliance property can be asserted over many
    // draws without a Spring context or a database. A single sample proves nothing about a
    // generator that used to fail roughly two times in five.
    static String generateTempPassword() {
        SecureRandom rng = new SecureRandom();
        List<Character> chars = new ArrayList<>(TEMP_PASSWORD_LENGTH);
        for (String required : List.of(UPPER, LOWER, DIGIT, SYMBOL)) {
            chars.add(required.charAt(rng.nextInt(required.length())));
        }
        while (chars.size() < TEMP_PASSWORD_LENGTH) {
            chars.add(ALL.charAt(rng.nextInt(ALL.length())));
        }
        Collections.shuffle(chars, rng);

        StringBuilder sb = new StringBuilder(TEMP_PASSWORD_LENGTH);
        chars.forEach(sb::append);
        return sb.toString();
    }

    public record ProvisionAdminResult(UUID userId, String tempPassword) {}
    public record ImpersonateResult(String token, int expiresIn) {}
}
