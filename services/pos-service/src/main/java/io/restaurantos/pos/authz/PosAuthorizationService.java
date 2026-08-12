package io.restaurantos.pos.authz;

import io.restaurantos.shared.authz.AuthorizationService;
import io.restaurantos.shared.authz.OpaInput;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.security.JwtClaims;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * POS-specific authorization wrapper around the shared OPA client.
 * All OPA evaluations are fail-closed: any exception → deny (PermissionDeniedException).
 */
@Service
public class PosAuthorizationService {

    private static final Logger log = LoggerFactory.getLogger(PosAuthorizationService.class);

    /**
     * The token attribute carrying a caller's menu-category scope (Program A).
     *
     * <p>Written by auth-service's {@code PermissionResolver.MENU_CATEGORY_SCOPE_CLAIM} and read
     * here straight off the verified token — no cross-service call, no projection table, no consumer
     * that can silently drop a message.
     *
     * <p>The spelling is the contract between two services and a policy file. It is a constant on
     * both sides so a rename cannot leave them disagreeing, which would not throw — it would
     * silently hand every confined cashier the whole menu back.
     */
    private static final String MENU_CATEGORY_SCOPE_CLAIM = "menu_categories";

    private final AuthorizationService authorizationService;

    public PosAuthorizationService(AuthorizationService authorizationService) {
        this.authorizationService = authorizationService;
    }

    /**
     * What menu categories the CURRENT caller may see on the grid (Program A).
     *
     * <p>Read from the signature-verified token's {@code attributes} map and from nowhere else.
     * Never from a query parameter, a header or a request body — the reason
     * {@code KdsAuthorizationService} gives for its station scope applies verbatim, and applies with
     * more force here because this scope has a boundary attached: a scope a client can assert is not
     * a scope, it is a suggestion.
     *
     * <p><b>This narrows the GRID only.</b> The refusal is {@link #authorizeAddItem}. See
     * {@link MenuCategoryScope} for why the two are not duplicates of one control, and why every
     * degenerate input here degrades to unrestricted.
     */
    public MenuCategoryScope resolveMenuCategoryScope() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof JwtClaims claims)) {
            // No principal at all. Unrestricted: the grid endpoints are @PreAuthorize-gated on
            // pos.menu.view, so a missing principal here is a filter-chain fault rather than an
            // anonymous request, and emptying the menu is not the right way to report one.
            return MenuCategoryScope.unrestricted();
        }
        Map<String, Object> attributes = claims.attributes();
        if (attributes == null || !attributes.containsKey(MENU_CATEGORY_SCOPE_CLAIM)) {
            // The overwhelmingly common case: no assignment, sees the whole menu. This is the state
            // every user in the product is in today and it must stay the do-nothing default.
            return MenuCategoryScope.unrestricted();
        }
        Object raw = attributes.get(MENU_CATEGORY_SCOPE_CLAIM);
        if (!(raw instanceof Collection<?> collection)) {
            log.warn("Menu category scope attribute '{}' is a {} rather than a list — treating the "
                    + "caller as unrestricted. The grid keeps working; the token is wrong.",
                MENU_CATEGORY_SCOPE_CLAIM, raw == null ? "null" : raw.getClass().getSimpleName());
            return MenuCategoryScope.unrestricted();
        }
        List<UUID> ids = new ArrayList<>();
        for (Object entry : collection) {
            if (entry instanceof UUID id) {
                ids.add(id);
            } else if (entry instanceof String s) {
                try {
                    ids.add(UUID.fromString(s));
                } catch (IllegalArgumentException e) {
                    // Dropped, not fatal, and NOT silently: an id that is not a UUID cannot match
                    // any category, so keeping it would only make the scope look larger than it is.
                    log.warn("Menu category scope contains an entry that is not a UUID — ignoring it");
                }
            } else if (entry != null) {
                log.warn("Menu category scope contains a non-string entry ({}) — ignoring it",
                    entry.getClass().getSimpleName());
            }
        }
        // An empty result here means the attribute was present but said nothing usable. Still
        // unrestricted, matching pos.rego exactly: an empty allow-list has no legitimate meaning,
        // and reading one as "permitted: nothing" is what turns a malformed token into an empty
        // till grid. restrictedTo() collapses it for us.
        return MenuCategoryScope.restrictedTo(ids);
    }

    /**
     * Authorize a void operation.
     *
     * <p>{@code pos.rego}'s {@code void.own} rule reads THREE facts about the resource —
     * {@code status}, {@code amount_paid_paisa} and {@code any_line_plated}: a cashier may write
     * off their own check while it is non-terminal, carries no tender, and the kitchen has plated
     * nothing on it. All three are therefore sent, and each must be the real measured value —
     * passing a hard-coded {@code 0} or {@code false} would turn the corresponding clause into a
     * decoration. {@code void.any} reads none of them.
     *
     * <p><b>Why {@code anyLinePlated} is a separate argument rather than read off {@code status}.</b>
     * It cannot be derived from either status field. {@code OrderStatus} declares PARTIAL_READY,
     * READY and SERVED but pos-service never writes them — the kitchen-progress meaning of that
     * column was retired in {@code fc6f389f}, so a fired check sits at SENT_TO_KDS from the fryer
     * to the table. {@code derivedStatus} collapses READY into IN_PROGRESS and only breaks out
     * served. The caller therefore computes it from the line statuses via
     * {@code OrderStatusDerivationService.anyLinePlated}.
     *
     * @param orderId         target order
     * @param tenantId        order's tenant
     * @param branchId        order's branch
     * @param createdBy       original cashier who created the order
     * @param status          current order status — the settlement lifecycle, NOT kitchen progress
     * @param amountPaidPaisa money already recorded against the order, summed over its payment
     *                        rows (refunds are negative rows, so a fully reversed order nets to 0)
     * @param anyLinePlated   whether any non-cancelled line has reached READY or SERVED, i.e.
     *                        whether cooked food exists on this check
     */
    public void authorizeVoid(UUID orderId, UUID tenantId, UUID branchId, UUID createdBy,
                              String status, long amountPaidPaisa, boolean anyLinePlated) {
        OpaInput.Resource resource = new OpaInput.Resource(
                "order", orderId, tenantId, branchId, createdBy, status, null, amountPaidPaisa,
                anyLinePlated);
        authorizationService.authorize("pos", "void", resource);
    }

    /**
     * Authorize adding ONE menu item to a check — the per-user menu-category boundary (Program A).
     *
     * <p><b>This is a hard boundary, not a filter.</b> The user's requirement was that the server
     * REFUSE an item outside the operator's assigned categories; hiding the button was explicitly
     * ruled insufficient. {@code MenuCategoryScope} narrows the grid so a cashier is not shown a
     * tile that would 403, and that is all it does — the refusal lives here and in {@code pos.rego},
     * and it holds for a caller that never opened the grid.
     *
     * <p><b>{@code categoryId} must come from the server-resolved item and never from the request.</b>
     * {@code OrderServiceImpl.addItem} calls this after {@code menuItemRepository.findByIdAndTenantId}
     * has produced the {@code MenuItem}, so the category is the one the catalogue says the item is
     * in. Taking it off {@code AddOrderItemRequest} would let the caller nominate a category it is
     * allowed and then ring an item from one it is not — the boundary would read correctly and
     * enforce nothing, which is the exact defect this program exists to close.
     *
     * <p><b>Why the category and not the terminal.</b> Nothing signed says which terminal a caller
     * is: there is no user→terminal table, no terminal claim and no {@code orders.terminal_id}, so a
     * terminal id could only ever be client-asserted. {@code pos.rego} carries the full argument.
     *
     * <p>Fail-closed like every other call here: an OPA outage becomes "cannot add items". That is
     * the same trade {@code authorizeVoid} makes, and it is a heavier one — a void is rare and this
     * is the hottest write path on the till.
     *
     * @param orderId    the check being added to
     * @param tenantId   the ORDER's tenant
     * @param branchId   the ORDER's branch — compared against the caller's verified JWT branch
     * @param createdBy  the check's original cashier; unread by this action's rules, sent for
     *                   symmetry with the rest of the module
     * @param status     the order's settlement status; likewise unread here
     * @param categoryId the resolved {@code MenuItem}'s category, the fact the rule tests
     */
    public void authorizeAddItem(UUID orderId, UUID tenantId, UUID branchId, UUID createdBy,
                                 String status, UUID categoryId) {
        OpaInput.Resource resource = new OpaInput.Resource(
                "order", orderId, tenantId, branchId, createdBy, status, null, null, null,
                categoryId);
        authorizationService.authorize("pos", "pos.order.add_item", resource);
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
