package io.restaurantos.platform.dto;

import io.restaurantos.platform.client.AuthUserDirectoryClient.StationAssignment;
import io.restaurantos.platform.client.AuthUserDirectoryClient.UserAssignment;
import io.restaurantos.platform.client.AuthUserDirectoryClient.UserSummary;
import io.restaurantos.platform.entity.PlatformAdminAuditEntity;
import io.restaurantos.platform.entity.TenantEntity;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Wire shapes for the platform-tier user, RBAC and operator-audit surfaces (superadmin plan).
 *
 * <p>A holder class, following {@link PlatformDtos} rather than inventing a second convention. Kept
 * SEPARATE from it because that file is tenant lifecycle, subscription and impersonation and is
 * edited by other plans; a shared file serialises unrelated work for no reason but where a record
 * happened to live.
 *
 * <h2>The honesty rule these records are built to (D-38-16)</h2>
 *
 * <p>The precedent is {@link PlatformDtos.UsageMeter} and its {@code counted / notMetered /
 * unreadable} trichotomy: a figure the system cannot compute renders as a stated absence, never as
 * a number. Two places here needed it and both are marked:
 *
 * <ul>
 *   <li>{@link DirectoryScan} — there is <b>no cross-tenant user query anywhere in this product</b>.
 *       {@code auth_db.users} is FORCE row-level security and reachable only one tenant at a time
 *       over HTTP, so a fleet-wide list is N calls. When any of those N fails, the total is
 *       genuinely unknown and is reported as null with a reason rather than as a smaller number
 *       that looks complete.</li>
 *   <li>{@link UserActivity} — {@code last_login_at} is the ONLY activity signal this platform
 *       records about a user. Null means "has never signed in", which is a real and important
 *       state, not a missing value; and there is no session count, no last-seen, no action count
 *       anywhere to derive anything richer from.</li>
 * </ul>
 */
public final class PlatformUserDtos {

    private PlatformUserDtos() {}

    // ── Requests ─────────────────────────────────────────────────────────────────────────────

    /**
     * The reason, and nothing else — the body of every platform-tier mutation on a tenant user.
     *
     * <p>{@code @NotBlank} because every one of them is audited and a row that cannot say why is
     * one somebody has to interpret rather than read (T-13-13-E). Deliberately identical in shape
     * to {@code PlatformUserAdminController.PlatformResetRequest}, so a reviewer comparing the
     * password reset with the newer lifecycle actions sees the same contract rather than having to
     * check whether the newer ones quietly made the reason optional.
     *
     * <p><b>There is no acting-administrator field, and that absence is the enforcement.</b> A body
     * field naming the actor is a field a caller can fill in with somebody else's name, which is
     * precisely what a repudiation control must not permit (T-13-13-G). The acting id comes from
     * the {@code sub} of the verified control-plane token and nowhere else.
     */
    public record PlatformActionRequest(@NotBlank @Size(max = 500) String reason) {}

    // ── The cross-tenant user directory ──────────────────────────────────────────────────────

    /**
     * One user, carrying the tenant they belong to.
     *
     * <p>The tenant fields are denormalised onto every row on purpose. A cross-tenant grid whose
     * rows say only {@code userId} forces the reader to resolve 50 tenant ids by eye, and the slug
     * is the identifier a platform operator actually recognises — it is what login resolves a
     * tenant by.
     *
     * <p>Carries no password hash, no TOTP secret and no failed-login counter: the producer builds
     * its summary by naming each field rather than serialising {@code UserEntity}, on which
     * {@code totp_secret} is a column, and this record mirrors that discipline.
     *
     * @param lockedUntil deliberately ABSENT from this row and present only on the detail. The list
     *                    endpoint's upstream summary does not carry it, and inventing a
     *                    {@code false} for "locked" on every row would be a fabricated column.
     */
    public record PlatformUserRow(
        UUID tenantId,
        String tenantSlug,
        String tenantBrandName,
        UUID userId,
        String email,
        String fullName,
        String locale,
        boolean active,
        boolean mustChangePassword,
        boolean totpEnabled,
        Instant lastLoginAt,
        Instant createdAt
    ) {
        public static PlatformUserRow of(TenantEntity tenant, UserSummary user) {
            return new PlatformUserRow(tenant.getId(), tenant.getSlug(), tenant.getBrandName(),
                user.id(), user.email(), user.fullName(), user.locale(), user.active(),
                user.mustChangePassword(), user.totpEnabled(), user.lastLoginAt(),
                user.createdAt());
        }
    }

    /**
     * A tenant the directory could not read, and why.
     *
     * <p>Named individually rather than counted. "3 tenants unreachable" tells an operator that
     * their list is wrong; naming them tells them WHICH restaurant is missing from it, which is the
     * difference between a warning they can act on and one they learn to ignore.
     *
     * <p>{@code detail} carries the upstream's structured error code where there was one — never a
     * raw exception message, which names the internal scheme, host and port.
     */
    public record UnreachableTenant(UUID tenantId, String tenantSlug, String detail) {}

    /**
     * The provenance of a cross-tenant scan — how the list in front of you was actually obtained.
     *
     * <p><b>This exists because there is no cross-tenant user query.</b> {@code auth_db.users} is
     * FORCE row-level security on {@code app.current_tenant_id}, {@code platform_db} holds no grant
     * in {@code auth_db} and has no FDW or dblink, and the only door is one HTTP call per tenant.
     * So a "list every user" screen is N calls with N chances to fail, and a response that hid that
     * would be a grid quietly missing a restaurant.
     *
     * @param tenantsMatched  how many tenants matched the filter
     * @param tenantsScanned  how many were actually queried. Less than matched means the fan-out
     *                        cap bit — see {@link #truncated}
     * @param unreachable     the tenants whose users could not be read on THIS request. Their users
     *                        are absent from the page and are NOT counted in the total
     * @param truncated       the fan-out cap stopped the scan short. The page is a prefix of the
     *                        real answer, in slug order, and the caller must narrow by tenant
     * @param totalCount      the real total across every scanned tenant, or <b>null when it is not
     *                        knowable</b> — any unreachable tenant, or a truncated scan, makes it
     *                        unknown. A smaller number that looks complete is the D-38-16 violation
     *                        this field exists to refuse
     * @param totalCountNote  plain language: why the total is null, or null when it is exact. An
     *                        operator looking at a blank total is owed the reason
     */
    public record DirectoryScan(
        int tenantsMatched,
        int tenantsScanned,
        List<UnreachableTenant> unreachable,
        boolean truncated,
        Long totalCount,
        String totalCountNote
    ) {
        /** Every tenant answered and nothing was cut short: the total is exact. */
        public static DirectoryScan complete(int matched, long totalCount) {
            return new DirectoryScan(matched, matched, List.of(), false, totalCount, null);
        }

        /** Something was missed. The total is withheld, and the reason travels with it. */
        public static DirectoryScan partial(int matched, int scanned,
                                            List<UnreachableTenant> unreachable,
                                            boolean truncated, String why) {
            return new DirectoryScan(matched, scanned, List.copyOf(unreachable), truncated,
                null, why);
        }
    }

    /**
     * A page of the cross-tenant directory: the rows, and how they were obtained.
     *
     * <p>The scan block is part of the DATA rather than a warning header because a client that has
     * to opt in to noticing an incomplete answer will not.
     */
    public record PlatformUserPage(List<PlatformUserRow> users, DirectoryScan scan) {}

    // ── User detail ──────────────────────────────────────────────────────────────────────────

    /**
     * The tenant a user belongs to, as much of it as a user screen needs.
     *
     * <p>{@code status} matters here and is not decoration: a perfectly healthy-looking user of a
     * SUSPENDED tenant cannot log in, and a screen that shows the account as active without saying
     * so sends an operator looking for a fault in the account.
     */
    public record TenantMembership(UUID tenantId, String slug, String brandName,
                                   String status, String tier) {
        public static TenantMembership of(TenantEntity tenant) {
            return new TenantMembership(tenant.getId(), tenant.getSlug(), tenant.getBrandName(),
                tenant.getStatus() == null ? null : tenant.getStatus().name(),
                tenant.getTier() == null ? null : tenant.getTier().name());
        }
    }

    /**
     * One branch-role assignment.
     *
     * <p>{@code branchId} is returned as an id and is NOT resolved to a branch name, deliberately.
     * Branches live in {@code user_db} and this service reaches them only through
     * {@code UserInternalClient.listBranches}, one call per tenant; resolving names here would put
     * an extra cross-service call on a detail screen to decorate a field. The honest answer is the
     * id — the same call {@code ImpersonationRecord} makes about {@code targetUserId}.
     *
     * @param approvalLimitPaisa BIGINT paisa, never a float and never rupees. Null means no
     *                           per-assignment limit, which is a state and not a zero
     */
    public record BranchRoleView(UUID branchId, String roleCode, boolean primary,
                                 Long approvalLimitPaisa) {
        public static BranchRoleView of(UserAssignment assignment) {
            return new BranchRoleView(assignment.branchId(), assignment.roleCode(),
                assignment.primary(), assignment.approvalLimitPaisa());
        }
    }

    /**
     * The stations a user works at one branch.
     *
     * <p><b>An empty {@code stationCodes} means UNRESTRICTED, not "assigned to nothing".</b> A user
     * with no station rows sees every station at their branch — that is what every user in the
     * product has by default, encoded as an absent claim key rather than an empty list. A screen
     * that renders this as "no stations" says the opposite of the truth, which is why
     * {@link #unrestricted} is a field and not something a client infers from a list length.
     */
    public record StationScopeView(UUID branchId, List<String> stationCodes, boolean unrestricted) {
        public static StationScopeView of(StationAssignment assignment) {
            List<String> codes = assignment.stationCodes() == null
                ? List.of() : List.copyOf(assignment.stationCodes());
            return new StationScopeView(assignment.branchId(), codes, codes.isEmpty());
        }
    }

    /**
     * What this platform actually records about a user's activity — which is one timestamp.
     *
     * <p>Stated as a shape rather than a bare nullable field because the two nulls mean different
     * things and a client must not collapse them. There is no session count, no last-seen, no
     * per-user action counter and no {@code usage_records} producer anywhere in the product; a
     * "last active" tile beyond this would be invented.
     *
     * @param lastLoginAt  the last SUCCESSFUL login, from {@code auth_db.users.last_login_at}, or
     *                     null
     * @param hasEverSignedIn false when {@code lastLoginAt} is null — which is a real state
     *                     ("provisioned, never used", the shape of a locked-out tenant) and must
     *                     never render as a blank date
     * @param note         the standing caveat: login history at attempt-level granularity exists in
     *                     {@code audit_db.audit_events} and the platform plane cannot read it
     *                     (separate database, FORCE RLS per partition, no platform-tier read). So
     *                     this is current state only — it cannot answer "how often" or "from where"
     */
    public record UserActivity(Instant lastLoginAt, boolean hasEverSignedIn, String note) {
        private static final String NOTE =
            "Current state only. Attempt-level login history lives in audit_db.audit_events, which "
                + "the platform plane cannot read — separate database, FORCE row-level security on "
                + "every partition, and no platform-tier read endpoint exists.";

        public static UserActivity of(Instant lastLoginAt) {
            return new UserActivity(lastLoginAt, lastLoginAt != null, NOTE);
        }
    }

    /**
     * Everything the platform can honestly say about one user.
     *
     * @param stationScopes null when station assignments could not be read on this request.
     *                      <b>Null and empty are different answers</b> and are kept apart for the
     *                      UsageMeter reason: empty means "unrestricted at every branch they work",
     *                      null means "we did not find out", and rendering the second as the first
     *                      tells an operator a user has full station access when nobody knows.
     * @param stationScopeNote why {@code stationScopes} is null, or null when it was read
     */
    public record PlatformUserDetail(
        TenantMembership tenant,
        UUID userId,
        String email,
        String fullName,
        String locale,
        boolean active,
        boolean mustChangePassword,
        boolean totpEnabled,
        Instant createdAt,
        UserActivity activity,
        List<BranchRoleView> branchRoles,
        List<StationScopeView> stationScopes,
        String stationScopeNote,
        boolean loginable,
        String loginableNote
    ) {}

    // ── RBAC (read-only) ─────────────────────────────────────────────────────────────────────

    /**
     * One role and what it grants.
     *
     * @param system true for a platform-defined role ({@code tenant_id IS NULL}) — global,
     *               identical for every tenant, and NOT editable by anyone. False for a role a
     *               tenant defined for itself
     * @param mutableByPlatform always false, and it is a FIELD rather than an omission so that a
     *               console renders "read-only" from the API instead of hardcoding an assumption
     *               that could silently go stale. See {@link RoleCatalogResponse} for why the
     *               platform tier has no write path here
     * @param assignedUserCount how many DISTINCT people in the named tenant hold it; 0 when no
     *               tenant was named, because holders are a per-tenant fact and a global number
     *               would be a sum nobody asked for
     */
    public record PlatformRole(String code, String name, boolean system, List<String> permissions,
                               long assignedUserCount, boolean mutableByPlatform) {}

    /** One permission code, with the module that owns it. */
    public record PlatformPermission(String code, String module, String description) {}

    /** One module and the permission codes it owns. */
    public record PlatformPermissionModule(String module, List<PlatformPermission> permissions) {}

    /**
     * The role catalogue, with the reason it is read-only stated in the response itself.
     *
     * <p>{@code readOnlyReason} is not documentation-in-a-payload for its own sake. A platform
     * console that shows roles will grow an Edit button unless the API says, in the response a
     * developer is already reading, why there is nothing to call. The reason is real: composing a
     * role IS granting authority; the tenant tier bounds that with the role ceiling (every
     * permission a role grants must be one the assigner already holds); and a platform operator
     * holds no {@code user_branch_roles} at all, so there is no ceiling to bound them. 13-02 split
     * {@code rbac.manage} precisely so a tenant admin could not mint an OWNER — a platform-tier
     * role editor would hand that capability back one layer up.
     *
     * @param tenantId the tenant this catalogue was read for, or null for the global one
     * @param scope    {@code GLOBAL} when no tenant was named, {@code TENANT} otherwise. Explicit
     *                 because "9 roles" means different things in the two cases
     */
    public record RoleCatalogResponse(UUID tenantId, String scope, List<PlatformRole> roles,
                                      String readOnlyReason) {
        public static final String READ_ONLY_REASON =
            "Roles are read-only to the platform tier. Composing a role is granting authority, and "
                + "the tenant tier bounds that with the role ceiling — an assigner may only grant "
                + "permissions they already hold. A platform operator holds no user_branch_roles, "
                + "so there is no ceiling to bound them; a platform-tier role editor would let one "
                + "author a role granting anything and place it in any tenant, which is the "
                + "escalation 13-02 split rbac.manage to prevent. System roles are seeded by "
                + "Liquibase and are global; tenant custom roles are edited by that tenant's own "
                + "administrators through POST/PUT/DELETE /api/v1/roles, which keeps its ceiling.";
    }

    /**
     * The role x permission matrix, in the shape a grid actually renders.
     *
     * <p>Computed here rather than left to the client to derive from {@link RoleCatalogResponse}:
     * every client would otherwise re-derive the column order, and two consoles showing the same
     * matrix with different column orders is a diff nobody can read. The permission codes are the
     * columns, in module-major order — the same order the catalogue returns them in, which is the
     * database's, so it cannot disagree with the legend beside it.
     *
     * @param permissionCodes the columns, in order
     * @param rows            one per role, each holding the granted subset. Granted codes are given
     *                        as a SET rather than a positional boolean array so that adding a
     *                        permission cannot silently shift every role's grants by one column
     */
    public record RolePermissionMatrix(UUID tenantId, String scope, List<String> permissionCodes,
                                       List<MatrixRow> rows, String readOnlyReason) {}

    /** One role's row of the matrix. */
    public record MatrixRow(String roleCode, String roleName, boolean system,
                            List<String> grantedPermissionCodes, long assignedUserCount) {}

    // ── Operator audit ───────────────────────────────────────────────────────────────────────

    /**
     * One platform-operator action, as the console reads it back.
     *
     * <p>Never carries a credential. The platform password reset hands a temporary password to the
     * operator once and it exists nowhere else — not in a log, not in an event, not in the audit
     * row, and not here.
     *
     * @param tenantSlug resolved from {@code platform_db.tenants} at READ time, because the tenant
     *                   row is in this database and a slug is immutable (nothing propagates a
     *                   rename to auth-service, so the product does not permit one). Contrast
     *                   {@code platformUserEmail}, which is stored at WRITE time because the
     *                   SuperAdmin credential IS rotated and a trail that re-resolves its own
     *                   actors changes its own history
     * @param detail     plain language "what happened" — {@code sessionsRevoked=3},
     *                   {@code active=false}, or an upstream refusal code
     */
    public record PlatformAuditRecord(
        UUID id,
        Instant occurredAt,
        UUID platformUserId,
        String platformUserEmail,
        String action,
        String outcome,
        UUID tenantId,
        String tenantSlug,
        UUID targetUserId,
        String reason,
        String detail
    ) {
        public static PlatformAuditRecord of(PlatformAdminAuditEntity row, String tenantSlug) {
            return new PlatformAuditRecord(row.getId(), row.getOccurredAt(),
                row.getPlatformUserId(), row.getPlatformUserEmail(),
                row.getAction() == null ? null : row.getAction().name(),
                row.getOutcome() == null ? null : row.getOutcome().name(),
                row.getTenantId(), tenantSlug, row.getTargetUserId(),
                row.getReason(), row.getDetail());
        }
    }
}
