package io.restaurantos.auth.service;

import io.restaurantos.auth.entity.UserBranchRoleEntity;
import io.restaurantos.auth.entity.UserStationAssignmentEntity;
import io.restaurantos.auth.repository.RolePermissionRepository;
import io.restaurantos.auth.repository.UserBranchRoleRepository;
import io.restaurantos.auth.repository.UserStationAssignmentRepository;
import jakarta.persistence.EntityManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class PermissionResolver {

    private static final Logger log = LoggerFactory.getLogger(PermissionResolver.class);

    /**
     * The {@code attributes} key carrying a user's station scope. Value is a sorted
     * {@code List<String>} of station CODES.
     *
     * <p>Read by kitchen-service (plan 28-07) straight off the verified token. Written from the
     * admin UI (plan 28-11). The spelling is the contract; it is declared once, here, so a rename
     * cannot leave a producer and a consumer disagreeing silently — which in this case would not
     * throw, it would simply un-scope every cook in the product.
     */
    public static final String STATION_SCOPE_CLAIM = "stations";

    private final UserBranchRoleRepository userBranchRoleRepository;
    private final RolePermissionRepository rolePermissionRepository;
    private final UserStationAssignmentRepository userStationAssignmentRepository;
    private final EntityManager entityManager;

    public PermissionResolver(UserBranchRoleRepository userBranchRoleRepository,
                              RolePermissionRepository rolePermissionRepository,
                              UserStationAssignmentRepository userStationAssignmentRepository,
                              EntityManager entityManager) {
        this.userBranchRoleRepository = userBranchRoleRepository;
        this.rolePermissionRepository = rolePermissionRepository;
        this.userStationAssignmentRepository = userStationAssignmentRepository;
        this.entityManager = entityManager;
    }

    public ResolvedBranchAuth resolve(UUID userId, UUID branchId) {
        UserBranchRoleEntity assignment = branchId != null
            ? resolveAtBranch(userId, branchId)
            : selectDefaultBranch(userId);
        return buildForAssignment(assignment);
    }

    public ResolvedBranchAuth resolveDefault(UUID userId) {
        return buildForAssignment(selectDefaultBranch(userId));
    }

    /**
     * Resolve for a caller that arrives over {@code /internal/auth/**} rather than with a JWT.
     *
     * <p>{@link #resolve} and {@link #resolveDefault} rely on the tenant GUC already being on the
     * connection, which is true on the login path because {@code AuthServiceImpl.login} sets it.
     * It is NOT true for the internal endpoint: there is no JWT there, so nothing populates
     * {@code TenantContext} and {@code TenantAwareDataSource} sets no GUC. Every RLS-protected read
     * then matches zero rows, and "this user has no active branch assignments" — a message that
     * means the user is locked out — is returned for a user whose assignments are sitting right
     * there. The header the endpoint already documented as required is now actually read, and used.
     */
    @Transactional(readOnly = true)
    public ResolvedBranchAuth resolveForTenant(UUID tenantId, UUID userId, UUID branchId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
        return resolve(userId, branchId);
    }

    /**
     * The user's active role at one branch.
     *
     * <p>A partial unique index makes a second active row impossible, so the surplus branch below
     * should be unreachable. It is written anyway, and deliberately: this is the login path. A row
     * that predates the index, arrives through a repair script, or survives a future migration that
     * drops it used to produce {@code IncorrectResultSizeDataAccessException} — a 500 on a
     * credential endpoint, for every attempt, until someone found and deleted the row. Degrading to
     * a deterministic pick with a warning turns that outage into a log line.
     */
    private UserBranchRoleEntity resolveAtBranch(UUID userId, UUID branchId) {
        List<UserBranchRoleEntity> assignments =
            userBranchRoleRepository.findByUserIdAndBranchIdAndActiveTrue(userId, branchId);
        if (assignments.isEmpty()) {
            throw new IllegalStateException(
                "User " + userId + " has no active assignment at branch " + branchId);
        }
        if (assignments.size() > 1) {
            log.warn("User {} has {} active roles at branch {} ({}) — the one-active-role-per-branch "
                    + "index should make this impossible. Resolving the lowest assignment id; the "
                    + "surplus rows need deactivating.",
                userId, assignments.size(), branchId,
                assignments.stream().map(UserBranchRoleEntity::getRoleCode).sorted().toList());
        }
        return assignments.stream()
            .min(Comparator.comparing(UserBranchRoleEntity::getId))
            .orElseThrow();
    }

    /**
     * The branch a user lands on when they log in without asking for one.
     *
     * <p>This used to prefer a hardcoded {@code HQ_BRANCH_ID} constant — one dev tenant's branch
     * UUID, right on one database and silently arbitrary on every other, and matching nothing at
     * all on a freshly provisioned tenant because the provisioning saga never marks the first
     * branch as HQ. It is now the row the data itself marks primary, with the lowest branch id as
     * the fallback for a user whose rows predate the backfill.
     */
    private UserBranchRoleEntity selectDefaultBranch(UUID userId) {
        List<UserBranchRoleEntity> assignments = userBranchRoleRepository.findByUserIdAndActiveTrue(userId);
        if (assignments.isEmpty()) {
            // Naming the user matters: this message is what an operator sees when someone cannot
            // log in, and without the id there is no way to tell who is locked out or why.
            throw new IllegalStateException("User " + userId + " has no active branch assignments");
        }
        return assignments.stream()
            .filter(UserBranchRoleEntity::isPrimary)
            .min(Comparator.comparing(UserBranchRoleEntity::getId))
            .orElseGet(() -> assignments.stream()
                .min(Comparator.comparing(UserBranchRoleEntity::getBranchId))
                .orElseThrow());
    }

    private ResolvedBranchAuth buildForAssignment(UserBranchRoleEntity assignment) {
        List<String> roles = List.of(assignment.getRoleCode());
        List<String> permissions = rolePermissionRepository.findPermissionCodesByRoleCodes(roles).stream()
            .distinct()
            .sorted()
            .toList();
        Map<String, Object> attributes = new HashMap<>();
        if (assignment.getApprovalLimitPaisa() != null) {
            attributes.put("approval_limit_paisa", assignment.getApprovalLimitPaisa());
        }
        putStationScope(attributes, assignment);
        return new ResolvedBranchAuth(assignment.getBranchId(), roles, permissions, attributes);
    }

    /**
     * The station codes this user works at the branch being resolved (D-28-02).
     *
     * <p>Rides {@code attributes}, alongside {@code approval_limit_paisa}, for one reason:
     * shared-lib's {@code JwtAuthenticationFilter} reads that map straight out of the verified token
     * in every downstream service. kitchen-service therefore learns a cook's station scope with no
     * cross-service call, no projection table and no consumer that can silently drop a message. It
     * also means all three minting paths — login, refresh and branch switch — carry it for free,
     * because each of them passes {@code resolved.attributes()} through to the signer, and each of
     * them arrives here rather than copying claims off a previous token.
     *
     * <p><b>Absent means unrestricted, and absent is the ONLY encoding of it.</b> A user with no
     * assignment gets no key at all — not a key holding an empty list. That asymmetry is the whole
     * back-compatibility story. Every user in this product today is unassigned, so the do-nothing
     * state has to be the permissive one; and if "unrestricted" had two spellings, the first
     * downstream reader to treat an empty list as an empty allow-list would black out every kitchen
     * screen in the product, mid-service, on the day it deployed. There is nothing to read wrong
     * here because there is nothing there.
     *
     * <p>Sorted, so two tokens minted for the same user are byte-comparable and a test can assert on
     * the claim without ordering flake.
     */
    private void putStationScope(Map<String, Object> attributes, UserBranchRoleEntity assignment) {
        List<String> codes = userStationAssignmentRepository
            .findByTenantIdAndUserIdAndBranchIdAndActiveTrue(
                assignment.getTenantId(), assignment.getUserId(), assignment.getBranchId())
            .stream()
            .map(UserStationAssignmentEntity::getStationCode)
            .distinct()
            .sorted()
            .toList();
        if (codes.isEmpty()) {
            // Deliberately nothing. See the javadoc: an absent key is what "no station
            // restriction" means, and it is the state every existing user is in.
            return;
        }
        attributes.put(STATION_SCOPE_CLAIM, codes);
    }
}
