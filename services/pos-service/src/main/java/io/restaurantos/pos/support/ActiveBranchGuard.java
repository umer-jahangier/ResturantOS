package io.restaurantos.pos.support;

import io.restaurantos.pos.feign.UserBranchClient;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * Refuses work on a branch the business has retired.
 *
 * <h3>The promise this exists to make true</h3>
 *
 * <p>The Branches screen's deactivate dialog says, verbatim: <i>"It leaves everyone's branch
 * switcher, so nobody can take an order or start a till there."</i> The first clause was true —
 * {@code BranchService.listMine} drops inactive branches. The second was enforced nowhere.
 *
 * <p>Measured against the live stack on 2026-08-12, before this class existed: create a branch,
 * switch onto it, deactivate it while standing on it, then
 * {@code POST /api/v1/pos/tills} → <b>201</b> and {@code POST /api/v1/pos/orders} → <b>201</b>.
 * {@code TillServiceImpl.requireOwnBranch} and {@code OrderServiceImpl.requireOwnBranch} both
 * compare the request's branchId against the JWT's branch claim, which answers "is this YOUR
 * branch" and never asks "is this branch open".
 *
 * <h3>Why this is still needed once auth-service refuses the switch</h3>
 *
 * <p>{@code BranchSwitchService} now refuses to mint a token for a deactivated branch, so no NEW
 * session can arrive on one. That does not close the path: a session that was already standing on
 * the branch at the moment it was deactivated keeps a valid, signature-correct token naming it for
 * the rest of the access TTL — and {@code POST /auth/refresh} re-mints that same branch from
 * {@code refresh_sessions.branch_id} on every page load, so the state can persist indefinitely. The
 * branch is the thing that is closed; the check belongs where the work is attempted.
 *
 * <h3>Fail CLOSED, and what that costs</h3>
 *
 * <p>An unverifiable branch takes no orders. When user-service cannot be reached, this guard
 * refuses — which means a user-service outage stops order creation and till opening fleet-wide.
 * That cost is real and is named here rather than discovered later:
 *
 * <ul>
 *   <li>The alternative — allow on lookup failure — makes the guard silently absent exactly when
 *       something is already wrong. A control that evaporates under load is the failure mode this
 *       codebase has found eight times over; it is not a safe default, it is a hidden one.</li>
 *   <li>{@code FinancePeriodClient} in this same service is already fail-closed at settlement, for
 *       the same reason in different words: some writes are worse than a refusal. Revenue booked
 *       against a branch that appears on no report and in no reconciliation is one of them.</li>
 *   <li>This is deliberately NOT the policy of {@link UserBranchClient#getBranch}, which the
 *       receipt path consumes fail-soft. A cashier holding a customer's money must not be blocked
 *       by a formatting lookup. Refusing to <i>start</i> a check is a different moment from
 *       refusing to <i>finish</i> one.</li>
 * </ul>
 *
 * <p><b>Not cached, on purpose.</b> A positive cache would give a just-deactivated branch a
 * TTL-long grace period in which the dialog's promise is false again — a smaller version of the
 * defect, on a timer, and one no test would catch. If the per-order lookup proves too costly under
 * measurement, add a short-TTL cache <i>with</i> an invalidation path from the deactivate action;
 * do not add one without.
 */
@Component
public class ActiveBranchGuard {

    private static final Logger log = LoggerFactory.getLogger(ActiveBranchGuard.class);

    /**
     * Distinct from the bare {@code STATE_INVALID} so a screen can tell this refusal from every
     * other 409 and say the one thing that helps: the branch was deactivated, reactivate it or work
     * somewhere else.
     */
    public static final String CODE = "BRANCH_DEACTIVATED";

    private final UserBranchClient userBranchClient;
    private final TenantContext tenantContext;

    public ActiveBranchGuard(UserBranchClient userBranchClient, TenantContext tenantContext) {
        this.userBranchClient = userBranchClient;
        this.tenantContext = tenantContext;
    }

    /**
     * @param branchId the branch the caller wants to work on — already verified to be the caller's
     *                 own JWT branch by the caller's {@code requireOwnBranch}. This method answers
     *                 the other question.
     * @throws StateInvalidException (409, code {@link #CODE}) if the branch is not a live, active
     *                               branch, or if that could not be established.
     */
    public void requireActive(UUID branchId) {
        if (branchId == null) {
            throw new StateInvalidException(CODE, "No branch on this request.");
        }
        UUID tenantId = tenantContext.requireTenantId();

        UserBranchClient.BranchStatus status;
        try {
            status = userBranchClient.getBranchStatus(branchId, tenantId);
        } catch (RuntimeException e) {
            // Includes user-service's 404 for a soft-deleted branch (a real answer, meaning the
            // branch is gone) and every transport failure (no answer). Both refuse; only the log
            // distinguishes them, because only an operator can act on the difference.
            log.warn("Branch {} could not be verified as active ({}); refusing the operation",
                    branchId, e.toString());
            throw new StateInvalidException(CODE, refusal());
        }

        // Boolean, not boolean: a response with no "active" key is absent authority, not permission.
        if (status == null || !Boolean.TRUE.equals(status.active()) || Boolean.TRUE.equals(status.deleted())) {
            log.info("Refusing work on branch {}: not a live active branch ({})", branchId, status);
            throw new StateInvalidException(CODE, refusal());
        }
    }

    private static String refusal() {
        return "This branch has been deactivated. Switch to an active branch, or reactivate it from"
                + " Branches, before taking orders or opening a till here.";
    }
}
