package io.restaurantos.platform.repository;

import io.restaurantos.platform.entity.TenantEntity;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The read-only aggregate queries over {@code platform_db.tenants} that platform analytics,
 * the cross-tenant audit scope and the usage roll-up need.
 *
 * <h2>Why a second repository interface over the same entity</h2>
 *
 * <p>{@link TenantRepository} is the lifecycle repository: sixteen files import it, it is on the
 * provisioning saga's path and on every tenant CRUD route, and it is edited by whoever is working
 * on tenant lifecycle. These methods are none of those things — they are aggregates for read-only
 * screens, and they have no business sharing a file with the finders the saga depends on. Spring
 * Data supports any number of repository interfaces over one aggregate root; the cost is one more
 * proxy bean and the benefit is that an analytics query cannot be lost in a lifecycle edit, nor a
 * lifecycle finder in an analytics one.
 *
 * <p>It deliberately extends {@code Repository} rather than {@code JpaRepository}: nothing here
 * should be able to save, delete or flush a tenant. A repository whose only exposed operations are
 * the ones below cannot become a write path by accident.
 *
 * <h2>The rule every method follows</h2>
 *
 * <p>They return what the rows say and nothing more. None synthesises a zero for a period with no
 * rows and none invents a bucket. Densification against a closed enum happens one layer up, where
 * the difference between "the table established this is zero" and "nothing was observed here" can
 * be reasoned about explicitly — see {@code PlatformAnalyticsService.densify}.
 *
 * <p>{@code platform_db} has NO row-level security, deliberately and with the measurements recorded
 * in changeset {@code 040-platform-db-rls-posture.xml}: a platform token carries no tenant claim,
 * the fleet-standard predicate would map that to NULL and fail closed, and the console would go
 * blank. Isolation here is by database and by role instead. So these aggregates really do see every
 * tenant, which is the whole purpose of this database.
 */
@Repository
public interface TenantAnalyticsRepository
        extends org.springframework.data.repository.Repository<TenantEntity, UUID> {

    // ── distributions ──────────────────────────────────────────────────────────

    /**
     * {@code (status, count)} for the statuses that actually occur.
     *
     * <p>A status with no tenants is ABSENT here rather than present with zero. The caller densifies
     * against the enum, because the six statuses are a closed compiled-in set and the table has a
     * row per tenant — so "no tenant is currently SUSPENDED" is a fact this query established,
     * unlike a time bucket, where absence of rows and absence of measurement are indistinguishable.
     */
    @Query("SELECT t.status, COUNT(t) FROM TenantEntity t GROUP BY t.status")
    List<Object[]> countGroupedByStatus();

    /** {@code (tier, count)} — same shape, same densification rule. */
    @Query("SELECT t.tier, COUNT(t) FROM TenantEntity t GROUP BY t.tier")
    List<Object[]> countGroupedByTier();

    /** {@code (status, tier, count)} — the cross-tab a "who is on what, and are they live" tile needs. */
    @Query("SELECT t.status, t.tier, COUNT(t) FROM TenantEntity t GROUP BY t.status, t.tier")
    List<Object[]> countGroupedByStatusAndTier();

    // ── growth: raw timestamps, never pre-bucketed ─────────────────────────────
    //
    // Bucketing in SQL would fix the calendar and the timezone here, in a repository, for every
    // caller. It happens once in the service against the zone the caller named; these return the
    // observations themselves.

    /** Every {@code created_at} in the window, ascending. Empty means no tenant was created then. */
    @Query("SELECT t.createdAt FROM TenantEntity t "
        + "WHERE t.createdAt >= :from AND t.createdAt <= :to ORDER BY t.createdAt")
    List<Instant> findCreatedAtBetween(@Param("from") Instant from, @Param("to") Instant to);

    /**
     * Every {@code suspended_at} in the window, ascending.
     *
     * <p><b>This column holds only the MOST RECENT suspension.</b> {@code TenantLifecycleService}
     * overwrites it on each suspend and publishes no event, so a tenant suspended in March,
     * reactivated in April and suspended again in June appears once, in June. A "suspensions per
     * month" series built on it is a lower bound, not a count, and the response says so.
     */
    @Query("SELECT t.suspendedAt FROM TenantEntity t "
        + "WHERE t.suspendedAt IS NOT NULL AND t.suspendedAt >= :from AND t.suspendedAt <= :to "
        + "ORDER BY t.suspendedAt")
    List<Instant> findSuspendedAtBetween(@Param("from") Instant from, @Param("to") Instant to);

    /** Every {@code cancelled_at} in the window. Same single-value caveat as suspensions. */
    @Query("SELECT t.cancelledAt FROM TenantEntity t "
        + "WHERE t.cancelledAt IS NOT NULL AND t.cancelledAt >= :from AND t.cancelledAt <= :to "
        + "ORDER BY t.cancelledAt")
    List<Instant> findCancelledAtBetween(@Param("from") Instant from, @Param("to") Instant to);

    /** How many tenants existed before the window opened — the baseline a cumulative line starts at. */
    @Query("SELECT COUNT(t) FROM TenantEntity t WHERE t.createdAt < :from")
    long countCreatedBefore(@Param("from") Instant from);

    /**
     * {@code (min, max)} of {@code created_at} over ALL time, not over the requested window.
     *
     * <p>A chart that starts at the window boundary implies the metric was zero before it. These
     * bounds let the response say "the record begins here" instead, which is the whole difference
     * between a sparse series and a dishonest one. Both elements are null on an empty platform.
     */
    @Query("SELECT MIN(t.createdAt), MAX(t.createdAt) FROM TenantEntity t")
    List<Object[]> findCreatedAtBounds();

    /** {@code (min, max)} of {@code suspended_at} over all time. Nulls when nothing was suspended. */
    @Query("SELECT MIN(t.suspendedAt), MAX(t.suspendedAt) FROM TenantEntity t")
    List<Object[]> findSuspendedAtBounds();

    /** {@code (min, max)} of {@code cancelled_at} over all time. */
    @Query("SELECT MIN(t.cancelledAt), MAX(t.cancelledAt) FROM TenantEntity t")
    List<Object[]> findCancelledAtBounds();

    // ── operator-actionable and operator-entered ───────────────────────────────

    /** Tenants in one status. {@code PROVISIONING_FAILED} is the operator-actionable one. */
    @Query("SELECT COUNT(t) FROM TenantEntity t WHERE t.status = :status")
    long countByStatus(@Param("status") TenantEntity.TenantStatus status);

    /**
     * Trials whose end date falls in a window.
     *
     * <p>{@code trial_ends_at} is OPERATOR-ENTERED free data, null for most tenants, and nothing
     * computes or enforces it. The count is real; what it counts is "dates a human typed", and the
     * analytics response carries that provenance rather than presenting it as a measured funnel.
     */
    @Query("SELECT COUNT(t) FROM TenantEntity t "
        + "WHERE t.trialEndsAt IS NOT NULL AND t.trialEndsAt >= :from AND t.trialEndsAt <= :to")
    long countTrialsEndingBetween(@Param("from") Instant from, @Param("to") Instant to);

    /** Renewals due in a window. Same provenance caveat as trials. */
    @Query("SELECT COUNT(t) FROM TenantEntity t "
        + "WHERE t.renewsAt IS NOT NULL AND t.renewsAt >= :from AND t.renewsAt <= :to")
    long countRenewalsDueBetween(@Param("from") Instant from, @Param("to") Instant to);

    /** How many tenants carry a non-blank {@code billing_ref}. Free text; it links to nothing. */
    @Query("SELECT COUNT(t) FROM TenantEntity t WHERE t.billingRef IS NOT NULL AND t.billingRef <> ''")
    long countWithBillingRef();

    // ── scope for fan-out reads ────────────────────────────────────────────────

    /**
     * Every tenant id, ordered so a fan-out is reproducible between calls.
     *
     * <p>Bounds the cross-tenant audit read and the usage roll-up. Ids only: a fan-out needs the
     * scope, not the rows, and loading whole entities to build a UUID list is how a control-plane
     * read starts costing what a report costs.
     */
    @Query("SELECT t.id FROM TenantEntity t ORDER BY t.createdAt, t.id")
    List<UUID> findAllTenantIds();

    /** The ids of tenants in one status — the roll-up scope when only live tenants are of interest. */
    @Query("SELECT t.id FROM TenantEntity t WHERE t.status = :status ORDER BY t.createdAt, t.id")
    List<UUID> findTenantIdsByStatus(@Param("status") TenantEntity.TenantStatus status);

    /** {@code (id, slug, brandName)} — attributing cross-tenant rows without loading whole tenants. */
    @Query("SELECT t.id, t.slug, t.brandName FROM TenantEntity t")
    List<Object[]> findAllTenantIdentities();

    /**
     * The entitlement ceilings for a scope, as {@code (id, maxBranches, maxUsers, storageGb,
     * nlqQuota)}.
     *
     * <p>A projection rather than {@code findAllById}: the roll-up sums four integers per tenant and
     * has no use for the theme JSON, the email config or the brand. It also keeps this interface
     * incapable of handing a managed {@code TenantEntity} to a screen that might then mutate it.
     */
    @Query("SELECT t.id, t.maxBranches, t.maxUsers, t.storageGb, t.nlqQuota FROM TenantEntity t "
        + "WHERE t.id IN :ids")
    List<Object[]> findEntitlementsByIds(@Param("ids") List<UUID> ids);

    // ── announcement audience resolution ───────────────────────────────────────

    /**
     * One tenant's tier, without loading the tenant.
     *
     * <p>The tenant-facing announcement read runs on every page load of every tenant's UI and needs
     * exactly one field. Empty when the id names no tenant, which the caller treats as "no
     * announcements" rather than as an error — an unknown tenant asking for its banners is a
     * question with an honest empty answer.
     */
    @Query("SELECT t.tier FROM TenantEntity t WHERE t.id = :id")
    java.util.Optional<TenantEntity.TierType> findTierById(@Param("id") UUID id);

    /** How many tenants sit on any of these tiers — the denominator of an announcement's reach. */
    @Query("SELECT COUNT(t) FROM TenantEntity t WHERE t.tier IN :tiers")
    long countByTierIn(@Param("tiers") List<TenantEntity.TierType> tiers);

    /** How many of these ids name a real tenant. A target that does not exist is not a target. */
    @Query("SELECT COUNT(t) FROM TenantEntity t WHERE t.id IN :ids")
    long countByIdIn(@Param("ids") List<UUID> ids);

    /** The whole tenant population — the denominator when an announcement targets everybody. */
    @Query("SELECT COUNT(t) FROM TenantEntity t")
    long countAll();
}
