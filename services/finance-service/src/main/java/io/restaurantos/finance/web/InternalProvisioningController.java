package io.restaurantos.finance.web;

import io.restaurantos.finance.config.InternalTenantContextHelper;
import io.restaurantos.finance.dto.ProvisionRequest;
import io.restaurantos.finance.dto.ProvisioningResult;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/internal")
public class InternalProvisioningController {

    private final ProvisioningService provisioningService;
    private final InternalTenantContextHelper tenantHelper;

    public InternalProvisioningController(ProvisioningService provisioningService,
                                           InternalTenantContextHelper tenantHelper) {
        this.provisioningService = provisioningService;
        this.tenantHelper = tenantHelper;
    }

    @PostMapping("/tenants/{tenantId}/provision")
    public ResponseEntity<ApiResponse<ProvisioningResult>> provision(
            @PathVariable UUID tenantId,
            @Valid @RequestBody(required = false) ProvisionRequest request) {
        int fiscalYear = request != null && request.fiscalYear() != null
                ? request.fiscalYear()
                : java.time.Year.now().getValue();
        tenantHelper.activate(tenantId);
        try {
            return ResponseEntity.ok(ApiResponse.ok(provisioningService.provision(tenantId, fiscalYear)));
        } finally {
            tenantHelper.clear();
        }
    }

    /** Platform-admin saga contract (Doc 4 §4.2). */
    @PostMapping("/finance/tenants/{tenantId}/seed-coa")
    public ResponseEntity<ApiResponse<Map<String, Object>>> seedCoa(@PathVariable UUID tenantId) {
        int fiscalYear = java.time.Year.now().getValue();
        tenantHelper.activate(tenantId);
        try {
            ProvisioningResult result = provisioningService.provision(tenantId, fiscalYear);
            return ResponseEntity.ok(ApiResponse.ok(Map.of(
                    "accountsSeeded", result.accountsSeeded(),
                    "periodsSeeded", result.periodsSeeded())));
        } finally {
            tenantHelper.clear();
        }
    }
}
