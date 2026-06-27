package io.restaurantos.user.service;

import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.user.client.AuthInternalClient;
import io.restaurantos.user.dto.BranchDtos;
import io.restaurantos.user.entity.BranchEntity;
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

    @Transactional
    public BranchEntity create(BranchDtos.CreateBranchRequest req) {
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
        branch.setReceiptConfig(req.receiptConfig());
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
        BranchEntity branch = get(id);
        if (req.name() != null) branch.setName(req.name());
        if (req.isActive() != null) branch.setActive(req.isActive());
        if (req.address() != null) branch.setAddress(req.address());
        if (req.phone() != null) branch.setPhone(req.phone());
        if (req.email() != null) branch.setEmail(req.email());
        if (req.timezone() != null) branch.setTimezone(req.timezone());
        if (req.currencyConfig() != null) branch.setCurrencyConfig(req.currencyConfig());
        if (req.receiptConfig() != null) branch.setReceiptConfig(req.receiptConfig());
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
