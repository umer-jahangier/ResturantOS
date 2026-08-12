package io.restaurantos.pos.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.util.UUID;

/** Wire contracts for a branch's service-charge policy (F20). */
public class ServiceChargeDtos {

    /**
     * A branch's policy, as read.
     *
     * <p>Always answered for a branch the caller holds, never 404: a branch nobody has configured
     * has a policy, and that policy is "no service charge". Returning "not found" would make the
     * screen guess whether it is looking at an unconfigured branch or a broken read — the
     * fold-a-failure-into-an-empty-state shape this codebase has already been bitten by.
     *
     * <p>A branch the caller does NOT hold is the one case that 404s, and it is not an exception
     * to the above — it is the house rule that a foreign tenant's resource reads as absent. Before
     * that check existed this record was synthesised for any UUID at all, which made "unconfigured"
     * indistinguishable from "not yours". See {@code ServiceChargeServiceImpl.requireOwnBranch}.
     *
     * @param canManage whether the caller may change it. On the wire because the screen renders
     *                  read-only for a MANAGER rather than refusing them the page: a manager asked
     *                  "why is there 5% on my bill" needs to be able to look up the answer, and
     *                  hiding it teaches them the charge is arbitrary.
     */
    public record ServiceChargePolicyDto(
            UUID branchId,
            boolean enabled,
            BigDecimal ratePct,
            String label,
            boolean dineIn,
            boolean takeaway,
            boolean pickup,
            boolean canManage
    ) {}

    /**
     * PUT is a REPLACE — every field on every update, including the ones you are not changing.
     * The same rule {@code UpdateMenuItemRequest} and {@code UpdateTaxClassRequest} state, for the
     * same reason: this codebase has already paid for one wipe-by-omission on tax data.
     *
     * <p>{@code ratePct} is REQUIRED even when {@code enabled} is false, so that turning the charge
     * back on later shows the rate it used to be rather than a blank the user has to re-derive.
     * The service refuses {@code enabled} with a rate of zero — an armed control that charges
     * nothing is worse than an absent one — and the database refuses it too.
     */
    public record UpdateServiceChargeRequest(
            @NotNull Boolean enabled,
            @NotNull @DecimalMin("0.00") @DecimalMax("100.00") BigDecimal ratePct,
            @NotBlank @Size(max = 60) String label,
            @NotNull Boolean dineIn,
            @NotNull Boolean takeaway,
            @NotNull Boolean pickup
    ) {}

    private ServiceChargeDtos() {}
}
