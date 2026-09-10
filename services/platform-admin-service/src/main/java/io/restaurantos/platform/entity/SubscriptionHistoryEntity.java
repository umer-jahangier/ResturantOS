package io.restaurantos.platform.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

/**
 * One transition of a tenant's plan, tier or subscription status. APPEND-ONLY.
 *
 * <h3>Why this table is the point of the whole plan domain</h3>
 *
 * <p>{@code tenants.tier} is a single column that a SuperAdmin overwrites. Before this table there
 * was <b>no record anywhere in this product that a tenant had ever been on a different tier</b>:
 * {@code TenantSubscriptionService.changeTier} publishes no event (CAPABILITY-MAP §7.4 measured
 * that the whole lifecycle — suspend, reactivate, cancel, close, re-tier — emits nothing), writes
 * no timestamp, and platform_db reaches no audit database. A tenant told "you were downgraded
 * without warning" and an operator sure they were not had exactly the same evidence: none.
 *
 * <h3>Immutability is enforced by a trigger, not by a grant</h3>
 *
 * <p>{@code trg_subscription_history_immutable} refuses UPDATE and DELETE, and
 * {@code trg_subscription_history_no_truncate} refuses TRUNCATE, which a row-level trigger does not
 * see at all. A GRANT-based control would be inert here: changeset 040 measured that
 * {@code platform_user} inherits {@code platform_admin} through {@code pg_auth_members}, so a
 * REVOKE changes the catalogue and not the effective privilege. A trigger fires for the owner, for
 * an inheriting member, and for Liquibase.
 *
 * <h3>Codes and prices are captured, not referenced</h3>
 *
 * <p>{@link #fromPlanCode}/{@link #toPlanCode} and {@link #fromPricePaisa}/{@link #toPricePaisa}
 * are stored verbatim rather than resolved through {@code plan_id} on read. A plan can be archived
 * and re-priced; a history row that re-resolved its price would retroactively rewrite what a tenant
 * was moved onto, which is the one thing an immutable record must not do.
 */
@Entity
@Table(name = "subscription_history")
@Getter
@Setter
public class SubscriptionHistoryEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    /**
     * Null for a tier change made on a tenant that has no subscription — the pre-existing
     * {@code POST /tenants/{id}/tier} endpoint, which every tenant in this database is subject to
     * and none of which has ever had a subscription record. Refusing to record those would leave
     * the most common transition in the product invisible.
     */
    @Column(name = "subscription_id")
    private UUID subscriptionId;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "change_type", nullable = false, length = 40)
    @Enumerated(EnumType.STRING)
    private ChangeType changeType;

    @Column(name = "from_plan_code", length = 60)
    private String fromPlanCode;

    @Column(name = "to_plan_code", length = 60)
    private String toPlanCode;

    @Column(name = "from_status", length = 30)
    private String fromStatus;

    @Column(name = "to_status", length = 30)
    private String toStatus;

    @Column(name = "from_tier", length = 30)
    private String fromTier;

    @Column(name = "to_tier", length = 30)
    private String toTier;

    /** BIGINT paisa, captured at the moment of the change. Null when no plan was involved. */
    @Column(name = "from_price_paisa")
    private Long fromPricePaisa;

    @Column(name = "to_price_paisa")
    private Long toPricePaisa;

    /**
     * When the change takes/took effect. Differs from {@link #recordedAt} for anything scheduled:
     * an operator scheduling a downgrade for the 30th produces a row recorded today and effective
     * then, and collapsing the two would make a forward-dated decision look like a past one.
     */
    @Column(name = "effective_at", nullable = false)
    private Instant effectiveAt = Instant.now();

    @Column(name = "recorded_at", nullable = false, updatable = false)
    private Instant recordedAt = Instant.now();

    @Column(name = "actor_kind", nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private ActorKind actorKind;

    /**
     * {@code platform_users.id}, taken from the {@code sub} of the verified control-plane token and
     * never from a request body or a header — the same rule
     * {@code PlatformAdminController.requirePlatformPrincipal} applies to impersonation, and for the
     * same reason: a repudiation control whose subject can choose what it says is not a control.
     *
     * <p>Null only when {@link #actorKind} is {@link ActorKind#SYSTEM}, enforced by
     * {@code chk_subscription_history_actor}.
     */
    @Column(name = "actor_platform_user_id")
    private UUID actorPlatformUserId;

    @Column(length = 500)
    private String reason;

    /** True when the operator applied the change over a limit violation with {@code force}. */
    @Column(name = "forced_over_limits", nullable = false)
    private boolean forcedOverLimits = false;

    /** Free-form provenance: the limit violations that were overridden, the feature codes that
     *  moved, a tier/plan divergence. Never load-bearing for a query. */
    @Column(columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private String detail;

    public enum ChangeType {
        /** A tenant was given its first subscription. */
        SUBSCRIPTION_CREATED,
        /** Moved to a plan whose tier is higher, or whose ceilings are wider. */
        PLAN_UPGRADED,
        /** Moved to a plan whose tier is lower, or whose ceilings are narrower. */
        PLAN_DOWNGRADED,
        /** Moved to a different plan at the same tier and comparable ceilings (e.g. re-pricing). */
        PLAN_CHANGED,
        /** A future-dated plan change was recorded. Nothing has moved yet. */
        CHANGE_SCHEDULED,
        /** The scheduler applied a change an operator had recorded earlier. */
        SCHEDULED_CHANGE_APPLIED,
        /** An operator withdrew a scheduled change before it fell due. */
        SCHEDULED_CHANGE_CANCELLED,
        /** The trial window elapsed. Changes no entitlement — see {@code SubscriptionStatus}. */
        TRIAL_ENDED,
        /** An operator asserted a new period. This product observes no payment; a human did. */
        RENEWED,
        /** A future-dated cancellation was recorded. The subscription is still live until then. */
        CANCELLATION_SCHEDULED,
        /** The cancellation took effect. The TENANT is untouched. */
        CANCELLED,
        /**
         * A bare tier change through {@code POST /tenants/{id}/tier}, with or without a
         * subscription. This is the transition that had no record at all before this table.
         */
        TIER_CHANGED
    }

    public enum ActorKind {
        /** A SuperAdmin, identified from the verified token. */
        OPERATOR,
        /** The scheduler, executing an instruction an operator left earlier. */
        SYSTEM
    }
}
