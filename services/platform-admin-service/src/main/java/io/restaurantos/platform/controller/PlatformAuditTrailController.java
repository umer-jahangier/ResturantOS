package io.restaurantos.platform.controller;

import io.restaurantos.platform.dto.PlatformAuditViewDtos.AuditCoverage;
import io.restaurantos.platform.dto.PlatformAuditViewDtos.PlatformAuditPage;
import io.restaurantos.platform.service.PlatformAuditTrailService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.exception.FieldValidationException;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

/**
 * The platform-wide audit and security surface. <b>Every route here is a GET.</b>
 *
 * <p>That is the contract, not a coincidence: there is no write path to {@code audit_events} from
 * this service, from audit-service, or from any role either of them connects as. A platform
 * administrator can read every tenant's trail and can change none of it.
 *
 * <h2>Routes</h2>
 *
 * <ul>
 *   <li>{@code GET /events} — the whole trail, filterable by tenant, actor, action, resource type
 *       and date.</li>
 *   <li>{@code GET /logins} — login history, with {@code failedOnly} for a brute-force review.</li>
 *   <li>{@code GET /authority-changes} — role grants and revokes, account state changes, password
 *       resets and impersonation starts.</li>
 *   <li>{@code GET /coverage} — what the trail covers and, explicitly, what it does not.</li>
 * </ul>
 *
 * <p>The impersonation register is deliberately NOT re-served here. It already exists, already
 * spans tenants, and already has its own filters at {@code GET /api/v1/platform/impersonations};
 * two endpoints answering one question is how two screens start disagreeing about who did what.
 *
 * <h2>Dates are cut in a zone the caller names</h2>
 *
 * <p>Same rule and same reason as {@code AuditQueryController}'s {@code zone} parameter: a UTC cut
 * moves an {@code Asia/Karachi} day boundary five hours, so "everything on the 12th" quietly begins
 * at 05:00 local. An unrecognised zone is a 422 naming the field, never a silent fall back to UTC.
 */
@RestController
@RequestMapping("/api/v1/platform/audit")
@PreAuthorize("hasAuthority('SUPER_ADMIN')")
public class PlatformAuditTrailController {

    /**
     * The window an unparameterised call reads.
     *
     * <p>Ninety days, matching the tenant-facing audit screen exactly. The number is chosen for the
     * failure mode that matters on an audit surface: an action whose last occurrence falls outside
     * the window disappears from the facet list, and an absent option reads as "that never happened
     * here". A default, never a cap.
     */
    private static final int DEFAULT_WINDOW_DAYS = 90;

    private static final int MAX_PAGE_SIZE = 200;
    private static final int DEFAULT_PAGE_SIZE = 50;

    private final PlatformAuditTrailService auditTrailService;

    public PlatformAuditTrailController(PlatformAuditTrailService auditTrailService) {
        this.auditTrailService = auditTrailService;
    }

    /**
     * {@code GET /api/v1/platform/audit/events}
     *
     * @param tenantId     one tenant, or omitted for every tenant on the platform.
     * @param action       repeatable. Omitted means every action.
     * @param actorId      matches the acting account OR the platform administrator behind an
     *                     impersonated session — asking "what did this person do" and getting only
     *                     the un-impersonated half is a misattribution, not a narrower answer.
     * @param includeFacets when true the response also carries the action names that occur in this
     *                     window and scope, so a filter control offers only choices that can return
     *                     rows.
     */
    @GetMapping("/events")
    public ResponseEntity<ApiResponse<PlatformAuditPage>> events(
            @RequestParam(required = false) UUID tenantId,
            @RequestParam(required = false) List<String> action,
            @RequestParam(required = false) String resourceType,
            @RequestParam(required = false) UUID actorId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) String zone,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            @RequestParam(defaultValue = "false") boolean includeFacets) {

        ZoneId cut = resolveZone(zone);
        return ResponseEntity.ok(ApiResponse.ok(auditTrailService.search(
                tenantId, action, resourceType, actorId,
                startOfDay(resolveFrom(from, cut), cut), endOfDay(resolveTo(to, cut), cut),
                cut.getId(), clampPage(page), clampSize(size), includeFacets)));
    }

    /** {@code GET /api/v1/platform/audit/logins?failedOnly=true} — attempt-level login history. */
    @GetMapping("/logins")
    public ResponseEntity<ApiResponse<PlatformAuditPage>> logins(
            @RequestParam(required = false) UUID tenantId,
            @RequestParam(required = false) UUID actorId,
            @RequestParam(defaultValue = "false") boolean failedOnly,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) String zone,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {

        ZoneId cut = resolveZone(zone);
        return ResponseEntity.ok(ApiResponse.ok(auditTrailService.loginHistory(
                tenantId, actorId, failedOnly,
                startOfDay(resolveFrom(from, cut), cut), endOfDay(resolveTo(to, cut), cut),
                cut.getId(), clampPage(page), clampSize(size))));
    }

    /** {@code GET /api/v1/platform/audit/authority-changes} — who was granted what, and by whom. */
    @GetMapping("/authority-changes")
    public ResponseEntity<ApiResponse<PlatformAuditPage>> authorityChanges(
            @RequestParam(required = false) UUID tenantId,
            @RequestParam(required = false) UUID actorId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) String zone,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {

        ZoneId cut = resolveZone(zone);
        return ResponseEntity.ok(ApiResponse.ok(auditTrailService.authorityChanges(
                tenantId, actorId,
                startOfDay(resolveFrom(from, cut), cut), endOfDay(resolveTo(to, cut), cut),
                cut.getId(), clampPage(page), clampSize(size))));
    }

    /**
     * {@code GET /api/v1/platform/audit/coverage} — the trail's own boundaries.
     *
     * <p>An endpoint rather than a paragraph in a wiki, so the console can render the gaps beside
     * the grid. The one that matters most: SuperAdmin logins are not in {@code audit_events} at all,
     * and a "platform operator activity" tile built on this data would be empty for reasons that
     * have nothing to do with how busy the operators were.
     */
    @GetMapping("/coverage")
    public ResponseEntity<ApiResponse<AuditCoverage>> coverage() {
        return ResponseEntity.ok(ApiResponse.ok(auditTrailService.coverage()));
    }

    // ── parameter resolution ──────────────────────────────────────────────────

    private static ZoneId resolveZone(String zone) {
        if (zone == null || zone.isBlank()) {
            return ZoneOffset.UTC;
        }
        try {
            return ZoneId.of(zone.trim());
        } catch (DateTimeException ex) {
            throw new FieldValidationException(
                    "INVALID_TIME_ZONE",
                    "zone",
                    "\"" + zone.trim() + "\" is not a time zone this server recognises. Use an "
                            + "IANA zone id such as Asia/Karachi.",
                    ex);
        }
    }

    private static int clampPage(int page) {
        return Math.max(page, 0);
    }

    private static int clampSize(int size) {
        return size <= 0 ? DEFAULT_PAGE_SIZE : Math.min(size, MAX_PAGE_SIZE);
    }

    private static LocalDate resolveFrom(LocalDate from, ZoneId zone) {
        return from != null ? from : LocalDate.now(zone).minusDays(DEFAULT_WINDOW_DAYS);
    }

    private static LocalDate resolveTo(LocalDate to, ZoneId zone) {
        return to != null ? to : LocalDate.now(zone);
    }

    private static Instant startOfDay(LocalDate date, ZoneId zone) {
        return date.atStartOfDay(zone).toInstant();
    }

    private static Instant endOfDay(LocalDate date, ZoneId zone) {
        return date.plusDays(1).atStartOfDay(zone).toInstant().minusNanos(1);
    }
}
