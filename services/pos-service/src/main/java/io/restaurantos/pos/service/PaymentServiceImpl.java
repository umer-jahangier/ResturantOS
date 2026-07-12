package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.domain.model.OrderPayment;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.repository.OrderPaymentRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

@Service
@Transactional
public class PaymentServiceImpl implements PaymentService {

    private final OrderRepository orderRepository;
    private final OrderPaymentRepository paymentRepository;
    private final TenantContext tenantContext;

    public PaymentServiceImpl(OrderRepository orderRepository,
                              OrderPaymentRepository paymentRepository,
                              TenantContext tenantContext) {
        this.orderRepository = orderRepository;
        this.paymentRepository = paymentRepository;
        this.tenantContext = tenantContext;
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

        OrderPayment payment = new OrderPayment();
        payment.setTenantId(tenantId);
        payment.setOrderId(orderId);
        payment.setMethod(method);
        payment.setAmountPaisa(amountPaisa);
        payment.setReferenceNo(referenceNo);
        payment.setRecordedAt(Instant.now());
        paymentRepository.save(payment);

        return paymentRepository.sumAmountByOrderId(orderId);
    }
}
