package io.restaurantos.pos.service;

import io.restaurantos.pos.authz.PosAuthorizationService;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.domain.model.OrderRefund;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.RefundRequest;
import io.restaurantos.pos.event.PosVoidRefundPayloads;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.repository.OrderRefundRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.idempotency.IdempotencyService;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

@Service
@Transactional
public class RefundServiceImpl implements RefundService {

    private static final String POS_EXCHANGE = "pos.topic";
    private static final String ORDER_REFUNDED_KEY = "pos.order.refunded";
    private static final String ORDER_REFUNDED_TYPE = "ORDER_REFUNDED";

    private final OrderRepository orderRepository;
    private final OrderRefundRepository refundRepository;
    private final PosAuthorizationService posAuthorizationService;
    private final IdempotencyService idempotencyService;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;
    private final OrderStateMachine stateMachine;

    public RefundServiceImpl(OrderRepository orderRepository,
                             OrderRefundRepository refundRepository,
                             PosAuthorizationService posAuthorizationService,
                             IdempotencyService idempotencyService,
                             EventPublisher eventPublisher,
                             TenantContext tenantContext,
                             OrderStateMachine stateMachine) {
        this.orderRepository = orderRepository;
        this.refundRepository = refundRepository;
        this.posAuthorizationService = posAuthorizationService;
        this.idempotencyService = idempotencyService;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
        this.stateMachine = stateMachine;
    }

    @Override
    public OrderDto refund(UUID orderId, RefundRequest request, String idempotencyKey) {
        UUID tenantId = tenantContext.requireTenantId();

        // Idempotency check
        Optional<String> stored = idempotencyService.getCompletedResponse(idempotencyKey);
        if (stored.isPresent()) {
            Order order = orderRepository.findById(orderId)
                    .filter(o -> tenantId.equals(o.getTenantId()))
                    .orElseThrow(() -> new PosExceptions.OrderNotFoundException(orderId.toString()));
            return toDto(order);
        }

        boolean claimed = idempotencyService.checkAndLock(idempotencyKey, request.reason() + request.refundPaisa(), 86400);
        if (!claimed) {
            Order order = orderRepository.findById(orderId)
                    .filter(o -> tenantId.equals(o.getTenantId()))
                    .orElseThrow(() -> new PosExceptions.OrderNotFoundException(orderId.toString()));
            return toDto(order);
        }

        Order order = orderRepository.findById(orderId)
                .filter(o -> tenantId.equals(o.getTenantId()))
                .orElseThrow(() -> new PosExceptions.OrderNotFoundException(orderId.toString()));

        // Refunds only allowed on CLOSED orders
        if (order.getStatus() != OrderStatus.CLOSED) {
            throw new StateInvalidException("Refund only allowed on CLOSED orders, current status: " + order.getStatus());
        }

        // OPA authorization with refund amount threshold check
        posAuthorizationService.authorizeRefund(
                orderId, tenantId, order.getBranchId(),
                order.getCashierId(), order.getStatus().name(), request.refundPaisa());

        UUID refundedBy = tenantContext.getUserId().orElse(null);

        if (request.isFull()) {
            // Full refund — transition to REFUNDED
            stateMachine.assertTransition(order.getStatus(), OrderStatus.REFUNDED);
            order.setStatus(OrderStatus.REFUNDED);
            order = orderRepository.save(order);
        } else {
            // Partial refund — create refund record, status stays CLOSED
            OrderRefund refund = new OrderRefund();
            refund.setTenantId(tenantId);
            refund.setOrderId(orderId);
            refund.setRefundPaisa(request.refundPaisa());
            refund.setReason(request.reason());
            refund.setRefundedBy(refundedBy);
            refund.setScope("PARTIAL");
            refundRepository.save(refund);
        }

        var payload = new PosVoidRefundPayloads.OrderRefundedPayload(
                orderId, request.refundPaisa(), request.reason(), refundedBy);
        eventPublisher.publish(POS_EXCHANGE, ORDER_REFUNDED_KEY, ORDER_REFUNDED_TYPE,
                order.getBranchId(), payload);

        Order finalOrder = order;
        idempotencyService.markComplete(idempotencyKey, finalOrder.getId().toString());
        return toDto(finalOrder);
    }

    private OrderDto toDto(Order order) {
        return new OrderDto(
                order.getId(),
                order.getBranchId(),
                order.getOrderNo(),
                order.getType(),
                order.getStatus(),
                order.getTableId(),
                order.getCoverCount(),
                order.getCashierId(),
                order.getCustomerId(),
                order.getSubtotalPaisa(),
                order.getTaxPaisa(),
                order.getDiscountPaisa(),
                order.getServiceChargePaisa(),
                order.getTotalPaisa(),
                order.getNotes(),
                order.getOpenedAt(),
                order.getSentToKdsAt(),
                order.getClientOrderId(),
                order.getVersion(),
                java.util.List.of()
        );
    }
}
