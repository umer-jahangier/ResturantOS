package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.enums.TaxBase;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/** Wire contracts for a tenant's sales-tax base position (V27). */
public class TaxPolicyDtos {

    /**
     * The tenant's position, as read.
     *
     * <p>Always answered, never 404 — the same rule {@code ServiceChargePolicyDto} states, for the
     * same reason. A tenant nobody has configured HAS a position, and that position is
     * {@link TaxBase#NET}. Returning "not found" would make a caller guess whether it is looking
     * at an unconfigured tenant or a broken read, and here the guess decides what gets remitted.
     *
     * @param configured whether a row actually exists. Distinct from {@code taxBase} on purpose:
     *                   "nobody has looked at this and it defaults to NET" and "somebody chose NET"
     *                   are the same arithmetic and very different facts to an auditor asking who
     *                   decided.
     * @param canManage  whether the caller may change it. On the wire so a screen can render
     *                   read-only for a MANAGER rather than refusing them the page — a manager
     *                   asked why a discounted bill's tax looks the way it does needs to be able
     *                   to look up the answer.
     */
    public record TaxPolicyDto(
            UUID tenantId,
            TaxBase taxBase,
            boolean configured,
            boolean canManage
    ) {}

    /**
     * PUT is a REPLACE, the same rule {@code UpdateServiceChargeRequest} and
     * {@code UpdateMenuItemRequest} state.
     *
     * <p>One field, and it is still {@code @NotNull} rather than defaulted: a request body that
     * omits the tax base must be refused, not silently read as NET. This endpoint decides what a
     * tenant remits, and the one thing it must never do is guess.
     */
    public record UpdateTaxPolicyRequest(
            @NotNull TaxBase taxBase
    ) {}

    private TaxPolicyDtos() {}
}
