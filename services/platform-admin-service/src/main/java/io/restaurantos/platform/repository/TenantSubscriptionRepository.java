package io.restaurantos.platform.repository;

import io.restaurantos.platform.entity.TenantSubscriptionEntity;
import io.restaurantos.platform.entity.TenantSubscriptionEntity.SubscriptionStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * <h3>Why the cross-tenant register is a {@link JpaSpecificationExecutor} and not a {@code @Query}</h3>
 *
 * <p>The register takes four independent, all-optional filters. Written as JPQL that is
 * {@code (:status IS NULL OR s.status = :status)} four times over, PostgreSQL is handed a NULL bind
 * with no usable type context and answers {@code could not determine data type of parameter} — the
 * failure is at execution, not at startup, so it ships. A Specification emits only the predicates
 * the caller actually supplied, so an absent filter contributes no bind at all.
 */
@Repository
public interface TenantSubscriptionRepository
        extends JpaRepository<TenantSubscriptionEntity, UUID>,
                JpaSpecificationExecutor<TenantSubscriptionEntity> {

    /**
     * The tenant's ONE live subscription, or empty.
     *
     * <p>Returns {@code Optional} rather than a list because the partial unique index
     * {@code ux_tenant_subscriptions_live} makes more than one impossible at the database level. A
     * list-returning finder here would invite defensive "take the first" code against a state that
     * cannot occur, and would hide it if it ever did.
     */
    Optional<TenantSubscriptionEntity> findByTenantIdAndStatusNot(UUID tenantId, SubscriptionStatus status);

    default Optional<TenantSubscriptionEntity> findLive(UUID tenantId) {
        return findByTenantIdAndStatusNot(tenantId, SubscriptionStatus.ENDED);
    }

    List<TenantSubscriptionEntity> findByTenantIdOrderByStartedAtDesc(UUID tenantId);

    long countByStatusNot(SubscriptionStatus status);

    long countByPlanId(UUID planId);

    /**
     * Scheduled plan changes that have fallen due.
     *
     * <p>The terminal status is a bound PARAMETER rather than an enum literal in the query text.
     * HQL will parse a fully-qualified literal, but a nested enum's real name contains a {@code $}
     * and the resulting string is both fragile across Hibernate versions and silently broken by any
     * future rename that an IDE would otherwise have caught.
     */
    @Query("""
        SELECT s FROM TenantSubscriptionEntity s
        WHERE s.pendingChangeAt IS NOT NULL
          AND s.pendingChangeAt <= :now
          AND s.status <> :ended
        """)
    List<TenantSubscriptionEntity> findDuePlanChanges(@Param("now") Instant now,
                                                      @Param("ended") SubscriptionStatus ended);

    default List<TenantSubscriptionEntity> findDuePlanChanges(Instant now) {
        return findDuePlanChanges(now, SubscriptionStatus.ENDED);
    }

    /** Cancellations whose operator-chosen effective date has arrived and that have not been applied. */
    @Query("""
        SELECT s FROM TenantSubscriptionEntity s
        WHERE s.cancelAt IS NOT NULL
          AND s.cancelAt <= :now
          AND s.cancelledAt IS NULL
          AND s.status <> :ended
        """)
    List<TenantSubscriptionEntity> findDueCancellations(@Param("now") Instant now,
                                                        @Param("ended") SubscriptionStatus ended);

    default List<TenantSubscriptionEntity> findDueCancellations(Instant now) {
        return findDueCancellations(now, SubscriptionStatus.ENDED);
    }

    /**
     * Trials whose window has closed and that nobody has moved on.
     *
     * <p>Bounded to {@code TRIALING} so a subscription an operator already promoted to ACTIVE is
     * never dragged back — the sweep observes the clock, it does not re-decide.
     */
    @Query("""
        SELECT s FROM TenantSubscriptionEntity s
        WHERE s.status = :trialing
          AND s.trialEndAt IS NOT NULL
          AND s.trialEndAt <= :now
        """)
    List<TenantSubscriptionEntity> findElapsedTrials(@Param("now") Instant now,
                                                     @Param("trialing") SubscriptionStatus trialing);

    default List<TenantSubscriptionEntity> findElapsedTrials(Instant now) {
        return findElapsedTrials(now, SubscriptionStatus.TRIALING);
    }
}
