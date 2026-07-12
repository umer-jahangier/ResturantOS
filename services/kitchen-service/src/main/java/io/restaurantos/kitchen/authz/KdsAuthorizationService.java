package io.restaurantos.kitchen.authz;

import io.restaurantos.shared.authz.AuthorizationService;
import io.restaurantos.shared.authz.OpaInput;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * KDS-specific OPA authorization wrapper. Fail-closed: any exception → deny.
 * Evaluates the "kds" OPA module with the appropriate action and resource.
 */
@Service
public class KdsAuthorizationService {

    private final AuthorizationService authorizationService;

    public KdsAuthorizationService(AuthorizationService authorizationService) {
        this.authorizationService = authorizationService;
    }

    public void authorizeView(UUID tenantId, UUID branchId) {
        OpaInput.Resource resource = new OpaInput.Resource(
                "kds_board", null, tenantId, branchId, null, null, null);
        authorizationService.authorize("kds", "pos.kds.view", resource);
    }

    public void authorizeUpdate(UUID tenantId, UUID branchId) {
        OpaInput.Resource resource = new OpaInput.Resource(
                "kds_ticket", null, tenantId, branchId, null, null, null);
        authorizationService.authorize("kds", "pos.kds.update", resource);
    }
}
