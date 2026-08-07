package io.restaurantos.pos.web;

import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.dto.OrderPaymentDto;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.pos.service.SplitTenderCalculator;
import io.restaurantos.pos.authz.PosAuthorizationService;
import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
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
    private final OrderRepository orderRepository;
    private final PosAuthorizationService posAuthorizationService;
    private final TenantContext tenantContext;

    public PaymentController(PaymentService paymentService,
                             SplitTenderCalculator splitTenderCalculator,
                             OrderRepository orderRepository,
                             PosAuthorizationService posAuthorizationService,
                             TenantContext tenantContext) {
        this.paymentService = paymentService;
        this.splitTenderCalculator = splitTenderCalculator;
        this.orderRepository = orderRepository;
        this.posAuthorizationService = posAuthorizationService;
        this.tenantContext = tenantContext;
    }

    /**
     * {@code amountPaisa} is what to apply to the bill; the server caps it at the outstanding
     * balance. {@code tenderedPaisa} is optional and CASH-only in practice — omit it and the
     * tender is taken to equal the applied amount.
     */
    record RecordPaymentRequest(
            @NotNull PaymentMethod method,
            @NotNull Long amountPaisa,
            Long tenderedPaisa,
            String referenceNo,
            /** Required for CHARGE_TO_ACCOUNT, ignored otherwise — which house account to bill. */
            UUID customerAccountId
    ) {}

    @PreAuthorize("hasAuthority('pos.order.close')")
    @PostMapping("/{id}/payments")
    public ResponseEntity<ApiResponse<Long>> recordPayment(
            @PathVariable UUID id,
            @Valid @RequestBody RecordPaymentRequest request) {
        long total = paymentService.recordPayment(id, request.method(), request.amountPaisa(),
                request.tenderedPaisa(), request.referenceNo(), request.customerAccountId());
        return ResponseEntity.ok(ApiResponse.ok(total));
    }

    @PreAuthorize("hasAuthority('pos.order.view')")
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
    @PreAuthorize("hasAuthority('pos.order.close')")
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

    @PreAuthorize("hasAuthority('pos.order.split_bill')")
    @PostMapping("/{id}/split")
    public ResponseEntity<ApiResponse<List<Long>>> splitPreview(
            @PathVariable UUID id,
            @Valid @RequestBody SplitPreviewRequest request) {
        // pos.rego's pos.order.split_bill rule, a dead letter until phase 18b. The ORDER's own
        // branch is what the policy is asked about — passing the caller's own branch would compare
        // it against itself and enforce nothing.
        UUID tenantId = tenantContext.requireTenantId();
        Order order = orderRepository.findById(id)
                .filter(o -> tenantId.equals(o.getTenantId()))
                .orElseThrow(() -> new PosExceptions.OrderNotFoundException(id.toString()));
        posAuthorizationService.authorizeSplitBill(
                id, tenantId, order.getBranchId(),
                order.getCashierId(), order.getStatus().name());

        List<Long> shares = splitTenderCalculator.equalSplit(request.totalPaisa(), request.diners());
        return ResponseEntity.ok(ApiResponse.ok(shares));
    }
}
