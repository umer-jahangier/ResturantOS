package io.restaurantos.pos.service;

import io.restaurantos.pos.authz.PosAuthorizationService;
import io.restaurantos.pos.domain.model.BranchServiceCharge;
import io.restaurantos.pos.dto.ServiceChargeDtos.ServiceChargePolicyDto;
import io.restaurantos.pos.dto.ServiceChargeDtos.UpdateServiceChargeRequest;
import io.restaurantos.pos.repository.BranchServiceChargeRepository;
import io.restaurantos.shared.exception.FieldValidationException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

@Service
@Transactional(readOnly = true)
public class ServiceChargeServiceImpl implements ServiceChargeService {

    static final String MANAGE_PERMISSION = "pos.service_charge.manage";

    private final BranchServiceChargeRepository repository;
    private final TenantContext tenantContext;
    private final PosAuthorizationService authorization;

    public ServiceChargeServiceImpl(BranchServiceChargeRepository repository,
                                    TenantContext tenantContext,
                                    PosAuthorizationService authorization) {
        this.repository = repository;
        this.tenantContext = tenantContext;
        this.authorization = authorization;
    }

    /**
     * Read is gated on {@code pos.menu.view}, not on the manage code, and it never 404s.
     *
     * <p>A MANAGER can read the policy and not change it. The charge appears on every bill they
     * hand a guest; being unable to look up what it is would leave them defending a number they
     * are not allowed to see the source of.
     */
    @Override
    public ServiceChargePolicyDto get(UUID branchId) {
        authorization.requireMenuView();
        UUID tenantId = tenantContext.requireTenantId();
        boolean canManage = authorization.hasPermission(MANAGE_PERMISSION);
        return repository.findByTenantIdAndBranchId(tenantId, branchId)
                .map(row -> toDto(branchId, row, canManage))
                .orElseGet(() -> unconfigured(branchId, canManage));
    }

    /**
     * <h2>Changing the rate does NOT re-price anything already rung</h2>
     *
     * <p>Nothing here touches an order. An OPEN check keeps the charge it was last computed with
     * until something else on it changes, and a settled check keeps it forever — every order
     * snapshots {@code service_charge_pct} and {@code service_charge_label} for exactly the reason
     * {@code order_items} snapshots its tax rate. The new rate applies from the next recompute.
     */
    @Override
    @Transactional
    public ServiceChargePolicyDto update(UUID branchId, UpdateServiceChargeRequest request) {
        authorization.requireServiceChargeManage();
        UUID tenantId = tenantContext.requireTenantId();

        boolean enabled = Boolean.TRUE.equals(request.enabled());
        BigDecimal rate = request.ratePct();

        // The two refusals below are the ones a user can actually reach, so each names the field
        // it blames and what to do about it. The database refuses the first as well
        // (ck_branch_service_charge_enabled_rate) — a constraint violation would surface as a 500
        // with a constraint name in it, which tells the person filling the form nothing.
        if (enabled && rate.compareTo(BigDecimal.ZERO) <= 0) {
            throw new FieldValidationException("SERVICE_CHARGE_RATE_REQUIRED", "ratePct",
                    "Enter a percentage above 0, or switch the service charge off. A charge that "
                            + "is switched on at 0% adds a line to every guest's bill and collects "
                            + "nothing.");
        }
        if (enabled && !request.dineIn() && !request.takeaway() && !request.pickup()) {
            throw new FieldValidationException("SERVICE_CHARGE_NO_CHANNEL", "dineIn",
                    "Choose at least one channel to charge. With all three off the charge is "
                            + "switched on and applies to nothing.");
        }

        BranchServiceCharge row = repository.findByTenantIdAndBranchId(tenantId, branchId)
                .orElseGet(() -> {
                    BranchServiceCharge fresh = new BranchServiceCharge();
                    fresh.setTenantId(tenantId);
                    fresh.setBranchId(branchId);
                    return fresh;
                });

        row.setEnabled(enabled);
        row.setRatePct(rate);
        row.setLabel(request.label().trim());
        row.setDineIn(Boolean.TRUE.equals(request.dineIn()));
        row.setTakeaway(Boolean.TRUE.equals(request.takeaway()));
        row.setPickup(Boolean.TRUE.equals(request.pickup()));

        return toDto(branchId, repository.save(row), true);
    }

    @Override
    public Optional<BranchServiceCharge> policyFor(UUID branchId) {
        if (branchId == null) {
            return Optional.empty();
        }
        return repository.findByTenantIdAndBranchId(tenantContext.requireTenantId(), branchId);
    }

    private static ServiceChargePolicyDto toDto(UUID branchId, BranchServiceCharge row, boolean canManage) {
        return new ServiceChargePolicyDto(
                branchId,
                row.isEnabled(),
                row.getRatePct(),
                row.getLabel(),
                row.isDineIn(),
                row.isTakeaway(),
                row.isPickup(),
                canManage);
    }

    /**
     * What a branch nobody has configured looks like: off, at 0%, dine-in only.
     *
     * <p>These are the same defaults the table declares, restated here rather than read back from
     * a row this branch does not have. Answering with the shape of a real policy is what lets the
     * screen render one form for both cases instead of an empty state that has to be explained.
     */
    private static ServiceChargePolicyDto unconfigured(UUID branchId, boolean canManage) {
        return new ServiceChargePolicyDto(
                branchId, false, BigDecimal.ZERO, "Service charge", true, false, false, canManage);
    }
}
