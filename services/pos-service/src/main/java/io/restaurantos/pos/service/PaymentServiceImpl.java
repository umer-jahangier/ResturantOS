package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.enums.TillStatus;
import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.domain.model.OrderPayment;
import io.restaurantos.pos.dto.OrderPaymentDto;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.repository.OrderPaymentRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.repository.TillSessionRepository;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@Transactional
public class PaymentServiceImpl implements PaymentService {

    private final OrderRepository orderRepository;
    private final OrderPaymentRepository paymentRepository;
    private final TenantContext tenantContext;
    private final OrderService orderService;
    private final TillSessionRepository tillSessionRepository;

    public PaymentServiceImpl(OrderRepository orderRepository,
                              OrderPaymentRepository paymentRepository,
                              TenantContext tenantContext,
                              OrderService orderService,
                              TillSessionRepository tillSessionRepository) {
        this.orderRepository = orderRepository;
        this.paymentRepository = paymentRepository;
        this.tenantContext = tenantContext;
        this.orderService = orderService;
        this.tillSessionRepository = tillSessionRepository;
    }

    @Override
    public long recordPayment(UUID orderId, PaymentMethod method, long amountPaisa, String referenceNo) {
        UUID tenantId = tenantContext.requireTenantId();

        Order order = orderRepository.findById(orderId)
                .filter(o -> tenantId.equals(o.getTenantId()))
                .orElseThrow(() -> new PosExceptions.OrderNotFoundException(orderId.toString()));

        // Cannot record payment against terminal orders
        if (order.getStatus() == OrderStatus.CLOSED
                || order.getStatus() == OrderStatus.VOIDED
                || order.getStatus() == OrderStatus.REFUNDED) {
            throw new StateInvalidException(
                    "Cannot record payment for order in status: " + order.getStatus());
        }

        // Guarantee the order is linked to the paying cashier's OPEN till (POS-till reconcil).
        // tillSessionId is otherwise only set at create-time, and only if the cashier already
        // had an open till THEN — so an order created before opening the till (or by another
        // path) stayed unlinked and its CASH payment was invisible to the till's expected
        // closing (the "charged but till shows 0" bug). Backfill it here, at settlement time.
        if (order.getTillSessionId() == null) {
            tenantContext.getUserId()
                    .flatMap(userId -> tillSessionRepository.findByCashierIdAndStatus(userId, TillStatus.OPEN))
                    .ifPresent(till -> order.setTillSessionId(till.getId()));
            if (order.getTillSessionId() != null) {
                orderRepository.save(order);
            }
        }

        OrderPayment payment = new OrderPayment();
        payment.setTenantId(tenantId);
        payment.setOrderId(orderId);
        payment.setMethod(method);
        payment.setAmountPaisa(amountPaisa);
        payment.setReferenceNo(referenceNo);
        payment.setRecordedAt(Instant.now());
        paymentRepository.save(payment);

        // POS-23: recording a payment persists it and derives paymentStatus, but never closes
        // the order directly — maybeCloseOrder is the single seam that closes ONLY when the
        // order is fully Paid AND fully Served (a payment on an unserved order stays open).
        orderService.maybeCloseOrder(orderId);

        return paymentRepository.sumAmountByOrderId(orderId);
    }

    @Override
    @Transactional(readOnly = true)
    public List<OrderPaymentDto> listPayments(UUID orderId) {
        UUID tenantId = tenantContext.requireTenantId();

        // Tenant-scope exactly as recordPayment — 404 if the order is not the caller's tenant.
        orderRepository.findById(orderId)
                .filter(o -> tenantId.equals(o.getTenantId()))
                .orElseThrow(() -> new PosExceptions.OrderNotFoundException(orderId.toString()));

        return paymentRepository.findByOrderId(orderId).stream()
                .map(OrderPaymentDto::from)
                .collect(Collectors.toList());
    }
}
