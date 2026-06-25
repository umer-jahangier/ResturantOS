package io.restaurantos.audit.controller;

import io.restaurantos.audit.entity.AuditEventEntity;
import io.restaurantos.audit.repository.AuditEventRepository;
import io.restaurantos.shared.api.ApiResponse;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

/**
 * Internal compliance query endpoint for audit events.
 * Gated by X-Internal-Service-Secret header via InternalServiceFilter.
 * No public REST in v1 — write-only from domain events; read is admin/compliance only.
 */
@RestController
@RequestMapping("/internal/audit")
public class AuditInternalController {

    private static final int MAX_PAGE_SIZE = 200;

    private final AuditEventRepository auditEventRepository;

    public AuditInternalController(AuditEventRepository auditEventRepository) {
        this.auditEventRepository = auditEventRepository;
    }

    /**
     * GET /internal/audit/events?tenantId=&from=&to=&page=&size=
     * Returns paginated audit events for a tenant within a time range.
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

        List<AuditEventEntity> events = auditEventRepository
                .findByTenantIdAndOccurredAtBetween(tenantId, fromInstant, toInstant, pageRequest);

        return ApiResponse.ok(events);
    }
}
