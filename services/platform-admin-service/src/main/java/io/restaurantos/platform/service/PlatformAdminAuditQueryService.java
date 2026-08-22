package io.restaurantos.platform.service;

import io.restaurantos.platform.dto.PlatformUserDtos.PlatformAuditRecord;
import io.restaurantos.platform.entity.PlatformAdminAuditEntity;
import io.restaurantos.platform.entity.TenantEntity;
import io.restaurantos.platform.repository.PlatformAdminAuditRepository;
import io.restaurantos.platform.repository.TenantRepository;
import io.restaurantos.shared.exception.FieldValidationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The read path over {@code platform_admin_audit} — what platform operators have done to tenant
 * accounts (superadmin plan).
 *
 * <h2>Why it ships in the same plan as the writes</h2>
 *
 * <p>{@code impersonation_log} is the cautionary example and it is in this same database: the write
 * side worked from PLATFORM-05, and the read side did not exist until 13-14 — the finder had zero
 * callers, no controller exposed it, and the accountability trail could only be read from a psql
 * session. An accountability record nobody can read is only marginally better than one that is not
 * written. So the reader ships with the writer rather than after it.
 *
 * <h2>The question this answers that audit_db cannot</h2>
 *
 * <p><i>"Where has operator X been, this month?"</i> {@code audit_events} is per-tenant with FORCED
 * row-level security, so the same question there is one query and one token per tenant, it misses
 * any tenant whose outbox delivery failed, and for two of the five actions there is no event at
 * all. Here it is one indexed read over one immutable table.
 *
 * <p>Shaped after {@code ImpersonationQueryService} on purpose — same date parsing, same
 * one-finder-per-filter structure, same slug resolution — because they answer the same kind of
 * question about the same principals and two different shapes for that would be gratuitous.
 */
@Service
public class PlatformAdminAuditQueryService {

    private static final int MAX_PAGE_SIZE = 200;

    private final PlatformAdminAuditRepository auditRepository;
    private final TenantRepository tenantRepository;

    public PlatformAdminAuditQueryService(PlatformAdminAuditRepository auditRepository,
                                          TenantRepository tenantRepository) {
        this.auditRepository = auditRepository;
        this.tenantRepository = tenantRepository;
    }

    /** One page of records, newest first. Every filter is optional and independent. */
    @Transactional(readOnly = true)
    public PagedAudit search(UUID platformUserId, UUID tenantId, UUID targetUserId,
                             String from, String to, int page, int size) {
        int pageNumber = Math.max(page, 0);
        int pageSize = size <= 0 ? 50 : Math.min(size, MAX_PAGE_SIZE);
        var pageable = PageRequest.of(pageNumber, pageSize,
            Sort.by(Sort.Direction.DESC, "occurredAt"));

        // An omitted bound reads as "everything", not "nothing" — EPOCH..now rather than a null
        // that a BETWEEN would turn into an empty result.
        Instant fromInstant = parseBound(from, "from", Instant.EPOCH);
        Instant toInstant = parseBound(to, "to", Instant.now());

        Page<PlatformAdminAuditEntity> rows;
        if (platformUserId != null) {
            rows = auditRepository.findByPlatformUserIdAndOccurredAtBetween(
                platformUserId, fromInstant, toInstant, pageable);
        } else if (tenantId != null) {
            rows = auditRepository.findByTenantIdAndOccurredAtBetween(
                tenantId, fromInstant, toInstant, pageable);
        } else if (targetUserId != null) {
            rows = auditRepository.findByTargetUserIdAndOccurredAtBetween(
                targetUserId, fromInstant, toInstant, pageable);
        } else {
            rows = auditRepository.findByOccurredAtBetween(fromInstant, toInstant, pageable);
        }

        // Slugs resolved in ONE query for the whole page rather than one per row. The tenant table
        // is in this database, so this is a local join the hard way — but N+1 on a console list is
        // how a screen that opens fine with 20 rows falls over at 200.
        Map<UUID, String> slugs = slugsFor(rows.getContent());
        List<PlatformAuditRecord> records = rows.getContent().stream()
            .map(row -> PlatformAuditRecord.of(row, slugs.get(row.getTenantId())))
            .toList();
        return new PagedAudit(records, pageNumber, pageSize, rows.getTotalElements());
    }

    private Map<UUID, String> slugsFor(List<PlatformAdminAuditEntity> rows) {
        Set<UUID> tenantIds = new LinkedHashSet<>();
        for (PlatformAdminAuditEntity row : rows) {
            if (row.getTenantId() != null) {
                tenantIds.add(row.getTenantId());
            }
        }
        Map<UUID, String> slugs = new LinkedHashMap<>();
        if (tenantIds.isEmpty()) {
            return slugs;
        }
        for (TenantEntity tenant : tenantRepository.findAllById(tenantIds)) {
            slugs.put(tenant.getId(), tenant.getSlug());
        }
        return slugs;
    }

    /**
     * An ISO date ({@code 2026-08-21}) or a full instant, or a 400.
     *
     * <p>A bare date is taken at UTC midnight — the same reading {@code ImpersonationQueryService}
     * gives it. This table records operator actions, which are not cut on any branch's business
     * day, so there is no timezone question here of the kind that has twice broken tenant-facing
     * date filters.
     *
     * <p>An unparseable bound is REFUSED rather than treated as absent: silently widening a filter
     * a caller narrowed is how an operator concludes nothing happened in a window they mistyped.
     */
    private static Instant parseBound(String raw, String field, Instant fallback) {
        if (raw == null || raw.isBlank()) {
            return fallback;
        }
        String value = raw.trim();
        try {
            return Instant.parse(value);
        } catch (DateTimeParseException notAnInstant) {
            try {
                return LocalDate.parse(value).atStartOfDay(ZoneOffset.UTC).toInstant();
            } catch (DateTimeParseException notADate) {
                throw new FieldValidationException(
                    "INVALID_TIME_BOUND",
                    field,
                    "\"" + value + "\" is not a time this server recognises. Send a date such as "
                        + "2026-08-21 (cut at UTC midnight) or an exact instant such as "
                        + "2026-08-21T09:30:00Z.");
            }
        }
    }

    /** Rows plus the paging facts the controller turns into a {@code PageMeta}. */
    public record PagedAudit(List<PlatformAuditRecord> records, int page, int size,
                             long totalCount) {}
}
