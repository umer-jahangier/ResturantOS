package io.restaurantos.platform;

import com.github.tomakehurst.wiremock.client.WireMock;
import io.restaurantos.platform.dto.SubscriptionDtos.AssignPlanRequest;
import io.restaurantos.platform.dto.SubscriptionDtos.CancelSubscriptionRequest;
import io.restaurantos.platform.dto.SubscriptionDtos.LimitState;
import io.restaurantos.platform.dto.SubscriptionDtos.RenewSubscriptionRequest;
import io.restaurantos.platform.entity.TenantEntity.TenantStatus;
import io.restaurantos.platform.entity.TenantEntity.TierType;
import io.restaurantos.platform.entity.TenantSubscriptionEntity.SubscriptionStatus;
import io.restaurantos.platform.repository.SubscriptionHistoryRepository;
import io.restaurantos.platform.repository.TenantSubscriptionRepository;
import io.restaurantos.platform.service.ProvisioningService;
import io.restaurantos.platform.service.SubscriptionScheduler;
import io.restaurantos.platform.service.SubscriptionService;
import io.restaurantos.platform.service.TenantSubscriptionService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Subscription lifecycle, limit enforcement and the append-only trail.
 *
 * <p>The behaviours, and what each one guards:
 *
 * <ol>
 *   <li>Assigning a plan moves the tenant's tier, its four ceilings and its feature rows through the
 *       ONE applier {@code changeTier} also uses — two appliers would drift invisibly.</li>
 *   <li>A tenant with no subscription is <b>200 with a stated absence</b>; an unknown tenant is 404.
 *       On this screen those mean opposite things.</li>
 *   <li>A plan change below MEASURABLE usage is refused naming the limit, and {@code force} applies
 *       it — the same posture the tier downgrade already takes.</li>
 *   <li>A scheduled change moves NOTHING until the sweep applies it, and the sweep is idempotent.</li>
 *   <li>Cancelling a SUBSCRIPTION leaves the TENANT completely untouched.</li>
 *   <li>An elapsed trial becomes {@code TRIAL_ENDED} and changes no entitlement — the product does
 *       not invent a commercial consequence for an event it cannot connect to a payment.</li>
 *   <li>A renewal is an operator ASSERTION; the sweep never rolls a period forward.</li>
 *   <li>Every transition writes exactly one history row, and the table refuses UPDATE, DELETE and
 *       TRUNCATE at the database.</li>
 *   <li><b>A bare tier change is no longer a silent overwrite</b> — the defect the whole domain
 *       exists to close.</li>
 *   <li>The limits report marks what cannot be measured instead of passing it.</li>
 *   <li>The register states how many tenants have no subscription, and carries NO revenue figure.</li>
 * </ol>
 */
class SubscriptionLifecycleIT extends BasePlatformIT {

    @Autowired ProvisioningService provisioningService;
    @Autowired SubscriptionService subscriptionService;
    @Autowired TenantSubscriptionService tenantSubscriptionService;
    @Autowired TenantSubscriptionRepository subscriptionRepository;
    @Autowired SubscriptionHistoryRepository historyRepository;
    @Autowired SubscriptionScheduler scheduler;

    private static final UUID SUPER_ADMIN_ID = UUID.randomUUID();

    // ── 1: assignment applies the entitlement ───────────────────────────────────────────────

    @Test
    void assigningAPlanMovesTheTierTheCeilingsAndTheFeatureRows_throughTheOneApplier() {
        UUID tenantId = provisionStarter("Assign Plan");
        stubBranchCount(tenantId, 0);

        var res = httpPostAs(superAdminToken(),
            "/api/v1/platform/tenants/" + tenantId + "/subscription",
            Map.of("planCode", "growth-monthly", "reason", "customer upgraded"));

        assertThat(res.getStatusCode().value()).isEqualTo(200);

        var tenant = tenantRepository.findById(tenantId).orElseThrow();
        assertThat(tenant.getTier())
            .as("the plan names a tier and assigning it moves the tenant there — otherwise the "
                + "commercial record and the entitlement describe different things")
            .isEqualTo(TierType.GROWTH);
        assertThat(tenant.getMaxBranches()).isEqualTo(5);
        assertThat(tenant.getNlqQuota()).isEqualTo(5000);
        assertThat(redis.opsForValue().get(TenantSubscriptionService.QUOTA_KEY_PREFIX + tenantId))
            .as("the quota key the gateway and nlq-service enforce against is written by the same "
                + "applier, so a plan assignment reaches the edge on the next request")
            .isEqualTo("5000");
        assertThat(redis.opsForValue().get("tenant_features:" + tenantId + ":FEATURE_MULTI_BRANCH"))
            .as("both cache key shapes are invalidated, because the applier is shared with changeTier")
            .isEqualTo("true");

        var subscription = subscriptionRepository.findLive(tenantId).orElseThrow();
        assertThat(subscription.getStatus()).isEqualTo(SubscriptionStatus.ACTIVE);
        assertThat(subscription.getCurrentPeriodEndAt())
            .as("the first period end is derivable from the billing period an operator chose; the "
                + "renewal AFTER it is not, and is asserted through /renew")
            .isNotNull();
        assertThat(tenant.getRenewsAt())
            .as("projected onto the contract-frozen tenant column so the two screens cannot show "
                + "different renewal dates")
            .isEqualTo(subscription.getCurrentPeriodEndAt());

        assertThat(historyRepository.countByTenantId(tenantId))
            .as("exactly one row per transition — the provisioning saga writes none, so this is it")
            .isEqualTo(1);
    }

    // ── 2: absence is an answer ─────────────────────────────────────────────────────────────

    @Test
    void aTenantWithNoSubscriptionIs200WithAStatedAbsence_whileAnUnknownTenantIs404() {
        UUID tenantId = provisionStarter("No Subscription");

        var present = httpGetAs(superAdminToken(), "/api/v1/platform/tenants/" + tenantId + "/subscription");
        assertThat(present.getStatusCode().value()).isEqualTo(200);
        assertThat(present.getBody())
            .as("nothing was backfilled: inventing a plan, a price and a start date for an existing "
                + "tenant would assert an agreement nobody made")
            .contains("\"subscription\":null")
            .contains("no subscription record")
            .contains("\"tier\":\"STARTER\"");

        var unknown = httpGetAs(superAdminToken(),
            "/api/v1/platform/tenants/" + UUID.randomUUID() + "/subscription");
        assertThat(unknown.getStatusCode().value())
            .as("'this tenant does not exist' and 'this tenant has no subscription' are opposite "
                + "answers and must not look the same")
            .isEqualTo(404);
    }

    // ── 3: limits are actually enforced ─────────────────────────────────────────────────────

    @Test
    void aPlanChangeBelowMeasurableUsageIsRefusedNamingTheLimit_andForceApplies() {
        UUID tenantId = provisionStarter("Limit Refusal");
        stubBranchCount(tenantId, 0);
        subscriptionService.assignPlan(tenantId,
            new AssignPlanRequest("growth-monthly", null, false, false, "start"), SUPER_ADMIN_ID);

        // Three live branches; starter-monthly allows one.
        stubBranchCount(tenantId, 3);

        var refused = httpPostAs(superAdminToken(),
            "/api/v1/platform/tenants/" + tenantId + "/subscription",
            Map.of("planCode", "starter-monthly", "reason", "downgrade"));

        assertThat(refused.getStatusCode().value()).isEqualTo(409);
        assertThat(refused.getBody())
            .as("a limit nobody checks is decoration; this is the check")
            .contains("SUBSCRIPTION_LIMIT_EXCEEDED")
            .contains("branches")
            .contains("in use 3")
            .contains("allows 1");
        assertThat(tenantRepository.findById(tenantId).orElseThrow().getTier())
            .as("a refusal must not have applied half the change")
            .isEqualTo(TierType.GROWTH);

        var forced = httpPostAs(superAdminToken(),
            "/api/v1/platform/tenants/" + tenantId + "/subscription",
            Map.of("planCode", "starter-monthly", "reason", "downgrade anyway", "force", true));

        assertThat(forced.getStatusCode().value()).isEqualTo(200);
        assertThat(tenantRepository.findById(tenantId).orElseThrow().getTier()).isEqualTo(TierType.STARTER);
        assertThat(historyRepository.findByTenantIdOrderByRecordedAtDesc(tenantId,
                org.springframework.data.domain.PageRequest.of(0, 1)).getContent().get(0)
                .isForcedOverLimits())
            .as("the trail records that the operator overrode a violation, not an ordinary change")
            .isTrue();
    }

    @Test
    void theLimitsReportMarksWhatCannotBeMeasuredRatherThanPassingIt() {
        UUID tenantId = provisionStarter("Limits Report");
        stubBranchCount(tenantId, 2);
        subscriptionService.assignPlan(tenantId,
            new AssignPlanRequest("growth-monthly", null, false, false, "start"), SUPER_ADMIN_ID);
        stubBranchCount(tenantId, 2);

        var report = subscriptionService.limits(tenantId);

        var branches = report.checks().stream().filter(c -> c.limit().equals("branches")).findFirst().orElseThrow();
        assertThat(branches.state())
            .as("branches is the ONE dimension with a real live count, and it comes from the same "
                + "call the tier downgrade guard trusts — so the two cannot disagree")
            .isEqualTo(LimitState.WITHIN);
        assertThat(branches.used()).isEqualTo(2);

        var users = report.checks().stream().filter(c -> c.limit().equals("users")).findFirst().orElseThrow();
        assertThat(users.state())
            .as("auth-service exposes no per-tenant count on the channel UsageService reads; a "
                + "confident tick here would be a fabrication an operator could act on")
            .isEqualTo(LimitState.NOT_MEASURABLE);
        assertThat(users.used()).as("null, NOT 0 — zero is a claim that we counted").isNull();

        var terminals = report.checks().stream().filter(c -> c.limit().equals("terminals")).findFirst().orElseThrow();
        assertThat(terminals.state()).isEqualTo(LimitState.NOT_MEASURABLE);
        assertThat(terminals.source()).contains("pos");

        var orders = report.checks().stream().filter(c -> c.limit().equals("orders_per_month")).findFirst().orElseThrow();
        assertThat(orders.state()).isEqualTo(LimitState.NOT_MEASURABLE);
        assertThat(orders.source()).contains("ClickHouse");

        assertThat(report.anyMeasurable())
            .as("this is what lets a screen tell 'exceeded=0 because we checked' from 'exceeded=0 "
                + "because we cannot check anything'")
            .isTrue();
        assertThat(report.exceeded()).isZero();
    }

    // ── 4: scheduling ───────────────────────────────────────────────────────────────────────

    @Test
    void aScheduledChangeMovesNothingUntilTheSweepApplies_andTheSweepIsIdempotent() {
        UUID tenantId = provisionStarter("Scheduled Change");
        stubBranchCount(tenantId, 0);
        subscriptionService.assignPlan(tenantId,
            new AssignPlanRequest("starter-monthly", null, false, false, "start"), SUPER_ADMIN_ID);

        Instant future = Instant.now().plus(30, ChronoUnit.DAYS);
        subscriptionService.assignPlan(tenantId,
            new AssignPlanRequest("growth-monthly", future, false, false, "upgrade next month"),
            SUPER_ADMIN_ID);

        assertThat(tenantRepository.findById(tenantId).orElseThrow().getTier())
            .as("a scheduled change is a recorded decision, not an applied one")
            .isEqualTo(TierType.STARTER);
        var pending = subscriptionRepository.findLive(tenantId).orElseThrow();
        assertThat(pending.hasPendingChange()).isTrue();

        // Bring the effective date into the past, the way the clock would.
        pending.setPendingChangeAt(Instant.now().minus(1, ChronoUnit.MINUTES));
        subscriptionRepository.save(pending);
        stubBranchCount(tenantId, 0);

        assertThat(subscriptionService.applyDuePlanChange(pending.getId())).isTrue();
        assertThat(tenantRepository.findById(tenantId).orElseThrow().getTier()).isEqualTo(TierType.GROWTH);
        long rowsAfterFirst = historyRepository.countByTenantId(tenantId);

        assertThat(subscriptionService.applyDuePlanChange(pending.getId()))
            .as("a second sweeper — another replica, an overlapping run — finds the pending fields "
                + "already cleared and does nothing. Idempotence here is what stops one decision "
                + "producing two history rows.")
            .isFalse();
        assertThat(historyRepository.countByTenantId(tenantId)).isEqualTo(rowsAfterFirst);
    }

    @Test
    void aScheduledChangeCanBeWithdrawn_andWithdrawingNothingIsRefused() {
        UUID tenantId = provisionStarter("Withdraw Scheduled");
        stubBranchCount(tenantId, 0);
        subscriptionService.assignPlan(tenantId,
            new AssignPlanRequest("starter-monthly", null, false, false, "start"), SUPER_ADMIN_ID);

        var nothingScheduled = httpDeleteAs(superAdminToken(),
            "/api/v1/platform/tenants/" + tenantId + "/subscription/scheduled-change");
        assertThat(nothingScheduled.getStatusCode().value())
            .as("an operator who believes they have just called off a downgrade, and has not, will "
                + "not check again — so a no-op 200 is the wrong answer")
            .isEqualTo(409);
        assertThat(nothingScheduled.getBody()).contains("NOTHING_SCHEDULED");

        subscriptionService.assignPlan(tenantId, new AssignPlanRequest("growth-monthly",
            Instant.now().plus(10, ChronoUnit.DAYS), false, false, "later"), SUPER_ADMIN_ID);

        var withdrawn = httpDeleteAs(superAdminToken(),
            "/api/v1/platform/tenants/" + tenantId + "/subscription/scheduled-change");
        assertThat(withdrawn.getStatusCode().value()).isEqualTo(200);
        assertThat(subscriptionRepository.findLive(tenantId).orElseThrow().hasPendingChange()).isFalse();
    }

    @Test
    void aBackdatedPlanChangeIsRefusedRatherThanTreatedAsNow() {
        UUID tenantId = provisionStarter("Backdated");
        stubBranchCount(tenantId, 0);

        assertThatThrownBy(() -> subscriptionService.assignPlan(tenantId,
            new AssignPlanRequest("growth-monthly", Instant.now().minus(30, ChronoUnit.DAYS),
                false, false, "backdate"), SUPER_ADMIN_ID))
            .as("backdating puts an effective date in the trail that the entitlement never had, and "
                + "the trail is the artefact this whole domain exists to produce")
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("backdated");
    }

    // ── 5: cancellation does not touch the tenant ───────────────────────────────────────────

    @Test
    void cancellingASubscriptionLeavesTheTenantCompletelyUntouched() {
        UUID tenantId = provisionStarter("Cancel Subscription");
        stubBranchCount(tenantId, 0);
        subscriptionService.assignPlan(tenantId,
            new AssignPlanRequest("growth-monthly", null, false, false, "start"), SUPER_ADMIN_ID);

        var before = tenantRepository.findById(tenantId).orElseThrow();
        TenantStatus statusBefore = before.getStatus();
        TierType tierBefore = before.getTier();
        int branchesBefore = before.getMaxBranches();

        subscriptionService.cancel(tenantId,
            new CancelSubscriptionRequest(null, "customer left"), SUPER_ADMIN_ID);

        assertThat(subscriptionRepository.findLive(tenantId).orElseThrow().getStatus())
            .isEqualTo(SubscriptionStatus.CANCELLED);

        var after = tenantRepository.findById(tenantId).orElseThrow();
        assertThat(after.getStatus())
            .as("POST /tenants/{id}/cancel is what takes a tenant out of service. Conflating the "
                + "two would let a billing decision silently take a restaurant's POS offline.")
            .isEqualTo(statusBefore);
        assertThat(after.getTier()).isEqualTo(tierBefore);
        assertThat(after.getMaxBranches()).isEqualTo(branchesBefore);
    }

    @Test
    void assigningAPlanAfterACancellationClosesTheOldRecordRatherThanOverwritingIt() {
        UUID tenantId = provisionStarter("Resubscribe");
        stubBranchCount(tenantId, 0);
        subscriptionService.assignPlan(tenantId,
            new AssignPlanRequest("starter-monthly", null, false, false, "first"), SUPER_ADMIN_ID);
        UUID firstId = subscriptionRepository.findLive(tenantId).orElseThrow().getId();
        subscriptionService.cancel(tenantId,
            new CancelSubscriptionRequest(null, "left"), SUPER_ADMIN_ID);

        stubBranchCount(tenantId, 0);
        subscriptionService.assignPlan(tenantId,
            new AssignPlanRequest("growth-monthly", null, false, false, "came back"), SUPER_ADMIN_ID);

        var live = subscriptionRepository.findLive(tenantId).orElseThrow();
        assertThat(live.getId())
            .as("the cancelled record's date, reason and period are the evidence that an agreement "
                + "ended; reusing the row to start a new one would erase it")
            .isNotEqualTo(firstId);
        assertThat(subscriptionRepository.findById(firstId).orElseThrow().getStatus())
            .isEqualTo(SubscriptionStatus.ENDED);
        assertThat(subscriptionRepository.findByTenantIdOrderByStartedAtDesc(tenantId))
            .as("the partial unique index permits exactly one non-ENDED row per tenant")
            .hasSize(2);
    }

    // ── 6: trials ───────────────────────────────────────────────────────────────────────────

    @Test
    void anElapsedTrialBecomesTrialEnded_andChangesNoEntitlement() {
        UUID tenantId = provisionStarter("Trial");
        stubBranchCount(tenantId, 0);
        subscriptionService.assignPlan(tenantId,
            new AssignPlanRequest("growth-monthly", null, true, false, "trial"), SUPER_ADMIN_ID);

        var subscription = subscriptionRepository.findLive(tenantId).orElseThrow();
        assertThat(subscription.getStatus()).isEqualTo(SubscriptionStatus.TRIALING);
        assertThat(subscription.getTrialEndAt()).isNotNull();
        assertThat(subscription.getCurrentPeriodEndAt())
            .as("NULL during a trial means NO RENEWAL SCHEDULED, which is exactly true — deriving "
                + "one would assert a billing date nobody has agreed to yet")
            .isNull();

        var before = tenantRepository.findById(tenantId).orElseThrow();
        TierType tierBefore = before.getTier();
        int branchesBefore = before.getMaxBranches();

        subscription.setTrialEndAt(Instant.now().minus(1, ChronoUnit.MINUTES));
        subscriptionRepository.save(subscription);
        assertThat(subscriptionService.markTrialEnded(subscription.getId())).isTrue();

        assertThat(subscriptionRepository.findLive(tenantId).orElseThrow().getStatus())
            .isEqualTo(SubscriptionStatus.TRIAL_ENDED);
        var after = tenantRepository.findById(tenantId).orElseThrow();
        assertThat(after.getTier())
            .as("TRIAL_ENDED is a worklist state produced by the clock. Downgrading here would be "
                + "the product inventing a commercial consequence for an event it cannot connect "
                + "to a payment decision.")
            .isEqualTo(tierBefore);
        assertThat(after.getMaxBranches()).isEqualTo(branchesBefore);
    }

    // ── 7: renewal is an assertion ──────────────────────────────────────────────────────────

    @Test
    void aRenewalIsAnOperatorAssertion_andTheSweepNeverRollsAPeriodForward() {
        UUID tenantId = provisionStarter("Renewal");
        stubBranchCount(tenantId, 0);
        subscriptionService.assignPlan(tenantId,
            new AssignPlanRequest("growth-monthly", null, false, false, "start"), SUPER_ADMIN_ID);

        var subscription = subscriptionRepository.findLive(tenantId).orElseThrow();
        Instant elapsed = Instant.now().minus(2, ChronoUnit.DAYS);
        subscription.setCurrentPeriodEndAt(elapsed);
        subscriptionRepository.save(subscription);

        redis.delete("platform:subscription-sweep:lease");
        scheduler.sweep();

        assertThat(subscriptionRepository.findLive(tenantId).orElseThrow().getCurrentPeriodEndAt())
            .as("advancing this date would assert that the tenant PAID, and nothing in this product "
                + "observes a payment. An elapsed period is a worklist, not a fact about money.")
            .isEqualTo(elapsed);

        assertThat(subscriptionService.forTenant(tenantId).subscription().renewalOverdue())
            .as("derived, never stored — this is the flag that prompts the operator")
            .isTrue();

        var renewed = httpPostAs(superAdminToken(),
            "/api/v1/platform/tenants/" + tenantId + "/subscription/renew",
            Map.of("deriveFromBillingPeriod", true, "reason", "customer paid, invoice INV-9"));
        assertThat(renewed.getStatusCode().value()).isEqualTo(200);
        assertThat(subscriptionRepository.findLive(tenantId).orElseThrow().getCurrentPeriodEndAt())
            .isAfter(Instant.now());
    }

    @Test
    void aRenewalWithNeitherADateNorADerivationIsRefused() {
        UUID tenantId = provisionStarter("Renewal Ambiguous");
        stubBranchCount(tenantId, 0);
        subscriptionService.assignPlan(tenantId,
            new AssignPlanRequest("growth-monthly", null, false, false, "start"), SUPER_ADMIN_ID);

        assertThatThrownBy(() -> subscriptionService.renew(tenantId,
            new RenewSubscriptionRequest(null, null, "paid"), SUPER_ADMIN_ID))
            .as("a renewal date is something an operator STATES, never something this service "
                + "infers on its own — because it cannot see the payment that would justify it")
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("deriveFromBillingPeriod");
    }

    // ── 8 + 9: the trail ────────────────────────────────────────────────────────────────────

    @Test
    void aBareTierChangeIsNoLongerASilentOverwrite() {
        UUID tenantId = provisionStarter("Tier History");
        stubBranchCount(tenantId, 0);
        long before = historyRepository.countByTenantId(tenantId);

        var res = httpPostAs(superAdminToken(), "/api/v1/platform/tenants/" + tenantId + "/tier",
            Map.of("tier", "ENTERPRISE"));
        assertThat(res.getStatusCode().value())
            .as("the pre-existing tier contract is unchanged — same path, same body, same 200")
            .isEqualTo(200);

        var rows = historyRepository.findByTenantIdOrderByRecordedAtDesc(tenantId,
            org.springframework.data.domain.PageRequest.of(0, 5)).getContent();
        assertThat(historyRepository.countByTenantId(tenantId)).isEqualTo(before + 1);

        var row = rows.get(0);
        assertThat(row.getChangeType().name()).isEqualTo("TIER_CHANGED");
        assertThat(row.getFromTier()).isEqualTo("STARTER");
        assertThat(row.getToTier()).isEqualTo("ENTERPRISE");
        assertThat(row.getSubscriptionId())
            .as("nullable on purpose: every tenant in this database is subject to a tier change and "
                + "none has a subscription, so refusing to record it until one exists would leave "
                + "the most common commercial transition invisible")
            .isNull();
        assertThat(row.getActorPlatformUserId())
            .as("taken from the sub of the verified control-plane token, never from the body — a "
                + "repudiation control whose subject can name itself is not a control")
            .isEqualTo(SUPER_ADMIN_ID);
        assertThat(row.getActorKind().name()).isEqualTo("OPERATOR");
    }

    @Test
    void subscriptionHistoryRefusesUpdateDeleteAndTruncateAtTheDatabase() {
        UUID tenantId = provisionStarter("History Immutable");
        stubBranchCount(tenantId, 0);
        subscriptionService.assignPlan(tenantId,
            new AssignPlanRequest("growth-monthly", null, false, false, "start"), SUPER_ADMIN_ID);

        assertThatThrownBy(() -> jdbc.update(
            "UPDATE subscription_history SET reason = 'rewritten' WHERE tenant_id = ?", tenantId))
            .as("the subject of the record must not be able to edit it — and a GRANT-based control "
                + "is INERT in platform_db (changeset 040 measured that platform_user inherits "
                + "platform_admin), so only a trigger holds")
            .hasMessageContaining("SUBSCRIPTION_HISTORY_IMMUTABLE");

        assertThatThrownBy(() -> jdbc.update(
            "DELETE FROM subscription_history WHERE tenant_id = ?", tenantId))
            .hasMessageContaining("SUBSCRIPTION_HISTORY_IMMUTABLE");

        assertThatThrownBy(() -> jdbc.execute("TRUNCATE subscription_history"))
            .as("a row-level trigger does not see TRUNCATE at all, so without its own statement-"
                + "level trigger the table would be immutable row by row and erasable in one "
                + "statement")
            .hasMessageContaining("SUBSCRIPTION_HISTORY_IMMUTABLE");
    }

    @Test
    void theHistoryEndpointReturnsTheTrailNewestFirstWithTheActorResolved() {
        UUID tenantId = provisionStarter("History Read");
        stubBranchCount(tenantId, 0);
        subscriptionService.assignPlan(tenantId,
            new AssignPlanRequest("starter-monthly", null, false, false, "initial sale"), SUPER_ADMIN_ID);
        stubBranchCount(tenantId, 0);
        subscriptionService.assignPlan(tenantId,
            new AssignPlanRequest("growth-monthly", null, false, false, "upgraded"), SUPER_ADMIN_ID);

        var res = httpGetAs(superAdminToken(),
            "/api/v1/platform/tenants/" + tenantId + "/subscription/history");
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getBody())
            .contains("PLAN_UPGRADED")
            .contains("SUBSCRIPTION_CREATED")
            .contains("initial sale")
            .contains("upgraded")
            .as("plan codes are captured verbatim so an archived or re-priced plan cannot "
                + "retroactively rewrite what a tenant was moved onto")
            .contains("starter-monthly")
            .contains("growth-monthly");
    }

    // ── 11: the register, and the absence of revenue ────────────────────────────────────────

    @Test
    void theRegisterStatesHowManyTenantsHaveNoSubscription_andCarriesNoRevenueFigure() {
        UUID subscribed = provisionStarter("Register Subscribed");
        stubBranchCount(subscribed, 0);
        subscriptionService.assignPlan(subscribed,
            new AssignPlanRequest("growth-monthly", null, false, false, "start"), SUPER_ADMIN_ID);
        provisionStarter("Register Unsubscribed");

        var res = httpGetAs(superAdminToken(), "/api/v1/platform/subscriptions");
        assertThat(res.getStatusCode().value()).isEqualTo(200);

        var register = subscriptionService.register(null, null, null, null, 0, 50);
        assertThat(register.tenantsWithoutSubscription())
            .as("without this figure the list reads as 'the fleet' while silently omitting every "
                + "tenant that has no subscription — which, until an operator assigns plans, is all "
                + "of them")
            .isPositive();
        assertThat(register.revenueNote())
            .as("the absence is rendered in words, not as a zero")
            .contains("Billing is not integrated")
            .contains("not money received");

        assertThat(res.getBody())
            .as("no revenue aggregate exists anywhere in this service: plan prices are what a plan "
                + "is SOLD at, and this product records no invoice, payment or processor "
                + "transaction, so any such sum would be a number the system cannot compute")
            .doesNotContain("\"mrr\"")
            .doesNotContain("\"arr\"")
            .doesNotContain("\"totalRevenue\"")
            .doesNotContain("\"revenuePaisa\"")
            .doesNotContain("\"churnValue\"");
    }

    @Test
    void theRegisterFiltersRenewalsDueWithoutTreatingAnAbsentRenewalAsDue() {
        UUID withRenewal = provisionStarter("Register Renewal");
        stubBranchCount(withRenewal, 0);
        subscriptionService.assignPlan(withRenewal,
            new AssignPlanRequest("growth-monthly", null, false, false, "start"), SUPER_ADMIN_ID);

        UUID onTrial = provisionStarter("Register Trial");
        stubBranchCount(onTrial, 0);
        subscriptionService.assignPlan(onTrial,
            new AssignPlanRequest("starter-monthly", null, true, false, "trial"), SUPER_ADMIN_ID);

        var due = subscriptionService.register(null, null, null,
            Instant.now().plus(400, ChronoUnit.DAYS), 0, 50);

        assertThat(due.subscriptions()).extracting("tenantId").contains(withRenewal);
        assertThat(due.subscriptions()).extracting("tenantId")
            .as("a NULL current_period_end_at means NO RENEWAL SCHEDULED — a real state, not a "
                + "date in the distant past, and a naive range predicate would sweep it in")
            .doesNotContain(onTrial);
    }

    // ── The gate ────────────────────────────────────────────────────────────────────────────

    @Test
    void superAdminGate_aTenantOwnerIsRefusedEverySubscriptionEndpoint() {
        UUID tenantId = provisionStarter("Subscription Gate");
        String ownerToken = tenantToken(UUID.randomUUID(), tenantId, "OWNER",
            List.of("rbac.manage", "rbac.user.manage", "pos.order.create"));

        assertThat(httpGetAs(ownerToken, "/api/v1/platform/tenants/" + tenantId + "/subscription")
            .getStatusCode().value()).isEqualTo(403);
        assertThat(httpPostAs(ownerToken, "/api/v1/platform/tenants/" + tenantId + "/subscription",
            Map.of("planCode", "enterprise-monthly", "reason", "self-service upgrade"))
            .getStatusCode().value())
            .as("a tenant putting itself on an ENTERPRISE plan is the elevation this gate exists for")
            .isEqualTo(403);
        assertThat(httpGetAs(ownerToken, "/api/v1/platform/subscriptions").getStatusCode().value())
            .as("the cross-tenant register is every competitor's commercial position")
            .isEqualTo(403);
        assertThat(httpGetAs(ownerToken,
            "/api/v1/platform/tenants/" + tenantId + "/subscription/history")
            .getStatusCode().value()).isEqualTo(403);

        assertThat(subscriptionRepository.findLive(tenantId))
            .as("and nothing moved")
            .isEmpty();

        assertThat(httpGetAs(superAdminToken(),
            "/api/v1/platform/tenants/" + tenantId + "/subscription").getStatusCode().value())
            .as("the negative control: a bug making EVERY request 403 would turn the assertions "
                + "above green")
            .isEqualTo(200);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────────

    private String superAdminToken() {
        return platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN");
    }

    /** DELETE with a bearer token — BasePlatformIT has GET/POST/PATCH but no DELETE helper. */
    private ResponseEntity<String> httpDeleteAs(String token, String uri) {
        return rest.method(org.springframework.http.HttpMethod.DELETE).uri(uri)
            .header("Authorization", "Bearer " + token)
            .accept(MediaType.APPLICATION_JSON)
            .exchange((req, res) -> toEntity(res), false);
    }

    private UUID provisionStarter(String brand) {
        WIREMOCK.resetAll();
        wireMockStubJwks();
        stubProvisioningSagaHappyPath(UUID.randomUUID(), UUID.randomUUID(), "T#sub");
        stubFinanceSeedCoaAnyTenant();
        UUID tenantId = provisioningService
            .provision("sub-life-" + UUID.randomUUID(), brand + " " + UUID.randomUUID(),
                "admin@sub.local", "STARTER")
            .tenantId();
        stubBranchCount(tenantId, 0);
        return tenantId;
    }

    private void stubBranchCount(UUID tenantId, int count) {
        StringBuilder body = new StringBuilder("[");
        for (int i = 0; i < count; i++) {
            if (i > 0) body.append(',');
            body.append("{\"id\":\"").append(UUID.randomUUID()).append("\",\"name\":\"B").append(i).append("\"}");
        }
        body.append(']');
        WIREMOCK.stubFor(WireMock.get(WireMock.urlPathEqualTo(
                "/internal/users/tenants/" + tenantId + "/branches"))
            .willReturn(WireMock.aResponse()
                .withStatus(200)
                .withHeader("Content-Type", "application/json")
                .withBody(body.toString())));
    }
}
