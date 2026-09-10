package io.restaurantos.platform.service;

import io.restaurantos.platform.client.AuthUserDirectoryClient;
import io.restaurantos.platform.client.UserInternalClient;
import io.restaurantos.platform.dto.PlatformAnalyticsDtos.AnalyticsOverviewResponse;
import io.restaurantos.platform.dto.PlatformAnalyticsDtos.HonestSeries;
import io.restaurantos.platform.dto.PlatformAnalyticsDtos.MeterRollup;
import io.restaurantos.platform.dto.PlatformAnalyticsDtos.PlatformFigure;
import io.restaurantos.platform.dto.PlatformAnalyticsDtos.SeriesPoint;
import io.restaurantos.platform.dto.PlatformAnalyticsDtos.StatusTierCell;
import io.restaurantos.platform.dto.PlatformAnalyticsDtos.TenantGrowthResponse;
import io.restaurantos.platform.dto.PlatformAnalyticsDtos.TenantPopulation;
import io.restaurantos.platform.dto.PlatformAnalyticsDtos.UsageRollupResponse;
import io.restaurantos.platform.entity.TenantEntity.TenantStatus;
import io.restaurantos.platform.entity.TenantEntity.TierType;
import io.restaurantos.platform.repository.ImpersonationLogRepository;
import io.restaurantos.platform.repository.TenantAnalyticsRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.IsoFields;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Platform-wide analytics, aggregated from what this product actually records.
 *
 * <h2>What it aggregates, and what it refuses to</h2>
 *
 * <p>Everything here is computed from {@code platform_db} — {@code tenants},
 * {@code impersonation_log} — plus the two internal HTTP seams the control plane already uses
 * ({@code user-service} for branches, {@code auth-service} for a per-tenant headcount) and the Redis
 * counter the gateway throttles NLQ against. No new ClickHouse table, no ClickHouse migration, no
 * new queue.
 *
 * <p>Cross-tenant SALES analytics — order volume, gross sales, margin, till variance — genuinely
 * exist in ClickHouse and are genuinely aggregatable by {@code tenant_id}, but they are not here.
 * Two reasons, and the second is the one that matters. First, this service has no ClickHouse driver
 * and adding one is a dependency change, not an analytics change. Second and more importantly, they
 * are RESTAURANT metrics — what tenants sell — and a platform dashboard that labels the sum of its
 * customers' takings as platform revenue has fabricated the most consequential number on the
 * screen. If they are added later they belong under a heading that says whose money it is.
 *
 * <h2>The three states, everywhere</h2>
 *
 * <p>Every scalar is a {@link PlatformFigure}: measured, not-measured, or unreadable. Every series
 * is an {@link HonestSeries} carrying only the buckets it observed. The precedent is
 * {@code UsageService}, which reports three of its four per-tenant meters as {@code notMetered}
 * rather than as {@code 0}, and the reason is the same: a screen cannot distinguish "we counted and
 * it was none" from "nobody is counting" once both are the number zero.
 */
@Service
public class PlatformAnalyticsService {

    private static final Logger log = LoggerFactory.getLogger(PlatformAnalyticsService.class);

    /** Written by nlq-service, enforced by the gateway. Absence of the key is NOT a zero. */
    private static final String NLQ_COUNTER_KEY = "nlq_quota:%s:monthly_count";

    /**
     * How many tenants one roll-up will fan out to.
     *
     * <p>The branches and users dimensions are one HTTP call per tenant each. That is the documented
     * cost of reading tenant data from the control plane — there is no cross-tenant query for
     * either, because both tables are FORCE RLS in databases {@code platform_db} holds no grants in.
     * Past this ceiling the roll-up reports {@code scopeTruncated} rather than quietly summing a
     * prefix and calling it a total.
     */
    public static final int MAX_ROLLUP_TENANTS = 200;

    private static final DateTimeFormatter DAY_LABEL = DateTimeFormatter.ISO_LOCAL_DATE;

    private final TenantAnalyticsRepository tenantRepository;
    private final ImpersonationLogRepository impersonationLogRepository;
    private final UserInternalClient userClient;
    private final AuthUserDirectoryClient authUserDirectoryClient;
    private final StringRedisTemplate redis;

    public PlatformAnalyticsService(TenantAnalyticsRepository tenantRepository,
                                    ImpersonationLogRepository impersonationLogRepository,
                                    UserInternalClient userClient,
                                    AuthUserDirectoryClient authUserDirectoryClient,
                                    StringRedisTemplate redis) {
        this.tenantRepository = tenantRepository;
        this.impersonationLogRepository = impersonationLogRepository;
        this.userClient = userClient;
        this.authUserDirectoryClient = authUserDirectoryClient;
        this.redis = redis;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Overview
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * The platform at a glance, plus a window over the lifecycle columns.
     *
     * @param from window start (inclusive), for the lifecycle and impersonation counts.
     * @param to   window end (inclusive).
     */
    @Transactional(readOnly = true)
    public AnalyticsOverviewResponse overview(Instant from, Instant to) {
        Map<String, Long> byStatus = densify(
                tenantRepository.countGroupedByStatus(),
                java.util.Arrays.stream(TenantStatus.values()).map(Enum::name).toList());
        Map<String, Long> byTier = densify(
                tenantRepository.countGroupedByTier(),
                java.util.Arrays.stream(TierType.values()).map(Enum::name).toList());

        List<StatusTierCell> cells = tenantRepository.countGroupedByStatusAndTier().stream()
                .map(row -> new StatusTierCell(
                        String.valueOf(row[0]), String.valueOf(row[1]), ((Number) row[2]).longValue()))
                .toList();

        long total = byStatus.values().stream().mapToLong(Long::longValue).sum();
        long active = byStatus.getOrDefault(TenantStatus.ACTIVE.name(), 0L);

        TenantPopulation population = new TenantPopulation(
                total, byStatus, byTier, cells, active, total - active);

        List<PlatformFigure> lifecycle = List.of(
                PlatformFigure.measured("tenants_created_in_window",
                        tenantRepository.findCreatedAtBetween(from, to).size(),
                        "platform_db.tenants.created_at — set once at provisioning, never rewritten"),
                PlatformFigure.measured("tenants_suspended_in_window",
                        tenantRepository.findSuspendedAtBetween(from, to).size(),
                        "platform_db.tenants.suspended_at — MOST RECENT suspension only; a tenant "
                            + "suspended, reactivated and suspended again counts once. A lower bound, "
                            + "not a count: no event is published for the transition"),
                PlatformFigure.measured("tenants_cancelled_in_window",
                        tenantRepository.findCancelledAtBetween(from, to).size(),
                        "platform_db.tenants.cancelled_at — same single-value caveat as suspensions"),
                PlatformFigure.measured("tenants_provisioning_failed",
                        tenantRepository.countByStatus(TenantStatus.PROVISIONING_FAILED),
                        "platform_db.tenants.status — operator-actionable; POST /tenants/{id}/retry-provisioning"),
                PlatformFigure.notMeasured("tenant_lifecycle_timeline",
                        "suspend / reactivate / cancel / close publish no events and overwrite a "
                            + "single timestamp column, so no per-tenant transition history exists to "
                            + "chart. Only the latest transition of each kind is recoverable"));

        List<PlatformFigure> entitlement = List.of(
                PlatformFigure.measured("trials_ending_in_window",
                        tenantRepository.countTrialsEndingBetween(from, to),
                        "platform_db.tenants.trial_ends_at — OPERATOR-ENTERED. Nothing computes or "
                            + "enforces it and it is null for most tenants; null means 'no trial "
                            + "recorded', which is a real state and not a zero"),
                PlatformFigure.measured("renewals_due_in_window",
                        tenantRepository.countRenewalsDueBetween(from, to),
                        "platform_db.tenants.renews_at — OPERATOR-ENTERED; null means 'no renewal "
                            + "scheduled', a real state"),
                PlatformFigure.measured("tenants_with_billing_reference",
                        tenantRepository.countWithBillingRef(),
                        "platform_db.tenants.billing_ref — FREE TEXT with no foreign key and no "
                            + "schema. It counts how many rows a human typed something into; it does "
                            + "not link to a billing system, because there is not one"));

        long impersonations = impersonationLogRepository
                .findByStartedAtBetween(from, to, PageRequest.of(0, 1))
                .getTotalElements();

        List<PlatformFigure> operations = List.of(
                PlatformFigure.measured("impersonation_sessions_started_in_window", impersonations,
                        "platform_db.impersonation_log — every session is written in the same "
                            + "transaction that mints the token"),
                PlatformFigure.notMeasured("active_users",
                        "no platform-side session store and no per-tenant activity counter exists; "
                            + "usage_records holds 0 rows and has no producer. DAU/MAU cannot be "
                            + "computed from anything this product records"),
                PlatformFigure.notMeasured("tenant_last_activity",
                        "nothing records a per-tenant last-seen timestamp anywhere in the platform "
                            + "database"));

        List<PlatformFigure> unavailable = List.of(
                PlatformFigure.notMeasured("mrr",
                        "no plan price, no subscription record, no invoice and no payment exists in "
                            + "this codebase. platform_db holds tenants, tenant_features, "
                            + "platform_users, usage_records and impersonation_log — nothing "
                            + "monetary. Any MRR figure would be invented"),
                PlatformFigure.notMeasured("arr", "see mrr — the same absence"),
                PlatformFigure.notMeasured("arpu",
                        "requires a price per tenant; no tier carries one"),
                PlatformFigure.notMeasured("churn_value",
                        "cancellations are countable; their VALUE is not, for want of any price"),
                PlatformFigure.notMeasured("failed_payments",
                        "no payment processor is integrated anywhere in this product"),
                PlatformFigure.notMeasured("cross_tenant_sales",
                        "real and aggregatable in ClickHouse, but not exposed here: this service has "
                            + "no ClickHouse driver, and those are the tenants' takings rather than "
                            + "platform revenue — labelling them as ours would be the exact "
                            + "fabrication this response exists to avoid"));

        return new AnalyticsOverviewResponse(
                Instant.now(), from, to, population, lifecycle, entitlement, operations, unavailable);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Growth
    // ─────────────────────────────────────────────────────────────────────────

    /** The three lifecycle series, each bounded by what its column can actually establish. */
    @Transactional(readOnly = true)
    public TenantGrowthResponse growth(Instant from, Instant to, Interval interval, ZoneId zone) {
        Instant[] createdBounds = bounds(tenantRepository.findCreatedAtBounds());
        Instant[] suspendedBounds = bounds(tenantRepository.findSuspendedAtBounds());
        Instant[] cancelledBounds = bounds(tenantRepository.findCancelledAtBounds());

        HonestSeries created = series(
                "tenants_created",
                tenantRepository.findCreatedAtBetween(from, to),
                from, to, interval, zone,
                tenantRepository.countCreatedBefore(from),
                createdBounds,
                "Counted from tenants.created_at, which is written once at provisioning and never "
                    + "rewritten — so this series is exact. Buckets with no tenant created are "
                    + "ABSENT rather than zero: before observedFrom the platform had no tenants at "
                    + "all, and a zero there would assert a measurement nobody made.");

        HonestSeries suspended = series(
                "tenants_suspended",
                tenantRepository.findSuspendedAtBetween(from, to),
                from, to, interval, zone,
                null,
                suspendedBounds,
                "A LOWER BOUND, not a count. tenants.suspended_at holds only the most recent "
                    + "suspension and TenantLifecycleService publishes no event, so a tenant "
                    + "suspended twice appears once, in the later bucket. No cumulative line is "
                    + "offered because summing a column that overwrites itself is meaningless.");

        HonestSeries cancelled = series(
                "tenants_cancelled",
                tenantRepository.findCancelledAtBetween(from, to),
                from, to, interval, zone,
                null,
                cancelledBounds,
                "Same single-value caveat as suspensions: tenants.cancelled_at records the latest "
                    + "cancellation only, and nothing publishes a lifecycle event to reconstruct "
                    + "the rest.");

        return new TenantGrowthResponse(Instant.now(), created, suspended, cancelled);
    }

    /**
     * Buckets the observations that exist. Emits nothing for a period with none.
     *
     * <p>This is the whole of the honesty rule in code: {@code counts} is built by walking the
     * observations, so a bucket exists if and only if something was observed in it. The obvious
     * alternative — iterate the calendar from {@code from} to {@code to} and emit a point per
     * period — produces a chart that is dense, tidy, and asserts a measurement for every period
     * including the ones before the platform had a single tenant.
     */
    private HonestSeries series(String metric,
                                List<Instant> observations,
                                Instant from,
                                Instant to,
                                Interval interval,
                                ZoneId zone,
                                Long baseline,
                                Instant[] observedBounds,
                                String coverage) {
        Map<ZonedDateTime, Long> counts = new LinkedHashMap<>();
        for (Instant observation : observations) {
            if (observation == null) {
                continue;
            }
            counts.merge(bucketStart(observation, interval, zone), 1L, Long::sum);
        }

        List<ZonedDateTime> ordered = new ArrayList<>(counts.keySet());
        ordered.sort(ZonedDateTime::compareTo);

        List<SeriesPoint> points = new ArrayList<>(ordered.size());
        long running = baseline == null ? 0L : baseline;
        for (ZonedDateTime bucket : ordered) {
            long count = counts.get(bucket);
            running += count;
            points.add(new SeriesPoint(
                    bucket.toInstant(),
                    label(bucket, interval),
                    count,
                    baseline == null ? null : running));
        }

        return new HonestSeries(
                metric, interval.name(), zone.getId(), from, to,
                observedBounds[0], observedBounds[1],
                baseline,
                List.copyOf(points),
                false,
                coverage);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Usage roll-up
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * The per-tenant usage meters, summed across a scope, with the coverage of each sum stated.
     *
     * @param status when non-null, only tenants in that status are read. {@code ACTIVE} is the
     *               useful default for an operator: a CANCELLED tenant's branch count is not a
     *               fleet capacity figure.
     */
    public UsageRollupResponse usageRollup(TenantStatus status) {
        List<UUID> scope = status == null
                ? tenantRepository.findAllTenantIds()
                : tenantRepository.findTenantIdsByStatus(status);

        boolean truncated = scope.size() > MAX_ROLLUP_TENANTS;
        if (truncated) {
            scope = scope.subList(0, MAX_ROLLUP_TENANTS);
        }
        // (id, maxBranches, maxUsers, storageGb, nlqQuota) — the entitlement half of every meter.
        // A projection rather than whole entities: the roll-up sums four integers per tenant.
        List<Object[]> entitlements = tenantRepository.findEntitlementsByIds(scope);

        long branchLimit = 0, userLimit = 0, storageLimit = 0, nlqLimit = 0;
        for (Object[] row : entitlements) {
            branchLimit += orZero((Integer) row[1]);
            userLimit += orZero((Integer) row[2]);
            storageLimit += orZero((Integer) row[3]);
            nlqLimit += orZero((Integer) row[4]);
        }

        Accumulator branches = new Accumulator();
        Accumulator users = new Accumulator();
        Accumulator nlq = new Accumulator();

        for (Object[] row : entitlements) {
            UUID tenantId = (UUID) row[0];

            try {
                var live = userClient.listBranches(tenantId);
                branches.count(live == null ? 0 : live.size());
            } catch (Exception ex) {
                log.warn("[analytics] tenant={} branch count unavailable ({}) — the roll-up records "
                        + "an unreadable tenant rather than adding zero", tenantId, ex.toString());
                branches.unreadable();
            }

            try {
                // size=1, not 0: the producer reads 0 as "use the default page size", which would
                // pull a whole page of names and emails across the wire to compute a count.
                var page = authUserDirectoryClient.list(tenantId, 0, 1, false, null, null, null);
                Long totalCount = page == null || page.meta() == null ? null : page.meta().totalCount();
                if (totalCount == null) {
                    users.unreadable();
                } else {
                    users.count(totalCount);
                }
            } catch (Exception ex) {
                log.warn("[analytics] tenant={} user count unavailable ({})", tenantId, ex.toString());
                users.unreadable();
            }

            try {
                String raw = redis.opsForValue().get(NLQ_COUNTER_KEY.formatted(tenantId));
                if (raw == null) {
                    // Absent key means the counter was never wired for this tenant. A tenant that
                    // has run no queries this month and a platform where nlq-service never
                    // incremented anything look identical at the key level, so neither is claimed.
                    nlq.notMetered();
                } else {
                    nlq.count(Long.parseLong(raw.trim()));
                }
            } catch (NumberFormatException ex) {
                nlq.unreadable();
            } catch (Exception ex) {
                log.warn("[analytics] tenant={} nlq counter read failed ({})", tenantId, ex.toString());
                nlq.unreadable();
            }
        }

        int inScope = entitlements.size();
        List<MeterRollup> meters = List.of(
                branches.toRollup("branches", "branches", branchLimit, inScope,
                        "user-service live count, one call per tenant "
                            + "(GET /internal/users/tenants/{id}/branches) — the same source "
                            + "TenantSubscriptionService trusts to refuse a downgrade"),
                users.toRollup("users", "users", userLimit, inScope,
                        "auth-service meta.totalCount, one call per tenant "
                            + "(GET /internal/auth/users?page=0&size=1 with X-Tenant-Id). Note the "
                            + "per-tenant GET /tenants/{id}/usage endpoint still reports users as "
                            + "not-metered; it has not been moved onto this source"),
                new MeterRollup("storage_gb", "GB", null, storageLimit,
                        0, inScope, 0, false,
                        "no producer records storage usage anywhere — file-service emits no usage "
                            + "events, so there is nothing to sum"),
                nlq.toRollup("nlq_queries", "queries", nlqLimit, inScope,
                        "Redis nlq_quota:{tenantId}:monthly_count, written by nlq-service. An absent "
                            + "key is reported as not-metered, never as zero"));

        boolean anyMetered = meters.stream().anyMatch(m -> m.tenantsCounted() > 0);

        return new UsageRollupResponse(
                Instant.now(),
                status == null ? "ALL" : status.name(),
                inScope,
                truncated,
                meters,
                anyMetered);
    }

    /** Tallies one dimension across tenants without ever letting a failure become a zero. */
    private static final class Accumulator {
        private long total;
        private int counted;
        private int notMetered;
        private int unreadable;

        void count(long value) {
            total += value;
            counted++;
        }

        void notMetered() {
            notMetered++;
        }

        void unreadable() {
            unreadable++;
        }

        MeterRollup toRollup(String resource, String unit, long limitTotal, int inScope, String source) {
            return new MeterRollup(
                    resource, unit,
                    counted == 0 ? null : total,
                    limitTotal,
                    counted, notMetered, unreadable,
                    counted == inScope,
                    source);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /** The bucket granularities offered. Anything finer than a day over a seven-year platform is a report. */
    public enum Interval { DAY, WEEK, MONTH }

    private static ZonedDateTime bucketStart(Instant instant, Interval interval, ZoneId zone) {
        LocalDate date = instant.atZone(zone).toLocalDate();
        LocalDate start = switch (interval) {
            case DAY -> date;
            case WEEK -> date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
            case MONTH -> date.withDayOfMonth(1);
        };
        return start.atStartOfDay(zone);
    }

    private static String label(ZonedDateTime bucket, Interval interval) {
        return switch (interval) {
            case DAY -> DAY_LABEL.format(bucket.toLocalDate());
            case WEEK -> "%d-W%02d".formatted(
                    bucket.get(IsoFields.WEEK_BASED_YEAR), bucket.get(IsoFields.WEEK_OF_WEEK_BASED_YEAR));
            case MONTH -> "%04d-%02d".formatted(bucket.getYear(), bucket.getMonthValue());
        };
    }

    /**
     * Fills every declared enum constant with a real count, defaulting the unseen ones to zero.
     *
     * <p>Legitimate here and NOT in a time series, and the distinction is worth stating because it
     * looks like the same operation. The status and tier sets are closed and compiled in, and the
     * table has a row for every tenant, so "no tenant is currently PURGED" is a fact the query
     * established. A time bucket with no rows establishes nothing of the kind — it cannot separate
     * "nothing happened" from "we were not there yet".
     */
    private static Map<String, Long> densify(List<Object[]> grouped, List<String> allKeys) {
        Map<String, Long> counts = new LinkedHashMap<>();
        for (String key : allKeys) {
            counts.put(key, 0L);
        }
        for (Object[] row : grouped) {
            counts.put(String.valueOf(row[0]), ((Number) row[1]).longValue());
        }
        return Map.copyOf(counts);
    }

    /** {@code SELECT MIN(x), MAX(x)} always returns one row; both elements are null when empty. */
    private static Instant[] bounds(List<Object[]> rows) {
        if (rows == null || rows.isEmpty() || rows.get(0) == null) {
            return new Instant[]{null, null};
        }
        Object[] row = rows.get(0);
        return new Instant[]{(Instant) row[0], (Instant) row[1]};
    }

    private static long orZero(Integer value) {
        return value == null ? 0L : value;
    }
}
