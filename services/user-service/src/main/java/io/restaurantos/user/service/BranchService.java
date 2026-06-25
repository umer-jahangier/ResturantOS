package io.restaurantos.user.service;

import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.user.dto.BranchDtos;
import io.restaurantos.user.entity.BranchEntity;
import io.restaurantos.user.repository.BranchRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class BranchService {

    private final BranchRepository branchRepository;
    private final TenantContext tenantContext;

    public BranchService(BranchRepository branchRepository, TenantContext tenantContext) {
        this.branchRepository = branchRepository;
        this.tenantContext = tenantContext;
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
}
