package io.restaurantos.platform.dto;

import io.restaurantos.platform.entity.SubscriptionHistoryEntity;
import io.restaurantos.platform.entity.SubscriptionPlanEntity;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Wire contracts for plans, subscriptions and subscription history.
 *
 * <h3>Why a separate file from {@link PlatformDtos}</h3>
 *
 * <p>{@code PlatformDtos} is a single ~450-line file that four contract-frozen surfaces share
 * (tenant lifecycle, features, usage, impersonation) and that several concurrent workstreams edit.
 * Appending a whole new domain to it buys nothing and guarantees a conflict; nothing here is
 * referenced by an existing contract.
 *
 * <h3>Money on the wire</h3>
 *
 * <p>Every amount is {@code long} paisa and is named {@code …Paisa}, so a client cannot mistake it
 * for major units. There is no formatted-currency field and no {@code amount} without a unit — the
 * one bug this naming exists to prevent is a display layer dividing by 100 twice, or not at all.
 */
public final class SubscriptionDtos {

    private SubscriptionDtos() {}

    // ── Plans ───────────────────────────────────────────────────────────────────────────────

    /**
     * A plan as an operator reads it.
     *
     * @param features the feature codes this plan grants, DERIVED from its tier through
     *                 {@code TierFeatureDefaults} rather than stored on the plan. There is one
     *                 feature matrix in this product and a second copy would be wrong from the
     *                 first time a code changes tier — the phantom-flag defect that has shipped
     *                 twice here (a gateway route gated on a code no tier grants answers a clean
     *                 403 that looks exactly like "the tenant has not bought the module").
     * @param maxTerminals declared ceiling or null. <b>Not measurable by the platform plane</b> —
     *                 {@code pos_terminals} is behind FORCE RLS in pos_db with no internal count
     *                 endpoint. It is returned so an operator can see what was written down, and
     *                 the limits report marks it NOT_MEASURABLE rather than compliant.
     * @param maxOrdersPerMonth same, for a figure that lives in ClickHouse, which this service has
     *                 no driver for.
     * @param subscriptionCount how many subscriptions currently name this plan — the number that
     *                 makes archiving a considered act rather than a guess.
     */
    public record PlanResponse(
        UUID id,
        String code,
        String name,
        String description,
        String tier,
        long pricePaisa,
        String currency,
        String billingPeriod,
        int trialDays,
        int maxBranches,
        int maxUsers,
        int storageGb,
        int nlqQuota,
        Integer maxTerminals,
        Integer maxOrdersPerMonth,
        boolean active,
        Map<String, Boolean> features,
        long subscriptionCount,
        Instant createdAt,
        Instant updatedAt
    ) {
        public static PlanResponse of(SubscriptionPlanEntity p, Map<String, Boolean> features,
                                      long subscriptionCount) {
            return new PlanResponse(
                p.getId(), p.getCode(), p.getName(), p.getDescription(), p.getTier().name(),
                p.getPricePaisa(), p.getCurrency(), p.getBillingPeriod().name(), p.getTrialDays(),
                p.getMaxBranches(), p.getMaxUsers(), p.getStorageGb(), p.getNlqQuota(),
                p.getMaxTerminals(), p.getMaxOrdersPerMonth(), p.isActive(),
                features, subscriptionCount, p.getCreatedAt(), p.getUpdatedAt());
        }
    }

    /**
     * @param code lowercase, digits and hyphens. Constrained because it is an API path segment and
     *             a stable identifier operators type; letting it carry spaces or slashes makes some
     *             plans unaddressable and only discovers that later.
     * @param pricePaisa BIGINT paisa. Zero is legal — an internal or comped plan is a real thing —
     *             but negative is not: a negative price is a data-entry accident, not a discount.
     */
    public record CreatePlanRequest(
        @NotBlank @Size(max = 60) @Pattern(regexp = "^[a-z0-9][a-z0-9-]*$",
            message = "must be lowercase letters, digits and hyphens") String code,
        @NotBlank @Size(max = 120) String name,
        @Size(max = 500) String description,
        @NotBlank String tier,
        @PositiveOrZero long pricePaisa,
        String currency,
        @NotBlank String billingPeriod,
        @PositiveOrZero int trialDays,
        Integer maxBranches,
        Integer maxUsers,
        Integer storageGb,
        Integer nlqQuota,
        Integer maxTerminals,
        Integer maxOrdersPerMonth
    ) {}

    /**
     * Every field optional; null means "leave it alone".
     *
     * <p><b>There is deliberately no {@code code} and no {@code tier}.</b> The code is what live
     * subscriptions, history rows and API paths address the plan by. The tier is the entitlement:
     * changing it under a plan would silently re-tier every tenant on it at some indeterminate
     * future moment (whenever something next reconciled), with no history row and no operator
     * decision. Re-tiering is a plan CHANGE, made per tenant, through the subscription endpoint.
     */
    public record UpdatePlanRequest(
        @Size(max = 120) String name,
        @Size(max = 500) String description,
        Long pricePaisa,
        String currency,
        String billingPeriod,
        Integer trialDays,
        Integer maxBranches,
        Integer maxUsers,
        Integer storageGb,
        Integer nlqQuota,
        Integer maxTerminals,
        Integer maxOrdersPerMonth
    ) {}

    // ── Subscriptions ───────────────────────────────────────────────────────────────────────

    /**
     * A tenant's subscription.
     *
     * <p><b>Read {@link TenantSubscriptionResponse#subscription} being null as a real answer.</b>
     * No tenant in this database has ever had a subscription — the registry is new and nothing was
     * backfilled, because inventing a plan, a price and a start date for an existing tenant would
     * assert a commercial agreement nobody made. The tenant still has a tier, and it is returned
     * beside the absence.
     *
     * @param tier the tenant's CURRENT tier, from the tenant row. Returned even when there is no
     *             subscription, because entitlement does not depend on this registry.
     * @param planTierMatchesTenantTier false when someone moved the tier directly through
     *             {@code POST /tenants/{id}/tier} while a subscription named a different one. It is
     *             surfaced rather than silently reconciled: the two are both real operator actions
     *             and the product must not guess which one was meant.
     */
    public record TenantSubscriptionResponse(
        UUID tenantId,
        String tier,
        SubscriptionDetail subscription,
        Boolean planTierMatchesTenantTier,
        String note
    ) {}

    /**
     * @param renewalOverdue derived, never stored: {@code currentPeriodEndAt} is in the past and the
     *        subscription is still live. <b>The scheduler does not roll renewal periods forward.</b>
     *        Advancing the date would assert that the tenant paid, and this product observes no
     *        payments — so a renewal is an operator action ({@code POST …/subscription/renew}) and
     *        this flag is the worklist that prompts it.
     * @param trialDaysRemaining null when there is no trial. Never negative and never 0-as-a-default:
     *        an elapsed trial reports {@code TRIAL_ENDED} in the status, not a zero that reads like
     *        "ends today".
     */
    public record SubscriptionDetail(
        UUID id,
        UUID tenantId,
        String status,
        PlanSummary plan,
        Instant trialStartAt,
        Instant trialEndAt,
        Long trialDaysRemaining,
        Instant currentPeriodStartAt,
        Instant currentPeriodEndAt,
        boolean renewalOverdue,
        PlanSummary pendingPlan,
        Instant pendingChangeAt,
        String pendingChangeReason,
        Instant cancelAt,
        String cancelReason,
        Instant cancelledAt,
        Instant startedAt,
        Instant endedAt
    ) {}

    /** Just enough of a plan to render it beside a subscription. */
    public record PlanSummary(UUID id, String code, String name, String tier,
                              long pricePaisa, String currency, String billingPeriod) {
        public static PlanSummary of(SubscriptionPlanEntity p) {
            return new PlanSummary(p.getId(), p.getCode(), p.getName(), p.getTier().name(),
                p.getPricePaisa(), p.getCurrency(), p.getBillingPeriod().name());
        }
    }

    /**
     * Assign a plan, or move an existing subscription onto a different one.
     *
     * @param effectiveAt null applies the change now. A future instant SCHEDULES it — nothing moves
     *        until the scheduler applies it, and the response says so. A PAST instant is refused
     *        rather than treated as "now": backdating a plan change would put an effective date in
     *        the history that the entitlement never actually had.
     * @param startTrial when true and the plan declares {@code trialDays > 0}, the subscription
     *        starts TRIALING and the trial window is stamped from the plan. Ignored on a plan with
     *        no trial length — there is nothing to derive a window from and a made-up one is worse
     *        than none.
     * @param force apply the plan even when the tenant measurably exceeds its ceilings. The refusal
     *        is the default. Boxed for the reason {@code ChangeTierRequest.force} is boxed: as a
     *        primitive, a body that omits it is a 400, which turns the safe default into an error.
     * @param reason recorded on the history row. Not optional for a change that alters what a tenant
     *        is entitled to — the trail exists to answer "why", and "" is not an answer.
     */
    public record AssignPlanRequest(
        @NotBlank String planCode,
        Instant effectiveAt,
        Boolean startTrial,
        Boolean force,
        @NotBlank @Size(max = 500) String reason
    ) {
        public boolean forced() { return Boolean.TRUE.equals(force); }
        public boolean trialRequested() { return Boolean.TRUE.equals(startTrial); }
    }

    /**
     * @param effectiveAt null cancels immediately; a future instant schedules it and the
     *        subscription stays live until then, which is the ordinary "cancel at period end" case.
     */
    public record CancelSubscriptionRequest(
        Instant effectiveAt,
        @NotBlank @Size(max = 500) String reason
    ) {}

    /**
     * Record a renewal an operator knows happened.
     *
     * <p>The new period end is REQUIRED and is not derived from the billing period by default,
     * because this product cannot observe a payment: an operator asserting a renewal must state
     * what they are asserting. {@code deriveFromBillingPeriod} is offered for the ordinary case and
     * makes the derivation explicit rather than implicit.
     */
    public record RenewSubscriptionRequest(
        Instant currentPeriodEndAt,
        Boolean deriveFromBillingPeriod,
        @NotBlank @Size(max = 500) String reason
    ) {
        public boolean derive() { return Boolean.TRUE.equals(deriveFromBillingPeriod); }
    }

    // ── Limits ──────────────────────────────────────────────────────────────────────────────

    /**
     * Whether one ceiling is being respected — and, just as importantly, whether we can tell.
     *
     * <p>The four states are not interchangeable and collapsing them is the defect this type exists
     * to prevent. It is the same trichotomy {@code PlatformDtos.UsageMeter} established for the
     * usage endpoint, extended by one because a limit check has a verdict as well as a reading:
     * {@code UsageMeter} answers "how many", this answers "is that too many".
     */
    public enum LimitState {
        /** Measured, and inside the ceiling. */
        WITHIN,
        /** Measured, and over the ceiling. This is what a refusal is built from. */
        EXCEEDED,
        /**
         * Nobody counts this dimension, so no verdict is possible. <b>Must not render as a tick.</b>
         * Three of the six ceilings are here today and the reasons are concrete, not vague: no
         * per-tenant user count is exposed by auth-service, no producer records storage, and the
         * NLQ counter key is unwritten. Terminals and monthly orders are in other services' RLS-ed
         * databases and in ClickHouse respectively.
         */
        NOT_MEASURABLE,
        /**
         * A real meter that did not answer on this request. Distinct from NOT_MEASURABLE: this one
         * would normally give a number, and treating the failure as "fine" is how a downgrade gets
         * applied over a limit nobody checked. Same posture as {@code UsageMeter.unreadable}.
         */
        UNREADABLE
    }

    /**
     * @param ceiling null when the plan declares no limit for this dimension — distinct from a
     *                ceiling of 0, which would mean "none allowed".
     * @param used    null unless {@link #state} is WITHIN or EXCEEDED. Never 0 as a stand-in for
     *                "unknown": zero is a claim that we counted and found none.
     * @param source  plain-language provenance, rendered in the UI. An operator looking at
     *                "not measurable" is owed the reason, and the reason is what tells them whether
     *                it is worth fixing.
     */
    public record PlanLimitCheck(
        String limit,
        String unit,
        Long used,
        Integer ceiling,
        LimitState state,
        String source
    ) {}

    /**
     * @param anyMeasurable false when NOT ONE ceiling could be checked. The console renders a single
     *        honest banner in that case rather than six rows that each look like an isolated
     *        omission instead of a platform-wide one — the pattern
     *        {@code TenantUsageResponse.anyMetered} established.
     * @param exceeded the count of ceilings measurably breached. Zero here does NOT mean the tenant
     *        fits: it means nothing we can measure says otherwise. {@code anyMeasurable} is what
     *        separates the two readings and both belong on the screen.
     */
    public record SubscriptionLimitReport(
        UUID tenantId,
        String planCode,
        String tier,
        List<PlanLimitCheck> checks,
        boolean anyMeasurable,
        int exceeded
    ) {}

    // ── History ─────────────────────────────────────────────────────────────────────────────

    /**
     * One immutable transition.
     *
     * <p>Plan codes and prices are the values captured AT THE TIME, not resolved on read: a plan can
     * be archived and re-priced afterwards, and a trail that re-resolved them would retroactively
     * rewrite what a tenant was moved onto.
     */
    public record SubscriptionHistoryRecord(
        UUID id,
        UUID tenantId,
        UUID subscriptionId,
        String changeType,
        String fromPlanCode,
        String toPlanCode,
        String fromStatus,
        String toStatus,
        String fromTier,
        String toTier,
        Long fromPricePaisa,
        Long toPricePaisa,
        Instant effectiveAt,
        Instant recordedAt,
        String actorKind,
        UUID actorPlatformUserId,
        String actorEmail,
        String reason,
        boolean forcedOverLimits,
        String detail
    ) {
        public static SubscriptionHistoryRecord of(SubscriptionHistoryEntity h, String actorEmail) {
            return new SubscriptionHistoryRecord(
                h.getId(), h.getTenantId(), h.getSubscriptionId(), h.getChangeType().name(),
                h.getFromPlanCode(), h.getToPlanCode(), h.getFromStatus(), h.getToStatus(),
                h.getFromTier(), h.getToTier(), h.getFromPricePaisa(), h.getToPricePaisa(),
                h.getEffectiveAt(), h.getRecordedAt(), h.getActorKind().name(),
                h.getActorPlatformUserId(), actorEmail, h.getReason(), h.isForcedOverLimits(),
                h.getDetail());
        }
    }

    // ── The cross-tenant register ───────────────────────────────────────────────────────────

    /**
     * One row of the cross-tenant subscription register.
     *
     * <p>Tenant slug and brand are resolved from {@code platform_db.tenants} — the same database,
     * one batched read per page, exactly as {@code ImpersonationRecord} resolves them.
     */
    public record SubscriptionRegisterRow(
        UUID tenantId,
        String tenantSlug,
        String tenantBrandName,
        String tenantStatus,
        String tier,
        String planCode,
        String planName,
        long pricePaisa,
        String currency,
        String billingPeriod,
        String status,
        Instant trialEndAt,
        Instant currentPeriodEndAt,
        boolean renewalOverdue,
        Instant pendingChangeAt,
        String pendingPlanCode,
        Instant cancelAt
    ) {}

    /**
     * The register, with the one figure that makes it readable.
     *
     * @param tenantsWithoutSubscription how many tenants have NO subscription record at all. This is
     *        the coverage number, and without it the register is dangerously easy to misread as
     *        "the fleet": on the day this shipped it is every tenant, because nothing was
     *        backfilled. Rendering the list alone would imply the missing tenants do not exist.
     *        <p><b>There is deliberately no MRR, ARR, total-contract-value or revenue figure here,
     *        and no endpoint anywhere in this service computes one.</b> A price is what a plan is
     *        sold at; revenue is what was received, and this product contains no invoice, no
     *        payment, no processor integration and no ledger of platform-side money — so any such
     *        aggregate would be a number the system cannot compute rendered as though it had. If
     *        billing is ever integrated, the sum becomes real and belongs beside the payments that
     *        make it so.
     */
    public record SubscriptionRegisterResponse(
        List<SubscriptionRegisterRow> subscriptions,
        long totalSubscriptions,
        long tenantsWithoutSubscription,
        String revenueNote
    ) {}

    /** The one place the absence of billing is stated in words, so a screen can render it verbatim. */
    public static final String REVENUE_NOT_AVAILABLE =
        "Billing is not integrated: this product records no invoice, payment or processor "
            + "transaction anywhere, so no revenue, MRR, ARR or churn-value figure can be computed. "
            + "Plan prices below are what each plan is SOLD at, not money received.";

    /** Marker for a tenant that has never been given a subscription — a true answer, not an error. */
    public static final String NO_SUBSCRIPTION_NOTE =
        "This tenant has no subscription record. Its entitlements come from its tier, which is "
            + "returned above. Nothing was backfilled when the subscription registry was added, "
            + "because inventing a plan, a price and a start date would assert an agreement nobody "
            + "made. Assign a plan to create one.";
}
