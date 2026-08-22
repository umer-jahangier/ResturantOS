package io.restaurantos.platform.service;

import io.restaurantos.platform.config.TierLimits;
import io.restaurantos.platform.dto.SubscriptionDtos.*;
// The two plain-language absences the API renders verbatim. Static-imported because they are
// constants, not types: `SubscriptionDtos.*` brings in the nested records and nothing else.
import static io.restaurantos.platform.dto.SubscriptionDtos.NO_SUBSCRIPTION_NOTE;
import static io.restaurantos.platform.dto.SubscriptionDtos.REVENUE_NOT_AVAILABLE;
import io.restaurantos.platform.entity.SubscriptionHistoryEntity.ActorKind;
import io.restaurantos.platform.entity.SubscriptionHistoryEntity.ChangeType;
import io.restaurantos.platform.entity.SubscriptionPlanEntity;
import io.restaurantos.platform.entity.TenantEntity;
import io.restaurantos.platform.entity.TenantEntity.TenantStatus;
import io.restaurantos.platform.entity.TenantSubscriptionEntity;
import io.restaurantos.platform.entity.TenantSubscriptionEntity.SubscriptionStatus;
import io.restaurantos.platform.exception.SubscriptionLimitExceededException;
import io.restaurantos.platform.exception.SubscriptionLimitExceededException.Violation;
import io.restaurantos.platform.repository.SubscriptionHistoryRepository;
import io.restaurantos.platform.repository.SubscriptionPlanRepository;
import io.restaurantos.platform.repository.TenantRepository;
import io.restaurantos.platform.repository.TenantSubscriptionRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import jakarta.persistence.criteria.Predicate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Subscription lifecycle: assign a plan, move between plans (now or on a date), cancel, renew, and
 * read the trail of everything that has happened.
 *
 * <h3>What this deliberately does NOT do, and why the omission is the point</h3>
 *
 * <p><b>There is no revenue figure anywhere in this service.</b> No MRR, no ARR, no ARPU, no churn
 * value, no total contract value, no "failed payments" and no payment status. Those are not omitted
 * for scope: a repo-wide survey established that this product contains <b>no billing integration of
 * any kind</b> — no invoice entity, no payment entity, no processor client, no webhook, no price
 * table before this one and no currency field on any platform table
 * (.planning/superadmin/CAPABILITY-MAP.md §1.3). {@code subscription_plans.price_paisa} is what a
 * plan is SOLD at, asserted by an operator. Summing it across active subscriptions produces
 * contracted value, and a tile labelled "revenue" over that sum would be a number the system cannot
 * compute, rendered as though it had. If a processor is ever integrated, the sum becomes real and
 * belongs beside the payments that make it so.
 *
 * <p><b>The scheduler does not roll renewal periods forward.</b> Advancing {@code
 * current_period_end_at} when it elapses would assert that the tenant paid. Nothing here observes a
 * payment, so a renewal is an operator action ({@link #renew}) and an elapsed period surfaces as
 * {@code renewalOverdue} — a worklist, not a fact about money.
 *
 * <p><b>An elapsed trial changes no entitlement.</b> It moves the status to {@code TRIAL_ENDED} and
 * stops. Automatically downgrading or suspending would be the product inventing a commercial
 * consequence for an event it cannot connect to a payment decision.
 *
 * <h3>Cancelling a SUBSCRIPTION is not cancelling a TENANT</h3>
 *
 * <p>{@link #cancel} ends a commercial agreement. It does not touch the tenant's status, its data,
 * its users or its feature flags. {@code POST /tenants/{id}/cancel} — a different endpoint, a
 * different service, shipped two phases earlier — is what takes a tenant out of service. Conflating
 * them would let a billing decision silently take a restaurant's POS offline, and the two are
 * routinely made by different people.
 *
 * <h3>Entitlement is applied through the one applier</h3>
 *
 * <p>Assigning a plan moves the tenant's tier, ceilings, feature rows and NLQ quota key through
 * {@link TenantSubscriptionService#applyEntitlement} — the same method {@code changeTier} uses. The
 * plan supplies the ceilings (a negotiated agreement is precisely a tier whose numbers are not the
 * tier's defaults) and the tier supplies the feature set. Two appliers would drift, and the drift
 * would be invisible: a tenant would be entitled to different things depending on which endpoint
 * had last moved it.
 */
@Service
public class SubscriptionService {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionService.class);

    private final TenantRepository tenantRepository;
    private final TenantSubscriptionRepository subscriptionRepository;
    private final SubscriptionPlanRepository planRepository;
    private final SubscriptionHistoryRepository historyRepository;
    private final SubscriptionPlanService planService;
    private final SubscriptionLimitService limitService;
    private final SubscriptionHistoryRecorder historyRecorder;
    private final TenantSubscriptionService tenantSubscriptionService;
    private final PlatformUserLookup platformUserLookup;

    public SubscriptionService(TenantRepository tenantRepository,
                               TenantSubscriptionRepository subscriptionRepository,
                               SubscriptionPlanRepository planRepository,
                               SubscriptionHistoryRepository historyRepository,
                               SubscriptionPlanService planService,
                               SubscriptionLimitService limitService,
                               SubscriptionHistoryRecorder historyRecorder,
                               TenantSubscriptionService tenantSubscriptionService,
                               PlatformUserLookup platformUserLookup) {
        this.tenantRepository = tenantRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.planRepository = planRepository;
        this.historyRepository = historyRepository;
        this.planService = planService;
        this.limitService = limitService;
        this.historyRecorder = historyRecorder;
        this.tenantSubscriptionService = tenantSubscriptionService;
        this.platformUserLookup = platformUserLookup;
    }

    // ── Read ────────────────────────────────────────────────────────────────────────────────

    /**
     * A tenant's subscription, or a stated absence.
     *
     * <p>An unknown tenant is <b>404</b>. A known tenant with no subscription is <b>200 with
     * {@code subscription: null}</b> and a note saying why. Those are opposite answers and must not
     * look the same: the first means "you are asking about something that does not exist", the
     * second means "this tenant exists, is entitled by its tier, and has never been given a
     * subscription record". Every tenant in this database is in the second state today.
     */
    public TenantSubscriptionResponse forTenant(UUID tenantId) {
        TenantEntity tenant = requireTenant(tenantId);
        Optional<TenantSubscriptionEntity> live = subscriptionRepository.findLive(tenantId);
        if (live.isEmpty()) {
            return new TenantSubscriptionResponse(tenantId, tenant.getTier().name(), null, null,
                NO_SUBSCRIPTION_NOTE);
        }
        TenantSubscriptionEntity subscription = live.get();
        SubscriptionPlanEntity plan = requirePlan(subscription.getPlanId());
        boolean tierMatches = plan.getTier() == tenant.getTier();
        return new TenantSubscriptionResponse(
            tenantId, tenant.getTier().name(), detail(subscription, plan), tierMatches,
            tierMatches ? null
                : "The tenant's tier (" + tenant.getTier() + ") does not match the tier of the plan "
                    + "its subscription names (" + plan.getTier() + "). Both are real operator "
                    + "actions — a direct tier change and a plan assignment — and neither is "
                    + "silently reconciled. Re-assign the plan to bring them back into line.");
    }

    /** Which of the plan's ceilings this tenant respects, and which cannot be checked at all. */
    public SubscriptionLimitReport limits(UUID tenantId) {
        requireTenant(tenantId);
        TenantSubscriptionEntity subscription = requireLive(tenantId);
        return limitService.evaluate(tenantId, requirePlan(subscription.getPlanId()));
    }

    /** The append-only trail, newest first. */
    public Page<SubscriptionHistoryRecord> history(UUID tenantId, int page, int size) {
        requireTenant(tenantId);
        return historyRepository
            .findByTenantIdOrderByRecordedAtDesc(tenantId, PageRequest.of(page, boundedSize(size)))
            .map(h -> SubscriptionHistoryRecord.of(h, platformUserLookup.emailOf(h.getActorPlatformUserId())));
    }

    /**
     * The cross-tenant register.
     *
     * <p>{@code tenantsWithoutSubscription} is not decoration. On the day this shipped it is EVERY
     * tenant, because nothing was backfilled; a list rendered without it reads as "the fleet" and
     * silently omits everyone it does not know about.
     */
    public SubscriptionRegisterResponse register(String status, String planCode,
                                                 Instant trialEndingBefore, Instant renewingBefore,
                                                 int page, int size) {
        SubscriptionStatus statusFilter = status == null || status.isBlank()
            ? null : parseStatus(status);
        UUID planIdFilter = planCode == null || planCode.isBlank()
            ? null : planService.require(planCode).getId();

        Page<TenantSubscriptionEntity> results = subscriptionRepository.findAll(
            registerSpec(statusFilter, planIdFilter, trialEndingBefore, renewingBefore),
            PageRequest.of(page, boundedSize(size), Sort.by(Sort.Direction.DESC, "updatedAt")));

        // One batched read per page for the tenant and plan names, exactly as ImpersonationRecord
        // resolves its slugs — platform_db holds all three tables, so this is a join we are allowed
        // to make and a per-row lookup would be N+1 for no benefit.
        Map<UUID, TenantEntity> tenants = new HashMap<>();
        tenantRepository.findAllById(results.getContent().stream()
            .map(TenantSubscriptionEntity::getTenantId).distinct().toList())
            .forEach(t -> tenants.put(t.getId(), t));
        Map<UUID, SubscriptionPlanEntity> plans = new HashMap<>();
        planRepository.findAllById(results.getContent().stream()
            .flatMap(s -> java.util.stream.Stream.of(s.getPlanId(), s.getPendingPlanId()))
            .filter(java.util.Objects::nonNull).distinct().toList())
            .forEach(p -> plans.put(p.getId(), p));

        List<SubscriptionRegisterRow> rows = new ArrayList<>();
        for (TenantSubscriptionEntity s : results.getContent()) {
            TenantEntity tenant = tenants.get(s.getTenantId());
            SubscriptionPlanEntity plan = plans.get(s.getPlanId());
            SubscriptionPlanEntity pending = s.getPendingPlanId() == null
                ? null : plans.get(s.getPendingPlanId());
            rows.add(new SubscriptionRegisterRow(
                s.getTenantId(),
                tenant == null ? null : tenant.getSlug(),
                tenant == null ? null : tenant.getBrandName(),
                tenant == null ? null : tenant.getStatus().name(),
                tenant == null ? null : tenant.getTier().name(),
                plan == null ? null : plan.getCode(),
                plan == null ? null : plan.getName(),
                plan == null ? 0L : plan.getPricePaisa(),
                plan == null ? null : plan.getCurrency(),
                plan == null ? null : plan.getBillingPeriod().name(),
                s.getStatus().name(),
                s.getTrialEndAt(),
                s.getCurrentPeriodEndAt(),
                renewalOverdue(s),
                s.getPendingChangeAt(),
                pending == null ? null : pending.getCode(),
                s.getCancelAt()));
        }

        long withSubscription = subscriptionRepository.countByStatusNot(SubscriptionStatus.ENDED);
        long tenantsWithout = Math.max(0, tenantRepository.count() - withSubscription);
        return new SubscriptionRegisterResponse(List.copyOf(rows), results.getTotalElements(),
            tenantsWithout, REVENUE_NOT_AVAILABLE);
    }

    // ── Write ───────────────────────────────────────────────────────────────────────────────

    /**
     * Give a tenant a plan, or move it to a different one — now, or on a date.
     *
     * <p><b>A past {@code effectiveAt} is refused rather than treated as "now".</b> Backdating puts
     * an effective date in the trail that the entitlement never actually had, and the trail is the
     * artefact this whole domain exists to produce.
     *
     * <p><b>An immediate change is refused when the tenant measurably exceeds the target plan's
     * ceilings</b>, naming each one, unless {@code force} is set. Only MEASURABLE dimensions can
     * produce a refusal — see {@code SubscriptionLimitService} for which those are today (branches,
     * and the NLQ counter once anything writes it) and why an empty violation list is not a
     * statement that the tenant fits.
     *
     * <p><b>A scheduled change is NOT limit-checked at schedule time</b>, deliberately: the check
     * would be against today's usage for a change that lands in six weeks, and passing it would be
     * a reassurance with no shelf life. The scheduler re-checks when the change actually falls due,
     * and refuses there — leaving the pending change in place with a loud log line rather than
     * applying an entitlement the operator would not have chosen.
     */
    @Transactional
    public TenantSubscriptionResponse assignPlan(UUID tenantId, AssignPlanRequest req, UUID actorId) {
        TenantEntity tenant = requireTenant(tenantId);
        if (tenant.getStatus() == TenantStatus.PURGED) {
            throw new StateInvalidException(
                "Tenant " + tenantId + " is PURGED — it cannot be given a subscription");
        }
        SubscriptionPlanEntity plan = planService.require(req.planCode());
        if (!plan.isActive()) {
            throw new StateInvalidException("PLAN_ARCHIVED",
                "Plan '" + plan.getCode() + "' is archived and cannot be newly assigned. Restore it "
                    + "first if this is intentional; archived plans stay readable so historical "
                    + "prices survive, but selecting one now would be an accident.");
        }

        Instant now = Instant.now();
        Optional<TenantSubscriptionEntity> existing = subscriptionRepository.findLive(tenantId);

        if (req.effectiveAt() != null && req.effectiveAt().isAfter(now)) {
            return scheduleChange(tenant, existing, plan, req, actorId);
        }
        if (req.effectiveAt() != null && req.effectiveAt().isBefore(now.minus(Duration.ofMinutes(1)))) {
            throw new IllegalArgumentException(
                "effectiveAt " + req.effectiveAt() + " is in the past. A plan change cannot be "
                    + "backdated: the entitlement did not exist then, and the history row would say "
                    + "it did. Omit effectiveAt to apply the change now.");
        }
        return applyPlanNow(tenant, existing.orElse(null), plan, req.reason(), req.forced(),
            req.trialRequested(), ActorKind.OPERATOR, actorId);
    }

    /**
     * Cancel the subscription — immediately, or on a date.
     *
     * <p>The TENANT is untouched: no status change, no feature revocation, no ceiling change. See
     * this class's header.
     */
    @Transactional
    public TenantSubscriptionResponse cancel(UUID tenantId, CancelSubscriptionRequest req, UUID actorId) {
        requireTenant(tenantId);
        TenantSubscriptionEntity subscription = requireLive(tenantId);
        SubscriptionPlanEntity plan = requirePlan(subscription.getPlanId());
        Instant now = Instant.now();

        if (req.effectiveAt() != null && req.effectiveAt().isAfter(now)) {
            subscription.setCancelAt(req.effectiveAt());
            subscription.setCancelReason(req.reason());
            subscriptionRepository.save(subscription);
            historyRecorder.record(subscription, ChangeType.CANCELLATION_SCHEDULED, plan, plan,
                subscription.getStatus().name(), subscription.getStatus().name(), null, null,
                req.effectiveAt(), ActorKind.OPERATOR, actorId, req.reason(), false,
                json(Map.of("scheduled", true, "planCode", plan.getCode())));
            log.info("[subscription] tenant={} cancellation SCHEDULED for {} — the subscription is "
                + "live until then and the tenant is untouched either way", tenantId, req.effectiveAt());
            return forTenant(tenantId);
        }

        applyCancellation(subscription, plan, req.reason(), now, ActorKind.OPERATOR, actorId);
        return forTenant(tenantId);
    }

    /**
     * Withdraw whatever is scheduled — a pending plan change, a pending cancellation, or both.
     *
     * <p>Refuses when nothing is scheduled, rather than answering 200 for a no-op: an operator who
     * believes they have just cancelled a downgrade, and has not, will not check again.
     */
    @Transactional
    public TenantSubscriptionResponse cancelScheduled(UUID tenantId, UUID actorId) {
        requireTenant(tenantId);
        TenantSubscriptionEntity subscription = requireLive(tenantId);
        boolean hadPlanChange = subscription.hasPendingChange();
        boolean hadCancellation = subscription.getCancelAt() != null && subscription.getCancelledAt() == null;
        if (!hadPlanChange && !hadCancellation) {
            throw new StateInvalidException("NOTHING_SCHEDULED",
                "This subscription has no scheduled plan change and no scheduled cancellation to "
                    + "withdraw.");
        }
        SubscriptionPlanEntity plan = requirePlan(subscription.getPlanId());
        SubscriptionPlanEntity pending = subscription.getPendingPlanId() == null
            ? null : planRepository.findById(subscription.getPendingPlanId()).orElse(null);

        subscription.clearPendingChange();
        if (hadCancellation) {
            subscription.setCancelAt(null);
            subscription.setCancelReason(null);
        }
        subscriptionRepository.save(subscription);

        historyRecorder.record(subscription, ChangeType.SCHEDULED_CHANGE_CANCELLED, pending, plan,
            subscription.getStatus().name(), subscription.getStatus().name(), null, null,
            Instant.now(), ActorKind.OPERATOR, actorId, null, false,
            json(Map.of("withdrewPlanChange", hadPlanChange, "withdrewCancellation", hadCancellation)));
        log.info("[subscription] tenant={} withdrew scheduled items (planChange={}, cancellation={})",
            tenantId, hadPlanChange, hadCancellation);
        return forTenant(tenantId);
    }

    /**
     * Record a renewal.
     *
     * <p>This is an operator ASSERTION, not an observation: this product cannot see a payment, so
     * the endpoint exists precisely because the scheduler must not roll the period forward on its
     * own. The new period end is either stated outright or derived from the plan's billing period,
     * and {@code deriveFromBillingPeriod} makes the operator say which — an implicit derivation
     * would look identical to a measured fact in the trail.
     */
    @Transactional
    public TenantSubscriptionResponse renew(UUID tenantId, RenewSubscriptionRequest req, UUID actorId) {
        requireTenant(tenantId);
        TenantSubscriptionEntity subscription = requireLive(tenantId);
        if (subscription.getStatus() == SubscriptionStatus.CANCELLED) {
            throw new StateInvalidException(
                "This subscription is CANCELLED and cannot be renewed. Assign a plan to start a new one.");
        }
        SubscriptionPlanEntity plan = requirePlan(subscription.getPlanId());
        Instant now = Instant.now();
        Instant newStart = subscription.getCurrentPeriodEndAt() != null
            && subscription.getCurrentPeriodEndAt().isBefore(now)
            ? subscription.getCurrentPeriodEndAt()
            : now;

        Instant newEnd;
        if (req.currentPeriodEndAt() != null) {
            newEnd = req.currentPeriodEndAt();
        } else if (req.derive()) {
            newEnd = plusPeriod(newStart, plan);
        } else {
            throw new IllegalArgumentException(
                "Supply currentPeriodEndAt, or set deriveFromBillingPeriod=true to take it from the "
                    + "plan's " + plan.getBillingPeriod() + " period. Nothing here observes a "
                    + "payment, so a renewal date is something an operator states, never something "
                    + "this service infers on its own.");
        }
        if (!newEnd.isAfter(now)) {
            throw new IllegalArgumentException(
                "currentPeriodEndAt " + newEnd + " is not in the future — a period that has already "
                    + "ended is not a renewal.");
        }

        Instant previousEnd = subscription.getCurrentPeriodEndAt();
        subscription.setCurrentPeriodStartAt(newStart);
        subscription.setCurrentPeriodEndAt(newEnd);
        String fromStatus = subscription.getStatus().name();
        // A renewal is the operator saying the agreement continues, which resolves an elapsed trial.
        if (subscription.getStatus() == SubscriptionStatus.TRIALING
            || subscription.getStatus() == SubscriptionStatus.TRIAL_ENDED) {
            subscription.setStatus(SubscriptionStatus.ACTIVE);
        }
        subscriptionRepository.save(subscription);
        projectPeriodOntoTenant(subscription);

        historyRecorder.record(subscription, ChangeType.RENEWED, plan, plan, fromStatus,
            subscription.getStatus().name(), null, null, newStart, ActorKind.OPERATOR, actorId,
            req.reason(), false,
            json(new LinkedHashMap<>(Map.of(
                "previousPeriodEnd", String.valueOf(previousEnd),
                "newPeriodEnd", newEnd.toString(),
                "derivedFromBillingPeriod", req.currentPeriodEndAt() == null))));
        log.info("[subscription] tenant={} renewed — period {} → {} (asserted by operator {})",
            tenantId, newStart, newEnd, actorId);
        return forTenant(tenantId);
    }

    // ── Scheduler entry points ──────────────────────────────────────────────────────────────

    /**
     * Apply one scheduled plan change that has fallen due.
     *
     * <p>Re-reads and re-checks inside its own transaction, so a second sweep (another replica, an
     * overlapping run) finds the pending fields already cleared and does nothing. Idempotence here
     * is what stops a double-apply producing two history rows for one decision.
     *
     * <p>A limit violation at this point does NOT force the change through and does NOT withdraw it:
     * it leaves the pending change in place and logs. Applying would hand a tenant an entitlement
     * the operator was never asked about; withdrawing would silently discard their instruction.
     * Leaving it visible is the only option that keeps a human in the loop.
     */
    @Transactional
    public boolean applyDuePlanChange(UUID subscriptionId) {
        TenantSubscriptionEntity subscription = subscriptionRepository.findById(subscriptionId).orElse(null);
        if (subscription == null || !subscription.hasPendingChange()
            || subscription.getPendingChangeAt().isAfter(Instant.now())) {
            return false;
        }
        TenantEntity tenant = tenantRepository.findById(subscription.getTenantId()).orElse(null);
        if (tenant == null) {
            log.warn("[subscription-sweep] subscription={} names tenant={} which no longer exists",
                subscriptionId, subscription.getTenantId());
            return false;
        }
        SubscriptionPlanEntity target = planRepository.findById(subscription.getPendingPlanId()).orElse(null);
        if (target == null) {
            log.error("[subscription-sweep] tenant={} has a scheduled change to plan id={} that no "
                + "longer exists — leaving it pending for an operator", tenant.getId(),
                subscription.getPendingPlanId());
            return false;
        }
        List<Violation> violations = limitService.violations(tenant.getId(), target);
        if (!violations.isEmpty()) {
            log.error("[subscription-sweep] tenant={} scheduled change to '{}' is DUE but the tenant "
                + "is over its limits ({}) — NOT applying and NOT withdrawing. An operator must "
                + "resolve it: applying would grant an entitlement nobody chose, withdrawing would "
                + "discard their instruction.", tenant.getId(), target.getCode(), violations);
            return false;
        }
        String reason = subscription.getPendingChangeReason();
        Instant effectiveAt = subscription.getPendingChangeAt();
        subscription.clearPendingChange();
        applyPlanTo(tenant, subscription, target, reason, false, false,
            ChangeType.SCHEDULED_CHANGE_APPLIED, effectiveAt, ActorKind.SYSTEM, null);
        log.info("[subscription-sweep] tenant={} scheduled change applied → plan '{}'",
            tenant.getId(), target.getCode());
        return true;
    }

    /** Apply one cancellation whose operator-chosen date has arrived. Idempotent for the same reason. */
    @Transactional
    public boolean applyDueCancellation(UUID subscriptionId) {
        TenantSubscriptionEntity subscription = subscriptionRepository.findById(subscriptionId).orElse(null);
        if (subscription == null || subscription.getCancelAt() == null
            || subscription.getCancelledAt() != null
            || subscription.getCancelAt().isAfter(Instant.now())) {
            return false;
        }
        applyCancellation(subscription, requirePlan(subscription.getPlanId()),
            subscription.getCancelReason(), subscription.getCancelAt(), ActorKind.SYSTEM, null);
        log.info("[subscription-sweep] tenant={} scheduled cancellation applied", subscription.getTenantId());
        return true;
    }

    /**
     * Move an elapsed trial to {@code TRIAL_ENDED}.
     *
     * <p><b>Changes no entitlement.</b> The tenant keeps its tier, its ceilings and its feature
     * flags. This is the clock being observed, and a worklist row being produced; the commercial
     * decision that follows is a human's.
     */
    @Transactional
    public boolean markTrialEnded(UUID subscriptionId) {
        TenantSubscriptionEntity subscription = subscriptionRepository.findById(subscriptionId).orElse(null);
        if (subscription == null || subscription.getStatus() != SubscriptionStatus.TRIALING
            || subscription.getTrialEndAt() == null
            || subscription.getTrialEndAt().isAfter(Instant.now())) {
            return false;
        }
        SubscriptionPlanEntity plan = requirePlan(subscription.getPlanId());
        subscription.setStatus(SubscriptionStatus.TRIAL_ENDED);
        subscriptionRepository.save(subscription);
        historyRecorder.record(subscription, ChangeType.TRIAL_ENDED, plan, plan,
            SubscriptionStatus.TRIALING.name(), SubscriptionStatus.TRIAL_ENDED.name(), null, null,
            subscription.getTrialEndAt(), ActorKind.SYSTEM, null,
            "Trial window elapsed", false,
            json(Map.of("entitlementChanged", false, "trialEndAt", subscription.getTrialEndAt().toString())));
        log.info("[subscription-sweep] tenant={} trial ended — entitlements UNCHANGED, this is a "
            + "worklist state", subscription.getTenantId());
        return true;
    }

    // ── Internals ───────────────────────────────────────────────────────────────────────────

    private TenantSubscriptionResponse scheduleChange(TenantEntity tenant,
                                                      Optional<TenantSubscriptionEntity> existing,
                                                      SubscriptionPlanEntity plan,
                                                      AssignPlanRequest req, UUID actorId) {
        TenantSubscriptionEntity subscription = existing.orElseThrow(() -> new StateInvalidException(
            "NO_SUBSCRIPTION",
            "Tenant " + tenant.getId() + " has no subscription, so there is nothing to change on a "
                + "future date. Assign the plan now (omit effectiveAt) and schedule the next move "
                + "from there — a subscription that does not exist yet cannot be said to be moving."));
        SubscriptionPlanEntity current = requirePlan(subscription.getPlanId());
        subscription.setPendingPlanId(plan.getId());
        subscription.setPendingChangeAt(req.effectiveAt());
        subscription.setPendingChangeReason(req.reason());
        subscriptionRepository.save(subscription);

        historyRecorder.record(subscription, ChangeType.CHANGE_SCHEDULED, current, plan,
            subscription.getStatus().name(), subscription.getStatus().name(),
            current.getTier().name(), plan.getTier().name(),
            req.effectiveAt(), ActorKind.OPERATOR, actorId, req.reason(), false,
            json(Map.of("limitCheckDeferred", true,
                        "reason", "checked when the change falls due, not against today's usage")));
        log.info("[subscription] tenant={} plan change '{}'→'{}' SCHEDULED for {} — nothing has "
            + "moved yet", tenant.getId(), current.getCode(), plan.getCode(), req.effectiveAt());
        return forTenant(tenant.getId());
    }

    private TenantSubscriptionResponse applyPlanNow(TenantEntity tenant,
                                                    TenantSubscriptionEntity existing,
                                                    SubscriptionPlanEntity plan,
                                                    String reason, boolean force, boolean startTrial,
                                                    ActorKind actorKind, UUID actorId) {
        List<Violation> violations = limitService.violations(tenant.getId(), plan);
        if (!violations.isEmpty() && !force) {
            log.warn("[subscription] tenant={} plan change to '{}' REFUSED: {}",
                tenant.getId(), plan.getCode(), violations);
            throw new SubscriptionLimitExceededException(plan.getCode(), violations);
        }

        if (existing == null || existing.getStatus() == SubscriptionStatus.CANCELLED) {
            // A cancelled subscription is closed out rather than reused: its cancellation date, its
            // reason and its period are the record of an agreement that ended, and overwriting them
            // to start a new one would erase it. The unique index only excludes ENDED, which is why
            // the old row must reach that state before the new one is written.
            if (existing != null) {
                existing.setStatus(SubscriptionStatus.ENDED);
                existing.setEndedAt(Instant.now());
                subscriptionRepository.saveAndFlush(existing);
            }
            return createSubscription(tenant, plan, reason, !violations.isEmpty() && force,
                startTrial, actorKind, actorId);
        }
        return applyPlanTo(tenant, existing, plan, reason, force && !violations.isEmpty(), startTrial,
            null, Instant.now(), actorKind, actorId);
    }

    private TenantSubscriptionResponse createSubscription(TenantEntity tenant,
                                                          SubscriptionPlanEntity plan,
                                                          String reason, boolean forced,
                                                          boolean startTrial,
                                                          ActorKind actorKind, UUID actorId) {
        Instant now = Instant.now();
        TenantSubscriptionEntity subscription = new TenantSubscriptionEntity();
        subscription.setTenantId(tenant.getId());
        subscription.setPlanId(plan.getId());
        subscription.setCurrentPeriodStartAt(now);
        subscription.setStartedAt(now);

        boolean trial = startTrial && plan.getTrialDays() > 0;
        if (trial) {
            subscription.setStatus(SubscriptionStatus.TRIALING);
            subscription.setTrialStartAt(now);
            subscription.setTrialEndAt(now.plus(plan.getTrialDays(), ChronoUnit.DAYS));
            // No renewal date during a trial. NULL means "no renewal scheduled", which is exactly
            // true here — deriving one would assert a billing date nobody has agreed to yet.
            subscription.setCurrentPeriodEndAt(null);
        } else {
            subscription.setStatus(SubscriptionStatus.ACTIVE);
            // The first period end IS derivable: assigning a MONTHLY plan today is the operator
            // stating a monthly agreement starting today. That is the contract's shape, not a claim
            // that anybody has paid — and the renewal endpoint is what asserts the next one.
            subscription.setCurrentPeriodEndAt(plusPeriod(now, plan));
        }
        subscriptionRepository.save(subscription);

        applyEntitlementFromPlan(tenant, plan);
        projectPeriodOntoTenant(subscription);

        historyRecorder.record(subscription, ChangeType.SUBSCRIPTION_CREATED, null, plan,
            null, subscription.getStatus().name(), tenant.getTier().name(), plan.getTier().name(),
            now, actorKind, actorId, reason, forced,
            json(Map.of("trial", trial, "trialDays", plan.getTrialDays(),
                        "periodEndDerived", !trial)));
        log.info("[subscription] tenant={} subscribed to '{}' ({}), status={} — entitlement applied "
            + "from the PLAN's ceilings", tenant.getId(), plan.getCode(), plan.getTier(),
            subscription.getStatus());
        return forTenant(tenant.getId());
    }

    /**
     * Move a live subscription onto a different plan.
     *
     * <p><b>The billing period is deliberately left where it was.</b> Changing plan mid-period does
     * not restart or re-cut the period: this product cannot compute a proration (it has no invoice
     * to prorate against), and silently resetting the renewal date would move a commercial date
     * nobody agreed to move. The operator sets it explicitly through {@code renew} if the agreement
     * really did change shape.
     */
    private TenantSubscriptionResponse applyPlanTo(TenantEntity tenant,
                                                   TenantSubscriptionEntity subscription,
                                                   SubscriptionPlanEntity plan,
                                                   String reason, boolean forced, boolean startTrial,
                                                   ChangeType overrideType, Instant effectiveAt,
                                                   ActorKind actorKind, UUID actorId) {
        SubscriptionPlanEntity previous = requirePlan(subscription.getPlanId());
        if (previous.getId().equals(plan.getId())) {
            // Idempotent rather than an error, for the reason changeTier is: a client retrying a
            // change it already made should not be told it did something wrong. No entitlement is
            // re-applied and no history row is written, because nothing moved.
            log.info("[subscription] tenant={} already on plan '{}' — no change",
                tenant.getId(), plan.getCode());
            return forTenant(tenant.getId());
        }
        String fromStatus = subscription.getStatus().name();
        String fromTier = tenant.getTier().name();

        subscription.setPlanId(plan.getId());
        if (startTrial && plan.getTrialDays() > 0 && subscription.getTrialStartAt() == null) {
            Instant now = Instant.now();
            subscription.setStatus(SubscriptionStatus.TRIALING);
            subscription.setTrialStartAt(now);
            subscription.setTrialEndAt(now.plus(plan.getTrialDays(), ChronoUnit.DAYS));
        } else if (subscription.getStatus() == SubscriptionStatus.TRIAL_ENDED) {
            // Moving an expired trial onto a plan is the decision the TRIAL_ENDED worklist exists
            // to prompt; recording it as still expired would leave the row on that list forever.
            subscription.setStatus(SubscriptionStatus.ACTIVE);
        }
        subscriptionRepository.save(subscription);

        applyEntitlementFromPlan(tenant, plan);
        projectPeriodOntoTenant(subscription);

        ChangeType type = overrideType != null ? overrideType : classify(previous, plan);
        historyRecorder.record(subscription, type, previous, plan, fromStatus,
            subscription.getStatus().name(), fromTier, plan.getTier().name(),
            effectiveAt, actorKind, actorId, reason, forced,
            json(Map.of("periodPreserved", true,
                        "fromCeilings", ceilings(previous), "toCeilings", ceilings(plan))));
        log.info("[subscription] tenant={} plan '{}'→'{}' ({}) applied{}", tenant.getId(),
            previous.getCode(), plan.getCode(), type, forced ? " (FORCED over limits)" : "");
        return forTenant(tenant.getId());
    }

    private void applyCancellation(TenantSubscriptionEntity subscription, SubscriptionPlanEntity plan,
                                   String reason, Instant effectiveAt, ActorKind actorKind, UUID actorId) {
        String fromStatus = subscription.getStatus().name();
        subscription.setStatus(SubscriptionStatus.CANCELLED);
        subscription.setCancelAt(effectiveAt);
        subscription.setCancelReason(reason);
        subscription.setCancelledAt(Instant.now());
        subscription.clearPendingChange();
        subscriptionRepository.save(subscription);

        historyRecorder.record(subscription, ChangeType.CANCELLED, plan, plan, fromStatus,
            SubscriptionStatus.CANCELLED.name(), null, null, effectiveAt, actorKind, actorId,
            reason, false,
            json(Map.of("tenantStatusChanged", false,
                        "note", "cancelling a subscription does not suspend or cancel the tenant")));
        log.info("[subscription] tenant={} subscription CANCELLED (effective {}) — the tenant's "
            + "status, data and feature flags are untouched", subscription.getTenantId(), effectiveAt);
    }

    /**
     * Push the plan's entitlement onto the tenant through the ONE applier.
     *
     * <p>The plan supplies the ceilings; its tier supplies the feature set. Both halves in one call,
     * shared with {@code changeTier}, so a tenant cannot end up entitled to different things
     * depending on which endpoint last moved it.
     */
    private void applyEntitlementFromPlan(TenantEntity tenant, SubscriptionPlanEntity plan) {
        tenantSubscriptionService.applyEntitlement(tenant, plan.getTier(), new TierLimits.Limits(
            plan.getMaxBranches(), plan.getMaxUsers(), plan.getStorageGb(), plan.getNlqQuota()));
    }

    /**
     * Mirror the subscription's dates onto the contract-frozen tenant columns.
     *
     * <p>{@code tenants.trial_ends_at} and {@code tenants.renews_at} are on {@code TenantResponse},
     * which the tenant list and detail screens already read. Leaving them stale while the
     * subscription moved would put two different renewal dates on two screens with no way to tell
     * which was right. {@code TenantSubscriptionService.update} projects the other direction for the
     * same reason.
     */
    private void projectPeriodOntoTenant(TenantSubscriptionEntity subscription) {
        tenantRepository.findById(subscription.getTenantId()).ifPresent(tenant -> {
            tenant.setRenewsAt(subscription.getCurrentPeriodEndAt());
            tenant.setTrialEndsAt(subscription.getTrialEndAt());
            tenantRepository.save(tenant);
        });
    }

    /**
     * Upgrade, downgrade, or neither — decided on the CEILINGS, not on the price.
     *
     * <p>Price would be the obvious key and is the wrong one here: plan prices in this product are
     * operator-entered and start as placeholders (the seeded plans are all 0), so a price-based
     * classification would label every early move "no change". Ceilings are the entitlement, which
     * is what actually moved. A plan that widens one ceiling and narrows another is
     * {@code PLAN_CHANGED} — neither word would be true, and the history row should not pick one.
     */
    private static ChangeType classify(SubscriptionPlanEntity from, SubscriptionPlanEntity to) {
        int[] a = ceilingArray(from);
        int[] b = ceilingArray(to);
        boolean anyUp = false;
        boolean anyDown = false;
        for (int i = 0; i < a.length; i++) {
            if (b[i] > a[i]) anyUp = true;
            if (b[i] < a[i]) anyDown = true;
        }
        if (anyUp && !anyDown) return ChangeType.PLAN_UPGRADED;
        if (anyDown && !anyUp) return ChangeType.PLAN_DOWNGRADED;
        return ChangeType.PLAN_CHANGED;
    }

    private static int[] ceilingArray(SubscriptionPlanEntity p) {
        return new int[]{p.getMaxBranches(), p.getMaxUsers(), p.getStorageGb(), p.getNlqQuota()};
    }

    private static String ceilings(SubscriptionPlanEntity p) {
        return p.getMaxBranches() + "/" + p.getMaxUsers() + "/" + p.getStorageGb() + "/" + p.getNlqQuota();
    }

    /**
     * The next period boundary for a plan's billing period.
     *
     * <p>Calendar months, not a fixed number of days: a MONTHLY plan started on the 31st renews on
     * the last day of the following month, which is what {@code plusMonths} does and what
     * {@code plus(30, DAYS)} would get wrong twice a year. UTC, matching every other instant in this
     * database ({@code hibernate.jdbc.time_zone: UTC}); business-day timezone handling belongs to
     * branch-level reporting, not to a billing boundary.
     */
    private static Instant plusPeriod(Instant from, SubscriptionPlanEntity plan) {
        return from.atZone(ZoneOffset.UTC).plusMonths(plan.getBillingPeriod().months()).toInstant();
    }

    private static boolean renewalOverdue(TenantSubscriptionEntity s) {
        return s.getCurrentPeriodEndAt() != null
            && s.getCurrentPeriodEndAt().isBefore(Instant.now())
            && s.getStatus() != SubscriptionStatus.CANCELLED
            && s.getStatus() != SubscriptionStatus.ENDED;
    }

    private SubscriptionDetail detail(TenantSubscriptionEntity s, SubscriptionPlanEntity plan) {
        SubscriptionPlanEntity pending = s.getPendingPlanId() == null
            ? null : planRepository.findById(s.getPendingPlanId()).orElse(null);
        Long trialDaysRemaining = null;
        if (s.getTrialEndAt() != null && s.getStatus() == SubscriptionStatus.TRIALING) {
            long remaining = Duration.between(Instant.now(), s.getTrialEndAt()).toDays();
            trialDaysRemaining = Math.max(0, remaining);
        }
        return new SubscriptionDetail(
            s.getId(), s.getTenantId(), s.getStatus().name(), PlanSummary.of(plan),
            s.getTrialStartAt(), s.getTrialEndAt(), trialDaysRemaining,
            s.getCurrentPeriodStartAt(), s.getCurrentPeriodEndAt(), renewalOverdue(s),
            pending == null ? null : PlanSummary.of(pending),
            s.getPendingChangeAt(), s.getPendingChangeReason(),
            s.getCancelAt(), s.getCancelReason(), s.getCancelledAt(),
            s.getStartedAt(), s.getEndedAt());
    }

    private static Specification<TenantSubscriptionEntity> registerSpec(
            SubscriptionStatus status, UUID planId, Instant trialEndingBefore, Instant renewingBefore) {
        return (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (status != null) {
                predicates.add(cb.equal(root.get("status"), status));
            }
            if (planId != null) {
                predicates.add(cb.equal(root.get("planId"), planId));
            }
            // NULL must not match "ending soon": a null trial end means the subscription never had a
            // trial, and a null period end means no renewal is scheduled. Both are real states, and
            // a naive range predicate would silently drop or include them depending on the dialect.
            if (trialEndingBefore != null) {
                predicates.add(cb.and(cb.isNotNull(root.get("trialEndAt")),
                    cb.lessThanOrEqualTo(root.get("trialEndAt"), trialEndingBefore)));
            }
            if (renewingBefore != null) {
                predicates.add(cb.and(cb.isNotNull(root.get("currentPeriodEndAt")),
                    cb.lessThanOrEqualTo(root.get("currentPeriodEndAt"), renewingBefore)));
            }
            return predicates.isEmpty() ? cb.conjunction() : cb.and(predicates.toArray(new Predicate[0]));
        };
    }

    private TenantEntity requireTenant(UUID tenantId) {
        return tenantRepository.findById(tenantId)
            .orElseThrow(() -> new ResourceNotFoundException("Tenant", tenantId));
    }

    private TenantSubscriptionEntity requireLive(UUID tenantId) {
        return subscriptionRepository.findLive(tenantId)
            .orElseThrow(() -> new StateInvalidException("NO_SUBSCRIPTION",
                "Tenant " + tenantId + " has no subscription. Its entitlements come from its tier; "
                    + "assign a plan to create a subscription record."));
    }

    private SubscriptionPlanEntity requirePlan(UUID planId) {
        return planRepository.findById(planId)
            .orElseThrow(() -> new ResourceNotFoundException("Subscription plan", planId));
    }

    private static SubscriptionStatus parseStatus(String raw) {
        try {
            return SubscriptionStatus.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("Unknown subscription status '" + raw
                + "' — expected one of TRIALING, ACTIVE, TRIAL_ENDED, CANCELLED, ENDED");
        }
    }

    /** Page size cap, matching the platform's other list endpoints. */
    private static int boundedSize(int size) {
        return Math.max(1, Math.min(size, 200));
    }

    /**
     * A tiny JSON writer for the history {@code detail} column.
     *
     * <p>Only booleans, numbers and values this service itself produced go in here — never operator
     * free text, which lives in the {@code reason} column where the database escapes it. That is
     * why hand-writing the object is safe and why an ObjectMapper would be ceremony; the one rule
     * is enforced by every call site passing literals.
     */
    private static String json(Map<String, ?> fields) {
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, ?> entry : fields.entrySet()) {
            if (!first) sb.append(',');
            first = false;
            sb.append('"').append(entry.getKey()).append("\":");
            Object value = entry.getValue();
            if (value instanceof Boolean || value instanceof Number) {
                sb.append(value);
            } else {
                sb.append('"').append(String.valueOf(value).replace("\"", "'")).append('"');
            }
        }
        return sb.append('}').toString();
    }
}
