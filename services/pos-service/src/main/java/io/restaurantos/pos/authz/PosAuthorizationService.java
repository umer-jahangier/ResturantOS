package io.restaurantos.pos.authz;

import io.restaurantos.shared.authz.AuthorizationService;
import io.restaurantos.shared.authz.OpaInput;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.security.JwtClaims;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * POS-specific authorization wrapper around the shared OPA client.
 * All OPA evaluations are fail-closed: any exception → deny (PermissionDeniedException).
 */
@Service
public class PosAuthorizationService {

    private final AuthorizationService authorizationService;

    public PosAuthorizationService(AuthorizationService authorizationService) {
        this.authorizationService = authorizationService;
    }

    /**
     * Authorize a void operation.
     *
     * <p>{@code pos.rego}'s {@code void.own} rule reads BOTH {@code status} and
     * {@code amount_paid_paisa}: a cashier may write off their own check while it is DRAFT, OPEN
     * or SENT_TO_KDS and carries no tender. Both are therefore sent, and
     * {@code amountPaidPaisa} must be the real figure — passing a hard-coded 0 would turn the
     * policy's money clause into a decoration. {@code void.any} reads neither.
     *
     * @param orderId         target order
     * @param tenantId        order's tenant
     * @param branchId        order's branch
     * @param createdBy       original cashier who created the order
     * @param status          current order status
     * @param amountPaidPaisa money already recorded against the order, summed over its payment
     *                        rows (refunds are negative rows, so a fully reversed order nets to 0)
     */
    public void authorizeVoid(UUID orderId, UUID tenantId, UUID branchId, UUID createdBy,
                              String status, long amountPaidPaisa) {
        OpaInput.Resource resource = new OpaInput.Resource(
                "order", orderId, tenantId, branchId, createdBy, status, null, amountPaidPaisa);
        authorizationService.authorize("pos", "void", resource);
    }

    /**
     * Authorize a refund operation.
     * The rego checks approval_limit_paisa >= resource.amount_paisa.
     *
     * @param orderId      target order
     * @param tenantId     order's tenant
     * @param branchId     order's branch
     * @param createdBy    original cashier
     * @param status       current order status
     * @param refundPaisa  amount being refunded (checked against approval_limit_paisa in rego)
     */
    public void authorizeRefund(UUID orderId, UUID tenantId, UUID branchId, UUID createdBy,
                                String status, long refundPaisa) {
        OpaInput.Resource resource = new OpaInput.Resource(
                "order", orderId, tenantId, branchId, createdBy, status, refundPaisa);
        authorizationService.authorize("pos", "pos.order.refund", resource);
    }

    /**
     * Authorize an ORDER-scope discount — {@code pos.rego}'s {@code pos.order.discount.override}
     * rule, a dead letter until phase 18b.
     *
     * <p>Bound to ORDER scope, not to every discount. {@code pos.order.discount.override} is held
     * by OWNER, MANAGER and TENANT_ADMIN — exactly the roles that already hold
     * {@code pos.order.discount.order}, and NOT by CASHIER, who holds
     * {@code pos.order.discount.line}. Calling this on every discount would therefore have stopped
     * cashiers applying line discounts, which is a working feature; binding it to the whole-order
     * discount adds the policy's tenant/branch and resource test to the manager-level action
     * without withdrawing anything anyone can do today.
     */
    public void authorizeDiscountOverride(UUID orderId, UUID tenantId, UUID branchId,
                                          UUID createdBy, String status) {
        OpaInput.Resource resource = new OpaInput.Resource(
                "order", orderId, tenantId, branchId, createdBy, status, null);
        authorizationService.authorize("pos", "pos.order.discount.override", resource);
    }

    /**
     * Authorize a bill split — {@code pos.rego}'s {@code pos.order.split_bill} rule, also a dead
     * letter until phase 18b (the endpoint was {@code @PreAuthorize}-gated only).
     */
    public void authorizeSplitBill(UUID orderId, UUID tenantId, UUID branchId,
                                   UUID createdBy, String status) {
        OpaInput.Resource resource = new OpaInput.Resource(
                "order", orderId, tenantId, branchId, createdBy, status, null);
        authorizationService.authorize("pos", "pos.order.split_bill", resource);
    }

    /**
     * Local (non-OPA) check of the current JWT's {@code permissions} claim — used to gate
     * own-vs-all-branch VIEW scoping (POS-09/POS-10), which is a fast read-path decision, not
     * an OPA-evaluated action (pos.rego has no "view" rule; void/refund/discount/split-bill
     * are the only rego-gated actions today). Returns {@code false} (fail-closed to the
     * narrower own-orders-only scope) if no authenticated {@link JwtClaims} principal is
     * present.
     */
    public boolean hasPermission(String permission) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof JwtClaims claims)) {
            return false;
        }
        return claims.permissions() != null && claims.permissions().contains(permission);
    }

    /**
     * Menu write gate (create/update/activate/deactivate/delete item or category). A plain
     * claims check like {@link #hasPermission}, not an OPA rule — there is no resource-scoped
     * nuance here (no owner-vs-any, no approval limit) the way void/refund/discount have; it is
     * a flat tenant-level permission, same shape as {@code inventory.item.manage}.
     */
    public void requireMenuManage() {
        if (!hasPermission("pos.menu.manage")) {
            throw new PermissionDeniedException("Requires pos.menu.manage");
        }
    }

    /**
     * Menu READ gate. Held by everyone who works a till — the same code the menu grid uses.
     */
    public void requireMenuView() {
        if (!hasPermission("pos.menu.view")) {
            throw new PermissionDeniedException("Requires pos.menu.view");
        }
    }

    /**
     * SALES-TAX CATALOGUE gate — define, re-rate, retire the rates the whole menu is priced
     * against (F16).
     *
     * <p>Its own code, not {@code pos.menu.manage}, and the split is on the merits rather than on
     * convenience. Deciding that a dish is standard-rated is menu work: a manager classifying a new
     * curry does it a dozen times a week, and {@code pos.menu.manage} — which MANAGER holds —
     * already governs it, both for assigning a class and for the per-item custom rate that has been
     * editable since S0-03. Deciding that "standard rate" MEANS 17% is not menu work: it is a
     * statutory fact about the business, it is wrong for every dish at once when it is wrong, and
     * it mis-states the tax return rather than one bill. That belongs with the person who signs the
     * return.
     *
     * <p>Held by OWNER and TENANT_ADMIN — the same two personas {@code /app/settings} already
     * admits, and the same holder set changesets 089 and 090 chose for the same reason. This is not
     * a widening of anything: before F16 there was no screen at all, and no role could set a rate
     * except one item at a time.
     *
     * <p>Phase 19b established the precedent (see {@link #requireTablesAdmin}) — verbs that share a
     * noun and nothing else do not share a permission.
     */
    public void requireTaxManage() {
        if (!hasPermission("pos.tax.manage")) {
            throw new PermissionDeniedException("Requires pos.tax.manage");
        }
    }

    /**
     * SERVICE-CHARGE gate — decide that every dine-in bill at this branch grows by a percentage
     * (F20).
     *
     * <p>Its own code, for the same reason {@link #requireTaxManage} has one. The neighbouring
     * codes are each wrong on their own terms:
     *
     * <ul>
     *   <li>{@code pos.menu.manage} prices ONE dish and is held by MANAGER. A service charge
     *       re-prices every check in the building at once, including checks already open.</li>
     *   <li>{@code pos.tax.manage} is the statutory rate. A service charge is not a tax — it is
     *       the restaurant's own money, credited to its own revenue account, and calling it a tax
     *       to reuse a permission would put a commercial decision behind a fiscal one.</li>
     *   <li>{@code pos.order.discount.*} moves money on one check with a reason attached. This
     *       moves it on all of them, silently, until somebody changes it back.</li>
     * </ul>
     *
     * <p>Held by OWNER and TENANT_ADMIN — the same two personas {@code /app/settings} already
     * admits and the same holder set changeset 091 chose. A branch MANAGER is deliberately left
     * able to READ the policy ({@code ServiceChargeServiceImpl.get} gates on
     * {@code pos.menu.view}): the charge is on every bill they hand a guest, and a manager who
     * cannot look up the rate is being asked to defend a number the product hides from them.
     *
     * <p>This widens nothing. Before F20 no role could set a service charge, because no screen and
     * no endpoint existed that could — measured live: {@code service_charge_paisa} was 0 on all
     * 195 orders in pos_db.
     */
    public void requireServiceChargeManage() {
        if (!hasPermission("pos.service_charge.manage")) {
            throw new PermissionDeniedException("Requires pos.service_charge.manage");
        }
    }

    /**
     * Dining-table CATALOGUE gate — create, rename, re-capacity, retire, reactivate (19b-01).
     *
     * <p>Deliberately NOT {@code pos.tables.manage}, which already exists and which
     * <strong>WAITER holds</strong> (changeset 055, on purpose: "Without it a waiter cannot seat
     * a table or attach an order to one"). The two verbs only look alike:
     *
     * <ul>
     *   <li>{@code pos.tables.manage} — seat/release a table, attach an order. Runtime service
     *       state, needed by everyone working the floor.</li>
     *   <li>{@code pos.tables.admin} — decide which tables the restaurant HAS. Catalogue state,
     *       needed by whoever lays out the floor, and by nobody else.</li>
     * </ul>
     *
     * <p>Reusing the existing code would have handed every waiter the ability to rename and
     * retire the restaurant's tables mid-shift. Held by OWNER, TENANT_ADMIN and MANAGER; see
     * changeset 083.
     */
    public void requireTablesAdmin() {
        if (!hasPermission("pos.tables.admin")) {
            throw new PermissionDeniedException("Requires pos.tables.admin");
        }
    }

    /**
     * POS TERMINAL PROFILE gate — create, rename, re-scope, retire, reactivate (28-04, D-28-03).
     *
     * <p>Its own code, not {@code pos.menu.manage}. A terminal is not a menu: deciding how many
     * tills a branch runs and what each one offers is a different decision, made at a different
     * time, by the same person who lays out the floor. Phase 19b established the precedent when it
     * separated {@code pos.tables.admin} from {@code pos.tables.manage} — verbs that share a noun
     * and nothing else do not share a permission.
     *
     * <p>Held by OWNER, TENANT_ADMIN and MANAGER; see auth changeset 085, which also fails the
     * migration if the grant lands on zero roles. CASHIER and WAITER hold neither this nor anything
     * that implies it: a cashier USES a terminal and does not get to re-scope the menu it offers.
     */
    public void requireTerminalsAdmin() {
        if (!hasPermission("pos.terminals.admin")) {
            throw new PermissionDeniedException("Requires pos.terminals.admin");
        }
    }
}
