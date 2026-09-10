package io.restaurantos.platform.controller;

import io.restaurantos.platform.dto.AnnouncementDtos.AnnouncementReach;
import io.restaurantos.platform.dto.AnnouncementDtos.AnnouncementResponse;
import io.restaurantos.platform.dto.AnnouncementDtos.CreateAnnouncementRequest;
import io.restaurantos.platform.dto.AnnouncementDtos.RevokeAnnouncementRequest;
import io.restaurantos.platform.service.AnnouncementService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.security.JwtClaims;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.util.List;
import java.util.UUID;

/**
 * Platform announcements — the SuperAdmin surface.
 *
 * <p><b>These are in-app banners and nothing else.</b> No email, no SMS, no WhatsApp: this product
 * has no delivery service at all (notification-service is an empty POM module with no source, no
 * route and no port), which is the same absence that keeps self-service forgot-password disabled.
 * Every response carries {@code deliveryChannels: ["IN_APP"]} so a screen cannot imply otherwise.
 *
 * <p><b>There is no DELETE.</b> Withdrawal is {@code POST /{id}/revoke}, which stops an
 * announcement matching the active window and records when it stopped. Deleting one would take the
 * meaning of its acknowledgement trail with it.
 *
 * <p>The acting administrator is read from the verified token's {@code sub} and never from a body
 * field — the rule the impersonation and platform password-reset paths already follow, because an
 * accountability record whose subject can choose what it says is not one.
 */
@RestController
@RequestMapping("/api/v1/platform/announcements")
@PreAuthorize("hasAuthority('SUPER_ADMIN')")
public class PlatformAnnouncementController {

    private final AnnouncementService announcementService;

    public PlatformAnnouncementController(AnnouncementService announcementService) {
        this.announcementService = announcementService;
    }

    /** {@code POST /api/v1/platform/announcements} — publish. 201 with the created row. */
    @PostMapping
    public ResponseEntity<ApiResponse<AnnouncementResponse>> create(
            @Valid @RequestBody CreateAnnouncementRequest request) {
        AnnouncementResponse created = announcementService.create(requirePlatformPrincipal(), request);
        return ResponseEntity
                .created(URI.create("/api/v1/platform/announcements/" + created.id()))
                .body(ApiResponse.ok(created));
    }

    /**
     * {@code GET /api/v1/platform/announcements?activeOnly=false}
     *
     * <p>Defaults to EVERYTHING, including revoked and expired. An operator's list of what they have
     * published is a record, and a record that hides its withdrawn entries by default is one you
     * cannot audit. {@code activeOnly=true} is the "what are tenants seeing right now" view.
     */
    @GetMapping
    public ResponseEntity<ApiResponse<List<AnnouncementResponse>>> list(
            @RequestParam(defaultValue = "false") boolean activeOnly) {
        return ResponseEntity.ok(ApiResponse.ok(announcementService.list(activeOnly)));
    }

    @GetMapping("/{announcementId}")
    public ResponseEntity<ApiResponse<AnnouncementResponse>> get(@PathVariable UUID announcementId) {
        return ResponseEntity.ok(ApiResponse.ok(announcementService.get(announcementId)));
    }

    /**
     * {@code POST /api/v1/platform/announcements/{id}/revoke} — withdraw.
     *
     * <p>Idempotent: revoking an already-revoked announcement does not move the timestamp, because
     * the first withdrawal is the one that happened.
     */
    @PostMapping("/{announcementId}/revoke")
    public ResponseEntity<ApiResponse<AnnouncementResponse>> revoke(
            @PathVariable UUID announcementId,
            @RequestBody(required = false) RevokeAnnouncementRequest request) {
        String reason = request == null ? null : request.reason();
        return ResponseEntity.ok(ApiResponse.ok(
                announcementService.revoke(announcementId, requirePlatformPrincipal(), reason)));
    }

    /**
     * {@code GET /api/v1/platform/announcements/{id}/acknowledgements} — the trail, and its reach.
     *
     * <p>{@code tenantsTargeted} is computed from the tenant registry at read time, not stored: an
     * announcement aimed at a TIER reaches whoever is on that tier NOW, and tenants change tier. If
     * the denominator cannot be established the response says {@code coverageKnown: false} rather
     * than offering a percentage over a guess.
     *
     * <p>What it counts is people who pressed acknowledge. Nothing in this product records an
     * impression, so it is not and cannot be a read rate.
     */
    @GetMapping("/{announcementId}/acknowledgements")
    public ResponseEntity<ApiResponse<AnnouncementReach>> acknowledgements(
            @PathVariable UUID announcementId) {
        return ResponseEntity.ok(ApiResponse.ok(announcementService.reach(announcementId)));
    }

    /**
     * The acting platform user's id, or a refusal.
     *
     * <p>Reads {@link JwtClaims#subject()} from the security context — for a platform token that is
     * {@code platform_users.id}, set by {@code JwtSigningService.signPlatformToken}. Never a body
     * field and never a header: the gateway strips {@code X-Acting-User-Id} from every inbound
     * request precisely so that no client can assert who it is.
     */
    private UUID requirePlatformPrincipal() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        Object principal = authentication != null ? authentication.getPrincipal() : null;
        if (principal instanceof JwtClaims claims && claims.subject() != null) {
            return claims.subject();
        }
        throw new PermissionDeniedException(
                "Publishing or withdrawing an announcement requires an authenticated platform "
                    + "administrator; the acting id is taken from the verified token and is never "
                    + "substituted");
    }
}
