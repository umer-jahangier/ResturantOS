package io.restaurantos.platform.controller;

import io.restaurantos.platform.dto.AnnouncementDtos.AcknowledgeRequest;
import io.restaurantos.platform.dto.AnnouncementDtos.TenantAnnouncement;
import io.restaurantos.platform.service.AnnouncementService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The tenant-facing half of announcements, reached through the internal seam.
 *
 * <h2>Why internal rather than a public route</h2>
 *
 * <p>An announcement is read by a TENANT user, whose token carries a {@code tenant_id} and no
 * {@code SUPER_ADMIN} authority — so it cannot pass {@code /api/v1/platform/**}, which is gated on
 * that authority alone. The alternatives were a second public route on this service with its own
 * tenant-scoping logic, or this: the calling service supplies the tenant and the user, bounded by
 * the shared secret that {@code PlatformInternalServiceFilter} checks in constant time.
 *
 * <p>The second option is the one that matches how every other tenant-facing read of platform_db
 * already works — {@code /internal/platform/tenants/{id}/status} and {@code .../features} are the
 * gateway's feature-flag and status reads, and they have the same shape for the same reason. It
 * also keeps this service from having to reason about tenant tokens at all, which is the property
 * that makes {@code platform_db} safe without row-level security.
 *
 * <p>The gateway maps no route to {@code /internal/**} and strips {@code X-Internal-Service} from
 * every inbound request at the edge, so no browser can reach these.
 */
@RestController
@RequestMapping("/internal/platform")
public class AnnouncementInternalController {

    private final AnnouncementService announcementService;

    public AnnouncementInternalController(AnnouncementService announcementService) {
        this.announcementService = announcementService;
    }

    /**
     * {@code GET /internal/platform/tenants/{tenantId}/announcements?userId=}
     *
     * <p>The announcements live right now that target this tenant, with a per-user acknowledged
     * flag. Per USER and not per tenant: a banner one colleague dismissed is not a banner the next
     * person has seen.
     *
     * <p>{@code userId} is optional. Omitted, every entry comes back {@code acknowledged: false} —
     * which is honest, because without a user there is nobody whose acknowledgement could be
     * looked up, and defaulting to true would hide a message from everyone.
     *
     * <p>An unknown tenant returns an empty list, not a 404. A tenant id that resolves to nothing
     * has no announcements, and answering 404 would turn this into an existence oracle for tenant
     * ids on a secret-gated but widely-called endpoint.
     */
    @GetMapping("/tenants/{tenantId}/announcements")
    public ResponseEntity<ApiResponse<List<TenantAnnouncement>>> forTenant(
            @PathVariable UUID tenantId,
            @RequestParam(required = false) UUID userId) {
        return ResponseEntity.ok(ApiResponse.ok(announcementService.forTenant(tenantId, userId)));
    }

    /**
     * {@code POST /internal/platform/announcements/{id}/acknowledge}
     *
     * <p>Records that one person has seen one announcement. Idempotent: a repeat keeps the FIRST
     * timestamp, because "when did they first see this" is the question the trail answers and a
     * re-render must not move it. {@code recorded: false} means it was already there, which is a
     * success and not a failure.
     *
     * <p>This is the only write in the announcement feature that is not a SuperAdmin action, and it
     * can only ever append. There is no path here that edits or removes an acknowledgement.
     */
    @PostMapping("/announcements/{announcementId}/acknowledge")
    public ResponseEntity<ApiResponse<Map<String, Object>>> acknowledge(
            @PathVariable UUID announcementId,
            @Valid @RequestBody AcknowledgeRequest request) {
        boolean recorded = announcementService.acknowledge(
                announcementId, request.tenantId(), request.userId());
        return ResponseEntity.ok(ApiResponse.ok(Map.of(
                "announcementId", announcementId,
                "userId", request.userId(),
                "recorded", recorded)));
    }
}
