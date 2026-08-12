package io.restaurantos.platform.service;

import io.restaurantos.platform.dto.PlatformDtos.ImpersonationRecord;
import io.restaurantos.platform.dto.PlatformDtos.ImpersonationStatus;
import io.restaurantos.platform.entity.ImpersonationLogEntity;
import io.restaurantos.platform.entity.PlatformUserEntity;
import io.restaurantos.platform.entity.TenantEntity;
import io.restaurantos.platform.repository.ImpersonationLogRepository;
import io.restaurantos.platform.repository.PlatformUserRepository;
import io.restaurantos.platform.repository.TenantRepository;
import io.restaurantos.shared.exception.FieldValidationException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
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
 * The platform SuperAdmin's read path over {@code impersonation_log}.
 *
 * <h2>Why this exists at all — and why it is not a second copy of the tenant's audit log</h2>
 *
 * <p>An impersonation already produces a tenant-visible record: {@code ImpersonationService}
 * publishes {@code IMPERSONATION_STARTED} in the same transaction as the log row, the outbox
 * delivers it, and a Floating Terrace OWNER calling
 * {@code GET /api/v1/audit/events?action=IMPERSONATION_STARTED} gets it with a Control Bistro OWNER
 * getting nothing. <b>That half works and this service does not duplicate it.</b>
 *
 * <p>What did not exist was the other direction. {@code audit_events} is per-tenant with FORCED
 * row-level security, so <i>"every tenant admin X has been into, this month"</i> is not a query that
 * database can answer — it is 21 queries with 21 tokens, and it silently misses any tenant whose
 * outbox delivery failed. {@code impersonation_log} answers it in one read, from the row written in
 * the same transaction that minted the token, on a table that is immutable at the trigger layer
 * ({@code trg_impersonation_log_immutable}). A reader over a mutable table shows whatever the last
 * operator decided it should say; this one cannot.
 *
 * <p>Split by the question, not by the data:
 * <ul>
 *   <li><i>"Who came into <b>my</b> restaurant?"</i> → audit-service, already built.</li>
 *   <li><i>"Where has <b>admin X</b> been?"</i> → here.</li>
 * </ul>
 *
 * <h2>Two things this deliberately does not do</h2>
 *
 * <ol>
 *   <li><b>It never returns the token.</b> There is no column for it — the JWT is handed to the
 *       caller of {@code POST /impersonate} once and never persisted — so this is a property of the
 *       schema, not a field this class remembers to omit.</li>
 *   <li><b>It never writes.</b> In particular it does not close a session: {@code ended_at} has no
 *       writer anywhere in this product and does not acquire one here. Status comes from
 *       {@code expires_at}; see {@link #statusOf}.</li>
 * </ol>
 */
@Service
public class ImpersonationQueryService {

    /** Matches {@code AuditQueryController} so the two log readers page identically. */
    private static final int MAX_PAGE_SIZE = 200;
    private static final int DEFAULT_PAGE_SIZE = 50;

    private final ImpersonationLogRepository logRepository;
    private final TenantRepository tenantRepository;
    private final PlatformUserRepository platformUserRepository;

    public ImpersonationQueryService(ImpersonationLogRepository logRepository,
                                     TenantRepository tenantRepository,
                                     PlatformUserRepository platformUserRepository) {
        this.logRepository = logRepository;
        this.tenantRepository = tenantRepository;
        this.platformUserRepository = platformUserRepository;
    }

    /**
     * One tenant's impersonation history.
     *
     * <p><b>An unknown tenant is 404, and it is checked before the log is read.</b> Without that
     * check a typo'd id returns {@code 200 []}, which reads as "nobody has ever impersonated into
     * this tenant" — the single most misleading answer this endpoint could give, on the screen an
     * abuse review uses. The empty list and the missing tenant must not look alike.
     *
     * <p>The tenant row is also what supplies {@code slug} and {@code brandName} on every returned
     * record, so the existence check costs nothing extra.
     */
    @Transactional(readOnly = true)
    public PagedImpersonations forTenant(UUID tenantId, String from, String to, int page, int size) {
        TenantEntity tenant = tenantRepository.findById(tenantId)
            .orElseThrow(() -> new ResourceNotFoundException("Tenant", tenantId));

        Instant fromInstant = parseLowerBound(from);
        Instant toInstant = parseUpperBound(to);
        PageRequest pageRequest = pageRequest(page, size);

        Page<ImpersonationLogEntity> rows = logRepository.findByTenantIdAndStartedAtBetween(
            tenantId, fromInstant, toInstant, pageRequest);

        return toPaged(rows, Map.of(tenant.getId(), tenant), pageRequest);
    }

    /**
     * Impersonations across every tenant, optionally narrowed to one acting administrator.
     *
     * <p>{@code adminUserId} is <b>not</b> validated against {@code platform_users} first. An id
     * that names no account returns an empty page rather than a 404, because a deleted platform
     * account is exactly the case where the question matters most: the rows it left behind are the
     * only remaining evidence of what that account did, and refusing the query because the account
     * is gone would hide them. The tenant endpoint's 404 is a different situation — there the path
     * names the resource being read, and a wrong path must not answer as though it were right.
     */
    @Transactional(readOnly = true)
    public PagedImpersonations search(UUID adminUserId, String from, String to, int page, int size) {
        Instant fromInstant = parseLowerBound(from);
        Instant toInstant = parseUpperBound(to);
        PageRequest pageRequest = pageRequest(page, size);

        Page<ImpersonationLogEntity> rows = adminUserId != null
            ? logRepository.findByAdminUserIdAndStartedAtBetween(
                adminUserId, fromInstant, toInstant, pageRequest)
            : logRepository.findByStartedAtBetween(fromInstant, toInstant, pageRequest);

        return toPaged(rows, resolveTenants(rows.getContent()), pageRequest);
    }

    // ── mapping ────────────────────────────────────────────────────────────────

    private PagedImpersonations toPaged(Page<ImpersonationLogEntity> rows,
                                        Map<UUID, TenantEntity> tenants,
                                        PageRequest pageRequest) {
        Map<UUID, PlatformUserEntity> admins = resolveAdmins(rows.getContent());
        // One clock reading for the whole page. Deriving status per row from a fresh Instant.now()
        // would let two rows with the same expires_at disagree across a millisecond boundary, which
        // is the kind of inconsistency that costs an hour to reproduce and explains nothing.
        Instant now = Instant.now();

        List<ImpersonationRecord> mapped = rows.getContent().stream()
            .map(row -> toRecord(row, tenants.get(row.getTenantId()),
                admins.get(row.getAdminUserId()), now))
            .toList();

        return new PagedImpersonations(
            mapped, rows.getTotalElements(), pageRequest.getPageNumber(), pageRequest.getPageSize());
    }

    private ImpersonationRecord toRecord(ImpersonationLogEntity row,
                                         TenantEntity tenant,
                                         PlatformUserEntity admin,
                                         Instant now) {
        return new ImpersonationRecord(
            row.getId(),
            row.getTenantId(),
            tenant != null ? tenant.getSlug() : null,
            tenant != null ? tenant.getBrandName() : null,
            row.getAdminUserId(),
            admin != null ? admin.getEmail() : null,
            row.getTargetUserId(),
            row.getStartedAt(),
            row.getExpiresAt(),
            statusOf(row.getExpiresAt(), now),
            row.getReason());
    }

    /**
     * ACTIVE / EXPIRED from {@code expires_at}. <b>Never from {@code ended_at}.</b>
     *
     * <p>{@code ended_at} is nullable, has no writer in any service, script or migration in this
     * product, and is therefore NULL on 100% of rows. {@code endedAt == null ? ACTIVE : EXPIRED} —
     * the obvious reading of the column name — would mark every impersonation ever performed as
     * still running, permanently, and a review screen that says "12 sessions ACTIVE" when zero are
     * is worse than no screen: it produces action.
     *
     * <p>A null {@code expires_at} is reported as UNKNOWN rather than pushed into either answer.
     * See {@code ImpersonationStatus.UNKNOWN}.
     */
    private ImpersonationStatus statusOf(Instant expiresAt, Instant now) {
        if (expiresAt == null) {
            return ImpersonationStatus.UNKNOWN;
        }
        return expiresAt.isAfter(now) ? ImpersonationStatus.ACTIVE : ImpersonationStatus.EXPIRED;
    }

    /**
     * Tenant rows for a page, in one read.
     *
     * <p>{@code findAllById} silently omits ids it cannot find, and that tolerance is still wanted —
     * but NOT for the reason this comment used to give. It said a PURGED tenant's registration row
     * is deleted, so the lookup misses. <b>It is not deleted.</b> {@code closePermanently} only sets
     * a status, so a PURGED tenant resolves here exactly like any other and renders its real slug.
     * That comment was written from the class javadoc's claim of a hard delete, which was never true
     * — an example of a false statement propagating into a second component's reasoning before
     * anyone tested it.
     *
     * <p>The tolerance earns its place on the honest ground: this is a cross-database join done in
     * application code, so a row can be genuinely absent (a tenant created outside provisioning, a
     * restore that missed a row), and an accountability log must render what it knows rather than
     * fail because a name is missing. If real erasure is ever built, this becomes load-bearing for
     * the reason originally stated — see {@code .planning/decisions/D-TENANT-ERASURE.md}.
     */
    private Map<UUID, TenantEntity> resolveTenants(List<ImpersonationLogEntity> rows) {
        Set<UUID> ids = new LinkedHashSet<>();
        rows.forEach(r -> ids.add(r.getTenantId()));
        if (ids.isEmpty()) {
            return Map.of();
        }
        Map<UUID, TenantEntity> byId = new LinkedHashMap<>();
        tenantRepository.findAllById(ids).forEach(t -> byId.put(t.getId(), t));
        return byId;
    }

    private Map<UUID, PlatformUserEntity> resolveAdmins(List<ImpersonationLogEntity> rows) {
        Set<UUID> ids = new LinkedHashSet<>();
        rows.forEach(r -> ids.add(r.getAdminUserId()));
        if (ids.isEmpty()) {
            return Map.of();
        }
        Map<UUID, PlatformUserEntity> byId = new LinkedHashMap<>();
        platformUserRepository.findAllById(ids).forEach(u -> byId.put(u.getId(), u));
        return byId;
    }

    // ── paging and bounds ──────────────────────────────────────────────────────

    private PageRequest pageRequest(int page, int size) {
        int pageNumber = Math.max(page, 0);
        int pageSize = size <= 0 ? DEFAULT_PAGE_SIZE : Math.min(size, MAX_PAGE_SIZE);
        // startedAt DESC is the only ordering that makes sense for an incident review, and it is
        // applied in SQL rather than after the fact — sorting a page in Java sorts the wrong twenty
        // rows.
        return PageRequest.of(pageNumber, pageSize, Sort.by(Sort.Direction.DESC, "startedAt"));
    }

    private Instant parseLowerBound(String raw) {
        return parseBound(raw, "from", Instant.EPOCH, false);
    }

    private Instant parseUpperBound(String raw) {
        return parseBound(raw, "to", Instant.now(), true);
    }

    /**
     * A time bound as either an exact instant or a bare date.
     *
     * <p>Both spellings are accepted because both are what callers actually send: a console computes
     * an exact instant from the operator's own clock, a person typing a curl sends {@code
     * 2026-08-12}. A bare date is cut at <b>UTC</b> midnight and that is stated in the API docs and
     * on the screen, because the platform plane has no timezone of its own — a platform token
     * carries no tenant and therefore no branch, so there is no local day to cut on. This is the
     * one place the {@code zone} parameter {@code AuditQueryController} needs would have nothing to
     * read.
     *
     * <p>An unparseable bound is a named 422, never a silent fall back to "no filter". A filter that
     * quietly stops filtering shows more rows than asked for, which on this screen reads as more
     * impersonations than happened.
     *
     * <p>The upper bound of a bare date is 23:59:59.999 rather than the next midnight because
     * {@code Between} is inclusive at both ends — and it is milliseconds rather than nanoseconds
     * because {@code timestamptz} is microsecond-precision in PostgreSQL and 23:59:59.999999999
     * rounds up into the following day on the way in.
     */
    private Instant parseBound(String raw, String field, Instant whenAbsent, boolean endOfDay) {
        String trimmed = raw == null || raw.isBlank() ? null : raw.trim();
        if (trimmed == null) {
            return whenAbsent;
        }
        try {
            return Instant.parse(trimmed);
        } catch (DateTimeParseException notAnInstant) {
            // fall through to the date form
        }
        try {
            LocalDate date = LocalDate.parse(trimmed);
            return endOfDay
                ? date.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().minusMillis(1)
                : date.atStartOfDay(ZoneOffset.UTC).toInstant();
        } catch (DateTimeParseException notADate) {
            throw new FieldValidationException(
                "INVALID_TIME_BOUND",
                field,
                "\"" + trimmed + "\" is not a time this server recognises. Send a date such as "
                    + "2026-08-12 (cut at UTC midnight) or an exact instant such as "
                    + "2026-08-12T09:30:00Z.",
                notADate);
        }
    }

    /**
     * A page of records with the total the caller needs to page through them.
     *
     * @param totalCount rows matching the filter, not rows returned. A pager cannot say "of 208"
     *                   without it, and {@code ApiResponse.ok(list)} — which is what every other
     *                   list on this controller returns — carries {@code meta: null}.
     */
    public record PagedImpersonations(
        List<ImpersonationRecord> records,
        long totalCount,
        int page,
        int size
    ) {}
}
