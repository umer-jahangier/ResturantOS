package io.restaurantos.auth.controller;

import io.restaurantos.auth.exception.ActingUserRequiredException;
import io.restaurantos.auth.service.AdminPasswordResetService;
import io.restaurantos.auth.service.AdminPasswordResetService.ActorTier;
import io.restaurantos.auth.service.AdminPasswordResetService.AdminResetResult;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * The one internal reset routine both public tiers call (13-13, D-16).
 *
 * <pre>
 *   POST /internal/auth/users/{userId}/password-reset
 *        headers: X-Internal-Service, X-Tenant-Id, X-Acting-User-Id
 *        body:    {"actorTier":"TENANT"|"PLATFORM", "reason":"…"}
 *     →  200 {"data":{"userId","email","tempPassword","mustChangePassword"}}
 * </pre>
 *
 * <p>Deliberately a separate class from {@link UserLifecycleInternalController} even though it
 * shares that path prefix: the lifecycle surface administers a user RECORD, this one takes over a
 * user's CREDENTIAL, and the two have different blast radii and different reviewers. It is one
 * endpoint because there must be exactly one implementation of "reset a password on somebody's
 * behalf" — two that agree on day one and drift afterwards is the recurring finding of the audit
 * that produced this phase.
 *
 * <p>Gated by {@code InternalServiceFilter}'s constant-time shared secret, and the gateway maps no
 * route to {@code /internal/**} — asserted live at 404 by 13-06. There is no {@code @PreAuthorize}
 * here because there is no JWT here: authorization of the HUMAN belongs to whichever public tier
 * called (the user-administration authority at the tenant tier, {@code SUPER_ADMIN} at the
 * platform tier), and what THIS layer enforces is the part neither of them can — the tenant
 * boundary and the role ceiling, both of which need tables only auth-service holds.
 *
 * <h2>The three inputs that are not the caller's to choose</h2>
 *
 * <p>{@code X-Tenant-Id} scopes the row-level-security GUC and the query predicate.
 * {@code X-Acting-User-Id} is WHO, and is <b>required</b> — see
 * {@link UserLifecycleInternalController#ACTING_USER_HEADER} for the full account of why it is an
 * identity and never an entitlement, why it is asserted by the calling service from a verified JWT,
 * and why the gateway strips it from every inbound request unconditionally. {@code actorTier} says
 * which id space that identity lives in and whether the ceiling applies; like the header, it is a
 * constant asserted by each calling service and is unreachable from a client.
 */
@RestController
@RequestMapping("/internal/auth/users")
public class AdminPasswordResetInternalController {

    private static final String TENANT_HEADER = "X-Tenant-Id";

    private final AdminPasswordResetService adminPasswordResetService;

    public AdminPasswordResetInternalController(AdminPasswordResetService adminPasswordResetService) {
        this.adminPasswordResetService = adminPasswordResetService;
    }

    /**
     * Reset the target's password and return the temporary one ONCE.
     *
     * <p>200 rather than 201: nothing is created, an existing account's credential is replaced.
     *
     * <p>The response body's {@code tempPassword} exists nowhere else — not in a log, not in the
     * database (only its bcrypt hash), not in the audit event. The caller must hand it to exactly
     * one person, out of band, and must never persist it. In particular it must never be written
     * into an idempotency record: {@code platform_db.idempotency_keys.response_json} is a plain
     * text column nothing ever purges (13-10), so a credential stored there is permanent.
     */
    @PostMapping("/{userId}/password-reset")
    public ResponseEntity<ApiResponse<AdminResetResult>> reset(
            @RequestHeader(TENANT_HEADER) UUID tenantId,
            @RequestHeader(value = UserLifecycleInternalController.ACTING_USER_HEADER, required = false)
            UUID actingUserId,
            @PathVariable UUID userId,
            @Valid @RequestBody AdminResetRequest request) {
        if (actingUserId == null) {
            // Declared optional and rejected by hand for the reason the lifecycle controller
            // records: Spring's own refusal is a 400 indistinguishable from a malformed body, and
            // this is an authorization failure that deserves its own code and status.
            throw new ActingUserRequiredException("POST /internal/auth/users/{userId}/password-reset");
        }
        return ResponseEntity.ok(ApiResponse.ok(adminPasswordResetService.reset(
            tenantId, userId, actingUserId, request.actorTier(), request.reason())));
    }

    /**
     * What a reset needs beyond the three headers.
     *
     * <p><b>There is no acting-administrator field and no tenant field, and both absences are the
     * enforcement</b> (T-13-13-G). A body field naming the actor is a field a caller can fill in
     * with somebody else's name, which is precisely what a repudiation control must not permit.
     *
     * <p>{@code reason} is {@code @NotBlank} because a reset used to lock a rival out is
     * indistinguishable from a legitimate one without it (T-13-13-E). The service trims and
     * re-checks it, so a body of spaces is refused too.
     *
     * <p>{@code actorTier} is a required enum with no default. An absent value is a 400 rather than
     * a silent fall-back to either tier: defaulting to TENANT would break every platform reset, and
     * defaulting to PLATFORM would silently disable the role ceiling — the fail-open direction, and
     * the one nobody would notice.
     */
    public record AdminResetRequest(ActorTier actorTier, @NotBlank @Size(max = 500) String reason) {}
}
