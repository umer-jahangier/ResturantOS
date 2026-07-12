package io.restaurantos.pos.web;

import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.dto.OrderPaymentDto;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.pos.service.SplitTenderCalculator;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/pos/orders")
@RequiresFeature("FEATURE_POS")
public class PaymentController {

    private final PaymentService paymentService;
    private final SplitTenderCalculator splitTenderCalculator;

    public PaymentController(PaymentService paymentService,
                             SplitTenderCalculator splitTenderCalculator) {
        this.paymentService = paymentService;
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

    @GetMapping("/{id}/payments")
    public ResponseEntity<ApiResponse<List<OrderPaymentDto>>> listPayments(
            @PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(paymentService.listPayments(id)));
    }

    /**
     * RETIRED (D-08 / POS-23 / SC4, plan 07.3-11): this endpoint used to close an order on
     * exact-tender-sum validation alone, bypassing the Paid-AND-Served invariant and never
     * persisting {@code OrderPayment} rows — corrupting the paymentStatus/amountPaidPaisa
     * settlement read model. It is retired to HTTP 410 Gone and calls no service. Record
     * tenders via {@code POST /{id}/payments}; the order auto-closes once it is fully Paid
     * AND fully Served via the {@code maybeCloseOrder} seam.
     */
    @PostMapping("/{id}/close")
    public ResponseEntity<ApiResponse<Void>> closeOrder(@PathVariable UUID id) {
        ApiResponse<Void> body = new ApiResponse<>(null, null, List.of(new ApiResponse.ApiWarning(
                "ENDPOINT_RETIRED",
                "POST /orders/{id}/close is retired. Record tenders via POST /api/v1/pos/orders/{id}/payments; "
                        + "the order auto-closes once it is fully Paid AND fully Served.")));
        return ResponseEntity.status(HttpStatus.GONE)
                .header("Deprecation", "true")
                .header("Sunset", "Wed, 31 Dec 2025 23:59:59 GMT")
                .header("Link", "</api/v1/pos/orders/" + id + "/payments>; rel=\"successor-version\"")
                .body(body);
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
