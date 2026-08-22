package io.restaurantos.platform.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import io.restaurantos.shared.api.PageMeta;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The platform plane's window onto {@code auth_db.users} (superadmin plan).
 *
 * <h2>Why every one of these is an HTTP call and not a query</h2>
 *
 * <p>{@code users} lives in {@code auth_db}, which {@code platform_db} cannot reach: separate
 * databases, zero grants held by the platform roles in any of the 14 tenant databases, and
 * {@code platform_db} has only {@code plpgsql} installed — no {@code postgres_fdw}, no
 * {@code dblink}. That is measured, in {@code 040-platform-db-rls-posture.xml}, not assumed. The
 * table is also FORCE ROW LEVEL SECURITY on {@code app.current_tenant_id}, and {@code auth_user} is
 * {@code NOSUPERUSER NOBYPASSRLS}. There is exactly one door and this is it.
 *
 * <p><b>{@code X-Tenant-Id} is not decoration.</b> The producer sets the row-level-security GUC from
 * it and carries it in the query predicate as well, so a call without it does not leak — it matches
 * zero rows and reports success, which is worse. There is <b>no all-tenants user query anywhere in
 * this product</b>: a fleet-wide list is N calls, one per tenant, and
 * {@code PlatformUserDirectoryService} is explicit about paying that cost rather than hiding it.
 *
 * <h2>Two paths, two prefixes, and the difference is the whole security story</h2>
 *
 * <ul>
 *   <li>The READS are the ordinary tenant-tier seam, {@code /internal/auth/users}. Reads are
 *       exempt from {@code X-Acting-User-Id} at the producer — {@code X-Tenant-Id} alone bounds
 *       them, and there is no authority to compare against on a list or a fetch.</li>
 *   <li>The WRITES are {@code /internal/auth/platform/users}, a DIFFERENT path that exists so the
 *       platform tier's exemption from the role ceiling is structural. There is no value a caller
 *       can send that turns a tenant-tier write into a platform-tier one, and no field that could
 *       be defaulted the fail-open way round. Contrast the password reset, where one routine serves
 *       both tiers and {@code actorTier} in the body says which — correct there, weaker here.</li>
 * </ul>
 *
 * <p><b>None of these writes can grant anything.</b> They flip {@code is_active}, clear a lockout
 * counter, or revoke refresh sessions. There is deliberately no role-assignment method on this
 * client and none should be added: 13-02 split {@code rbac.manage} so a tenant admin could not mint
 * an OWNER, and a platform tier that could do it from above would undo that.
 *
 * <p>{@code contextId} is mandatory: {@link AuthInternalClient} already declares
 * {@code name = "auth-service"}, and two {@code @FeignClient}s sharing a name without distinct
 * context ids collide on the same {@code FeignClientSpecification} bean and fail the context at
 * startup.
 */
@FeignClient(
    name = "auth-service",
    contextId = "authUserDirectoryClient",
    url = "${restaurantos.auth-service.uri:}",
    configuration = FeignSharedConfig.class
)
public interface AuthUserDirectoryClient {

    /**
     * One page of ONE tenant's users.
     *
     * <p>The producer caps the page size at 200 and fixes the sort at {@code (email, id)}; a caller
     * asking for more gets the cap and {@code meta.totalCount} says how many there really are. The
     * sort is not a parameter there and is therefore not one here — an unstable sort makes page 2
     * omit and repeat rows.
     *
     * <p>{@code meta.page.nextCursor} carries the next page NUMBER, or null on the last page. That
     * is offset pagination wearing a cursor envelope, deliberately, so every list in the platform
     * has one shape.
     */
    @GetMapping("/internal/auth/users")
    UserPage list(@RequestHeader("X-Tenant-Id") UUID tenantId,
                  @RequestParam("page") int page,
                  @RequestParam("size") int size,
                  @RequestParam("activeOnly") boolean activeOnly,
                  @RequestParam(value = "search", required = false) String search,
                  @RequestParam(value = "status", required = false) String status,
                  @RequestParam(value = "roleCode", required = false) String roleCode);

    /**
     * One user of one tenant, with the branch-role assignments that decide what they can do.
     *
     * <p>Another tenant's id is <b>404</b> at the producer, never 403 — answering 403 would confirm
     * that the identifier names a real user somewhere, a cross-tenant existence oracle.
     */
    @GetMapping("/internal/auth/users/{userId}")
    UserDetailResponse get(@RequestHeader("X-Tenant-Id") UUID tenantId,
                           @PathVariable UUID userId);

    /**
     * A user's ACTIVE station assignments, grouped by branch.
     *
     * <p>Returned <b>UNWRAPPED</b> — {@code AuthInternalController.listStations} returns its list
     * directly with no {@code ApiResponse} envelope, unlike the user endpoints above. That
     * inconsistency is the producer's and is mirrored here rather than corrected, because a client
     * that assumes an envelope the producer does not send reads null and reports "no stations",
     * which is a legitimate and very common state and therefore gets triaged as configuration for a
     * week. This is the same class of defect as the fabricated branch id in audit B2.
     *
     * <p>A user with NO rows is not restricted — they see every station at their branch. So an
     * empty list here means "unrestricted", never "assigned to nothing", and a screen that renders
     * it as "no stations" says the opposite of the truth.
     */
    @GetMapping("/internal/auth/users/{userId}/stations")
    List<StationAssignment> stations(@PathVariable UUID userId,
                                     @RequestHeader("X-Tenant-Id") UUID tenantId);

    /** Flag off, refresh sessions revoked, row and assignments untouched. Never deletes. */
    @PostMapping("/internal/auth/platform/users/{userId}/deactivate")
    UserDetailResponse deactivate(@PathVariable UUID userId,
                                  @RequestHeader("X-Tenant-Id") UUID tenantId,
                                  @RequestHeader("X-Acting-User-Id") UUID actingPlatformUserId);

    /**
     * Flag on. Sessions are deliberately NOT restored: revocation is not reversible and should not
     * be, because the sessions revoked at deactivation may have been on a device the person no
     * longer has.
     */
    @PostMapping("/internal/auth/platform/users/{userId}/reactivate")
    UserDetailResponse reactivate(@PathVariable UUID userId,
                                  @RequestHeader("X-Tenant-Id") UUID tenantId,
                                  @RequestHeader("X-Acting-User-Id") UUID actingPlatformUserId);

    /**
     * Clear the brute-force lockout counter and timestamp.
     *
     * <p>Not the same operation as reactivating. {@code locked_until} is a fifteen-minute cooldown
     * that expires by itself; {@code is_active} is the durable lock. Both are exposed separately so
     * an operator cannot clear a timer and believe they disabled an account.
     */
    @PostMapping("/internal/auth/platform/users/{userId}/unlock")
    UserSecurityResponse unlock(@PathVariable UUID userId,
                                @RequestHeader("X-Tenant-Id") UUID tenantId,
                                @RequestHeader("X-Acting-User-Id") UUID actingPlatformUserId);

    /**
     * Sign a user out everywhere — revoke every live refresh session, account untouched.
     *
     * <p>The bound must reach the caller rather than be glossed: <b>already-issued ACCESS tokens
     * stay valid until they expire.</b> They are stateless and there is no revocation list, so
     * {@code sessionsRevoked} counts refresh sessions only and the residual window is the
     * access-token TTL.
     */
    @PostMapping("/internal/auth/platform/users/{userId}/revoke-sessions")
    UserSecurityResponse revokeSessions(@PathVariable UUID userId,
                                        @RequestHeader("X-Tenant-Id") UUID tenantId,
                                        @RequestHeader("X-Acting-User-Id") UUID actingPlatformUserId);

    // -- Typed contracts, mirroring auth-service's UserDtos field for field --------------------
    //
    // Typed rather than Map<String,Object> for the reason 13-10 paid for in UserInternalClient: a
    // map-shaped client cannot express a producer-side rename, so the read silently misses and the
    // saga carried a fabricated branch id into production for a whole phase. A typed record makes
    // the same mistake a compile error on this side.
    //
    // @JsonIgnoreProperties(ignoreUnknown = true) everywhere: auth-service may add a field to its
    // response, and a strict binding would turn that into a deserialisation failure on a call that
    // does not need it.

    /** {@code ApiResponse.paginated} - {@code {"data":[...],"meta":{...}}}. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record UserPage(List<UserSummary> data, PageMeta meta) {}

    /** {@code ApiResponse.ok} around {@code UserDtos.UserDetail}. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record UserDetailResponse(UserDetailData data) {}

    /** {@code ApiResponse.ok} around {@code UserDtos.UserSecurityState}. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record UserSecurityResponse(UserSecurityData data) {}

    /**
     * {@code UserDtos.UserSummary}. Carries no password, no hash, no TOTP secret and no
     * failed-login counter — the producer builds it by naming each field rather than serialising
     * {@code UserEntity}, on which {@code totp_secret} is a column.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record UserSummary(UUID id, String email, String fullName, String locale, boolean active,
                       boolean mustChangePassword, boolean totpEnabled,
                       Instant lastLoginAt, Instant createdAt) {}

    /**
     * {@code UserDtos.UserDetail}.
     *
     * <p>The assignments are part of the detail rather than a second call because a user with none
     * cannot log in at all — an empty list here is the visible form of an unusable account, which
     * is the exact failure blocker B2 was.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record UserDetailData(UserSummary user, List<UserAssignment> assignments) {}

    /**
     * {@code StationAssignmentResponse} — the stations a user works at one branch.
     *
     * <p>Station CODES, not ids: {@code pos_db} and {@code auth_db} are separate databases, so a
     * station id in {@code auth_db} would be a foreign key this codebase can neither declare nor
     * enforce. The code is the routing key everywhere downstream and cannot be changed once
     * created.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record StationAssignment(UUID branchId, List<String> stationCodes) {}

    /** {@code UserDtos.UserAssignment} - one active branch-role assignment. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record UserAssignment(UUID branchId, String roleCode, boolean primary, Long approvalLimitPaisa) {}

    /**
     * {@code UserDtos.UserSecurityState}.
     *
     * <p>{@code lockedUntil} null is a STATE — "not locked" — and not a missing value; it must not
     * render as a blank date. {@code sessionsRevoked} 0 honestly means the user held no live
     * refresh session, not that the call did nothing.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record UserSecurityData(UUID userId, String email, boolean active, Instant lockedUntil,
                            int failedLoginCount, int sessionsRevoked) {}
}
