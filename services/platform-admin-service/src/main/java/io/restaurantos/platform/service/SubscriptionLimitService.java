package io.restaurantos.platform.service;

import io.restaurantos.platform.dto.PlatformDtos.TenantUsageResponse;
import io.restaurantos.platform.dto.PlatformDtos.UsageMeter;
import io.restaurantos.platform.dto.SubscriptionDtos.LimitState;
import io.restaurantos.platform.dto.SubscriptionDtos.PlanLimitCheck;
import io.restaurantos.platform.dto.SubscriptionDtos.SubscriptionLimitReport;
import io.restaurantos.platform.entity.SubscriptionPlanEntity;
import io.restaurantos.platform.exception.SubscriptionLimitExceededException.Violation;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Whether a tenant fits inside a plan's ceilings — and, where it cannot be determined, saying so.
 *
 * <h3>The whole point: a limit nobody checks is decoration</h3>
 *
 * <p>Before this class, {@code subscription_plans.max_users} would have been a number in a table
 * that nothing ever compared anything to. That is the failure mode the brief names, and it is not
 * hypothetical here: {@code tenants.max_users} has existed since 010-001, is stamped on every
 * tenant by {@code TierLimits}, and <b>nothing in this product has ever enforced it</b> — not at
 * user creation, not at downgrade. This class is where a plan ceiling acquires a reader.
 *
 * <h3>It measures nothing itself, on purpose</h3>
 *
 * <p>Every reading comes from {@link UsageService#meters(UUID)} — the endpoint that already answers
 * "what is this tenant using" and already distinguishes counted / not-metered / unreadable. Probing
 * user-service and Redis a second time here would produce a second answer to the same question, and
 * two screens contradicting each other about a tenant's branch count is worse than one screen
 * saying "unknown". It is the same argument {@code TierLimits}' javadoc makes about a second copy of
 * the tier table.
 *
 * <p>The consequence is a good one: the day a producer appears for any dimension — a user count on
 * auth-service's internal channel, a storage meter in file-service, the NLQ counter actually being
 * written — that ceiling starts being enforced here with <b>no change to this file</b>, because
 * {@code UsageService} will report it as counted and the mapping below already handles that.
 *
 * <h3>What CANNOT be checked today, stated rather than hidden</h3>
 *
 * <table>
 *   <tr><th>Ceiling</th><th>Checkable</th><th>Why</th></tr>
 *   <tr><td>branches</td><td><b>yes</b></td>
 *       <td>live count from {@code GET /internal/users/tenants/{id}/branches} — the same call the
 *           tier downgrade guard already trusts, so the two cannot disagree</td></tr>
 *   <tr><td>users</td><td>no</td>
 *       <td>auth-service exposes no per-tenant count on the channel {@code UsageService} reads.
 *           <b>This is the closest gap to closing</b> — {@code GET /internal/auth/users?size=1}
 *           returns {@code meta.totalCount} today</td></tr>
 *   <tr><td>storage_gb</td><td>no</td><td>no producer records storage anywhere</td></tr>
 *   <tr><td>nlq_queries</td><td>when written</td>
 *       <td>a real counter shape the gateway throttles against; an ABSENT key is reported as
 *           unwired, not as zero</td></tr>
 *   <tr><td>terminals</td><td>no</td>
 *       <td>{@code pos_terminals} is behind FORCE RLS in pos_db and pos-service exposes no count</td></tr>
 *   <tr><td>orders/month</td><td>no</td>
 *       <td>lives in {@code clickhouse_analytics.sales_order_facts}; this service has no ClickHouse
 *           driver, and adding one is a deliberate, separate decision</td></tr>
 * </table>
 *
 * <p><b>An empty violation list is therefore NOT a statement that the tenant fits.</b> It is a
 * statement that nothing we can measure says otherwise. {@link SubscriptionLimitReport#anyMeasurable}
 * is what lets a screen tell those apart, and both belong on it.
 */
@Service
public class SubscriptionLimitService {

    /** Plan ceiling → the meter resource name {@code UsageService} publishes it under. */
    private static final Map<String, String> METER_BY_LIMIT = Map.of(
        "branches", "branches",
        "users", "users",
        "storage_gb", "storage_gb",
        "nlq_queries", "nlq_queries");

    private final UsageService usageService;

    public SubscriptionLimitService(UsageService usageService) {
        this.usageService = usageService;
    }

    /**
     * Every ceiling the plan declares, checked where checking is possible.
     *
     * <p>Ordered branches → users → storage → NLQ → terminals → orders so the one dimension that is
     * genuinely measured leads, rather than a screen opening on four "not measurable" rows.
     */
    public SubscriptionLimitReport evaluate(UUID tenantId, SubscriptionPlanEntity plan) {
        TenantUsageResponse usage = usageService.meters(tenantId);
        Map<String, UsageMeter> meters = new LinkedHashMap<>();
        for (UsageMeter meter : usage.meters()) {
            meters.put(meter.resource(), meter);
        }

        List<PlanLimitCheck> checks = new ArrayList<>();
        checks.add(check(meters, "branches", "branches", plan.getMaxBranches()));
        checks.add(check(meters, "users", "users", plan.getMaxUsers()));
        checks.add(check(meters, "storage_gb", "GB", plan.getStorageGb()));
        checks.add(check(meters, "nlq_queries", "queries", plan.getNlqQuota()));
        checks.add(unmeasurable("terminals", "terminals", plan.getMaxTerminals(),
            "pos_terminals lives in pos_db behind FORCE row-level security and pos-service exposes "
                + "no terminal count on any internal channel — the platform plane cannot reach it"));
        checks.add(unmeasurable("orders_per_month", "orders", plan.getMaxOrdersPerMonth(),
            "monthly order volume lives in clickhouse_analytics.sales_order_facts and "
                + "platform-admin-service has no ClickHouse driver on its classpath"));

        boolean anyMeasurable = checks.stream()
            .anyMatch(c -> c.state() == LimitState.WITHIN || c.state() == LimitState.EXCEEDED);
        int exceeded = (int) checks.stream().filter(c -> c.state() == LimitState.EXCEEDED).count();

        return new SubscriptionLimitReport(tenantId, plan.getCode(), plan.getTier().name(),
            List.copyOf(checks), anyMeasurable, exceeded);
    }

    /**
     * The ceilings this tenant MEASURABLY breaches on the given plan.
     *
     * <p>Only {@link LimitState#EXCEEDED} produces a violation. An unreadable meter deliberately
     * does <b>not</b>: {@code TenantSubscriptionService.usageViolations} takes the opposite posture
     * for a tier downgrade — it refuses when the branch count cannot be obtained — and the
     * difference is not an inconsistency. That guard protects the ONE dimension it can read and an
     * outage there means it can read nothing at all. Here, refusing every plan change whenever any
     * of six meters is unreadable would make the whole surface unusable during a partial outage,
     * and four of the six are permanently unreadable by design. The honest report is what the
     * limits endpoint returns; this method answers the narrower question a refusal needs.
     */
    public List<Violation> violations(UUID tenantId, SubscriptionPlanEntity plan) {
        List<Violation> violations = new ArrayList<>();
        for (PlanLimitCheck check : evaluate(tenantId, plan).checks()) {
            if (check.state() == LimitState.EXCEEDED && check.used() != null && check.ceiling() != null) {
                violations.add(new Violation(check.limit(), check.used(), check.ceiling()));
            }
        }
        return violations;
    }

    // --- Mapping -------------------------------------------------------------------------------

    /**
     * Map one usage meter onto one plan ceiling.
     *
     * <p>{@code UsageMeter}'s three states carry straight through, because they already encode the
     * distinction this class must not lose: {@code metered=false} is "nobody counts this",
     * {@code unavailable=true} is "a real meter did not answer", and only a non-null {@code used}
     * is a number anyone may compare.
     */
    private PlanLimitCheck check(Map<String, UsageMeter> meters, String limit, String unit, Integer ceiling) {
        UsageMeter meter = meters.get(METER_BY_LIMIT.getOrDefault(limit, limit));
        if (meter == null) {
            return new PlanLimitCheck(limit, unit, null, ceiling, LimitState.NOT_MEASURABLE,
                "no usage meter is published for this resource");
        }
        if (!meter.metered()) {
            return new PlanLimitCheck(limit, unit, null, ceiling, LimitState.NOT_MEASURABLE, meter.source());
        }
        if (meter.unavailable() || meter.used() == null) {
            return new PlanLimitCheck(limit, unit, null, ceiling, LimitState.UNREADABLE, meter.source());
        }
        if (ceiling == null) {
            // The meter reads, but the plan sets no ceiling for it. Reporting WITHIN would imply a
            // comparison that was never made against a limit that does not exist.
            return new PlanLimitCheck(limit, unit, meter.used(), null, LimitState.NOT_MEASURABLE,
                "the plan declares no ceiling for this resource; usage is " + meter.used()
                    + " (" + meter.source() + ")");
        }
        LimitState state = meter.used() > ceiling ? LimitState.EXCEEDED : LimitState.WITHIN;
        return new PlanLimitCheck(limit, unit, meter.used(), ceiling, state, meter.source());
    }

    /**
     * A ceiling the platform plane structurally cannot read.
     *
     * <p>Returned even when the plan declares no value, so the screen shows the dimension and its
     * reason rather than omitting it — an operator who cannot see that terminals are unenforced may
     * reasonably assume they are enforced.
     */
    private PlanLimitCheck unmeasurable(String limit, String unit, Integer ceiling, String why) {
        return new PlanLimitCheck(limit, unit, null, ceiling, LimitState.NOT_MEASURABLE,
            ceiling == null ? "the plan declares no ceiling for this resource; " + why : why);
    }
}
