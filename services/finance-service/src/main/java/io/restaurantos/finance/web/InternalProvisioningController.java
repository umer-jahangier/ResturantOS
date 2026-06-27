package io.restaurantos.finance.web;

import io.restaurantos.finance.dto.ProvisionRequest;
import io.restaurantos.finance.dto.ProvisioningResult;
import io.restaurantos.finance.service.ProvisioningService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/internal")
public class InternalProvisioningController {

    private final ProvisioningService provisioningService;

    public InternalProvisioningController(ProvisioningService provisioningService) {
        this.provisioningService = provisioningService;
    }

    @PostMapping("/tenants/{tenantId}/provision")
    public ResponseEntity<ProvisioningResult> provision(
            @PathVariable UUID tenantId,
            @Valid @RequestBody ProvisionRequest request) {
        ProvisioningResult result = provisioningService.provision(
                tenantId,
                request.fiscalYear() != null ? request.fiscalYear() : java.time.Year.now().getValue()
        );
        return ResponseEntity.ok(result);
    }
}
