package io.restaurantos.platform.controller;

import io.restaurantos.platform.dto.SubscriptionDtos.*;
import io.restaurantos.platform.service.SubscriptionPlanService;
import io.restaurantos.platform.service.SubscriptionService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.api.PageMeta;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.security.JwtClaims;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Plans, subscriptions and subscription history — the commercial layer over an entitlement that
 * already existed.
 *
 * <h3>A separate controller from {@link PlatformAdminController}, on the same base path</h3>
 *
 * <p>{@code PlatformAdminController} is ~20 contract-frozen endpoints that the frontend, two e2e
 * suites and the gateway all code against. Appending a whole new domain to it makes every future
 * change to either one a conflict, for no benefit: the {@code SUPER_ADMIN} gate is a class-level
 * annotation on both, the base path is the same, and no path here collides with one there.
 *
 * <h3>What is NOT here</h3>
 *
 * <p>There is no revenue, MRR, ARR, ARPU, churn-value, invoice, payment or dunning endpoint,
 * because this product contains no billing integration at all — no invoice entity, no payment
 * entity, no processor client, no webhook (see {@code SubscriptionService}'s header for the
 * survey). {@code price_paisa} is what a plan is SOLD at. The register returns a plain-language
 * {@code revenueNote} saying so, so a screen renders the absence rather than a zero.
 */
@RestController
@RequestMapping("/api/v1/platform")
@PreAuthorize("hasAuthority('SUPER_ADMIN')")
public class PlatformSubscriptionController {

    private final SubscriptionPlanService planService;
    private final SubscriptionService subscriptionService;

    public PlatformSubscriptionController(SubscriptionPlanService planService,
                                          SubscriptionService subscriptionService) {
        this.planService = planService;
        this.subscriptionService = subscriptionService;
    }

    // ── Plans ───────────────────────────────────────────────────────────────────────────────

    /**
     * {@code GET /api/v1/platform/plans?includeInactive=false}
     *
     * <p>Archived plans are hidden by default: they exist so historical prices stay readable, not so
     * they can be selected by accident.
     */
    @GetMapping("/plans")
    public ResponseEntity<ApiResponse<List<PlanResponse>>> listPlans(
            @RequestParam(defaultValue = "false") boolean includeInactive) {
        return ResponseEntity.ok(ApiResponse.ok(planService.list(includeInactive)));
    }

    @GetMapping("/plans/{code}")
    public ResponseEntity<ApiResponse<PlanResponse>> getPlan(@PathVariable String code) {
        return ResponseEntity.ok(ApiResponse.ok(planService.get(code)));
    }

    /** 201 with a Location header — a resource genuinely was created. */
    @PostMapping("/plans")
    public ResponseEntity<ApiResponse<PlanResponse>> createPlan(@Valid @RequestBody CreatePlanRequest req) {
        PlanResponse created = planService.create(req);
        return ResponseEntity.created(URI.create("/api/v1/platform/plans/" + created.code()))
            .body(ApiResponse.ok(created));
    }

    /**
     * PATCH, because every field is optional and an absent one means "leave it alone" — a PUT would
     * imply the body is the whole resource, so a client omitting the price would be asking to zero
     * it.
     *
     * <p>Editing a ceiling here does NOT restamp tenants already on the plan; see
     * {@code SubscriptionPlanService.update} for why that is deliberate and how to move them.
     */
    @PatchMapping("/plans/{code}")
    public ResponseEntity<ApiResponse<PlanResponse>> updatePlan(@PathVariable String code,
                                                                @Valid @RequestBody UpdatePlanRequest req) {
        return ResponseEntity.ok(ApiResponse.ok(planService.update(code, req)));
    }

    /**
     * Take a plan out of circulation. <b>Nothing is deleted</b> — POST rather than DELETE for
     * exactly the reason {@code POST /tenants/{id}/close} is: answering 204 to an operation that
     * only flips a boolean tells a caller the resource is gone when every historical price it
     * carries is still there and still needed.
     *
     * <p>Refused with 409 while subscriptions still name it, naming the count.
     */
    @PostMapping("/plans/{code}/archive")
    public ResponseEntity<ApiResponse<PlanResponse>> archivePlan(@PathVariable String code) {
        return ResponseEntity.ok(ApiResponse.ok(planService.archive(code)));
    }

    @PostMapping("/plans/{code}/restore")
    public ResponseEntity<ApiResponse<PlanResponse>> restorePlan(@PathVariable String code) {
        return ResponseEntity.ok(ApiResponse.ok(planService.restore(code)));
    }

    // ── Subscriptions ───────────────────────────────────────────────────────────────────────

    /**
     * {@code GET /api/v1/platform/subscriptions?status=&planCode=&trialEndingBefore=&renewingBefore=}
     *
     * <p>The cross-tenant register, and the honest replacement for a revenue dashboard: trials
     * ending, renewals due, scheduled changes pending, cancellations booked.
     *
     * <p>{@code tenantsWithoutSubscription} rides in the body and belongs on the screen. Without it
     * the list reads as "the fleet" while silently omitting every tenant that has no subscription —
     * which, until an operator assigns plans, is all of them.
     */
    @GetMapping("/subscriptions")
    public ResponseEntity<ApiResponse<SubscriptionRegisterResponse>> subscriptions(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String planCode,
            @RequestParam(required = false) Instant trialEndingBefore,
            @RequestParam(required = false) Instant renewingBefore,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return ResponseEntity.ok(ApiResponse.ok(subscriptionService.register(
            status, planCode, trialEndingBefore, renewingBefore, page, size)));
    }

    /**
     * One tenant's subscription.
     *
     * <p>An unknown tenant is 404. A known tenant with no subscription is <b>200 with
     * {@code subscription: null}</b> and a note explaining that its entitlements come from its tier.
     * On this screen those two answers mean opposite things and must not look the same.
     */
    @GetMapping("/tenants/{tenantId}/subscription")
    public ResponseEntity<ApiResponse<TenantSubscriptionResponse>> getSubscription(
            @PathVariable UUID tenantId) {
        return ResponseEntity.ok(ApiResponse.ok(subscriptionService.forTenant(tenantId)));
    }

    /**
     * Assign a plan, or move to a different one — now, or on a future date.
     *
     * <p>Refused with <b>409 SUBSCRIPTION_LIMIT_EXCEEDED</b> when the tenant measurably exceeds the
     * target plan's ceilings, naming each violated limit with the usage, unless {@code force} is
     * set. Only measurable dimensions can produce a refusal, and the limits endpoint below says
     * which those are — an empty violation list is not a statement that the tenant fits.
     */
    @PostMapping("/tenants/{tenantId}/subscription")
    public ResponseEntity<ApiResponse<TenantSubscriptionResponse>> assignPlan(
            @PathVariable UUID tenantId, @Valid @RequestBody AssignPlanRequest req) {
        return ResponseEntity.ok(ApiResponse.ok(
            subscriptionService.assignPlan(tenantId, req, requirePlatformPrincipal())));
    }

    /**
     * Cancel the subscription, immediately or on a date.
     *
     * <p><b>This does not cancel the TENANT.</b> No status change, no feature revocation, no ceiling
     * change — {@code POST /tenants/{id}/cancel} is the separate operation that takes a tenant out
     * of service, and conflating the two would let a commercial decision silently take a
     * restaurant's POS offline.
     */
    @PostMapping("/tenants/{tenantId}/subscription/cancel")
    public ResponseEntity<ApiResponse<TenantSubscriptionResponse>> cancelSubscription(
            @PathVariable UUID tenantId, @Valid @RequestBody CancelSubscriptionRequest req) {
        return ResponseEntity.ok(ApiResponse.ok(
            subscriptionService.cancel(tenantId, req, requirePlatformPrincipal())));
    }

    /**
     * Withdraw a scheduled plan change and/or a scheduled cancellation.
     *
     * <p>409 when nothing is scheduled, rather than a 200 no-op: an operator who believes they have
     * just called off a downgrade, and has not, will not check again.
     */
    @DeleteMapping("/tenants/{tenantId}/subscription/scheduled-change")
    public ResponseEntity<ApiResponse<TenantSubscriptionResponse>> cancelScheduledChange(
            @PathVariable UUID tenantId) {
        return ResponseEntity.ok(ApiResponse.ok(
            subscriptionService.cancelScheduled(tenantId, requirePlatformPrincipal())));
    }

    /**
     * Record a renewal an operator knows happened.
     *
     * <p>This exists because the scheduler must NOT roll the period forward on its own: advancing a
     * renewal date asserts that the tenant paid, and nothing in this product observes a payment. A
     * renewal is therefore an assertion, attributed to the operator who made it.
     */
    @PostMapping("/tenants/{tenantId}/subscription/renew")
    public ResponseEntity<ApiResponse<TenantSubscriptionResponse>> renewSubscription(
            @PathVariable UUID tenantId, @Valid @RequestBody RenewSubscriptionRequest req) {
        return ResponseEntity.ok(ApiResponse.ok(
            subscriptionService.renew(tenantId, req, requirePlatformPrincipal())));
    }

    /**
     * Every ceiling the tenant's plan declares, checked where checking is possible.
     *
     * <p>The response distinguishes WITHIN / EXCEEDED / NOT_MEASURABLE / UNREADABLE and carries a
     * reason for each, in the shape {@code PlatformDtos.UsageMeter} established: a limit nobody can
     * check must say so rather than render as a green tick, and {@code exceeded = 0} beside
     * {@code anyMeasurable = false} is a very different screen from {@code exceeded = 0} beside
     * {@code anyMeasurable = true}.
     */
    @GetMapping("/tenants/{tenantId}/subscription/limits")
    public ResponseEntity<ApiResponse<SubscriptionLimitReport>> subscriptionLimits(
            @PathVariable UUID tenantId) {
        return ResponseEntity.ok(ApiResponse.ok(subscriptionService.limits(tenantId)));
    }

    /**
     * The append-only trail: every plan move, tier change, trial expiry, renewal and cancellation,
     * newest first.
     *
     * <p>This is the half that did not exist. {@code tenants.tier} was a column an operator
     * overwrote with no record of the previous value anywhere in the product — no event, no
     * timestamp, and platform_db cannot reach audit_db.
     */
    @GetMapping("/tenants/{tenantId}/subscription/history")
    public ResponseEntity<ApiResponse<List<SubscriptionHistoryRecord>>> subscriptionHistory(
            @PathVariable UUID tenantId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        Page<SubscriptionHistoryRecord> result = subscriptionService.history(tenantId, page, size);
        // Same envelope and the same cursor-carries-the-page-number convention as
        // PlatformAdminController.paginate and AuditQueryController — one pager for every platform
        // list is worth more than a second one that fits marginally better.
        PageMeta meta = new PageMeta(
            new PageMeta.Page(
                String.valueOf(result.getNumber()),
                result.hasNext() ? String.valueOf(result.getNumber() + 1) : null,
                result.getSize()),
            result.getTotalElements());
        return ResponseEntity.ok(ApiResponse.paginated(result.getContent(), meta));
    }

    /**
     * The authenticated platform user's id, or a refusal.
     *
     * <p>Every write here lands in an append-only history row that names its actor, so the acting id
     * is taken from {@link JwtClaims#subject()} on the verified control-plane token and is never
     * read from a body field or a header. {@code PlatformAdminController.requirePlatformPrincipal}
     * takes the identical position for impersonation and states the reason: a repudiation control
     * whose subject can choose what it says is not a control.
     *
     * <p>With no resolvable principal the operation is REFUSED rather than attributed to nobody.
     * {@code chk_subscription_history_actor} would refuse the row anyway; failing here produces a
     * 403 an operator can read instead of a constraint violation they cannot.
     */
    private UUID requirePlatformPrincipal() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        Object principal = authentication != null ? authentication.getPrincipal() : null;
        if (principal instanceof JwtClaims claims && claims.subject() != null) {
            return claims.subject();
        }
        throw new PermissionDeniedException(
            "A subscription change requires an authenticated platform administrator; the acting id "
                + "is taken from the verified token and is never substituted");
    }
}
