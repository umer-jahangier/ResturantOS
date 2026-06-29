package io.restaurantos.pos.web;

import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.dto.CloseOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.pos.service.SplitTenderCalculator;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/pos/orders")
@RequiresFeature("FEATURE_POS")
public class PaymentController {

    private final PaymentService paymentService;
    private final OrderService orderService;
    private final SplitTenderCalculator splitTenderCalculator;

    public PaymentController(PaymentService paymentService,
                             OrderService orderService,
                             SplitTenderCalculator splitTenderCalculator) {
        this.paymentService = paymentService;
        this.orderService = orderService;
        this.splitTenderCalculator = splitTenderCalculator;
    }

    record RecordPaymentRequest(
            @NotNull PaymentMethod method,
            @NotNull Long amountPaisa,
            String referenceNo
    ) {}

    @PostMapping("/{id}/payments")
    public ResponseEntity<ApiResponse<Long>> recordPayment(
            @PathVariable UUID id,
            @Valid @RequestBody RecordPaymentRequest request) {
        long total = paymentService.recordPayment(id, request.method(), request.amountPaisa(), request.referenceNo());
        return ResponseEntity.ok(ApiResponse.ok(total));
    }

    @PostMapping("/{id}/close")
    public ResponseEntity<ApiResponse<OrderDto>> closeOrder(
            @PathVariable UUID id,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody CloseOrderRequest request) {
        OrderDto dto = orderService.closeOrder(id, request, idempotencyKey);
        return ResponseEntity.ok(ApiResponse.ok(dto));
    }

    record SplitPreviewRequest(
            @NotNull Long totalPaisa,
            @NotNull Integer diners
    ) {}

    @PostMapping("/{id}/split")
    public ResponseEntity<ApiResponse<List<Long>>> splitPreview(
            @PathVariable UUID id,
            @Valid @RequestBody SplitPreviewRequest request) {
        List<Long> shares = splitTenderCalculator.equalSplit(request.totalPaisa(), request.diners());
        return ResponseEntity.ok(ApiResponse.ok(shares));
    }
}
