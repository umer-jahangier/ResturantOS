package io.restaurantos.user.service;

import io.restaurantos.shared.exception.DuplicateValueException;
import io.restaurantos.shared.exception.FieldValidationException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.user.client.AuthInternalClient;
import io.restaurantos.user.dto.BranchDtos;
import io.restaurantos.user.entity.BranchEntity;
import io.restaurantos.user.exception.ReceiptConfigExceptionHandler;
import io.restaurantos.user.repository.BranchRepository;
import jakarta.persistence.EntityManager;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class BranchService {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(BranchService.class);

    private final BranchRepository branchRepository;
    private final TenantContext tenantContext;
    private final AuthInternalClient authInternalClient;
    private final EntityManager entityManager;

    public BranchService(BranchRepository branchRepository,
                         TenantContext tenantContext,
                         AuthInternalClient authInternalClient,
                         EntityManager entityManager) {
        this.branchRepository = branchRepository;
        this.tenantContext = tenantContext;
        this.authInternalClient = authInternalClient;
        this.entityManager = entityManager;
    }

    /**
     * The message returned when a caller tries to write the printer registry through the legacy
     * bare-string field. Package-visible so the integration test asserts the same constant the
     * service raises rather than a copy of the sentence.
     */
    public static final String LEGACY_RECEIPT_CONFIG_REFUSED =
            "receiptConfig is no longer writable through the branch endpoint. "
                    + "Use PUT /api/v1/branches/{id}/receipt-config, which validates the printer registry.";

    /**
     * The legacy door, closed.
     *
     * <p>{@code CreateBranchRequest} and {@code UpdateBranchRequest} declare {@code receiptConfig}
     * as a bare {@code String} with no validation, and this service used to persist it verbatim —
     * so any caller of the branch write endpoints could overwrite a validated printer registry with
     * arbitrary text and nothing would detect it until a kitchen stopped printing. Adding a
     * validating endpoint beside an open door does not close the door.
     *
     * <p>A NULL stays a null and changes nothing, so an ordinary branch update — which is every
     * branch update that exists today — is unaffected. Verified before making the change:
     * {@code receiptConfig} appears in the frontend only in {@code apiBranchSchema} (the READ
     * shape); {@code apiUpdateBranchSchema}, the write shape, has no such field. No shipped caller
     * sends it.
     *
     * <p>The field itself is deliberately left on the DTOs: {@code BranchResponse} returns it and
     * removing it would churn the read contract. The point is to make the WRITE refuse.
     */
    private static void refuseLegacyReceiptConfig(String receiptConfig) {
        if (receiptConfig != null) {
            // 400, not 409: the caller's request is wrong, not the server's state. StateInvalid
            // maps to CONFLICT in the shared handler, which would tell a client to retry later.
            throw new ReceiptConfigExceptionHandler.LegacyReceiptConfigWriteException(
                    LEGACY_RECEIPT_CONFIG_REFUSED);
        }
    }

    /**
     * Set the printer registry on a branch. The ONLY write path to {@code receipt_config}.
     *
     * <p>Lives here rather than in {@link ReceiptConfigService} so there is one service, one
     * repository and one tenant-scoped lookup for the branch row. {@link #get} raises the existing
     * not-found for a branch outside the caller's tenant, so the authority question is answered by
     * the code that already answers it for every other branch field.
     */
    @Transactional
    public BranchEntity updateReceiptConfig(UUID id, String json) {
        BranchEntity branch = getForCurrentTenant(id);
        branch.setReceiptConfig(json);
        return branchRepository.save(branch);
    }

    /**
     * {@link #get} with the caller's tenant in the QUERY as well as in the RLS policy.
     *
     * <p>26-CONTEXT requires both. {@code ReceiptConfigIT} then measured why: {@link #get} handed
     * back another tenant's branch under the integration harness. Two things had to be true at
     * once for that, and both were — but the second one is not what this comment used to say.
     * Testcontainers ran Postgres as a superuser, which bypasses even FORCE ROW LEVEL SECURITY, so
     * the policy was inert for the whole suite (fixed — {@code BaseUserIT} now connects as a
     * NOSUPERUSER NOBYPASSRLS role); and the Hibernate {@code tenantFilter} was not in force on
     * the query. The second one is not fixed and is not local to this service:
     * {@code TenantFilterInterceptor} enables the filter in {@code preHandle}, but every service
     * runs {@code spring.jpa.open-in-view: false}, so it enables it on a temporary session that
     * closes before this {@code @Transactional} method opens its own. The interceptor is inert
     * everywhere it is registered. {@code TenantIsolationHarnessIT} captures both SQL statements
     * side by side.
     *
     * <p>Which makes this method load-bearing rather than defensive: it is currently the only
     * application-layer tenant scoping on this read that reaches the database.
     *
     * <p>The claim that Hibernate does not propagate {@code @Filter} from the
     * {@code TenantAuditableEntity} mapped superclass to the concrete entity is FALSE. It does.
     * {@code TenantIsolationHarnessIT} captures the SQL Hibernate emits for {@code BranchEntity}
     * with the filter enabled — {@code ... from branches be1_0 where be1_0.tenant_id = ?} — and
     * {@code BranchEntity} declares no {@code @Filter} of its own. Do not re-derive the old
     * conclusion from a missing predicate: check whether the filter was enabled on that path first.
     *
     * <p>Deliberately a NEW method rather than a change to {@link #get}: {@code get} is on the
     * branch read path, the internal provisioning path and the compensating-deactivation path, and
     * two of those run with the tenant set from a request body rather than from a token. Narrowing
     * it belongs to a plan that can test all three. This one is used by the printer registry, which
     * is the surface this plan is responsible for.
     */
    @Transactional(readOnly = true)
    public BranchEntity getForCurrentTenant(UUID id) {
        UUID tenantId = tenantContext.requireTenantId();
        return branchRepository.findByIdAndTenantIdAndDeletedAtIsNull(id, tenantId)
            .orElseThrow(() -> new ResourceNotFoundException("Branch not found: " + id));
    }

    /**
     * Create a branch, and put the administrator who created it ON that branch.
     *
     * <h3>Why the second half is not optional</h3>
     *
     * <p>A branch nobody is assigned to is invisible to everyone, including the person who just
     * created it: {@link #listMine} — which is the branch switcher, and the only route to a
     * branch's data — is driven entirely by {@code user_branch_roles}. Before this, the whole
     * observable effect of "add your second branch" was a row appearing in a list. The creator
     * could not switch to it, could not take an order on it, and had no signal that anything was
     * missing. That is the shape this repair exists to remove, not a smaller version of it.
     *
     * <p>The role granted is the creator's OWN role, read back from auth-service rather than
     * assumed, so an OWNER lands as OWNER and a TENANT_ADMIN as TENANT_ADMIN. It cannot be an
     * escalation by construction — a role is being granted to the person who already holds it —
     * and auth-service applies {@code RoleCeiling} to it regardless, because this goes through
     * {@code assignAsActingUser} like every other networked grant.
     *
     * <p><b>Inside the transaction, and after the flush, on purpose.</b> If auth-service refuses
     * or is unreachable the branch insert rolls back, so the failure is a create that did not
     * happen rather than a branch that exists and cannot be reached. user-service is already
     * unable to administer users at all without auth-service; this adds no new dependency.
     */
    @Transactional
    public BranchEntity create(BranchDtos.CreateBranchRequest req) {
        refuseLegacyReceiptConfig(req.receiptConfig());
        UUID tenantId = tenantContext.requireTenantId();
        BranchEntity branch = new BranchEntity();
        branch.setId(UUID.randomUUID());
        branch.setTenantId(tenantId);
        branch.setName(req.name());
        // Absent means false — see CreateBranchRequest for the 400 the primitive used to produce.
        branch.setHq(Boolean.TRUE.equals(req.isHq()));
        branch.setActive(true);
        branch.setAddress(req.address());
        branch.setPhone(req.phone());
        branch.setEmail(req.email());
        branch.setTimezone(requireZone(req.timezone() != null ? req.timezone() : "Asia/Karachi"));
        branch.setCurrencyConfig(req.currencyConfig());
        // receiptConfig is deliberately NOT set here — refuseLegacyReceiptConfig above has already
        // established it is null, and the printer registry is written through
        // ReceiptConfigService, which validates it.
        branch.setOpenedOn(req.openedOn());
        BranchEntity saved;
        try {
            saved = branchRepository.saveAndFlush(branch);
        } catch (DataIntegrityViolationException e) {
            // Field-bound, so the form can put the message under the box the user typed in. The
            // old StateInvalidException produced a bare 409 whose body was "This conflicts with
            // existing data" with no field and no offending value — indistinguishable, to a
            // client, from the jsonb address failure that shared the same catch.
            throw new DuplicateValueException("name",
                "A branch called '" + req.name() + "' already exists. Choose another name.", e);
        }
        assignCreatorToNewBranch(tenantId, saved.getId());
        return saved;
    }

    /**
     * An IANA zone id, or a refusal naming the field.
     *
     * <p>{@code timezone} is not decoration: {@code BusinessDay} cuts a branch's trading day on it,
     * so a value PostgreSQL and Java cannot resolve would put every order, every till session and
     * every report on that branch onto a date nothing can compute. It was a free {@code String}
     * with no check at all, on both create and update.
     */
    private static String requireZone(String zoneId) {
        try {
            return java.time.ZoneId.of(zoneId).getId();
        } catch (java.time.DateTimeException e) {
            throw new FieldValidationException("INVALID_TIMEZONE", "timezone",
                "'" + zoneId + "' is not a time zone. Use an IANA name such as Asia/Karachi.", e);
        }
    }

    /**
     * Grant the acting administrator their own role at a branch they have just created.
     *
     * <p>Silent only in the one case where silence is correct: a caller with no user identity is
     * not a human and has no role to copy — the internal provisioning saga reaches
     * {@link #createInternal}, not this method, but a future system caller must not crash here.
     * Every other outcome is either a successful grant or a propagated failure.
     */
    private void assignCreatorToNewBranch(UUID tenantId, UUID branchId) {
        UUID actingUserId = tenantContext.getUserId().orElse(null);
        if (actingUserId == null) {
            log.warn("Branch {} was created without an acting user; nobody has been assigned to it",
                branchId);
            return;
        }
        String roleCode = ownRoleCode(actingUserId, tenantId);
        if (roleCode == null) {
            // An administrator whose authority comes from somewhere other than a branch role. Not
            // an error, but it must not pass unrecorded: the branch they just made has no staff.
            log.warn("User {} created branch {} but holds no branch role to copy onto it",
                actingUserId, branchId);
            return;
        }
        authInternalClient.assignBranchRole(actingUserId, tenantId, actingUserId,
            new BranchDtos.BranchRoleRequest(branchId, roleCode, null));
    }

    /**
     * The acting user's role, preferring the branch they are signed in on.
     *
     * <p>A user holds at most one active role per branch but may hold different roles at different
     * branches. The one they are working on right now is the one they are creating this branch
     * from, so it is the one to carry across.
     */
    private String ownRoleCode(UUID actingUserId, UUID tenantId) {
        List<BranchDtos.BranchRoleAssignment> mine =
            authInternalClient.listBranchRoles(actingUserId, tenantId);
        UUID currentBranchId = tenantContext.getBranchId().orElse(null);
        return mine.stream()
            .filter(a -> a.branchId().equals(currentBranchId))
            .map(BranchDtos.BranchRoleAssignment::roleCode)
            .findFirst()
            .orElseGet(() -> mine.stream()
                .map(BranchDtos.BranchRoleAssignment::roleCode)
                .findFirst()
                .orElse(null));
    }

    @Transactional(readOnly = true)
    public List<BranchEntity> list() {
        return branchRepository.findAllByDeletedAtIsNull();
    }

    /**
     * Branches the signed-in user is assigned to (US-1.3 branch switcher).
     *
     * <p><b>Active branches only, and no placeholder for a branch that is not one.</b> This method
     * feeds the branch switcher, and the switcher is a list of places the user may go to work. A
     * deactivated branch is not one — it takes no orders and appears on no report — so an entry
     * for it is an invitation to spend a shift on data nobody is maintaining. The register's
     * paired defect (#16) was the switcher lying about WHICH branch you were on; offering a
     * retired branch is the same lie one step earlier.
     *
     * <p>The former behaviour also had a second face: an assignment whose branch row was
     * unreadable (soft-deleted, or filtered out here) was rendered as {@code "Branch c7f5bfe4"} —
     * the first eight characters of a UUID, offered to a restaurant manager as somewhere to work.
     * A branch this service cannot resolve to a live, active row is now dropped and logged, so the
     * switcher never names a place that does not exist.
     */
    @Transactional(readOnly = true)
    public List<BranchDtos.MineBranchResponse> listMine() {
        UUID userId = tenantContext.getUserId()
            .orElseThrow(() -> new IllegalStateException("User id not set in tenant context"));
        UUID tenantId = tenantContext.requireTenantId();
        setTenantGuc(tenantId);

        Map<UUID, String> roleByBranch = new LinkedHashMap<>();
        for (BranchDtos.BranchRoleAssignment assignment : authInternalClient.listBranchRoles(userId, tenantId)) {
            roleByBranch.putIfAbsent(assignment.branchId(), assignment.roleCode());
        }
        if (roleByBranch.isEmpty()) {
            return List.of();
        }

        // Re-set GUC after the outbound Feign call — interceptor GUC is transaction-local
        // and may not survive the external HTTP round-trip before this JPA query (RLS).
        setTenantGuc(tenantId);

        Map<UUID, BranchEntity> branchesById = branchRepository
            .findAllByIdInAndIsActiveTrueAndDeletedAtIsNull(roleByBranch.keySet()).stream()
            .collect(Collectors.toMap(BranchEntity::getId, Function.identity()));

        return roleByBranch.entrySet().stream()
            .filter(entry -> {
                if (branchesById.containsKey(entry.getKey())) {
                    return true;
                }
                log.info("Dropping branch {} from the switcher for user {}: no live active branch"
                    + " row (deactivated, deleted, or outside this tenant)", entry.getKey(), userId);
                return false;
            })
            .map(entry -> toMineResponse(entry.getValue(), branchesById.get(entry.getKey())))
            .sorted(Comparator.comparing(BranchDtos.MineBranchResponse::isHq).reversed()
                .thenComparing(BranchDtos.MineBranchResponse::name))
            .toList();
    }

    private static BranchDtos.MineBranchResponse toMineResponse(String roleCode, BranchEntity branch) {
        return new BranchDtos.MineBranchResponse(
            branch.getId(), branch.getName(), branch.isHq(), roleCode);
    }

    @Transactional(readOnly = true)
    public BranchEntity get(UUID id) {
        return branchRepository.findByIdAndDeletedAtIsNull(id)
            .orElseThrow(() -> new ResourceNotFoundException("Branch not found: " + id));
    }

    @Transactional
    public BranchEntity update(UUID id, BranchDtos.UpdateBranchRequest req) {
        refuseLegacyReceiptConfig(req.receiptConfig());
        BranchEntity branch = get(id);
        if (req.name() != null) branch.setName(req.name());
        if (req.isActive() != null) branch.setActive(req.isActive());
        if (req.address() != null) branch.setAddress(req.address());
        if (req.phone() != null) branch.setPhone(req.phone());
        if (req.email() != null) branch.setEmail(req.email());
        if (req.timezone() != null) branch.setTimezone(requireZone(req.timezone()));
        if (req.currencyConfig() != null) branch.setCurrencyConfig(req.currencyConfig());
        // receiptConfig: see refuseLegacyReceiptConfig. A non-null value never reaches this line.
        if (req.openedOn() != null) branch.setOpenedOn(req.openedOn());
        try {
            return branchRepository.saveAndFlush(branch);
        } catch (DataIntegrityViolationException e) {
            // saveAndFlush, not save: without the flush the unique-index violation surfaced at
            // commit, OUTSIDE this catch and outside the transaction advice, so a rename onto an
            // existing name escaped as a bare 500 instead of the field-bound 409 below.
            throw new DuplicateValueException("name",
                "A branch called '" + req.name() + "' already exists. Choose another name.", e);
        }
    }

    @Transactional
    public void softDelete(UUID id) {
        BranchEntity branch = get(id);
        branch.setDeletedAt(Instant.now());
        branch.setActive(false);
        branchRepository.save(branch);
    }

    /**
     * Internal create for the provisioning saga (FD-1 step 4).
     * Sets tenant GUC from request tenantId directly so the RLS-scoped insert
     * lands under the correct tenant (provisioning context has no user JWT).
     */
    @Transactional
    public BranchEntity createInternal(BranchDtos.InternalCreateBranchRequest req) {
        BranchEntity branch = new BranchEntity();
        branch.setId(UUID.randomUUID());
        branch.setTenantId(req.tenantId());
        branch.setName(req.name());
        branch.setHq(req.isHq());
        branch.setActive(true);
        branch.setTimezone("Asia/Karachi");
        try {
            return branchRepository.saveAndFlush(branch);
        } catch (DataIntegrityViolationException e) {
            throw new StateInvalidException("Branch '" + req.name() + "' already exists for tenant " + req.tenantId());
        }
    }

    /**
     * Compensating deactivation for a failed provisioning saga (13-10).
     *
     * <p><b>Soft, not hard.</b> A branch that a saga created may already be referenced — by an
     * outbox event, by a branch-role row in auth-service — and a hard delete of a row with live
     * referents is its own hazard, one taken during error handling when the system is already in a
     * bad state. Marking it deleted and inactive removes it from every live query, which is what
     * compensation actually needs.
     *
     * <p><b>Idempotent by contract.</b> Returns {@code false} rather than throwing when the branch
     * is already gone, because a compensating action is retried and a second run must not turn a
     * completed cleanup into a fresh failure. This is why it does not delegate to {@link #get}.
     *
     * <p>The caller must have put the tenant on the connection first — {@code branches} is
     * RLS-scoped, and without the GUC this method silently matches nothing and reports success.
     */
    @Transactional
    public boolean deactivateInternal(UUID branchId) {
        return branchRepository.findByIdAndDeletedAtIsNull(branchId)
            .map(branch -> {
                branch.setDeletedAt(Instant.now());
                branch.setActive(false);
                branchRepository.save(branch);
                return true;
            })
            .orElse(false);
    }

    @Transactional(readOnly = true)
    public List<BranchEntity> listByTenantId(UUID tenantId) {
        return branchRepository.findAllByTenantIdAndDeletedAtIsNull(tenantId);
    }

    private void setTenantGuc(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
    }
}
