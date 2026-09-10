package io.restaurantos.platform.service;

import io.restaurantos.platform.entity.SubscriptionHistoryEntity;
import io.restaurantos.platform.entity.SubscriptionHistoryEntity.ActorKind;
import io.restaurantos.platform.entity.SubscriptionHistoryEntity.ChangeType;
import io.restaurantos.platform.entity.SubscriptionPlanEntity;
import io.restaurantos.platform.entity.TenantSubscriptionEntity;
import io.restaurantos.platform.repository.SubscriptionHistoryRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * The one writer of {@code subscription_history}.
 *
 * <h3>Why this is a component and not a private method on the service that changes things</h3>
 *
 * <p>There are two callers that must produce comparable rows: {@code SubscriptionService}, which
 * owns the plan domain, and {@code TenantSubscriptionService.changeTier}, which predates it by a
 * phase and is still the endpoint the tier is actually moved through. If each wrote its own row the
 * two would diverge on exactly the fields a dispute turns on — the actor, the effective date, the
 * captured price — and nothing would fail. This is the same argument {@code TierLimits}' own javadoc
 * makes about the tier table having two callers.
 *
 * <h3>Same transaction as the change, deliberately</h3>
 *
 * <p>No {@code REQUIRES_NEW}. If the change rolls back, its history row must roll back with it: a
 * trail containing transitions that did not happen is worse than one with gaps, because a gap is
 * visible and a fabricated row is not. And the converse — a change that commits without its row —
 * is exactly the silent overwrite this table exists to end.
 *
 * <h3>The actor is never defaulted</h3>
 *
 * <p>An operator row carries the {@code platform_users.id} the controller read from the {@code sub}
 * of the verified control-plane token. There is no fallback: a null acting id with
 * {@code actorKind=OPERATOR} is refused by {@code chk_subscription_history_actor} at the database,
 * because a record naming nobody is worse than no record — the same posture
 * {@code PlatformAdminController.requirePlatformPrincipal} takes for impersonation.
 */
@Component
public class SubscriptionHistoryRecorder {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionHistoryRecorder.class);

    private final SubscriptionHistoryRepository historyRepository;

    public SubscriptionHistoryRecorder(SubscriptionHistoryRepository historyRepository) {
        this.historyRepository = historyRepository;
    }

    /**
     * A transition involving a subscription.
     *
     * @param effectiveAt when it takes effect. Differs from the recorded time for anything
     *                    scheduled; passing {@code Instant.now()} for a forward-dated change would
     *                    make a future decision look like a past one.
     */
    public SubscriptionHistoryEntity record(TenantSubscriptionEntity subscription,
                                            ChangeType changeType,
                                            SubscriptionPlanEntity fromPlan,
                                            SubscriptionPlanEntity toPlan,
                                            String fromStatus,
                                            String toStatus,
                                            String fromTier,
                                            String toTier,
                                            Instant effectiveAt,
                                            ActorKind actorKind,
                                            UUID actorPlatformUserId,
                                            String reason,
                                            boolean forcedOverLimits,
                                            String detailJson) {
        // Not defensive nulling: tenant_id is NOT NULL and a history row that cannot say WHICH
        // tenant moved is not a trail. The tier-change overload below is the one that legitimately
        // has no subscription, and it takes the tenant id directly.
        Objects.requireNonNull(subscription, "a subscription transition must name its subscription");
        SubscriptionHistoryEntity row = new SubscriptionHistoryEntity();
        row.setSubscriptionId(subscription.getId());
        row.setTenantId(subscription.getTenantId());
        row.setChangeType(changeType);
        // Codes and prices are captured, never re-resolved on read: a plan can be archived and
        // re-priced afterwards, and a trail that resolved them later would retroactively rewrite
        // what a tenant was moved onto.
        row.setFromPlanCode(fromPlan == null ? null : fromPlan.getCode());
        row.setToPlanCode(toPlan == null ? null : toPlan.getCode());
        row.setFromPricePaisa(fromPlan == null ? null : fromPlan.getPricePaisa());
        row.setToPricePaisa(toPlan == null ? null : toPlan.getPricePaisa());
        row.setFromStatus(fromStatus);
        row.setToStatus(toStatus);
        row.setFromTier(fromTier);
        row.setToTier(toTier);
        row.setEffectiveAt(effectiveAt == null ? Instant.now() : effectiveAt);
        row.setRecordedAt(Instant.now());
        row.setActorKind(actorKind);
        row.setActorPlatformUserId(actorPlatformUserId);
        row.setReason(reason);
        row.setForcedOverLimits(forcedOverLimits);
        row.setDetail(detailJson);
        return persist(row);
    }

    /**
     * A bare tier change, with or without a subscription behind it.
     *
     * <p>This is the transition that had no record anywhere in the product: {@code tenants.tier} is
     * a column an operator overwrites, {@code changeTier} publishes no event, and platform_db cannot
     * reach audit_db. Every tenant in this database is subject to it and none of them has a
     * subscription, so refusing to record it until a subscription exists would leave the most
     * common commercial transition invisible — which is why {@code subscription_id} is nullable.
     */
    public SubscriptionHistoryEntity recordTierChange(UUID tenantId,
                                                      TenantSubscriptionEntity subscription,
                                                      String fromTier,
                                                      String toTier,
                                                      ActorKind actorKind,
                                                      UUID actorPlatformUserId,
                                                      String reason,
                                                      boolean forcedOverLimits,
                                                      String detailJson) {
        SubscriptionHistoryEntity row = new SubscriptionHistoryEntity();
        row.setSubscriptionId(subscription == null ? null : subscription.getId());
        row.setTenantId(tenantId);
        row.setChangeType(ChangeType.TIER_CHANGED);
        row.setFromTier(fromTier);
        row.setToTier(toTier);
        row.setEffectiveAt(Instant.now());
        row.setRecordedAt(Instant.now());
        row.setActorKind(actorKind);
        row.setActorPlatformUserId(actorPlatformUserId);
        row.setReason(reason);
        row.setForcedOverLimits(forcedOverLimits);
        row.setDetail(detailJson);
        return persist(row);
    }

    private SubscriptionHistoryEntity persist(SubscriptionHistoryEntity row) {
        SubscriptionHistoryEntity saved = historyRepository.save(row);
        log.info("[subscription-history] tenant={} type={} {}→{} tier {}→{} actor={}/{} forced={}",
            saved.getTenantId(), saved.getChangeType(), saved.getFromPlanCode(),
            saved.getToPlanCode(), saved.getFromTier(), saved.getToTier(),
            saved.getActorKind(), saved.getActorPlatformUserId(), saved.isForcedOverLimits());
        return saved;
    }
}
