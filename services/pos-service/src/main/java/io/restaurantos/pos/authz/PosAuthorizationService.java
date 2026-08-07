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
     * @param orderId   target order
     * @param tenantId  order's tenant
     * @param branchId  order's branch
     * @param createdBy original cashier who created the order
     * @param status    current order status
     */
    public void authorizeVoid(UUID orderId, UUID tenantId, UUID branchId, UUID createdBy, String status) {
        OpaInput.Resource resource = new OpaInput.Resource(
                "order", orderId, tenantId, branchId, createdBy, status, null);
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
}
