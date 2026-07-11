package io.restaurantos.purchasing.web;

import io.restaurantos.purchasing.config.InventoryIntegrationProperties;
import io.restaurantos.purchasing.dto.MockReceiveRequest;
import io.restaurantos.purchasing.dto.MockReceiveResponse;
import io.restaurantos.purchasing.service.GrnReceiptSimulator;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/purchasing/purchase-orders")
@RequiresFeature("FEATURE_VENDOR")
public class MockGrnController {

    private final GrnReceiptSimulator grnReceiptSimulator;
    private final InventoryIntegrationProperties integrationProperties;

    public MockGrnController(GrnReceiptSimulator grnReceiptSimulator,
                               InventoryIntegrationProperties integrationProperties) {
        this.grnReceiptSimulator = grnReceiptSimulator;
        this.integrationProperties = integrationProperties;
    }

    @PostMapping("/{poId}/mock-receive")
    public ApiResponse<MockReceiveResponse> mockReceive(
            @PathVariable UUID poId,
            @Valid @RequestBody MockReceiveRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        if (!integrationProperties.isMockMode()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return ApiResponse.ok(grnReceiptSimulator.simulateReceive(poId, request, idempotencyKey));
    }
}
