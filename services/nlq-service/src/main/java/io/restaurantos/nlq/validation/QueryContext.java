package io.restaurantos.nlq.validation;

import java.util.UUID;

/**
 * The security context a query is validated against — built from {@code JwtClaims} at the
 * controller (plan 12-07). Pure data, no behaviour.
 *
 * @param tenantId       always ANDed into every table reference (Stage 5).
 * @param branchId       ANDed in for non-OWNER callers only (Stage 6). May be {@code null} for an
 *                       OWNER querying across branches.
 * @param roleCode       resolves the table allowlist (Stage 3) — see {@code nlq_allowed_tables}.
 * @param isOwner        OWNER-role users may query across branches; everyone else is branch-pinned.
 * @param userId         the acting user — written to {@code nlq_query_log} (plan 12-07).
 * @param impersonatedBy the NLQ-02 impersonation stamp, or {@code null} when not impersonating.
 */
public record QueryContext(UUID tenantId, UUID branchId, String roleCode, boolean isOwner,
                            UUID userId, UUID impersonatedBy) {
}
