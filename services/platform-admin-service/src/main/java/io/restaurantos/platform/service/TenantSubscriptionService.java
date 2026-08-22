package io.restaurantos.platform.service;

import io.restaurantos.platform.client.UserInternalClient;
import io.restaurantos.platform.config.TierFeatureDefaults;
import io.restaurantos.platform.config.TierLimits;
import io.restaurantos.platform.entity.SubscriptionHistoryEntity.ActorKind;
import io.restaurantos.platform.entity.SubscriptionPlanEntity;
import io.restaurantos.platform.entity.TenantEntity;
import io.restaurantos.platform.entity.TenantEntity.TenantStatus;
import io.restaurantos.platform.entity.TenantEntity.TierType;
import io.restaurantos.platform.exception.TierLimitExceededException;
import io.restaurantos.platform.exception.TierLimitExceededException.Violation;
import io.restaurantos.platform.repository.SubscriptionPlanRepository;
import io.restaurantos.platform.repository.TenantRepository;
import io.restaurantos.platform.repository.TenantSubscriptionRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Tenant subscription management: the editable profile, the commercial dates, and the tier
 * (PLATFORM-02/03, D-35).
 *
 * <h3>Why this exists</h3>
 * <p>The tier was write-once. It was chosen at provisioning and there was no way to change it,
 * which made every feature gate in the product end in a dead link: the gateway returns an
 * {@code X-Upgrade-CTA-URL} header on every {@code FEATURE_DISABLED} response and the destination
 * did not exist. Three columns on the tenant row — {@code billing_ref}, {@code trial_ends_at}, and
 * (once 13-14 added it) {@code renews_at} — were likewise never read or written by anything.
 *
 * <h3>What a tier change actually does</h3>
 * <ol>
 *   <li>Re-applies {@link TierLimits} — the numeric ceilings, previously stamped only at
 *       provisioning.</li>
 *   <li>Reconciles the feature rows against the new tier's defaults through
 *       {@link FeatureFlagAdminService#reconcileToTierDefaults}, which preserves SuperAdmin
 *       overrides (PLATFORM-10) and invalidates BOTH Redis key shapes for every code that moved,
 *       so the gateway sees the change on the very next request with no restart and no TTL wait.</li>
 *   <li>Writes the tenant's new NLQ quota to the gateway's quota cache key, for the same reason.</li>
 * </ol>
 *
 * <h3>What a downgrade does NOT do</h3>
 * <p><b>It destroys no tenant data.</b> Lowering a tier changes four integer ceilings on the tenant
 * row and flips {@code tenant_features.is_enabled} for the codes the lower tier does not cover.
 * Nothing is deleted anywhere: branches, users, orders, ledger entries and every record belonging
 * to a now-disabled module stay exactly as they were. Disabling a module GATES it — the gateway
 * answers 403 FEATURE_DISABLED at the edge — and re-upgrading restores access to the same rows.
 * The one thing a downgrade can leave behind is a tenant sitting above its own new ceiling, which
 * is why the usage check below exists.
 */
@Service
public class TenantSubscriptionService {

    private static final Logger log = LoggerFactory.getLogger(TenantSubscriptionService.class);

    /**
     * The gateway's per-tenant NLQ quota cache key. Same {@code tenant:} namespace and the same
     * 5-minute TTL discipline as {@code tenant:status:{id}}, which {@code TenantLifecycleService}
     * already writes on every lifecycle transition for exactly this reason: a limit that only takes
     * effect once a cache expires is not a limit an operator can rely on.
     *
     * <p><b>This string is a contract with two readers</b> — {@code FeatureFlagGlobalFilter} in the
     * gateway and {@code NlqQuotaService} in nlq-service. Changing it here without changing it
     * there silently returns both of them to a compiled-in constant.
     */
    public static final String QUOTA_KEY_PREFIX = "tenant:nlq_quota:";

    /**
     * Statuses on which a tier change is meaningless. A CANCELLED or PURGED tenant has no
     * subscription to move between tiers, and permitting it would let a re-tiering silently
     * resurrect entitlements for an account that is gone. SUSPENDED is deliberately NOT here:
     * upgrading is a normal way to resolve a suspension.
     */
    private static final Set<TenantStatus> TIER_CHANGE_FORBIDDEN =
        EnumSet.of(TenantStatus.CANCELLED, TenantStatus.PURGED);

    private final TenantRepository tenantRepository;
    private final FeatureFlagAdminService featureFlagAdminService;
    private final TierFeatureDefaults tierFeatureDefaults;
    private final TierLimits tierLimits;
    private final UserInternalClient userClient;
    private final StringRedisTemplate redis;
    private final SubscriptionHistoryRecorder historyRecorder;
    private final TenantSubscriptionRepository subscriptionRepository;
    private final SubscriptionPlanRepository planRepository;

    public TenantSubscriptionService(TenantRepository tenantRepository,
                                     FeatureFlagAdminService featureFlagAdminService,
                                     TierFeatureDefaults tierFeatureDefaults,
                                     TierLimits tierLimits,
                                     UserInternalClient userClient,
                                     StringRedisTemplate redis,
                                     SubscriptionHistoryRecorder historyRecorder,
                                     TenantSubscriptionRepository subscriptionRepository,
                                     SubscriptionPlanRepository planRepository) {
        this.tenantRepository = tenantRepository;
        this.featureFlagAdminService = featureFlagAdminService;
        this.tierFeatureDefaults = tierFeatureDefaults;
        this.tierLimits = tierLimits;
        this.userClient = userClient;
        this.redis = redis;
        this.historyRecorder = historyRecorder;
        this.subscriptionRepository = subscriptionRepository;
        this.planRepository = planRepository;
    }

    /**
     * Update the editable profile and subscription fields. Every argument is optional; a null
     * leaves the stored value alone, so a caller can set a billing reference without having to
     * resend the brand name.
     *
     * <p><b>The slug is not editable and there is no parameter for it.</b> Login resolves a tenant
     * by slug ({@code auth_db.auth_tenants.slug} mirrors it), the login URL handed to every
     * provisioned admin embeds it, and nothing in this codebase propagates a slug rename to
     * auth-service. An editable slug would therefore be a silent way to make a tenant unable to log
     * in, which is the exact blocker this phase exists to close.
     */
    @Transactional
    public TenantEntity update(UUID tenantId, String brandName, String billingRef,
                               Instant trialEndsAt, Instant renewsAt) {
        TenantEntity tenant = requireTenant(tenantId);
        if (tenant.getStatus() == TenantStatus.PURGED) {
            throw new StateInvalidException("Tenant " + tenantId + " is PURGED and cannot be edited");
        }
        if (brandName != null && !brandName.isBlank()) {
            tenant.setBrandName(brandName.trim());
        }
        if (billingRef != null) {
            // Blank clears it — a SuperAdmin removing a billing reference has to be able to say so,
            // and null already means "leave alone".
            tenant.setBillingRef(billingRef.isBlank() ? null : billingRef.trim());
        }
        if (trialEndsAt != null) {
            tenant.setTrialEndsAt(trialEndsAt);
        }
        if (renewsAt != null) {
            tenant.setRenewsAt(renewsAt);
        }
        tenantRepository.save(tenant);
        projectDatesOntoSubscription(tenantId, trialEndsAt, renewsAt);
        log.info("[subscription] tenant={} updated — billingRef={} trialEndsAt={} renewsAt={}",
            tenantId, tenant.getBillingRef(), tenant.getTrialEndsAt(), tenant.getRenewsAt());
        return tenant;
    }

    /**
     * Keep {@code tenants.trial_ends_at} / {@code tenants.renews_at} and the live subscription row
     * from drifting apart.
     *
     * <p>Both places genuinely need the dates. The tenant columns are contract-frozen: they are on
     * {@code TenantResponse}, the tenant list and detail screens read them, and this PATCH is the
     * only editor they have ever had. The subscription row needs them because a subscription that
     * cannot express its own period is not a subscription. Without this projection an operator
     * editing the renewal date here would leave the subscription claiming the old one, and the two
     * screens would disagree with no way to tell which was right.
     *
     * <p><b>The trial date is projected only onto a subscription that ALREADY has a trial window.</b>
     * {@code chk_tenant_subscriptions_trial_pair} requires the start and the end together, so
     * setting an end on a subscription that never had a trial would mean inventing a start — and
     * the honest start of a trial that was never recorded is not knowable. A no-op with a log line
     * is the correct answer there; the subscription endpoint is where a trial is actually opened.
     *
     * <p>A no-op when the tenant has no subscription, which is every tenant in this database today.
     */
    private void projectDatesOntoSubscription(UUID tenantId, Instant trialEndsAt, Instant renewsAt) {
        if (trialEndsAt == null && renewsAt == null) {
            return;
        }
        subscriptionRepository.findLive(tenantId).ifPresent(subscription -> {
            boolean changed = false;
            if (renewsAt != null) {
                subscription.setCurrentPeriodEndAt(renewsAt);
                changed = true;
            }
            if (trialEndsAt != null) {
                if (subscription.getTrialStartAt() != null) {
                    subscription.setTrialEndAt(trialEndsAt);
                    changed = true;
                } else {
                    log.info("[subscription] tenant={} trialEndsAt was set on the tenant row but its "
                        + "subscription has no trial window to extend — not inventing a trial start",
                        tenantId);
                }
            }
            if (changed) {
                subscriptionRepository.save(subscription);
            }
        });
    }

    /**
     * Move a tenant to a different tier, re-applying both halves of what a tier means.
     *
     * @param force apply the tier even when the tenant is already over the target's limits. The
     *              refusal is the default; this is the SuperAdmin saying "yes, I know".
     */
    @Transactional
    public TierChangeResult changeTier(UUID tenantId, TierType targetTier, boolean force) {
        return changeTier(tenantId, targetTier, force, null, null);
    }

    /**
     * As above, naming the SuperAdmin who did it so the change lands in {@code subscription_history}
     * attributed rather than anonymous.
     *
     * <p><b>Why the actor is a parameter and not read from the {@code SecurityContext} here.</b>
     * This method has two call paths with genuinely different principals: the public endpoint, where
     * the acting id is the {@code sub} of a verified control-plane token, and a direct in-process
     * call (the scheduler applying a plan change, an integration test driving the service), where
     * there is no human at all. A service reaching into the security context would silently record
     * the second case as whoever happened to be on the thread, which is worse than recording that
     * nobody was: {@code actorKind} says which, and the database refuses an OPERATOR row with no id.
     *
     * @param actingPlatformUserId {@code platform_users.id}, or null when no operator principal
     *                             exists on this path — the row is then attributed to SYSTEM.
     * @param reason               optional. The pre-existing {@code POST /tenants/{id}/tier} body
     *                             carries none and that contract is frozen, so a tier change made
     *                             through it records who and when but not why. The subscription
     *                             endpoints require a reason; this one cannot without breaking a
     *                             shipped contract.
     */
    @Transactional
    public TierChangeResult changeTier(UUID tenantId, TierType targetTier, boolean force,
                                       UUID actingPlatformUserId, String reason) {
        TenantEntity tenant = requireTenant(tenantId);
        if (TIER_CHANGE_FORBIDDEN.contains(tenant.getStatus())) {
            throw new StateInvalidException(
                "Tenant " + tenantId + " is " + tenant.getStatus() + " — its tier cannot be changed");
        }

        TierType previousTier = tenant.getTier();
        if (previousTier == targetTier) {
            // Idempotent rather than an error: a client retrying a tier change it already made
            // should not be told it did something wrong. Nothing is reconciled and nothing is
            // invalidated, because nothing moved.
            log.info("[subscription] tenant={} already on tier {} — no change", tenantId, targetTier);
            return new TierChangeResult(tenantId, previousTier.name(), targetTier.name(),
                List.of(), tierLimits.forTier(targetTier), false);
        }

        TierLimits.Limits target = tierLimits.forTier(targetTier);
        List<Violation> violations = usageViolations(tenantId, target);
        if (!violations.isEmpty()) {
            if (!force) {
                log.warn("[subscription] tenant={} tier change {}→{} REFUSED: {}",
                    tenantId, previousTier, targetTier, violations);
                throw new TierLimitExceededException(targetTier.name(), violations);
            }
            log.warn("[subscription] tenant={} tier change {}→{} FORCED over {} — the tenant is now "
                    + "above its own limits and nothing has been deleted to make it fit",
                tenantId, previousTier, targetTier, violations);
        }

        List<String> changedCodes = applyEntitlement(tenant, targetTier, target);

        boolean forcedOverLimits = force && !violations.isEmpty();
        log.info("[subscription] tenant={} tier {}→{} applied — limits {} , {} feature code(s) changed{}",
            tenantId, previousTier, targetTier, target, changedCodes.size(),
            forcedOverLimits ? " (FORCED over limits)" : "");

        // The record that did not exist before the subscription registry: tenants.tier is a column
        // an operator overwrites, this method publishes no event, and platform_db cannot reach
        // audit_db — so until now a tier change left no trace anywhere in the product.
        recordTierHistory(tenantId, previousTier, targetTier, changedCodes, violations,
            forcedOverLimits, actingPlatformUserId, reason);

        return new TierChangeResult(tenantId, previousTier.name(), targetTier.name(),
            changedCodes, target, forcedOverLimits);
    }

    /**
     * Apply BOTH halves of an entitlement to a tenant: the numeric ceilings and the feature set.
     *
     * <p><b>Extracted so there is exactly one applier with two callers</b> — {@link #changeTier},
     * which passes the TIER's limits, and {@code SubscriptionService}, which passes the PLAN's,
     * because a bespoke plan can carry negotiated ceilings its tier's defaults do not. Two copies of
     * this sequence would diverge on the day one of them learned about a fifth ceiling or a second
     * cache key, and nothing would fail: the tenant would simply be entitled to different things
     * depending on which endpoint moved it. That is the same argument {@link TierLimits}' own
     * javadoc makes about the tier table having two callers.
     *
     * <p>Does not save the tenant's caller-visible response and does not validate: the caller owns
     * the refusal policy, this owns the mechanics.
     *
     * @return the feature codes whose stored value moved
     */
    @Transactional
    public List<String> applyEntitlement(TenantEntity tenant, TierType targetTier, TierLimits.Limits limits) {
        UUID tenantId = tenant.getId();
        tenant.setTier(targetTier);
        tierLimits.applyTo(tenant, limits);
        tenantRepository.save(tenant);

        // The qualitative half. Overrides survive; both cache key shapes are written for every code
        // that moved, which is what makes the change visible to the gateway immediately.
        Map<String, Boolean> defaults = tierFeatureDefaults.defaultsFor(targetTier.name());
        List<String> changedCodes = featureFlagAdminService.reconcileToTierDefaults(tenantId, defaults);

        // The quota the gateway and nlq-service enforce against. Written straight through rather
        // than deleted: a delete would leave the gateway to re-resolve on the next request, and a
        // resolution that fails now fails CLOSED (503), so a tier UPGRADE could briefly refuse
        // requests it just paid for.
        writeQuotaKey(tenantId, limits.nlqQuota());
        return changedCodes;
    }

    /**
     * One history row per tier change, with the tenant's live subscription attached when there is
     * one — and a note when the tier now disagrees with the plan that subscription names.
     *
     * <p>The divergence is RECORDED, never silently reconciled. Moving the tier directly while a
     * subscription names a different one is a real operator action and so is the subscription; the
     * product must not guess which was meant. {@code GET .../subscription} surfaces the same fact as
     * {@code planTierMatchesTenantTier}.
     */
    private void recordTierHistory(UUID tenantId, TierType previousTier, TierType targetTier,
                                   List<String> changedCodes, List<Violation> violations,
                                   boolean forcedOverLimits, UUID actingPlatformUserId, String reason) {
        var subscription = subscriptionRepository.findLive(tenantId).orElse(null);
        String planTier = null;
        if (subscription != null) {
            planTier = planRepository.findById(subscription.getPlanId())
                .map(SubscriptionPlanEntity::getTier)
                .map(Enum::name)
                .orElse(null);
        }
        boolean divergedFromPlan = planTier != null && !planTier.equals(targetTier.name());
        if (divergedFromPlan) {
            log.warn("[subscription] tenant={} tier moved to {} directly while its subscription "
                + "names a {} plan — the divergence is recorded, not reconciled", tenantId,
                targetTier, planTier);
        }
        String detail = "{\"changedFeatureCodes\":" + changedCodes.size()
            + ",\"violationsOverridden\":" + violations.size()
            + ",\"subscriptionPlanTier\":" + (planTier == null ? "null" : "\"" + planTier + "\"")
            + ",\"divergedFromSubscriptionPlan\":" + divergedFromPlan
            + ",\"via\":\"POST /tenants/{id}/tier\"}";
        historyRecorder.recordTierChange(tenantId, subscription, previousTier.name(),
            targetTier.name(),
            actingPlatformUserId != null ? ActorKind.OPERATOR : ActorKind.SYSTEM,
            actingPlatformUserId, reason, forcedOverLimits, detail);
    }

    // --- Usage ----------------------------------------------------------------------------------

    /**
     * Which of the target tier's ceilings the tenant is already above.
     *
     * <h3>Branches are checked; users are not, and that is a named gap rather than an oversight</h3>
     * <p>user-service exposes {@code GET /internal/users/tenants/{id}/branches}, so the branch count
     * is authoritative and is read with RLS enforced at the producer. There is no equivalent for
     * users: the {@code users} table lives in auth_db and auth-service exposes no tenant user count
     * on any internal channel. Adding one was out of bounds for this plan (13-09 is working in
     * auth-service concurrently). The consequence is stated plainly in 13-14-SUMMARY: a downgrade
     * whose USER cap is below the tenant's current headcount is applied without a refusal. Nothing
     * is deleted by it, and no login breaks — {@code max_users} is a ceiling nothing currently
     * enforces at creation time either — but the refusal this method exists to produce does not
     * cover that case yet.
     *
     * <h3>An unreachable user-service refuses the downgrade</h3>
     * <p>If the branch count cannot be obtained, the downgrade is refused rather than applied on the
     * assumption that it is safe. That is the same posture 13-03 established for tenant status: an
     * undeterminable answer is not a permissive one. {@code force} still overrides it, so an
     * operator is never locked out of a tier change by an outage.
     */
    private List<Violation> usageViolations(UUID tenantId, TierLimits.Limits target) {
        List<Violation> violations = new ArrayList<>();
        long branchCount;
        try {
            var branches = userClient.listBranches(tenantId);
            branchCount = branches == null ? 0 : branches.size();
        } catch (Exception ex) {
            log.warn("[subscription] tenant={} branch count unavailable ({}) — refusing the tier "
                + "change rather than assuming it is safe", tenantId, ex.toString());
            return List.of(new Violation("branches (count unavailable: " + ex.getClass().getSimpleName() + ")",
                -1, target.maxBranches()));
        }
        if (branchCount > target.maxBranches()) {
            violations.add(new Violation("branches", branchCount, target.maxBranches()));
        }
        return violations;
    }

    // --- Helpers --------------------------------------------------------------------------------

    private TenantEntity requireTenant(UUID tenantId) {
        return tenantRepository.findById(tenantId)
            .orElseThrow(() -> new ResourceNotFoundException("Tenant", tenantId));
    }

    private void writeQuotaKey(UUID tenantId, int nlqQuota) {
        redis.opsForValue().set(QUOTA_KEY_PREFIX + tenantId, String.valueOf(nlqQuota));
    }

    /**
     * What changed, in enough detail for a SuperAdmin UI to say so.
     *
     * @param forcedOverLimits true when the change was applied despite the tenant being over the
     *                         target tier's limits — the caller asked for it, and the response says
     *                         so rather than reporting an ordinary success
     */
    public record TierChangeResult(UUID tenantId, String previousTier, String tier,
                                   List<String> changedFeatureCodes, TierLimits.Limits limits,
                                   boolean forcedOverLimits) {}
}
