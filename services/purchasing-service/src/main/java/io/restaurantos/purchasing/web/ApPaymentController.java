package io.restaurantos.purchasing.web;

import io.restaurantos.purchasing.dto.ApPaymentDto;
import io.restaurantos.purchasing.dto.CreateApPaymentRequest;
import io.restaurantos.purchasing.service.ApPaymentService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/purchasing/payments")
@RequiresFeature("FEATURE_VENDOR")
public class ApPaymentController {

    private final ApPaymentService apPaymentService;

    public ApPaymentController(ApPaymentService apPaymentService) {
        this.apPaymentService = apPaymentService;
    }

    @PostMapping
    public ApiResponse<ApPaymentDto> create(
            @Valid @RequestBody CreateApPaymentRequest req,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return ApiResponse.ok(apPaymentService.create(req, idempotencyKey));
    }
}
