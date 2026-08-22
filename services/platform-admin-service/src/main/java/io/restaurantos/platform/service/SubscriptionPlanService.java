package io.restaurantos.platform.service;

import io.restaurantos.platform.config.TierFeatureDefaults;
import io.restaurantos.platform.config.TierLimits;
import io.restaurantos.platform.dto.SubscriptionDtos.CreatePlanRequest;
import io.restaurantos.platform.dto.SubscriptionDtos.PlanResponse;
import io.restaurantos.platform.dto.SubscriptionDtos.UpdatePlanRequest;
import io.restaurantos.platform.entity.SubscriptionPlanEntity;
import io.restaurantos.platform.entity.SubscriptionPlanEntity.BillingPeriod;
import io.restaurantos.platform.entity.TenantEntity.TierType;
import io.restaurantos.platform.repository.SubscriptionPlanRepository;
import io.restaurantos.platform.repository.TenantSubscriptionRepository;
import io.restaurantos.shared.exception.DuplicateValueException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

/**
 * Plans as first-class entities: create, read, edit, archive.
 *
 * <h3>What a plan is allowed to decide, and what it is not</h3>
 *
 * <p>A plan decides the COMMERCIAL facts (code, name, price in paisa, billing period, trial length)
 * and the four QUANTITATIVE ceilings. It does <b>not</b> decide the feature set: that is derived
 * from the plan's tier through {@link TierFeatureDefaults}, the single matrix the gateway, the
 * provisioning seed and the tier reconciliation all read. A {@code plan_features} table would be a
 * second copy, and the failure mode of a second copy is the phantom-flag defect this repository has
 * shipped twice — a route gated on a code no tier grants answers a clean 403 that is
 * indistinguishable from "the tenant has not bought the module".
 *
 * <h3>Plans are archived, never deleted</h3>
 *
 * <p>{@code tenant_subscriptions.plan_id} carries no cascade, and {@code subscription_history}
 * captures plan codes and prices verbatim rather than by reference. Deleting a plan would therefore
 * either be refused by the database or destroy the only record of what a tenant was actually sold.
 * Archiving keeps every historical price readable and simply removes the plan from what an operator
 * can newly assign.
 */
@Service
public class SubscriptionPlanService {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionPlanService.class);

    private final SubscriptionPlanRepository planRepository;
    private final TenantSubscriptionRepository subscriptionRepository;
    private final TierFeatureDefaults tierFeatureDefaults;
    private final TierLimits tierLimits;

    public SubscriptionPlanService(SubscriptionPlanRepository planRepository,
                                   TenantSubscriptionRepository subscriptionRepository,
                                   TierFeatureDefaults tierFeatureDefaults,
                                   TierLimits tierLimits) {
        this.planRepository = planRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.tierFeatureDefaults = tierFeatureDefaults;
        this.tierLimits = tierLimits;
    }

    public List<PlanResponse> list(boolean includeInactive) {
        List<SubscriptionPlanEntity> plans = includeInactive
            ? planRepository.findAllByOrderByPricePaisaAsc()
            : planRepository.findByActiveTrueOrderByPricePaisaAsc();
        return plans.stream().map(this::toResponse).toList();
    }

    public PlanResponse get(String code) {
        return toResponse(require(code));
    }

    /** The entity, for callers inside this service package that need more than the wire shape. */
    public SubscriptionPlanEntity require(String code) {
        return planRepository.findByCode(code)
            .orElseThrow(() -> new ResourceNotFoundException("Subscription plan not found: " + code));
    }

    /**
     * Create a plan.
     *
     * <p><b>The four ceilings default to the tier's, they are not required.</b> Most plans are a
     * price attached to an existing tier, and forcing an operator to retype
     * {@code TierLimits.forTier()} by hand is how a plan silently acquires ceilings that differ from
     * every other plan on the same tier. Supplying a ceiling explicitly is the bespoke case and is
     * exactly what a first-class plan makes possible.
     *
     * <p>A duplicate code is 409 {@code DUPLICATE_VALUE} naming the field, not a raw constraint
     * violation: the operator typed it and can fix it.
     */
    @Transactional
    public PlanResponse create(CreatePlanRequest req) {
        String code = req.code().trim();
        if (planRepository.existsByCode(code)) {
            throw new DuplicateValueException("code", "A plan with code '" + code + "' already exists");
        }
        TierType tier = parseTier(req.tier());
        TierLimits.Limits defaults = tierLimits.forTier(tier);

        SubscriptionPlanEntity plan = new SubscriptionPlanEntity();
        plan.setCode(code);
        plan.setName(req.name().trim());
        plan.setDescription(blankToNull(req.description()));
        plan.setTier(tier);
        plan.setPricePaisa(req.pricePaisa());
        plan.setCurrency(normaliseCurrency(req.currency()));
        plan.setBillingPeriod(parsePeriod(req.billingPeriod()));
        plan.setTrialDays(req.trialDays());
        plan.setMaxBranches(orDefault(req.maxBranches(), defaults.maxBranches()));
        plan.setMaxUsers(orDefault(req.maxUsers(), defaults.maxUsers()));
        plan.setStorageGb(orDefault(req.storageGb(), defaults.storageGb()));
        plan.setNlqQuota(orDefault(req.nlqQuota(), defaults.nlqQuota()));
        plan.setMaxTerminals(req.maxTerminals());
        plan.setMaxOrdersPerMonth(req.maxOrdersPerMonth());
        plan.setActive(true);

        SubscriptionPlanEntity saved = planRepository.save(plan);
        log.info("[plan] created code={} tier={} price={}paisa/{} period={} limits=({},{},{},{})",
            saved.getCode(), saved.getTier(), saved.getPricePaisa(), saved.getCurrency(),
            saved.getBillingPeriod(), saved.getMaxBranches(), saved.getMaxUsers(),
            saved.getStorageGb(), saved.getNlqQuota());
        return toResponse(saved);
    }

    /**
     * Edit a plan. Null leaves a field alone.
     *
     * <h3>Editing a price does not re-price anybody retroactively</h3>
     *
     * <p>{@code subscription_history} captured the price at the moment of every past change, so a
     * correction here cannot rewrite what a tenant was moved onto. It does change what the plan is
     * sold at from now on, and it changes what the subscription screen shows for tenants already on
     * it — which is correct, because they are on the plan, not on a copy of it.
     *
     * <h3>Editing a ceiling does NOT restamp live tenants</h3>
     *
     * <p>Deliberately. The ceilings on the tenant row are applied when a plan is ASSIGNED, by the
     * one applier in {@code TenantSubscriptionService.applyEntitlement}. Widening a plan here and
     * having every tenant on it silently gain capacity — with no history row, no operator decision
     * and no limit check — is a bulk entitlement change disguised as an edit. Re-assign the plan to
     * a tenant to move that tenant; the log line below says how many are affected so the operator
     * knows the size of what they have not done.
     */
    @Transactional
    public PlanResponse update(String code, UpdatePlanRequest req) {
        SubscriptionPlanEntity plan = require(code);
        if (req.name() != null && !req.name().isBlank()) {
            plan.setName(req.name().trim());
        }
        if (req.description() != null) {
            plan.setDescription(blankToNull(req.description()));
        }
        if (req.pricePaisa() != null) {
            if (req.pricePaisa() < 0) {
                throw new IllegalArgumentException(
                    "pricePaisa cannot be negative — a negative price is a data-entry accident, not a discount");
            }
            plan.setPricePaisa(req.pricePaisa());
        }
        if (req.currency() != null && !req.currency().isBlank()) {
            plan.setCurrency(normaliseCurrency(req.currency()));
        }
        if (req.billingPeriod() != null && !req.billingPeriod().isBlank()) {
            plan.setBillingPeriod(parsePeriod(req.billingPeriod()));
        }
        if (req.trialDays() != null) {
            requireNonNegative("trialDays", req.trialDays());
            plan.setTrialDays(req.trialDays());
        }
        if (req.maxBranches() != null) {
            requireNonNegative("maxBranches", req.maxBranches());
            plan.setMaxBranches(req.maxBranches());
        }
        if (req.maxUsers() != null) {
            requireNonNegative("maxUsers", req.maxUsers());
            plan.setMaxUsers(req.maxUsers());
        }
        if (req.storageGb() != null) {
            requireNonNegative("storageGb", req.storageGb());
            plan.setStorageGb(req.storageGb());
        }
        if (req.nlqQuota() != null) {
            requireNonNegative("nlqQuota", req.nlqQuota());
            plan.setNlqQuota(req.nlqQuota());
        }
        if (req.maxTerminals() != null) {
            requireNonNegative("maxTerminals", req.maxTerminals());
            plan.setMaxTerminals(req.maxTerminals());
        }
        if (req.maxOrdersPerMonth() != null) {
            requireNonNegative("maxOrdersPerMonth", req.maxOrdersPerMonth());
            plan.setMaxOrdersPerMonth(req.maxOrdersPerMonth());
        }
        SubscriptionPlanEntity saved = planRepository.save(plan);
        long live = subscriptionRepository.countByPlanId(saved.getId());
        log.info("[plan] updated code={} — {} live subscription(s) name it; their tenant-row "
            + "ceilings are UNCHANGED until the plan is re-assigned to each", saved.getCode(), live);
        return toResponse(saved);
    }

    /**
     * Take a plan out of circulation without destroying what it says.
     *
     * <p>Refuses while subscriptions still name it, with the count, because the alternative is an
     * operator archiving a plan and only later discovering that thirty tenants are on something
     * nobody can now select. Move them first; the refusal names the number.
     */
    @Transactional
    public PlanResponse archive(String code) {
        SubscriptionPlanEntity plan = require(code);
        long live = subscriptionRepository.countByPlanId(plan.getId());
        if (live > 0) {
            throw new StateInvalidException("PLAN_IN_USE",
                "Plan '" + code + "' cannot be archived: " + live + " subscription(s) still name it. "
                    + "Move those tenants to another plan first — archiving would leave them on a "
                    + "plan no operator can select or reason about.");
        }
        plan.setActive(false);
        log.info("[plan] archived code={}", code);
        return toResponse(planRepository.save(plan));
    }

    /** Put an archived plan back in circulation. */
    @Transactional
    public PlanResponse restore(String code) {
        SubscriptionPlanEntity plan = require(code);
        plan.setActive(true);
        log.info("[plan] restored code={}", code);
        return toResponse(planRepository.save(plan));
    }

    /** The plan, with its feature set resolved from its tier and its live subscription count. */
    public PlanResponse toResponse(SubscriptionPlanEntity plan) {
        Map<String, Boolean> features = tierFeatureDefaults.defaultsFor(plan.getTier().name());
        return PlanResponse.of(plan, features, subscriptionRepository.countByPlanId(plan.getId()));
    }

    // --- Parsing -------------------------------------------------------------------------------

    private static TierType parseTier(String raw) {
        try {
            return TierType.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("Unknown tier '" + raw
                + "' — expected one of STARTER, GROWTH, ENTERPRISE, CUSTOM");
        }
    }

    private static BillingPeriod parsePeriod(String raw) {
        try {
            return BillingPeriod.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("Unknown billingPeriod '" + raw
                + "' — expected one of MONTHLY, QUARTERLY, ANNUAL");
        }
    }

    /**
     * Uppercased, and length-checked here rather than only by the column.
     *
     * <p>A 4-character currency reaching the database is a 500 the operator cannot act on; a
     * refusal naming the field is one they can. Not validated against ISO 4217 — this product has
     * no currency table, and inventing an allow-list here would refuse a real currency on the
     * strength of a list nobody maintains.
     */
    private static String normaliseCurrency(String raw) {
        if (raw == null || raw.isBlank()) {
            return "PKR";
        }
        String currency = raw.trim().toUpperCase();
        if (currency.length() != 3) {
            throw new IllegalArgumentException(
                "currency must be a 3-letter code (e.g. PKR, USD) — got '" + raw + "'");
        }
        return currency;
    }

    private static void requireNonNegative(String field, int value) {
        if (value < 0) {
            throw new IllegalArgumentException(field + " cannot be negative");
        }
    }

    private static int orDefault(Integer supplied, int fallback) {
        return supplied == null ? fallback : supplied;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
