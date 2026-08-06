package io.restaurantos.auth.service;

import io.restaurantos.auth.dto.request.BranchRoleAssignRequest;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.repository.UserRepository;
import io.restaurantos.shared.exception.StateInvalidException;
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
import java.util.Locale;
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
    private final BranchRoleAdminService branchRoleAdminService;
    private final RoleCatalog roleCatalog;

    public ProvisioningAdminService(UserRepository userRepository,
                                    PasswordEncoder passwordEncoder,
                                    PermissionResolver permissionResolver,
                                    JwtSigningService jwtSigningService,
                                    EntityManager entityManager,
                                    BranchRoleAdminService branchRoleAdminService,
                                    RoleCatalog roleCatalog) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.permissionResolver = permissionResolver;
        this.jwtSigningService = jwtSigningService;
        this.entityManager = entityManager;
        this.branchRoleAdminService = branchRoleAdminService;
        this.roleCatalog = roleCatalog;
    }

    /**
     * Creates the initial Tenant Admin for a tenant — the user row AND the branch-role assignment
     * that makes the account usable (FD-1 step 3, D-05/D-12/D-13, blocker B2).
     *
     * <p>This used to create the user and stop. A user with no active branch assignment cannot log
     * in at all: {@code PermissionResolver.selectDefaultBranch} throws "has no active branch
     * assignments" before a token is ever minted. So the tenant admin the platform API reported
     * creating was, in every case, an account nobody could use — and because the failure happens at
     * the first login rather than at provisioning time, provisioning reported success.
     *
     * <p><b>Both writes share this one transaction, and that is load-bearing.</b> A user without an
     * assignment is not a partial success, it is a broken account that looks provisioned; a clean
     * failure the saga can compensate is strictly better. {@code BranchRoleAdminService.assign} is
     * called rather than writing the row here because it is the only sanctioned write path for
     * {@code user_branch_roles} and it owns the one-active-role-per-branch and primary-flag
     * invariants 13-02 established. It marks a user's first assignment primary, which is what makes
     * the new admin's default branch deterministic.
     *
     * <p><b>The temporary password is returned in the response and exists nowhere else.</b> It is
     * not logged, not persisted (only its bcrypt hash is), and not placed in any event payload. A
     * later "helpful" log line naming it, or an outbox event carrying it, is wrong — 13-CONTEXT
     * records the password-reset flow having exactly that defect with its raw token.
     *
     * @throws io.restaurantos.auth.exception.UnknownRoleCodeException if the role code is not in the
     *         catalog (400) — checked before anything at all is written.
     * @throws StateInvalidException if the branch id is missing, or the email is already taken in
     *         this tenant.
     */
    @Transactional
    public ProvisionAdminResult provisionAdmin(UUID tenantId, String email, UUID branchId,
                                               String roleCode, String fullName) {
        // The RLS tenant GUC must be the first statement in the transaction, before any read or
        // write, so the GUC and the statements share one connection.
        //
        // Its absence here was a live defect, not a hypothetical one. `users` is FORCE ROW LEVEL
        // SECURITY on this GUC, and nothing set it: there is no JWT on /internal/**, so
        // JwtAuthenticationFilter never populates TenantContext and TenantAwareDataSource sets no
        // GUC. Measured against the running dev stack before this change, provision-admin answered
        // HTTP 500 and wrote no row —
        //     ERROR: new row violates row-level security policy for table "users"
        // — which means the endpoint the provisioning saga depends on had never once worked against
        // a database that enforces RLS. Every test passed regardless, because Testcontainers'
        // Postgres user is a SUPERUSER and superusers bypass row security entirely. This is the
        // same class of defect 13-02 found on the branch-role and permissions paths (commit ab7e59a);
        // this method was missed then.
        setTenantGuc(tenantId);

        if (branchId == null) {
            throw new StateInvalidException(
                "A branch id is required: an admin with no branch assignment cannot log in");
        }
        // Validated before the temp password is generated and before any row is written, so a typo
        // in the role code costs nothing and leaves nothing behind.
        roleCatalog.requireKnown(roleCode);

        // Login lower-cases the address before looking it up, so an admin stored with any upper-case
        // character could never be found — a provisioned account that silently does not work.
        String normalisedEmail = email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
        if (normalisedEmail.isBlank()) {
            throw new StateInvalidException("An email address is required to provision an admin");
        }
        // The unique constraint is (tenant_id, email) and the GUC above scopes this read to the
        // tenant, so this finds a clash within the tenant and only within it.
        if (userRepository.findByEmail(normalisedEmail).isPresent()) {
            throw new StateInvalidException(
                "A user with email " + normalisedEmail + " already exists in this tenant");
        }

        String tempPassword = generateTempPassword();

        UserEntity user = new UserEntity();
        user.setId(UUID.randomUUID());
        user.setTenantId(tenantId);
        user.setEmail(normalisedEmail);
        user.setPasswordHash(passwordEncoder.encode(tempPassword));
        user.setFullName(fullName);
        user.setMustChangePassword(true);
        user.setActive(true);
        user.setTotpEnabled(false);
        user.setFailedLoginCount(0);
        userRepository.saveAndFlush(user);

        branchRoleAdminService.assign(tenantId, user.getId(),
            new BranchRoleAssignRequest(branchId, roleCode.trim(), null));

        return new ProvisionAdminResult(user.getId(), tempPassword, branchId, roleCode.trim());
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

    /**
     * {@code tempPassword} crosses back to the caller exactly once and is never stored, logged or
     * published. Do not add it to {@code toString()} — a record's generated one already includes it,
     * which is why this type must never be logged as a whole.
     */
    public record ProvisionAdminResult(UUID userId, String tempPassword, UUID branchId, String roleCode) {}
    public record ImpersonateResult(String token, int expiresIn) {}
}
