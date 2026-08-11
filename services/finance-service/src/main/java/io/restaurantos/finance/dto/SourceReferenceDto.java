package io.restaurantos.finance.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * What produced a journal entry, in words an owner recognises — or an explicit statement that it
 * cannot be said (37-04, D-37-01 + D-37-05).
 *
 * <h2>Four outcomes, deliberately distinguishable</h2>
 *
 * <table>
 *   <tr><th>state</th><th>meaning</th></tr>
 *   <tr><td>{@code RESOLVED}</td><td>the source was read; the human-readable fields are populated</td></tr>
 *   <tr><td>{@code NOT_APPLICABLE}</td><td>a hand-written adjustment — there is no source at all</td></tr>
 *   <tr><td>{@code UNSUPPORTED_SOURCE_TYPE}</td><td>finance knows this source type but has no lookup for it</td></tr>
 *   <tr><td>{@code LOOKUP_FAILED}</td><td>there IS a source and it could not be read; {@code reason} says why</td></tr>
 * </table>
 *
 * <p>Collapsing these is how a screen ends up printing one dash that means four different things —
 * and an owner cannot tell "this was typed in by hand" from "the order service is down" from
 * "we don't know how to look this up". Those demand three different reactions.
 *
 * <p>{@code state} is an enum precisely so a client can branch on it without parsing free text.
 * D-37-05: never invent a number, and never invent a name either.
 */
public record SourceReferenceDto(
        State state,
        /** Always present — the raw source identifier, so a client can still link even when unresolved. */
        String sourceType,
        UUID sourceId,
        /** Populated only when {@link State#RESOLVED}. */
        String orderNo,
        UUID branchId,
        UUID cashierId,
        Instant closedAt,
        /** Populated only when {@link State#LOOKUP_FAILED} or {@link State#UNSUPPORTED_SOURCE_TYPE}. */
        String reason
) {

    public enum State {
        RESOLVED,
        NOT_APPLICABLE,
        UNSUPPORTED_SOURCE_TYPE,
        LOOKUP_FAILED
    }

    /**
     * The same resolved source, restated for a sibling entry's own source type.
     *
     * <p>One order id needs one lookup, but the entries it produced are not interchangeable: the
     * revenue entry and the cost-of-sales entry share an order number and differ in why they exist.
     * Reusing one reference object verbatim across both told a client the COGS entry was a revenue
     * entry — caught live, against a real order, before this shipped.
     */
    public SourceReferenceDto forSourceType(String ownSourceType) {
        if (ownSourceType == null || ownSourceType.equals(this.sourceType)) {
            return this;
        }
        return new SourceReferenceDto(state, ownSourceType, sourceId,
                orderNo, branchId, cashierId, closedAt, reason);
    }

    public static SourceReferenceDto resolved(String sourceType, UUID sourceId, String orderNo,
                                              UUID branchId, UUID cashierId, Instant closedAt) {
        return new SourceReferenceDto(State.RESOLVED, sourceType, sourceId,
                orderNo, branchId, cashierId, closedAt, null);
    }

    /** A hand-written adjustment. There is nothing to look up, and that is not a failure. */
    public static SourceReferenceDto notApplicable() {
        return new SourceReferenceDto(State.NOT_APPLICABLE, null, null, null, null, null, null,
                "Entered by hand — this entry has no source document");
    }

    public static SourceReferenceDto unsupported(String sourceType, UUID sourceId) {
        return new SourceReferenceDto(State.UNSUPPORTED_SOURCE_TYPE, sourceType, sourceId,
                null, null, null, null,
                "No lookup exists for source type '" + sourceType + "'");
    }

    public static SourceReferenceDto lookupFailed(String sourceType, UUID sourceId, String reason) {
        return new SourceReferenceDto(State.LOOKUP_FAILED, sourceType, sourceId,
                null, null, null, null, reason);
    }
}
