package io.restaurantos.platform.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * One tenant's subscription: which plan, in what state, over which period.
 *
 * <p>platform_db is NOT tenant-scoped — no RLS, and {@code tenant_id} here is a plain FK exactly as
 * it is in {@code tenant_features} and {@code usage_records}. Changeset
 * {@code 040-platform-db-rls-posture.xml} measured what the fleet-standard policy would do to this
 * database (0 rows read, 42501 on write) and that reasoning applies unchanged here.
 *
 * <h3>One live subscription per tenant</h3>
 *
 * <p>Enforced by the partial unique index {@code ux_tenant_subscriptions_live} on
 * {@code (tenant_id) WHERE status <> 'ENDED'}, in the database rather than in application code:
 * two live subscriptions makes "which plan is this tenant on?" ambiguous, and an ambiguity that a
 * race can create is one that no amount of careful service code prevents.
 *
 * <h3>Nullability carries meaning</h3>
 *
 * <ul>
 *   <li>{@link #currentPeriodEndAt} null = <b>no renewal scheduled</b>. {@code TenantEntity.renewsAt}
 *       already documents this precise state and it is a real answer, not a missing value. A screen
 *       must render it as "no renewal scheduled", never as a blank that reads like a date.</li>
 *   <li>{@link #trialStartAt}/{@link #trialEndAt} null = this subscription never had a trial. The
 *       two travel together, enforced by {@code chk_tenant_subscriptions_trial_pair}.</li>
 *   <li>{@link #pendingPlanId}/{@link #pendingChangeAt} null = no scheduled change. They also travel
 *       together ({@code chk_tenant_subscriptions_pending_pair}), because a plan with no date or a
 *       date with no plan is a half-written instruction the scheduler would have to guess at.</li>
 *   <li>{@link #cancelAt} is the effective date an operator CHOSE; {@link #cancelledAt} is when the
 *       cancellation was actually applied. They differ for every cancellation scheduled in advance,
 *       and one column could not express both.</li>
 * </ul>
 *
 * <h3>There is no billing state here, on purpose</h3>
 *
 * <p>No {@code amount_due}, no {@code next_invoice_at}, no {@code payment_status}, no
 * {@code past_due}. This product contains no payment integration of any kind, so every one of those
 * would be a column only an operator could type into while looking like a fact the system observed.
 * The states below are all things the platform can actually determine: an operator's decision, or
 * the clock.
 */
@Entity
@Table(name = "tenant_subscriptions")
@Getter
@Setter
public class TenantSubscriptionEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "plan_id", nullable = false)
    private UUID planId;

    @Column(nullable = false, length = 30)
    @Enumerated(EnumType.STRING)
    private SubscriptionStatus status;

    @Column(name = "trial_start_at")
    private Instant trialStartAt;

    @Column(name = "trial_end_at")
    private Instant trialEndAt;

    @Column(name = "current_period_start_at", nullable = false)
    private Instant currentPeriodStartAt = Instant.now();

    /** Null means NO RENEWAL SCHEDULED — a real state, not a missing value. */
    @Column(name = "current_period_end_at")
    private Instant currentPeriodEndAt;

    @Column(name = "pending_plan_id")
    private UUID pendingPlanId;

    @Column(name = "pending_change_at")
    private Instant pendingChangeAt;

    @Column(name = "pending_change_reason", length = 500)
    private String pendingChangeReason;

    @Column(name = "cancel_at")
    private Instant cancelAt;

    @Column(name = "cancel_reason", length = 500)
    private String cancelReason;

    @Column(name = "cancelled_at")
    private Instant cancelledAt;

    @Column(name = "started_at", nullable = false, updatable = false)
    private Instant startedAt = Instant.now();

    @Column(name = "ended_at")
    private Instant endedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    @PreUpdate
    void touch() {
        this.updatedAt = Instant.now();
    }

    /** True when a change has been scheduled and not yet applied or withdrawn. */
    public boolean hasPendingChange() {
        return pendingPlanId != null && pendingChangeAt != null;
    }

    /** Clears both halves of a scheduled change together — the CHECK constraint requires it. */
    public void clearPendingChange() {
        this.pendingPlanId = null;
        this.pendingChangeAt = null;
        this.pendingChangeReason = null;
    }

    /**
     * The states a subscription can actually be in, given that this product observes no payments.
     *
     * <p><b>What is NOT here, and why.</b> There is no {@code PAST_DUE}, no {@code UNPAID} and no
     * {@code PAYMENT_FAILED}. Those describe a payment attempt, and nothing in this codebase makes
     * one — a status that only an operator could set by hand while reading as a system observation
     * is the exact fabrication this domain is supposed to avoid.
     */
    public enum SubscriptionStatus {
        /** Inside a trial window. {@code trial_end_at} is in the future. */
        TRIALING,
        /** A live subscription an operator has asserted. */
        ACTIVE,
        /**
         * The trial window has elapsed and no operator has moved the subscription to ACTIVE.
         *
         * <p><b>This changes no entitlement.</b> It does not suspend the tenant, gate a feature or
         * lower a ceiling; it is a worklist state, produced by the clock, saying "this needs a
         * decision". Automatically downgrading here would be the product inventing a commercial
         * consequence for an event it cannot connect to a payment.
         */
        TRIAL_ENDED,
        /**
         * The subscription has been cancelled and the cancellation has taken effect.
         *
         * <p><b>Cancelling a SUBSCRIPTION is not cancelling a TENANT.</b> The tenant keeps its
         * status, its data and its entitlements; {@code POST /tenants/{id}/cancel} is the separate,
         * pre-existing operation that changes a tenant's lifecycle. Conflating the two would let a
         * commercial decision silently take a restaurant's POS offline.
         */
        CANCELLED,
        /**
         * Terminal. Superseded by a newer subscription for the same tenant, which is why the
         * uniqueness index excludes exactly this value.
         */
        ENDED;

        /** Statuses that still occupy the tenant's one live subscription slot. */
        public boolean live() {
            return this != ENDED;
        }
    }
}
