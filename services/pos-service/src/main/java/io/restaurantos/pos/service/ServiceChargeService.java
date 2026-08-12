package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.model.BranchServiceCharge;
import io.restaurantos.pos.dto.ServiceChargeDtos.ServiceChargePolicyDto;
import io.restaurantos.pos.dto.ServiceChargeDtos.UpdateServiceChargeRequest;

import java.util.Optional;
import java.util.UUID;

/** A branch's service-charge policy — read by a screen, and read by the pricing path (F20). */
public interface ServiceChargeService {

    /** The admin read. Always answers; an unconfigured branch answers "no service charge". */
    ServiceChargePolicyDto get(UUID branchId);

    /** The admin write. Requires {@code pos.service_charge.manage}. */
    ServiceChargePolicyDto update(UUID branchId, UpdateServiceChargeRequest request);

    /**
     * The PRICING read: the stored policy row, or empty when the branch has none.
     *
     * <p>Deliberately NOT the DTO and deliberately NOT authorization-checked. It is called from
     * inside {@code OrderServiceImpl.recomputeOrderTotals}, on the same transaction that writes the
     * order, for a cashier who holds no settings permission whatsoever. Gating it on a manage code
     * would make every cashier's bill compute without the charge — the exact failure this codebase
     * calls "structurally present, behaviourally absent".
     */
    Optional<BranchServiceCharge> policyFor(UUID branchId);
}
