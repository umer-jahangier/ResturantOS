package io.restaurantos.pos.authz;

import io.restaurantos.shared.authz.AuthorizationService;
import io.restaurantos.shared.authz.OpaInput;
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
}
