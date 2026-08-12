package io.restaurantos.auth.dto.response;

import java.util.List;

/**
 * Wire shapes for the role and permission catalog (D-14).
 *
 * <p>A holder class rather than five top-level files, following the convention this codebase
 * already uses for grouped DTOs ({@code BranchDtos} in user-service). The records are deliberately
 * flat and carry no entity: {@code RoleEntity} has {@code id} and {@code tenantId} columns, and
 * serialising it would publish a tenant identifier on a response whose whole purpose is to be
 * tenant-agnostic vocabulary.
 */
public final class RoleCatalogDtos {

    private RoleCatalogDtos() {
    }

    /**
     * One assignable role.
     *
     * @param code        the value a caller passes as {@code roleCode} when assigning — the same
     *                    string {@code RoleCatalog.requireKnown} validates against (D-13/D-14).
     * @param name        the human label, for a picker.
     * @param system      true for a platform-defined role, false for one this tenant defined. A
     *                    picker needs the distinction: a system role cannot be edited, and a
     *                    tenant role can.
     * @param permissions the codes this role grants, sorted.
     * @param assignedUserCount how many DISTINCT people in this tenant currently hold the role
     *                    (S3). A roles screen has to answer "is anything using this?" before an
     *                    administrator will touch it, and it is the same number the delete refusal
     *                    counts — computed once, in the same pass, so the list and the refusal
     *                    cannot disagree. Zero for a role nobody holds, never null.
     */
    public record RoleEntry(String code, String name, boolean system, List<String> permissions,
                            long assignedUserCount) {

        /**
         * A role whose holders have not been counted — used by the write paths, which return the
         * role they just wrote rather than a list row.
         *
         * <p>A freshly created role has no holders by construction, and an edited one's count did
         * not change; recounting on the write path would be a query whose only purpose is to
         * restate something the client already has.
         */
        public RoleEntry(String code, String name, boolean system, List<String> permissions) {
            this(code, name, system, permissions, 0L);
        }
    }

    /**
     * The result of a catalog read, plus the count of roles withheld as above the caller's ceiling.
     *
     * <p>The count is carried out of the service rather than computed by the controller so that
     * "how many were withheld" cannot drift from "which were returned" — they are produced by the
     * same pass over the same list.
     */
    public record AssignableRoles(List<RoleEntry> roles, int withheldAboveCeiling) {
    }

    /**
     * One permission.
     *
     * <p>{@code module} is repeated here even though the entry sits inside its module's group. A
     * caller that flattens the response — which any client filling a search box will — would
     * otherwise lose the grouping dimension entirely.
     */
    public record PermissionEntry(String code, String module, String description) {
    }

    /** One module and the permissions it owns, codes sorted. */
    public record PermissionModule(String module, List<PermissionEntry> permissions) {
    }
}
