package io.restaurantos.auth.service;

import io.restaurantos.auth.dto.request.BranchRoleAssignRequest;
import io.restaurantos.auth.dto.request.CreateUserRequest;
import io.restaurantos.auth.dto.request.UpdateUserRequest;
import io.restaurantos.auth.dto.response.UserDtos.CreatedUser;
import io.restaurantos.auth.dto.response.UserDtos.UserAssignment;
import io.restaurantos.auth.dto.response.UserDtos.UserDetail;
import io.restaurantos.auth.dto.response.UserDtos.UserSummary;
import io.restaurantos.auth.entity.UserBranchRoleEntity;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.repository.UserBranchRoleRepository;
import io.restaurantos.auth.exception.InvalidUserRequestException;
import io.restaurantos.auth.repository.UserRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import jakarta.persistence.EntityManager;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;

/**
 * The user lifecycle for one tenant — list, get, create, update, deactivate, reactivate (D-11).
 *
 * <p>Blocker B3: there was no user-creation API anywhere in the repository, so a tenant could not
 * onboard a single cashier. {@code users} lives in {@code auth_db} and auth-service is the system of
 * record, so the operations live here and 13-12 exposes them publicly.
 *
 * <h2>Row-level security, and why the GUC is not the only control</h2>
 *
 * <p>Every method sets the tenant GUC as the FIRST statement inside its transaction, before any
 * row-level-security-scoped read or write, so the GUC and the statements share one connection. That
 * is not defensive style: this codebase has shipped five paths that were green in CI and broken in
 * production for exactly that omission, {@code provisionAdmin} among them (13-06), because
 * Testcontainers' Postgres user is a SUPERUSER and superusers bypass row security entirely.
 *
 * <p>For the same reason the reads do <b>not rely on the policy for isolation</b>. Every finder in
 * {@link UserRepository} carries {@code tenant_id = :tenantId} in the query itself, so the tenant
 * boundary is enforced twice by independent mechanisms and one of them is assertable in CI. See
 * {@link UserRepository#findPageForTenant}. 13-07 took the same two-control approach for the role
 * catalog after measuring that the policy is inert under test.
 *
 * <h2>What a caller may not do</h2>
 *
 * <p>No operation here accepts a password. Creation issues a generated temporary password and sets
 * the forced-change flag (D-12); update rejects a body carrying a password field rather than
 * ignoring it. Nothing deletes: deactivation flips {@code is_active}, so audit rows, orders and
 * journal entries that reference a user id stay resolvable.
 *
 * <p>Writes that change what a user may do are bounded by {@link RoleCeiling} against the ACTING
 * user, recomputed here from the database rather than taken from the request.
 */
@Service
public class UserLifecycleService {

    /**
     * The largest page this endpoint will serve, whatever a caller asks for.
     *
     * <p>Unbounded list queries are T-13-11-H. A cap rather than a rejection, because a client
     * asking for 10 000 rows wants rows, not an error, and the page metadata tells it how many
     * there really are.
     */
    public static final int MAX_PAGE_SIZE = 200;
    public static final int DEFAULT_PAGE_SIZE = 50;

    private final UserRepository userRepository;
    private final UserBranchRoleRepository userBranchRoleRepository;
    private final BranchRoleAdminService branchRoleAdminService;
    private final PasswordPolicyService passwordPolicyService;
    private final RoleCeiling roleCeiling;
    private final PasswordEncoder passwordEncoder;
    private final EntityManager entityManager;
    private final UserLifecycleEventPublisher events;

    public UserLifecycleService(UserRepository userRepository,
                                UserBranchRoleRepository userBranchRoleRepository,
                                BranchRoleAdminService branchRoleAdminService,
                                PasswordPolicyService passwordPolicyService,
                                RoleCeiling roleCeiling,
                                PasswordEncoder passwordEncoder,
                                EntityManager entityManager,
                                UserLifecycleEventPublisher events) {
        this.userRepository = userRepository;
        this.userBranchRoleRepository = userBranchRoleRepository;
        this.branchRoleAdminService = branchRoleAdminService;
        this.passwordPolicyService = passwordPolicyService;
        this.roleCeiling = roleCeiling;
        this.passwordEncoder = passwordEncoder;
        this.entityManager = entityManager;
        this.events = events;
    }

    /**
     * One page of a tenant's users.
     *
     * @param search a fragment matched case-insensitively against email and full name; null or
     *               blank means no filter
     */
    @Transactional(readOnly = true)
    public Page<UserSummary> list(UUID tenantId, int page, int size, boolean activeOnly, String search) {
        setTenantGuc(tenantId);
        Pageable pageable = PageRequest.of(Math.max(page, 0), clampPageSize(size));
        String term = (search == null || search.isBlank())
            ? null
            : "%" + search.trim().toLowerCase(Locale.ROOT) + "%";
        return userRepository.findPageForTenant(tenantId, activeOnly, term, pageable)
            .map(UserSummary::of);
    }

    /**
     * One user, with the assignments that decide what they can do.
     *
     * <p>A user of another tenant is <b>not found</b>, never forbidden. Answering 403 would confirm
     * that the identifier names a real user somewhere, which is a cross-tenant existence oracle
     * over an id space an administrator of a neighbouring tenant can enumerate from their own data.
     */
    @Transactional(readOnly = true)
    public UserDetail get(UUID tenantId, UUID userId) {
        setTenantGuc(tenantId);
        return detailOf(requireUser(tenantId, userId));
    }

    /**
     * Create a user, optionally with a branch role, in one transaction (D-11, D-12, D-13).
     *
     * <p>Order of operations is the whole of the safety here:
     *
     * <ol>
     *   <li>tenant GUC, before any RLS-scoped statement;</li>
     *   <li>validate the role code and the acting user's ceiling — <b>before</b> a password is
     *       generated or a row is written, so a typo or an over-reach costs nothing and leaves
     *       nothing behind;</li>
     *   <li>normalise and check the email;</li>
     *   <li>write the user, then the assignment, through {@link BranchRoleAdminService} so 13-02's
     *       one-active-role-per-branch and primary-flag invariants keep their single owner.</li>
     * </ol>
     *
     * <p><b>Both writes share this transaction.</b> A user with no assignment is not a partial
     * success — it is an account that looks created and cannot log in, which is exactly the failure
     * blocker B2 was. A clean rollback the caller can retry is strictly better.
     *
     * <p>The temporary password is returned once, in the response, and exists nowhere else: not in
     * a log, not in the database (only its bcrypt hash), not in any event payload. It satisfies
     * {@code @StrongPassword} by construction — see
     * {@link ProvisioningAdminService#generateTempPassword()}, whose generator is reused rather than
     * duplicated so the property {@code TempPasswordPolicyTest} pins keeps holding for both callers.
     *
     * @param actingUserId the human on whose behalf this is done; required when a role is requested
     */
    @Transactional
    public CreatedUser create(UUID tenantId, UUID actingUserId, CreateUserRequest request) {
        setTenantGuc(tenantId);

        boolean wantsRole = request.roleCode() != null && !request.roleCode().isBlank();
        if (wantsRole) {
            if (request.branchId() == null) {
                // 400, not 409: this is a malformed request, and it is refused rather than
                // downgraded to "create the user without the role" — a caller who asked for a
                // cashier and silently received an account that cannot log in has been told the
                // opposite of the truth.
                throw new InvalidUserRequestException(
                    "A branchId is required when a roleCode is given: a role without a branch is "
                        + "not an assignment, and the user could not log in");
            }
            // Validated and ceiling-checked before anything is written.
            roleCeiling.requireAssignable(actingUserId, request.roleCode());
        } else if (request.branchId() != null) {
            throw new InvalidUserRequestException(
                "A roleCode is required when a branchId is given: a branch without a role is not "
                    + "an assignment");
        }

        String email = normaliseEmail(request.email());
        // A courtesy check that names the address; the unique index added in changeset 058 is the
        // enforcement, and it is what a race loses to.
        if (userRepository.findLiveByTenantAndLowercasedEmail(tenantId, email).isPresent()) {
            throw new StateInvalidException(
                "A user with email " + email + " already exists in this tenant");
        }

        String tempPassword = ProvisioningAdminService.generateTempPassword();

        UserEntity user = new UserEntity();
        user.setId(UUID.randomUUID());
        user.setTenantId(tenantId);
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode(tempPassword));
        user.setFullName(blankToNull(request.fullName()));
        user.setLocale(blankToNull(request.locale()));
        // D-12. 13-08 makes this flag binding at login, so the account cannot be used until its
        // holder has replaced the credential that was read to them over the phone.
        user.setMustChangePassword(true);
        user.setActive(true);
        user.setTotpEnabled(false);
        user.setFailedLoginCount(0);
        userRepository.saveAndFlush(user);

        String assignedRole = null;
        if (wantsRole) {
            assignedRole = branchRoleAdminService
                .assignAsActingUser(tenantId, actingUserId, user.getId(),
                    new BranchRoleAssignRequest(request.branchId(), request.roleCode().trim(), null))
                .assignment()
                .getRoleCode();
        }

        // Inside this transaction, so the account and the record that it was created commit
        // together. The temporary password above is deliberately not passed: the payload record
        // has no field for it and must never gain one.
        events.userCreated(tenantId, actingUserId, user.getId(), email,
            assignedRole, request.branchId());

        return new CreatedUser(user.getId(), email, tempPassword, true,
            request.branchId(), assignedRole, assignedRole != null);
    }

    /**
     * Change a user's name, locale and active flag. Nothing else, and never a password.
     *
     * <p>A body carrying a password field is refused with 400 rather than ignored — see
     * {@link UpdateUserRequest} for why silently discarding it is the more dangerous option.
     *
     * <p>Flipping {@code active} through here has the same consequences as
     * {@link #setActive(UUID, UUID, UUID, boolean)}, because it delegates to it: a caller must not
     * be able to deactivate an account through the profile endpoint and leave that account's
     * sessions alive.
     */
    @Transactional
    public UserDetail update(UUID tenantId, UUID actingUserId, UUID userId, UpdateUserRequest request) {
        setTenantGuc(tenantId);

        if (request.passwordFieldPresent()) {
            throw new InvalidUserRequestException(
                "A password cannot be set here. Use the password reset or forced-change flow; "
                    + "this endpoint changes profile fields only");
        }

        UserEntity user = requireUser(tenantId, userId);
        roleCeiling.requireMayAdminister(actingUserId, activeRoleCodesOf(userId));

        // Which fields actually changed, compared before the setters run. The audit event records
        // the field NAMES and never their values — see UserUpdatedPayload for why an append-only
        // table is the wrong place for arbitrary user-supplied strings.
        List<String> changedFields = new ArrayList<>();
        if (request.fullName() != null) {
            String next = blankToNull(request.fullName());
            if (!Objects.equals(next, user.getFullName())) {
                changedFields.add("fullName");
            }
            user.setFullName(next);
        }
        if (request.locale() != null) {
            String next = blankToNull(request.locale());
            if (!Objects.equals(next, user.getLocale())) {
                changedFields.add("locale");
            }
            user.setLocale(next);
        }
        if (request.active() != null && request.active() != user.isActive()) {
            // Delegates, and setActive publishes USER_DEACTIVATED / USER_REACTIVATED itself. Any
            // name or locale edits in the same request are still recorded first, so a patch that
            // renames and deactivates in one call produces both facts rather than only the louder
            // one.
            if (!changedFields.isEmpty()) {
                events.userUpdated(tenantId, actingUserId, userId, user.getEmail(), changedFields);
            }
            return setActive(tenantId, actingUserId, userId, request.active());
        }
        UserDetail detail = detailOf(userRepository.save(user));
        events.userUpdated(tenantId, actingUserId, userId, user.getEmail(), changedFields);
        return detail;
    }

    /**
     * Deactivate or reactivate. Never deletes.
     *
     * <p>Deactivation revokes every unrevoked refresh session, because the flag alone would leave a
     * removed employee holding a 30-day refresh token — {@code AuthServiceImpl.login} now refuses an
     * inactive account (13-11 closed that defect), but refusing new logins while leaving existing
     * sessions renewable is not removing access.
     *
     * <p><b>Reactivation deliberately does not restore sessions.</b> Revocation is not reversible
     * and should not be: the sessions revoked at deactivation may have been on a device the person
     * no longer has. A reactivated user logs in again, which is one password prompt and is the
     * point at which the platform re-establishes who is holding the account.
     *
     * <p>The row and its assignments survive untouched, so a reactivated user comes back with the
     * roles they had, and every audit, order and journal reference to their id still resolves.
     *
     * <p>Already-issued ACCESS tokens stay valid until they expire — they are stateless and there is
     * no revocation list. The residual window is the access-token TTL, which is the same bound
     * {@code PasswordPolicyService.revokeActiveRefreshSessions} documents for a password change, and
     * the live script measures it rather than assuming it away.
     */
    @Transactional
    public UserDetail setActive(UUID tenantId, UUID actingUserId, UUID userId, boolean active) {
        setTenantGuc(tenantId);
        UserEntity user = requireUser(tenantId, userId);
        roleCeiling.requireMayAdminister(actingUserId, activeRoleCodesOf(userId));

        user.setActive(active);
        UserEntity saved = userRepository.saveAndFlush(user);
        int sessionsRevoked = 0;
        if (!active) {
            sessionsRevoked = passwordPolicyService.revokeActiveRefreshSessions(userId);
        }
        // Inside this transaction: the flag flip, the session revocations and the record that it
        // happened are one atomic fact.
        events.activationChanged(tenantId, actingUserId, userId, saved.getEmail(),
            active, sessionsRevoked);
        return detailOf(saved);
    }

    // ───────────────────────────────── internals ─────────────────────────────────

    /**
     * The user, or 404.
     *
     * <p>Tenant-scoped in the query as well as by the policy, so this is a real not-found for a
     * neighbouring tenant's id rather than a row that happened not to be visible.
     */
    private UserEntity requireUser(UUID tenantId, UUID userId) {
        return userRepository.findByIdForTenant(userId, tenantId)
            .orElseThrow(() -> new ResourceNotFoundException("User not found: " + userId));
    }

    private List<String> activeRoleCodesOf(UUID userId) {
        return userBranchRoleRepository.findByUserIdAndActiveTrue(userId).stream()
            .map(UserBranchRoleEntity::getRoleCode)
            .distinct()
            .toList();
    }

    private UserDetail detailOf(UserEntity user) {
        List<UserAssignment> assignments = userBranchRoleRepository
            .findByUserIdAndActiveTrue(user.getId()).stream()
            // Sorted so two reads of the same user are diffable, the same property 13-07 gave the
            // role catalog. Primary first, because it is the branch this user lands on at login.
            .sorted(Comparator.comparing(UserBranchRoleEntity::isPrimary).reversed()
                .thenComparing(UserBranchRoleEntity::getRoleCode)
                .thenComparing(UserBranchRoleEntity::getBranchId))
            .map(a -> new UserAssignment(a.getBranchId(), a.getRoleCode(), a.isPrimary(),
                a.getApprovalLimitPaisa()))
            .toList();
        return new UserDetail(UserSummary.of(user), assignments);
    }

    /**
     * Lower-cased and trimmed, always.
     *
     * <p>{@code AuthServiceImpl.login} lower-cases before the lookup, so an address stored with any
     * upper-case character names an account that exists and can never be used. 13-06 fixed exactly
     * this on the provisioning path; changeset 058 repairs the rows that predate both and makes the
     * uniqueness index case-insensitive so the two cannot disagree again.
     */
    private static String normaliseEmail(String email) {
        String normalised = email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
        if (normalised.isBlank()) {
            throw new InvalidUserRequestException("An email address is required");
        }
        return normalised;
    }

    private static String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value.trim();
    }

    private static int clampPageSize(int requested) {
        if (requested <= 0) {
            return DEFAULT_PAGE_SIZE;
        }
        return Math.min(requested, MAX_PAGE_SIZE);
    }

    /**
     * Transaction-local tenant GUC. Must be the first statement of the transaction — see this
     * class's javadoc for the five shipped defects that were this omission.
     */
    private void setTenantGuc(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
    }
}
