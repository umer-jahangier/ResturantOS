package io.restaurantos.audit.controller;

import io.restaurantos.audit.dto.PlatformAuditDtos.PlatformAuditSearchRequest;
import io.restaurantos.audit.dto.PlatformAuditDtos.PlatformAuditSearchResponse;
import io.restaurantos.audit.entity.AuditEventEntity;
import io.restaurantos.audit.repository.AuditEventRepository;
import io.restaurantos.audit.service.PlatformAuditReadService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Internal compliance query endpoints for audit events.
 * Gated by the {@code X-Internal-Service-Secret} header via {@code InternalServiceFilter}.
 * No public REST in v1 — write-only from domain events; read is admin/compliance only.
 *
 * <h2>Read-only, structurally</h2>
 *
 * <p>Both endpoints here are reads. {@code /platform/search} is a POST only because its tenant list
 * does not fit in a query string; it performs no write, and could not if it wanted to — the runtime
 * role holds INSERT and SELECT and nothing else, a trigger raises on UPDATE and DELETE, and this
 * service exposes no mutating handler anywhere. An audit log a platform administrator can edit is
 * not an audit log, and here that is a property of the schema rather than of this class's
 * discipline.
 *
 * <h2>The GUC bug this class shipped with</h2>
 *
 * <p>{@link #getEvents} took its tenant as a query parameter and filtered in JPA — and NOTHING on
 * this path populated {@link TenantContext}. {@code TenantAwareDataSource} therefore wrote
 * {@code app.current_tenant_id = ''} on checkout; changeset 030 put {@code FORCE ROW LEVEL
 * SECURITY} on {@code audit_events} and on every partition with a policy that maps the empty string
 * to NULL and fails closed; so the endpoint returned an <b>empty list for every tenant</b> — a 200
 * with {@code data: []}, indistinguishable from a tenant that has never done anything. The endpoint
 * predates the RLS changeset and no integration test covered it, so the regression was invisible
 * from both ends.
 *
 * <p>The fix is the smallest correct one: set the tenant on the context from the parameter that was
 * already being trusted to filter, and clear it in a {@code finally}. The policy then evaluates
 * against the same tenant the JPA predicate names, which makes the predicate redundant and the
 * policy authoritative — the right way round. Deliberately NOT fixed by disabling, forcing-off or
 * bypassing the policy: this is the table that holds every login, void, refund and role change for
 * every tenant on the platform.
 */
@RestController
@RequestMapping("/internal/audit")
public class AuditInternalController {

    private static final int MAX_PAGE_SIZE = 200;

    private final AuditEventRepository auditEventRepository;
    private final PlatformAuditReadService platformAuditReadService;
    private final TenantContext tenantContext;

    public AuditInternalController(AuditEventRepository auditEventRepository,
                                   PlatformAuditReadService platformAuditReadService,
                                   TenantContext tenantContext) {
        this.auditEventRepository = auditEventRepository;
        this.platformAuditReadService = platformAuditReadService;
        this.tenantContext = tenantContext;
    }

    /**
     * GET /internal/audit/events?tenantId=&from=&to=&page=&size=
     * Returns paginated audit events for a tenant within a time range.
     *
     * <p>Response shape unchanged. What changed is that it now returns rows.
     */
    @GetMapping("/events")
    public ApiResponse<List<AuditEventEntity>> getEvents(
            @RequestParam UUID tenantId,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {

        int clampedSize = Math.min(size, MAX_PAGE_SIZE);
        Instant fromInstant = from != null ? from.atStartOfDay().toInstant(ZoneOffset.UTC) : Instant.EPOCH;
        Instant toInstant = to != null ? to.plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC) : Instant.now();

        PageRequest pageRequest = PageRequest.of(page, clampedSize,
                Sort.by(Sort.Direction.DESC, "occurredAt"));

        // Without this the RLS policy sees an empty GUC and every read below matches zero rows.
        tenantContext.set(tenantId, null, null, null);
        try {
            List<AuditEventEntity> events = auditEventRepository
                    .findByTenantIdAndOccurredAtBetween(tenantId, fromInstant, toInstant, pageRequest);
            return ApiResponse.ok(events);
        } finally {
            tenantContext.clear();
        }
    }

    /**
     * POST /internal/audit/platform/search — the platform plane's cross-tenant audit read.
     *
     * <p>The caller names the tenants; this service reads each one under its own row-level-security
     * policy and merges. See {@link PlatformAuditReadService} for why that is the only shape
     * offered, and {@code PlatformAuditDtos} for what the response says about the tenants it could
     * not read.
     *
     * <p>A malformed scope (empty, or larger than the fan-out ceiling) is a 400 naming the problem,
     * not a silently narrowed or silently widened query.
     */
    @PostMapping("/platform/search")
    public ResponseEntity<ApiResponse<PlatformAuditSearchResponse>> platformSearch(
            @RequestBody PlatformAuditSearchRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(platformAuditReadService.search(request)));
    }

    /**
     * A bad scope is the caller's error and is reported as one. Scoped to this controller so it
     * cannot change how any other handler in the service reports failures.
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> onBadRequest(IllegalArgumentException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                "error", Map.of("code", "VALIDATION_FAILED", "message", String.valueOf(ex.getMessage()))));
    }
}
