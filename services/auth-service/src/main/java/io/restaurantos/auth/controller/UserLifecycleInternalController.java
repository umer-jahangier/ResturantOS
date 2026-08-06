package io.restaurantos.auth.controller;

import io.restaurantos.auth.dto.request.CreateUserRequest;
import io.restaurantos.auth.dto.request.UpdateUserRequest;
import io.restaurantos.auth.dto.response.UserDtos.CreatedUser;
import io.restaurantos.auth.dto.response.UserDtos.UserDetail;
import io.restaurantos.auth.dto.response.UserDtos.UserSummary;
import io.restaurantos.auth.exception.ActingUserRequiredException;
import io.restaurantos.auth.service.UserLifecycleService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.api.PageMeta;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * The internal user lifecycle (D-11, blocker B3) — auth-service is the system of record for
 * {@code users}, and 13-12 puts the public, authorized surface in front of these.
 *
 * <pre>
 *   GET    /internal/auth/users                       list, paginated
 *   GET    /internal/auth/users/{userId}              one user + assignments
 *   POST   /internal/auth/users                       create, returns a one-time temp password
 *   PATCH  /internal/auth/users/{userId}              name / locale / active
 *   POST   /internal/auth/users/{userId}/deactivate   flag off + sessions revoked
 *   POST   /internal/auth/users/{userId}/reactivate   flag on, sessions NOT restored
 * </pre>
 *
 * <p>All are under {@code /internal/auth/**}, gated by {@code InternalServiceFilter}'s
 * constant-time shared secret, and the gateway deliberately maps no route there — asserted live at
 * 404 by 13-06. There is no {@code @PreAuthorize} here because there is no JWT here; authorization
 * of the human is 13-12's job, and what THIS layer enforces is the part 13-12 cannot: the role
 * ceiling, which needs the target role's permission set and therefore can only be evaluated by the
 * service that owns {@code role_permissions}.
 *
 * <h2>The two headers</h2>
 *
 * <p>{@code X-Tenant-Id} names the tenant whose rows are touched. It sets the row-level-security
 * GUC and is carried into every query's predicate, and it follows the convention the existing
 * internal branch-role endpoints already use.
 *
 * <p>{@code X-Acting-User-Id} names the human on whose behalf a write is made, and is <b>required
 * on every write</b>. See {@link #ACTING_USER_HEADER}.
 */
@RestController
@RequestMapping("/internal/auth/users")
public class UserLifecycleInternalController {

    /**
     * Who is asking — the missing half of the internal seam, added by 13-11.
     *
     * <h2>Why it had to exist</h2>
     *
     * <p>{@code /internal/auth/**} carried no identity at all. auth-service therefore could not
     * answer "may THIS person grant THAT role", and the only place the check could live was the
     * calling service — where anything reaching the internal port bypasses it. The measurable
     * consequence, reproduced live by 13-07: a TENANT_ADMIN assigning OWNER was answered 200, and
     * could then log in as that account holding {@code rbac.manage}, the umbrella permission 13-02
     * split the tenant-administration authority precisely in order to withhold.
     *
     * <h2>Who is authoritative for its value</h2>
     *
     * <p><b>The calling service, from a verified JWT — never a client.</b> user-service and
     * platform-admin-service both authenticate the caller before they delegate here, and it is the
     * subject of that verified token that must be forwarded. Three things keep a client from
     * supplying it:
     *
     * <ol>
     *   <li>the gateway maps no route to {@code /internal/**}, so an external request cannot reach
     *       this path at all;</li>
     *   <li>{@code InternalServiceFilter} refuses anything without the shared secret, which no
     *       client has;</li>
     *   <li>{@code StripInternalHeaderFilter} deletes this header from every inbound request at the
     *       edge, unconditionally and before authentication — the same treatment
     *       {@code X-Internal-Service} and {@code X-TOTP-Verified} get, so a route added later
     *       without reading this file cannot reopen it.</li>
     * </ol>
     *
     * <p>And the header is only an IDENTITY. auth-service does not trust a forwarded permission
     * list; it recomputes what that user may do from {@code user_branch_roles} and
     * {@code role_permissions} on every call ({@link io.restaurantos.auth.service.RoleCeiling}), so
     * a stale or inflated claim about the caller's authority buys nothing.
     *
     * <h2>Required, not optional</h2>
     *
     * <p>An optional identity header disables a security check when omitted, silently, and would be
     * omitted by the first caller written by someone who had not read this. Absence is a 403
     * {@code ACTING_USER_REQUIRED}, and an id that does not resolve to a user with active
     * assignments in this tenant yields the empty permission set — which permits only a role that
     * grants nothing. Both directions fail closed.
     *
     * <p>Reads are exempt: {@code X-Tenant-Id} alone bounds them, and there is no authority to
     * compare against on a list or a fetch.
     */
    public static final String ACTING_USER_HEADER = "X-Acting-User-Id";
    private static final String TENANT_HEADER = "X-Tenant-Id";

    private final UserLifecycleService userLifecycleService;

    public UserLifecycleInternalController(UserLifecycleService userLifecycleService) {
        this.userLifecycleService = userLifecycleService;
    }

    /**
     * One page of this tenant's users.
     *
     * <p>Pagination is mandatory and the page size is capped in the service (T-13-11-H); a caller
     * asking for more gets the cap, and {@code meta.totalCount} tells them how many there are. The
     * sort is fixed at {@code (email, id)} and is not a parameter — an unstable sort makes page 2
     * omit and repeat rows, and offering the choice would let a caller select an order no index
     * serves.
     *
     * <p>The cursor fields carry the page NUMBER. {@link PageMeta} is shaped for cursor pagination
     * and this is offset pagination; putting the number where a cursor goes keeps one envelope for
     * every list in the platform rather than inventing a second, and {@code nextCursor} is null on
     * the last page, which is the question a client actually asks.
     */
    @GetMapping
    public ResponseEntity<ApiResponse<List<UserSummary>>> list(
            @RequestHeader(TENANT_HEADER) UUID tenantId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "0") int size,
            @RequestParam(defaultValue = "false") boolean activeOnly,
            @RequestParam(required = false) String search) {
        Page<UserSummary> result = userLifecycleService.list(tenantId, page, size, activeOnly, search);
        PageMeta meta = new PageMeta(
            new PageMeta.Page(
                String.valueOf(result.getNumber()),
                result.hasNext() ? String.valueOf(result.getNumber() + 1) : null,
                result.getSize()),
            result.getTotalElements());
        return ResponseEntity.ok(ApiResponse.paginated(result.getContent(), meta));
    }

    /** One user of this tenant. Another tenant's id is 404, never 403 — see the service. */
    @GetMapping("/{userId}")
    public ResponseEntity<ApiResponse<UserDetail>> get(
            @RequestHeader(TENANT_HEADER) UUID tenantId,
            @PathVariable UUID userId) {
        return ResponseEntity.ok(ApiResponse.ok(userLifecycleService.get(tenantId, userId)));
    }

    /**
     * Create a user, optionally with a branch role, and return the temporary password ONCE.
     *
     * <p>201, because a resource was created. The body's {@code tempPassword} exists nowhere else —
     * the caller must deliver it out of band, and must not log it.
     */
    @PostMapping
    public ResponseEntity<ApiResponse<CreatedUser>> create(
            @RequestHeader(TENANT_HEADER) UUID tenantId,
            @RequestHeader(value = ACTING_USER_HEADER, required = false) UUID actingUserId,
            @Valid @RequestBody CreateUserRequest request) {
        requireActingUser(actingUserId, "POST /internal/auth/users");
        return ResponseEntity.status(201)
            .body(ApiResponse.ok(userLifecycleService.create(tenantId, actingUserId, request)));
    }

    /**
     * Change name, locale and the active flag. A body carrying a password field is refused with
     * 400 rather than ignored.
     *
     * <p>PATCH rather than PUT: every field is optional and a null field is left alone, so this is
     * a partial update and saying so in the method is how a client knows it will not blank the
     * fields it did not send.
     */
    @PatchMapping("/{userId}")
    public ResponseEntity<ApiResponse<UserDetail>> update(
            @RequestHeader(TENANT_HEADER) UUID tenantId,
            @RequestHeader(value = ACTING_USER_HEADER, required = false) UUID actingUserId,
            @PathVariable UUID userId,
            @Valid @RequestBody UpdateUserRequest request) {
        requireActingUser(actingUserId, "PATCH /internal/auth/users/{userId}");
        return ResponseEntity.ok(
            ApiResponse.ok(userLifecycleService.update(tenantId, actingUserId, userId, request)));
    }

    /** Flag off, refresh sessions revoked, row and assignments untouched. Never deletes. */
    @PostMapping("/{userId}/deactivate")
    public ResponseEntity<ApiResponse<UserDetail>> deactivate(
            @RequestHeader(TENANT_HEADER) UUID tenantId,
            @RequestHeader(value = ACTING_USER_HEADER, required = false) UUID actingUserId,
            @PathVariable UUID userId) {
        requireActingUser(actingUserId, "POST /internal/auth/users/{userId}/deactivate");
        return ResponseEntity.ok(
            ApiResponse.ok(userLifecycleService.setActive(tenantId, actingUserId, userId, false)));
    }

    /** Flag on. Sessions are deliberately NOT restored — see the service for why. */
    @PostMapping("/{userId}/reactivate")
    public ResponseEntity<ApiResponse<UserDetail>> reactivate(
            @RequestHeader(TENANT_HEADER) UUID tenantId,
            @RequestHeader(value = ACTING_USER_HEADER, required = false) UUID actingUserId,
            @PathVariable UUID userId) {
        requireActingUser(actingUserId, "POST /internal/auth/users/{userId}/reactivate");
        return ResponseEntity.ok(
            ApiResponse.ok(userLifecycleService.setActive(tenantId, actingUserId, userId, true)));
    }

    /**
     * Declared {@code required = false} on each mapping and rejected here, rather than
     * {@code required = true}.
     *
     * <p>Spring's own refusal is a 400 {@code BAD_REQUEST} indistinguishable from a malformed body;
     * this is an authorization failure and deserves its own code, its own status and a message that
     * says what the calling service must do. It is no less mandatory for being enforced by hand —
     * one line per endpoint, and every endpoint has it.
     */
    private static void requireActingUser(UUID actingUserId, String operation) {
        if (actingUserId == null) {
            throw new ActingUserRequiredException(operation);
        }
    }
}
