package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.TaxBase;
import io.restaurantos.pos.dto.TaxPolicyDtos.TaxPolicyDto;
import io.restaurantos.pos.dto.TaxPolicyDtos.UpdateTaxPolicyRequest;

/** A tenant's sales-tax base position — read by a screen, and read by the pricing path (V27). */
public interface TaxPolicyService {

    /** The admin read. Always answers; an unconfigured tenant answers {@link TaxBase#NET}. */
    TaxPolicyDto get();

    /** The admin write. Requires {@code pos.tax.manage}. */
    TaxPolicyDto update(UpdateTaxPolicyRequest request);

    /**
     * The PRICING read: which base to charge tax on, never empty and never failing.
     *
     * <p>Deliberately NOT the DTO and deliberately NOT authorization-checked, for the reason
     * {@code ServiceChargeService.policyFor} gives: it is called from inside
     * {@code OrderServiceImpl.recomputeOrderTotals}, on the same transaction that writes the order,
     * for a cashier who holds no settings permission whatsoever. Gating it on a manage code would
     * make every cashier's bill compute under whichever base the deny-path happened to fall back
     * to — the exact failure this codebase calls "structurally present, behaviourally absent".
     *
     * <p>Returns {@link TaxBase#NET} rather than an {@code Optional} because there is no third
     * answer. A tenant with no row is NET; that is the decision V27 records, not an absence the
     * caller has to interpret.
     */
    TaxBase taxBaseForCurrentTenant();
}
