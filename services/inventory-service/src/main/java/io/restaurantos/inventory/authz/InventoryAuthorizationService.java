package io.restaurantos.inventory.authz;

import io.restaurantos.shared.authz.AuthorizationService;
import io.restaurantos.shared.authz.OpaInput;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * Inventory-specific OPA authorization wrapper. Fail-closed: any exception → deny.
 * Evaluates the "inventory" OPA module (policies/restaurantos/inventory.rego) with the
 * appropriate action and resource.
 */
@Service
public class InventoryAuthorizationService {

    private final AuthorizationService authorizationService;

    public InventoryAuthorizationService(AuthorizationService authorizationService) {
        this.authorizationService = authorizationService;
    }

    public void authorizeView(UUID tenantId, UUID branchId) {
        OpaInput.Resource resource = new OpaInput.Resource(
                "inventory_item", null, tenantId, branchId, null, null, null);
        authorizationService.authorize("inventory", "inventory.item.view", resource);
    }

    public void authorizeManage(UUID tenantId, UUID branchId) {
        OpaInput.Resource resource = new OpaInput.Resource(
                "inventory_item", null, tenantId, branchId, null, null, null);
        authorizationService.authorize("inventory", "inventory.item.manage", resource);
    }
}
