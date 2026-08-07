package io.restaurantos.audit.controller;

import io.restaurantos.audit.dto.AuditEventView;
import io.restaurantos.audit.repository.AuditEventRepository;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

/**
 * The tenant-facing audit log (15-01).
 *
 * <p>Until this phase the only way to read {@code audit_events} was {@code /internal/audit/events},
 * which is gated on a shared secret and has no gateway route — so the audit log was unreachable from
 * outside the cluster and "everything logged for audits" had no reader. This endpoint is that
 * reader, and it is reachable through {@code audit-route} in the gateway.
 *
 * <h2>The tenant is taken, not asked for</h2>
 *
 * <p>{@code tenantId} is read from {@link TenantContext} — populated by {@code JwtAuthenticationFilter}
 * from the {@code tenant_id} claim of a signature-verified JWT — and there is <b>no tenant parameter
 * on this endpoint at all</b>. That is the whole of the cross-tenant control, and it is a structural
 * one: there is no code path here that could be persuaded to read another tenant's rows, because
 * there is nothing for a caller to influence. The internal endpoint next door takes a tenant as a
 * query parameter, which is defensible only because the secret that gates it is held by services and
 * not by users; repeating that shape on a user-facing endpoint would have made every tenant admin a
 * reader of every other tenant's audit log.
 *
 * <p>{@code AuditTenantIsolationIT} asserts a token for tenant A reading nothing of tenant B's, over
 * HTTP, against a database holding both.
 *
 * <h2>Why {@code audit.log.view} and not an existing permission</h2>
 *
 * <p>Reading the audit log is not implied by any other capability. It shows every login, every void,
 * every role change and every password reset in the tenant — including the acting administrators'
 * own — so it is exactly the surface a compromised manager account would want, and exactly the
 * record that would show the compromise. It is granted to OWNER and TENANT_ADMIN only (changeset
 * 060). MANAGER deliberately does not hold it: a manager can void an order, and a manager who can
 * also read the void log is a manager who can see whether anyone is looking.
 *
 * <h2>What this endpoint cannot do</h2>
 *
 * <p>Read only. There is no write, no update and no delete surface here or anywhere else in the
 * service — the table is append-only at the privilege layer and again at the trigger layer, and this
 * controller holds a repository whose runtime role has SELECT and INSERT and nothing more.
 */
@RestController
@RequestMapping("/api/v1/audit")
public class AuditQueryController {

    private static final int MAX_PAGE_SIZE = 200;
    private static final int DEFAULT_PAGE_SIZE = 50;

    private final AuditEventRepository auditEventRepository;
    private final TenantContext tenantContext;

    public AuditQueryController(AuditEventRepository auditEventRepository,
                                TenantContext tenantContext) {
        this.auditEventRepository = auditEventRepository;
        this.tenantContext = tenantContext;
    }

    /**
     * {@code GET /api/v1/audit/events?action=&from=&to=&page=&size=}
     *
     * <p>Newest first. {@code from}/{@code to} are inclusive dates; {@code to} covers the whole of
     * its day. Omitting both reads from the epoch to now, which the partition pruning on
     * {@code occurred_at} keeps cheap for the common "what happened recently" case.
     */
    @GetMapping("/events")
    @PreAuthorize("hasAuthority('audit.log.view')")
    public ApiResponse<List<AuditEventView>> getEvents(
            @RequestParam(required = false) String action,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {

        // From the verified token, never from the request. See the class javadoc.
        UUID tenantId = tenantContext.requireTenantId();

        Instant fromInstant = from != null
                ? from.atStartOfDay().toInstant(ZoneOffset.UTC)
                : Instant.EPOCH;
        Instant toInstant = to != null
                ? to.plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC)
                : Instant.now();

        PageRequest pageRequest = PageRequest.of(
                Math.max(page, 0),
                size <= 0 ? DEFAULT_PAGE_SIZE : Math.min(size, MAX_PAGE_SIZE),
                Sort.by(Sort.Direction.DESC, "occurredAt"));

        List<AuditEventView> events = (action == null || action.isBlank()
                ? auditEventRepository.findByTenantIdAndOccurredAtBetween(
                        tenantId, fromInstant, toInstant, pageRequest)
                : auditEventRepository.findByTenantIdAndActionAndOccurredAtBetween(
                        tenantId, action.trim(), fromInstant, toInstant, pageRequest))
                .stream()
                .map(AuditEventView::of)
                .toList();

        return ApiResponse.ok(events);
    }
}
