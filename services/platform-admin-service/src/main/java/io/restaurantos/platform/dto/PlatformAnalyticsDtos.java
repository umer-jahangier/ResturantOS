package io.restaurantos.platform.dto;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * The wire contract for platform-wide analytics.
 *
 * <h2>One rule, applied everywhere in this file</h2>
 *
 * <p><b>A figure the platform cannot compute renders as a stated absence, never as a number.</b>
 * The precedent is {@code PlatformDtos.UsageMeter}, whose {@code counted / notMetered / unreadable}
 * trichotomy exists because a console showing "0 / 50 branches" for a tenant with seven live
 * branches is worse than a console with no usage screen — decisions get made on it. Every scalar
 * here is a {@link PlatformFigure} carrying the same three states, and every series here is an
 * {@link HonestSeries} that returns the buckets it observed rather than a dense line of zeroes.
 *
 * <h2>Why a series is not back-filled</h2>
 *
 * <p>Back-filling a missing bucket with zero asserts "we measured this period and nothing
 * happened". For several of the columns behind these series that assertion is false: the platform
 * did not exist yet, or the column is written by a lifecycle transition that publishes no event and
 * keeps only its most recent value. A zero and "we did not measure" are different facts and a chart
 * cannot tell them apart once they are the same number, so they never become the same number here.
 * {@link HonestSeries#observedFrom} and {@link HonestSeries#coverage} give the reader what a
 * back-filled zero would have hidden.
 *
 * <h2>What is deliberately absent</h2>
 *
 * <p>There is no revenue, MRR, ARR, ARPU, churn-value, invoice or payment figure anywhere in this
 * file, because there is none in this product: {@code platform_db} holds
 * {@code tenants, tenant_features, platform_users, usage_records, impersonation_log} plus outbox
 * infrastructure, and {@code tenants.billing_ref} is free text pointing at a billing system that
 * does not exist here. Rather than omit them silently — which invites the next author to "add the
 * missing MRR tile" — {@link AnalyticsOverviewResponse#unavailableMetrics} names them and says why,
 * so the absence is part of the contract.
 */
public final class PlatformAnalyticsDtos {

    private PlatformAnalyticsDtos() {}

    // ─────────────────────────────────────────────────────────────────────────
    // The honest scalar
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * One platform figure, in one of three states.
     *
     * <ul>
     *   <li>{@code measured=true, value=n} — really computed. {@code value=0} means zero, and means
     *       it.</li>
     *   <li>{@code measured=false, value=null} — nothing in this product computes this. The screen
     *       must render the {@code source} text, never a number.</li>
     *   <li>{@code unreadable=true, value=null} — a real figure whose source did not answer on this
     *       request. Neither zero nor reassuring.</li>
     * </ul>
     *
     * @param source plain-language provenance. An operator looking at "not measured" is owed the
     *               reason, and an operator looking at a number is owed where it came from.
     */
    public record PlatformFigure(
            String name,
            Long value,
            boolean measured,
            boolean unreadable,
            String source
    ) {
        public static PlatformFigure measured(String name, long value, String source) {
            return new PlatformFigure(name, value, true, false, source);
        }

        public static PlatformFigure notMeasured(String name, String why) {
            return new PlatformFigure(name, null, false, false, why);
        }

        public static PlatformFigure unreadable(String name, String why) {
            return new PlatformFigure(name, null, true, true, why);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // The honest series
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * One bucket of a series.
     *
     * @param bucketStart  the instant the bucket opens, cut in the requested zone.
     * @param count        events observed in this bucket. Always ≥ 1 — a bucket with none is not
     *                     emitted, because emitting it would be the back-fill this type exists to
     *                     avoid.
     * @param cumulative   running total including {@link HonestSeries#baselineBeforeWindow}, or
     *                     null for series where a cumulative reading would be meaningless (see
     *                     {@link HonestSeries#coverage}).
     */
    public record SeriesPoint(Instant bucketStart, String bucketLabel, long count, Long cumulative) {}

    /**
     * A time series with its own limits stated in the body.
     *
     * @param interval             DAY, WEEK or MONTH.
     * @param zone                 the zone the buckets were cut in. Cutting a business day at UTC
     *                             for an {@code Asia/Karachi} platform moves every boundary five
     *                             hours — the defect class already fixed twice in this repo (the
     *                             Takings screen, and {@code AuditQueryController}'s {@code zone}
     *                             parameter), so the cut is a parameter here too and it is echoed
     *                             back.
     * @param observedFrom         the first instant this metric has any observation at all, across
     *                             all time — NOT the window start. A chart that begins at the window
     *                             start implies the metric was zero before it; this says when the
     *                             record actually begins.
     * @param observedTo           the last observation across all time, or null if there are none.
     * @param baselineBeforeWindow how many events precede the window, when that is computable — the
     *                             number a cumulative line has to start from. Null when the metric
     *                             has no meaningful baseline.
     * @param points               only the buckets with observations, ascending.
     * @param backFilled           always false. Present in the contract so a consumer can assert on
     *                             it rather than assume it, and so that a future change that starts
     *                             back-filling has to say so on the wire.
     * @param coverage             what this series does and does not prove, in words the screen can
     *                             render next to it.
     */
    public record HonestSeries(
            String metric,
            String interval,
            String zone,
            Instant windowFrom,
            Instant windowTo,
            Instant observedFrom,
            Instant observedTo,
            Long baselineBeforeWindow,
            List<SeriesPoint> points,
            boolean backFilled,
            String coverage
    ) {}

    // ─────────────────────────────────────────────────────────────────────────
    // Overview
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Tenant population.
     *
     * @param byStatus every one of the six declared statuses, densified against the enum with a
     *                 real zero. That densification is legitimate where a time bucket's is not: the
     *                 status set is closed and compiled in, so "no tenant is currently PURGED" is
     *                 something the table can actually establish.
     * @param byTier   likewise for the four tiers.
     * @param active   tenants in {@code ACTIVE}. The only status that means "serving traffic".
     * @param inactive every other status combined — deliberately one number rather than a
     *                 second "not active" bucket per status, since {@code byStatus} already has
     *                 the breakdown and two views of the same split invite them to disagree.
     */
    public record TenantPopulation(
            long total,
            Map<String, Long> byStatus,
            Map<String, Long> byTier,
            List<StatusTierCell> byStatusAndTier,
            long active,
            long inactive
    ) {}

    /** One cell of the status × tier cross-tab. Only occurring combinations are emitted. */
    public record StatusTierCell(String status, String tier, long count) {}

    /**
     * The platform overview.
     *
     * @param unavailableMetrics metrics a Superadmin dashboard would normally show and this
     *                           platform genuinely cannot: each is a {@code notMeasured}
     *                           {@link PlatformFigure} whose source names the missing capability.
     *                           They are in the payload rather than omitted so that the screen can
     *                           render the absence deliberately instead of leaving a gap that reads
     *                           like an oversight.
     */
    public record AnalyticsOverviewResponse(
            Instant generatedAt,
            Instant windowFrom,
            Instant windowTo,
            TenantPopulation tenants,
            List<PlatformFigure> lifecycle,
            List<PlatformFigure> entitlement,
            List<PlatformFigure> operations,
            List<PlatformFigure> unavailableMetrics
    ) {}

    // ─────────────────────────────────────────────────────────────────────────
    // Growth
    // ─────────────────────────────────────────────────────────────────────────

    /** Growth, suspension and cancellation, each as its own honestly-bounded series. */
    public record TenantGrowthResponse(
            Instant generatedAt,
            HonestSeries created,
            HonestSeries suspended,
            HonestSeries cancelled
    ) {}

    // ─────────────────────────────────────────────────────────────────────────
    // Usage roll-up
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * One usage dimension rolled up across tenants.
     *
     * <p>The per-tenant endpoint {@code GET /tenants/{id}/usage} answers three ways per dimension:
     * counted, not-metered, unreadable. A roll-up therefore cannot be a single number — it is a
     * number PLUS how many tenants it actually covers. A "1,240 branches" tile computed from nine
     * of fourteen tenants is a different fact from the same tile computed from fourteen, and the
     * difference is exactly what an operator would act on.
     *
     * @param total            summed across the tenants that could be counted; null when none
     *                         could.
     * @param limitTotal       summed tier ceilings across the tenants in scope. Always computable —
     *                         it is stamped on the tenant row.
     * @param tenantsCounted   how many tenants contributed a real number.
     * @param tenantsNotMetered how many have no meter at all for this dimension.
     * @param tenantsUnreadable how many have a meter that did not answer on this request.
     * @param complete         true only when every tenant in scope was counted.
     */
    public record MeterRollup(
            String resource,
            String unit,
            Long total,
            long limitTotal,
            int tenantsCounted,
            int tenantsNotMetered,
            int tenantsUnreadable,
            boolean complete,
            String source
    ) {}

    /**
     * Platform-wide usage against entitlement.
     *
     * @param scope           which tenants were rolled up (a {@code TenantStatus} name, or ALL).
     * @param tenantsInScope  how many tenants that resolved to.
     * @param scopeTruncated  true when the scope exceeded the fan-out ceiling and only the first
     *                        {@code tenantsInScope} were read. A truncated roll-up that does not
     *                        say so is a fabricated total.
     * @param anyMetered      false when NOT ONE dimension is recorded for ANY tenant — the console
     *                        then renders one honest banner instead of five separate "not metered"
     *                        rows that each read like an isolated omission.
     */
    public record UsageRollupResponse(
            Instant generatedAt,
            String scope,
            int tenantsInScope,
            boolean scopeTruncated,
            List<MeterRollup> meters,
            boolean anyMetered
    ) {}
}
