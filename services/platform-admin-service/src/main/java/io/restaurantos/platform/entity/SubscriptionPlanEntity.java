package io.restaurantos.platform.entity;

import io.restaurantos.platform.entity.TenantEntity.TierType;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * A sellable plan: what it costs, how often, and the ceilings it grants.
 *
 * <h3>Why a plan is not just a tier</h3>
 *
 * <p>The tier has always been the ENTITLEMENT — {@link io.restaurantos.platform.config.TierLimits}
 * and {@link io.restaurantos.platform.config.TierFeatureDefaults} decide what a tenant can do, and
 * have since Phase 3. What never existed is the AGREEMENT that granted it. A tier is a four-value
 * enum on the tenant row; two ENTERPRISE tenants on wildly different contracts are byte-identical
 * in the database, and there is nowhere to record that one of them is billed annually at a
 * negotiated rate.
 *
 * <p>So a plan carries the commercial facts (code, price, billing period, trial length) and the
 * QUANTITATIVE entitlement (the four ceilings), and it names a {@link #tier} from which the
 * QUALITATIVE entitlement — the feature codes — is derived.
 *
 * <h3>The feature set is derived, never stored here</h3>
 *
 * <p>There is deliberately no {@code plan_features} table and no feature column. {@code
 * TierFeatureDefaults} is the one matrix; a second copy on this table would be wrong from the first
 * time a code changes tier, and the failure mode is the phantom-flag bug that has shipped twice in
 * this repository (a gateway route gated on a code no tier grants ⇒ a clean, confident 403 that is
 * indistinguishable from "the tenant has not bought the module"). {@code SubscriptionPlanService}
 * resolves the feature map from the tier on read.
 *
 * <h3>Money</h3>
 *
 * <p>{@link #pricePaisa} is {@code BIGINT} paisa, like {@code sales_order_facts.total_paisa} and
 * every other monetary value in this product. It is a PRICE and never observed revenue — nothing in
 * this codebase records a payment, so an aggregate of this column across active subscriptions is
 * contracted value at best. No endpoint in this service performs that aggregation; see
 * {@code SubscriptionService} for why.
 */
@Entity
@Table(name = "subscription_plans")
@Getter
@Setter
public class SubscriptionPlanEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    /** Stable operator-chosen identifier ({@code growth-monthly}). The API addresses plans by this. */
    @Column(nullable = false, unique = true, length = 60)
    private String code;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(length = 500)
    private String description;

    /** Supplies the feature set and the default ceilings. Constrained to the tenants table's own
     *  tier vocabulary by {@code chk_subscription_plans_tier}. */
    @Column(nullable = false, length = 30)
    @Enumerated(EnumType.STRING)
    private TierType tier;

    /** BIGINT paisa. Never a float, never a double, never NUMERIC. */
    @Column(name = "price_paisa", nullable = false)
    private long pricePaisa;

    @Column(nullable = false, length = 3)
    private String currency = "PKR";

    @Column(name = "billing_period", nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private BillingPeriod billingPeriod;

    /** How long a trial on this plan runs. 0 means the plan has no trial, which is a real answer. */
    @Column(name = "trial_days", nullable = false)
    private int trialDays;

    @Column(name = "max_branches", nullable = false)
    private int maxBranches;

    @Column(name = "max_users", nullable = false)
    private int maxUsers;

    @Column(name = "storage_gb", nullable = false)
    private int storageGb;

    @Column(name = "nlq_quota", nullable = false)
    private int nlqQuota;

    /**
     * Declarable, NOT measurable. {@code pos_terminals} lives in pos_db behind FORCE row-level
     * security and pos-service exposes no terminal count on any internal channel, so the platform
     * plane cannot compare a tenant against this number. Null means "not part of this plan's
     * contract"; a value means an operator wrote one down. {@code SubscriptionLimitService} reports
     * it as NOT_MEASURABLE and never as satisfied — a limit nobody can check must say so rather
     * than render as a green tick.
     */
    @Column(name = "max_terminals")
    private Integer maxTerminals;

    /**
     * Declarable, NOT measurable, for the same class of reason as {@link #maxTerminals}: monthly
     * order volume lives in {@code clickhouse_analytics.sales_order_facts} and
     * platform-admin-service has no ClickHouse driver on its classpath. Adding one is a real,
     * bounded option (CAPABILITY-MAP §8 recommends it, with no migration); until then this is a
     * declaration, not a check.
     */
    @Column(name = "max_orders_per_month")
    private Integer maxOrdersPerMonth;

    /**
     * Archived plans are {@code false}. A plan is NEVER deleted: {@code tenant_subscriptions.plan_id}
     * has no cascade, so deleting one would either orphan live subscriptions or be refused by the
     * database. Archiving keeps every historical price readable.
     */
    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    @PreUpdate
    void touch() {
        this.updatedAt = Instant.now();
    }

    /**
     * How often the plan is charged.
     *
     * <p>Deliberately three values and no {@code WEEKLY} or {@code CUSTOM}: each one has to be
     * convertible to a period length by {@code SubscriptionService.nextPeriodEnd}, and a period the
     * code cannot advance is a renewal date that silently never moves.
     */
    public enum BillingPeriod {
        MONTHLY(1), QUARTERLY(3), ANNUAL(12);

        private final int months;

        BillingPeriod(int months) {
            this.months = months;
        }

        public int months() {
            return months;
        }
    }
}
