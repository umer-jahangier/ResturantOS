package io.restaurantos.pos.web;

import io.restaurantos.pos.dto.ServiceChargeDtos.ServiceChargePolicyDto;
import io.restaurantos.pos.dto.ServiceChargeDtos.UpdateServiceChargeRequest;
import io.restaurantos.pos.service.ServiceChargeService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * A branch's service-charge policy (F20).
 *
 * <pre>
 * GET /api/v1/pos/branches/{branchId}/service-charge   pos.menu.view              read the rate
 * PUT /api/v1/pos/branches/{branchId}/service-charge   pos.service_charge.manage  set it
 * </pre>
 *
 * <p>The read and the write carry different codes on purpose — see
 * {@code PosAuthorizationService.requireServiceChargeManage}. The gates are declared here AND
 * asserted in the service, the same belt-and-braces every other pos admin surface uses: the
 * annotation is what a reader of the route sees, and the service check is what survives being
 * called from a consumer or a test that bypasses MVC.
 *
 * <p>Branch-scoped in the path rather than taken from the token, because a tenant admin
 * administering two branches switches between them on one screen, and because a rate applied to
 * the wrong dining room is a mistake that shows up on guests' bills before it shows up anywhere
 * else.
 */
@RestController
@RequestMapping("/api/v1/pos/branches/{branchId}/service-charge")
@RequiresFeature("FEATURE_POS")
public class ServiceChargeController {

    private final ServiceChargeService serviceChargeService;

    public ServiceChargeController(ServiceChargeService serviceChargeService) {
        this.serviceChargeService = serviceChargeService;
    }

    @PreAuthorize("hasAuthority('pos.menu.view')")
    @GetMapping
    public ResponseEntity<ApiResponse<ServiceChargePolicyDto>> get(@PathVariable UUID branchId) {
        return ResponseEntity.ok(ApiResponse.ok(serviceChargeService.get(branchId)));
    }

    @PreAuthorize("hasAuthority('pos.service_charge.manage')")
    @PutMapping
    public ResponseEntity<ApiResponse<ServiceChargePolicyDto>> update(
            @PathVariable UUID branchId,
            @Valid @RequestBody UpdateServiceChargeRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(serviceChargeService.update(branchId, request)));
    }
}
