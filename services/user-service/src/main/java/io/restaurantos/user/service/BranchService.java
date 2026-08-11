package io.restaurantos.user.service;

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
     * back another tenant's branch under the integration harness. Two things have to be true at
     * once for that, and both are: Testcontainers runs Postgres as a superuser, which bypasses even
     * FORCE ROW LEVEL SECURITY; and Hibernate's {@code tenantFilter} is annotated on the
     * {@code TenantAuditableEntity} mapped superclass, which Hibernate does not propagate to the
     * concrete entity. So there was nothing scoping this read except a policy that is inert in the
     * one place the tests can see.
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

    @Transactional
    public BranchEntity create(BranchDtos.CreateBranchRequest req) {
        refuseLegacyReceiptConfig(req.receiptConfig());
        BranchEntity branch = new BranchEntity();
        branch.setId(UUID.randomUUID());
        branch.setTenantId(tenantContext.requireTenantId());
        branch.setName(req.name());
        branch.setHq(req.isHq());
        branch.setActive(true);
        branch.setAddress(req.address());
        branch.setPhone(req.phone());
        branch.setEmail(req.email());
        branch.setTimezone(req.timezone() != null ? req.timezone() : "Asia/Karachi");
        branch.setCurrencyConfig(req.currencyConfig());
        // receiptConfig is deliberately NOT set here — refuseLegacyReceiptConfig above has already
        // established it is null, and the printer registry is written through
        // ReceiptConfigService, which validates it.
        branch.setOpenedOn(req.openedOn());
        try {
            return branchRepository.save(branch);
        } catch (DataIntegrityViolationException e) {
            throw new StateInvalidException("Branch with name '" + req.name() + "' already exists for this tenant");
        }
    }

    @Transactional(readOnly = true)
    public List<BranchEntity> list() {
        return branchRepository.findAllByDeletedAtIsNull();
    }

    /** Branches the signed-in user is assigned to (US-1.3 branch switcher). */
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
            .findAllByIdInAndDeletedAtIsNull(roleByBranch.keySet()).stream()
            .collect(Collectors.toMap(BranchEntity::getId, Function.identity()));

        return roleByBranch.entrySet().stream()
            .map(entry -> toMineResponse(entry.getKey(), entry.getValue(), branchesById.get(entry.getKey())))
            .sorted(Comparator.comparing(BranchDtos.MineBranchResponse::isHq).reversed()
                .thenComparing(BranchDtos.MineBranchResponse::name))
            .toList();
    }

    private static BranchDtos.MineBranchResponse toMineResponse(
            UUID branchId, String roleCode, BranchEntity branch) {
        if (branch != null) {
            return new BranchDtos.MineBranchResponse(
                branch.getId(), branch.getName(), branch.isHq(), roleCode);
        }
        return new BranchDtos.MineBranchResponse(branchId, "Branch " + branchId.toString().substring(0, 8), false, roleCode);
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
        if (req.timezone() != null) branch.setTimezone(req.timezone());
        if (req.currencyConfig() != null) branch.setCurrencyConfig(req.currencyConfig());
        // receiptConfig: see refuseLegacyReceiptConfig. A non-null value never reaches this line.
        if (req.openedOn() != null) branch.setOpenedOn(req.openedOn());
        try {
            return branchRepository.save(branch);
        } catch (DataIntegrityViolationException e) {
            throw new StateInvalidException("Branch with name '" + req.name() + "' already exists for this tenant");
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
