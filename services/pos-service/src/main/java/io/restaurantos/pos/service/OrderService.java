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

    /**
     * Asks crm-service which promotions this order qualifies for and records the result as one
     * ORDER-scoped discount (CRM-04).
     *
     * <p>An order with no customer, or one that qualifies for nothing, is a no-op — never an
     * error. Applying twice replaces the promotional discount rather than stacking it.
     */
    OrderDto applyPromotions(UUID orderId);
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
    /**
     * The unsearched listing. Declared here and implemented in {@code OrderServiceImpl} rather
     * than written as an interface {@code default} that delegates: a default method carries no
     * {@code @Transactional} of its own, and its call to the annotated sibling is a
     * self-invocation on the target that the proxy never sees — so the summary rows would be
     * built with no Hibernate session and every one of them would throw
     * {@code LazyInitializationException} on {@code order.getItems()}. Caught here by
     * {@code OrderSummaryDtoIT}, which is exactly what that suite is for.
     */
    Page<OrderSummaryDto> listOrderSummaries(UUID branchId, List<String> statuses, Pageable pageable);

    /**
     * The same list, narrowed by a free-text search term (S0-05).
     *
     * <p>{@code q} matches an order number (substring, case-insensitive), a table name, or the
     * attached customer's phone/name — the three things a manager actually has to hand when they
     * go looking for a check. It is answered HERE and not in the browser: the page can only ever
     * filter what it has already fetched, which is one truncated page of one status scope, so a
     * client-side search cannot reach a voided check, a closed one, or anything past row 20.
     *
     * <p>A non-blank {@code q} with no explicit {@code statuses} searches EVERY status, including
     * DRAFT and the terminal ones the default listing deliberately hides. That asymmetry is the
     * point: hiding a voided order from the default list is right (it is not active work), hiding
     * it from someone typing its number is not.
     */
    Page<OrderSummaryDto> listOrderSummaries(UUID branchId, List<String> statuses, String q, Pageable pageable);

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

    /**
     * S0-06: serves every active line of {@code orderId} in one transaction and then runs the
     * {@code maybeCloseOrder} seam — the operator-reachable step from "the guest has paid" to a
     * terminal order. It never closes the order itself, so the Paid-AND-Served rule, the
     * period-lock check and the single ORDER_CLOSED publish stay where they are; an order that
     * is served but not fully paid stays open, which is correct.
     *
     * <p>Refuses (409) when the order is already terminal, has no active lines, or still has a
     * line that was never fired to the kitchen — loudly, because a control that silently does
     * nothing is precisely the defect this closes.
     */
    OrderDto markAllItemsServed(UUID orderId);
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
