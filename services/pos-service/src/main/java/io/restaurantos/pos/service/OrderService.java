package io.restaurantos.pos.service;

import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.ApplyDiscountRequest;
import io.restaurantos.pos.dto.AssignTableRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.OrderSummaryDto;
import io.restaurantos.pos.dto.UpdateInstructionsRequest;
import io.restaurantos.pos.dto.VoidOrderRequest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.UUID;

public interface OrderService {
    OrderDto createOrder(CreateOrderRequest request);
    OrderDto addItem(UUID orderId, AddOrderItemRequest request);
    OrderDto removeItem(UUID orderId, UUID itemId);
    OrderDto applyDiscount(UUID orderId, ApplyDiscountRequest request);
    OrderDto sendToKds(UUID orderId, String clientFireId);
    OrderDto getOrder(UUID orderId, UUID branchId);
    Page<OrderDto> listOrders(UUID branchId, List<String> statuses, Pageable pageable);

    /**
     * Order Management list (POS-09): defaults to ALL non-terminal statuses (never hides a
     * non-closed order) when {@code statuses} is null/empty, and is permission-gated
     * own-vs-all-branch (T-07.1d-01) — a caller without {@code pos.order.view.all} is silently
     * scoped to their own orders, never a client-controllable filter. {@code branchId} MUST be
     * the caller's JWT branch.
     */
    Page<OrderSummaryDto> listOrderSummaries(UUID branchId, List<String> statuses, Pageable pageable);

    /**
     * The single seam (POS-23) that closes an order as a derived consequence of settlement
     * state — never a direct user action. Closes ONLY when the order is fully Paid
     * ({@code sum(OrderPayment) >= totalPaisa}) AND fully Served
     * ({@code derivedStatus == SERVED}) AND not already terminal (CLOSED/VOIDED/REFUNDED), in
     * which case it is a no-op returning the order unchanged. Invoked from BOTH
     * {@code PaymentServiceImpl.recordPayment} and {@code markItemServed} so a payment
     * completing an already-served order closes it, and serving the last line of an
     * already-paid order closes it too.
     */
    OrderDto maybeCloseOrder(UUID orderId);

    OrderDto voidOrder(UUID orderId, VoidOrderRequest request, String idempotencyKey);
    OrderDto markItemServed(UUID orderId, UUID itemId);
    OrderDto cancelItem(UUID orderId, UUID itemId);
    OrderDto updateInstructions(UUID orderId, UpdateInstructionsRequest request);

    /**
     * Assign-table (POS-24): binds {@code tableId} to a non-terminal order. Rejects
     * (StateInvalidException, 409) if the order is already terminal (CLOSED/VOIDED/REFUNDED)
     * or the target table is not AVAILABLE (re-checked INSIDE the transaction — concurrency
     * safe, T-07.3-12). Table-status mutation routes exclusively through
     * {@code TableService.syncStatusForOrder} (single seam) — never an inline
     * {@code table.setStatus(...)}.
     */
    OrderDto assignTable(UUID orderId, UUID tableId);
}
