package io.restaurantos.platform.controller;

import io.restaurantos.platform.dto.PlatformAnalyticsDtos.AnalyticsOverviewResponse;
import io.restaurantos.platform.dto.PlatformAnalyticsDtos.TenantGrowthResponse;
import io.restaurantos.platform.dto.PlatformAnalyticsDtos.UsageRollupResponse;
import io.restaurantos.platform.entity.TenantEntity.TenantStatus;
import io.restaurantos.platform.service.PlatformAnalyticsService;
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
import java.util.Locale;

/**
 * Platform-wide analytics for the SuperAdmin console.
 *
 * <p>A separate controller from {@code PlatformAdminController} on purpose: that class is the
 * tenant-lifecycle API and every one of its ~20 endpoint contracts is frozen and consumed by e2e.
 * Adding read-only analytics routes to it would put new code in the file with the most to lose.
 * This one is additive, all-GET, and touches no existing route.
 *
 * <p>Gated identically — class-level {@code hasAuthority('SUPER_ADMIN')} — because a platform token
 * carries exactly one authority and these reads cross every tenant boundary in the product.
 *
 * <h2>Dates and the zone they are cut in</h2>
 *
 * <p>{@code from}/{@code to} are inclusive calendar dates cut in {@code zone}, defaulting to UTC.
 * The parameter is not decoration: cutting a day at UTC for a platform whose branches run on
 * {@code Asia/Karachi} moves every boundary five hours and silently sweeps five hours of the
 * previous day into each bucket. That exact defect has been fixed twice in this repository already
 * (the Takings screen, and {@code AuditQueryController}). An unrecognised zone is a 422 naming the
 * field rather than a silent fall back to UTC, because a silent fall back is indistinguishable from
 * the bug.
 */
@RestController
@RequestMapping("/api/v1/platform/analytics")
@PreAuthorize("hasAuthority('SUPER_ADMIN')")
public class PlatformAnalyticsController {

    /**
     * The window an unparameterised call reads.
     *
     * <p>Ninety days for the same reason the audit screen uses ninety: the failure mode that
     * matters is an absent observation, not a slow query, and a shorter default omits more. It is a
     * default and never a cap — any range asked for explicitly is honoured.
     */
    private static final int DEFAULT_WINDOW_DAYS = 90;

    private final PlatformAnalyticsService analyticsService;

    public PlatformAnalyticsController(PlatformAnalyticsService analyticsService) {
        this.analyticsService = analyticsService;
    }

    /**
     * {@code GET /api/v1/platform/analytics/overview?from=&to=&zone=}
     *
     * <p>Tenant population by status and tier, the lifecycle counts in the window, the
     * operator-entered entitlement dates, impersonation volume — and an explicit, itemised list of
     * the metrics this platform cannot compute, so the console renders their absence deliberately
     * rather than leaving a hole that reads like an oversight.
     */
    @GetMapping("/overview")
    public ResponseEntity<ApiResponse<AnalyticsOverviewResponse>> overview(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) String zone) {
        ZoneId cut = resolveZone(zone);
        Instant fromInstant = startOfDay(resolveFrom(from, cut), cut);
        Instant toInstant = endOfDay(resolveTo(to, cut), cut);
        return ResponseEntity.ok(ApiResponse.ok(analyticsService.overview(fromInstant, toInstant)));
    }

    /**
     * {@code GET /api/v1/platform/analytics/tenant-growth?from=&to=&interval=&zone=}
     *
     * <p>Three sparse series — created, suspended, cancelled. Buckets with no observation are
     * absent, not zero, and each series carries the first and last instant its metric has ANY
     * observation so a chart cannot imply a measured zero before the platform existed.
     */
    @GetMapping("/tenant-growth")
    public ResponseEntity<ApiResponse<TenantGrowthResponse>> tenantGrowth(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(defaultValue = "MONTH") String interval,
            @RequestParam(required = false) String zone) {
        ZoneId cut = resolveZone(zone);
        Instant fromInstant = startOfDay(resolveFrom(from, cut), cut);
        Instant toInstant = endOfDay(resolveTo(to, cut), cut);
        return ResponseEntity.ok(ApiResponse.ok(
                analyticsService.growth(fromInstant, toInstant, resolveInterval(interval), cut)));
    }

    /**
     * {@code GET /api/v1/platform/analytics/usage?scope=ACTIVE}
     *
     * <p>The per-tenant usage meters rolled up platform-wide. Each dimension reports how many
     * tenants it actually covers alongside its total — a sum over nine of fourteen tenants is a
     * different fact from a sum over fourteen, and that difference is what an operator would act on.
     *
     * <p>{@code scope} is a {@code TenantStatus} name or {@code ALL}. It defaults to {@code ACTIVE}
     * because a cancelled tenant's branch count is not fleet capacity, and because the branches and
     * users dimensions are one internal HTTP call per tenant each.
     */
    @GetMapping("/usage")
    public ResponseEntity<ApiResponse<UsageRollupResponse>> usage(
            @RequestParam(defaultValue = "ACTIVE") String scope) {
        return ResponseEntity.ok(ApiResponse.ok(analyticsService.usageRollup(resolveScope(scope))));
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

    private static PlatformAnalyticsService.Interval resolveInterval(String interval) {
        try {
            return PlatformAnalyticsService.Interval.valueOf(interval.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            throw new FieldValidationException(
                    "INVALID_INTERVAL",
                    "interval",
                    "Expected one of DAY, WEEK or MONTH; received \"" + interval + "\".",
                    ex);
        }
    }

    /** {@code ALL} is null — "no status filter" — and any other value must name a real status. */
    private static TenantStatus resolveScope(String scope) {
        String value = scope == null ? "" : scope.trim().toUpperCase(Locale.ROOT);
        if (value.isEmpty() || "ALL".equals(value)) {
            return null;
        }
        try {
            return TenantStatus.valueOf(value);
        } catch (IllegalArgumentException ex) {
            throw new FieldValidationException(
                    "INVALID_SCOPE",
                    "scope",
                    "Expected ALL or one of "
                            + java.util.Arrays.toString(TenantStatus.values()) + ".",
                    ex);
        }
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

    /** Inclusive upper bound: the last instant of the named day, in the named zone. */
    private static Instant endOfDay(LocalDate date, ZoneId zone) {
        return date.plusDays(1).atStartOfDay(zone).toInstant().minusNanos(1);
    }
}
