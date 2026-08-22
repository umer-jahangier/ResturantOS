package io.restaurantos.platform.service;

import io.restaurantos.platform.entity.TenantSubscriptionEntity;
import io.restaurantos.platform.repository.TenantSubscriptionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Executes instructions operators already gave: applies scheduled plan changes and cancellations on
 * their effective date, and moves elapsed trials to {@code TRIAL_ENDED}.
 *
 * <h3>Why this is the whole of what it does</h3>
 *
 * <p>All three are things the platform can honestly determine — an operator's recorded decision, and
 * the clock. It deliberately does <b>not</b> roll renewal periods forward when
 * {@code current_period_end_at} elapses: advancing that date asserts that the tenant paid, and
 * nothing in this product observes a payment. An elapsed period surfaces as {@code renewalOverdue}
 * on the register instead, which is a worklist an operator works, not a fact invented on their
 * behalf. It also does not downgrade or suspend on trial expiry, for the same reason.
 *
 * <h3>Safe to run in more than one replica, and safe to overlap</h3>
 *
 * <p>Two layers, because either alone is insufficient:
 *
 * <ol>
 *   <li><b>A Redis lease</b> ({@code SET NX PX}) so ordinary concurrent replicas do not all sweep
 *       the same rows. Best-effort: a lease is not a distributed transaction and Redis being
 *       unreachable must not stop the sweep, so a failed acquisition logs and proceeds rather than
 *       silently skipping work forever.</li>
 *   <li><b>Per-row idempotence in the service.</b> Each apply re-reads its own row inside its own
 *       transaction and re-checks that the work is still outstanding, so a second sweeper finds the
 *       pending fields already cleared and does nothing. This is the layer that actually holds — a
 *       control that only works while the lock works is the "inert control" pattern this repository
 *       keeps finding.</li>
 * </ol>
 *
 * <p>Each row is applied in its OWN transaction. One tenant whose plan was archived out from under
 * a scheduled change must not roll back the twelve changes that swept cleanly beside it.
 */
@Component
public class SubscriptionScheduler {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionScheduler.class);

    /**
     * Same {@code tenant:}-adjacent namespace discipline as the other platform keys. The TTL is
     * deliberately shorter than the sweep interval's worst case and longer than a sweep takes: too
     * long and a crashed replica blocks every later sweep until it expires, too short and two
     * replicas overlap — which the per-row re-check already makes harmless.
     */
    private static final String LEASE_KEY = "platform:subscription-sweep:lease";
    private static final Duration LEASE_TTL = Duration.ofMinutes(5);

    private final TenantSubscriptionRepository subscriptionRepository;
    private final SubscriptionService subscriptionService;
    private final StringRedisTemplate redis;
    private final boolean enabled;

    public SubscriptionScheduler(TenantSubscriptionRepository subscriptionRepository,
                                 SubscriptionService subscriptionService,
                                 StringRedisTemplate redis,
                                 @Value("${restaurantos.subscription.sweep.enabled:true}") boolean enabled) {
        this.subscriptionRepository = subscriptionRepository;
        this.subscriptionService = subscriptionService;
        this.redis = redis;
        this.enabled = enabled;
    }

    /**
     * Every 15 minutes by default.
     *
     * <p>Granularity, not precision: a change scheduled for 09:00 is applied by 09:15. That is
     * stated rather than hidden because the alternative — a minute-by-minute sweep — buys accuracy
     * nobody needs for a commercial date and costs a query every minute forever. An operator who
     * needs a change at an exact instant applies it themselves.
     */
    @Scheduled(cron = "${restaurantos.subscription.sweep.cron:0 */15 * * * *}")
    public void sweep() {
        if (!enabled) {
            return;
        }
        if (!acquireLease()) {
            log.debug("[subscription-sweep] another replica holds the lease — skipping this run");
            return;
        }
        Instant now = Instant.now();
        int changes = applyEach(subscriptionRepository.findDuePlanChanges(now),
            subscriptionService::applyDuePlanChange, "plan change");
        int cancellations = applyEach(subscriptionRepository.findDueCancellations(now),
            subscriptionService::applyDueCancellation, "cancellation");
        int trials = applyEach(subscriptionRepository.findElapsedTrials(now),
            subscriptionService::markTrialEnded, "trial expiry");

        if (changes + cancellations + trials > 0) {
            log.info("[subscription-sweep] applied {} plan change(s), {} cancellation(s), "
                + "{} trial expiry/expiries", changes, cancellations, trials);
        }
    }

    /**
     * Apply one action per row, isolating failures.
     *
     * <p>A row that throws is logged and the sweep continues. The alternative — letting the first
     * failure abort the loop — means one broken subscription silently stops every later one from
     * ever being applied, and the symptom (a scheduled change that just never happened) points
     * nowhere near the cause.
     */
    private int applyEach(List<TenantSubscriptionEntity> due,
                          java.util.function.Predicate<UUID> action, String what) {
        int applied = 0;
        for (TenantSubscriptionEntity subscription : due) {
            try {
                if (action.test(subscription.getId())) {
                    applied++;
                }
            } catch (RuntimeException ex) {
                log.error("[subscription-sweep] {} failed for subscription={} tenant={} — continuing "
                    + "with the rest of the sweep", what, subscription.getId(),
                    subscription.getTenantId(), ex);
            }
        }
        return applied;
    }

    /**
     * Best-effort lease.
     *
     * <p><b>Returns true when Redis cannot be reached.</b> A lock whose failure mode is "never
     * sweep" turns a cache outage into scheduled changes silently never being applied — a far worse
     * failure than two replicas doing idempotent work at the same time, which the per-row re-check
     * already handles.
     */
    private boolean acquireLease() {
        try {
            Boolean acquired = redis.opsForValue()
                .setIfAbsent(LEASE_KEY, Instant.now().toString(), LEASE_TTL);
            return !Boolean.FALSE.equals(acquired);
        } catch (RuntimeException ex) {
            log.warn("[subscription-sweep] could not take the Redis lease ({}) — sweeping anyway; "
                + "each apply re-checks its own row, so a concurrent sweep is harmless",
                ex.toString());
            return true;
        }
    }
}
