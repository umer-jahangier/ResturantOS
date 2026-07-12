package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.enums.TillStatus;
import io.restaurantos.pos.domain.model.TillSession;
import io.restaurantos.pos.dto.CloseTillRequest;
import io.restaurantos.pos.dto.OpenTillRequest;
import io.restaurantos.pos.dto.TillSessionDto;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.repository.OrderPaymentRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.repository.TillSessionRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
@Transactional
public class TillServiceImpl implements TillService {

    private static final String POS_EXCHANGE = "pos.topic";
    private static final String TILL_OPENED_KEY = "pos.till.opened";
    private static final String TILL_OPENED_TYPE = "TILL_OPENED";
    private static final String TILL_CLOSED_KEY = "pos.till.closed";
    private static final String TILL_CLOSED_TYPE = "TILL_CLOSED";

    private static final Set<OrderStatus> TERMINAL_STATUSES = EnumSet.of(
            OrderStatus.CLOSED, OrderStatus.VOIDED, OrderStatus.REFUNDED);

    private final TillSessionRepository tillSessionRepository;
    private final OrderRepository orderRepository;
    private final OrderPaymentRepository paymentRepository;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;

    public TillServiceImpl(TillSessionRepository tillSessionRepository,
                           OrderRepository orderRepository,
                           OrderPaymentRepository paymentRepository,
                           EventPublisher eventPublisher,
                           TenantContext tenantContext) {
        this.tillSessionRepository = tillSessionRepository;
        this.orderRepository = orderRepository;
        this.paymentRepository = paymentRepository;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
    }

    @Override
    public TillSessionDto openTill(OpenTillRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        UUID cashierId = tenantContext.getUserId()
                .orElseThrow(() -> new IllegalStateException("No authenticated cashier"));

        tillSessionRepository.findByCashierIdAndStatus(cashierId, TillStatus.OPEN)
                .ifPresent(existing -> {
                    throw new PosExceptions.TillAlreadyOpenException(cashierId.toString());
                });

        TillSession session = new TillSession();
        session.setTenantId(tenantId);
        session.setBranchId(request.branchId());
        session.setCashierId(cashierId);
        session.setOpeningFloatPaisa(request.openingFloatPaisa());
        session.setStatus(TillStatus.OPEN);
        session.setOpenedAt(Instant.now());
        session = tillSessionRepository.save(session);

        eventPublisher.publish(POS_EXCHANGE, TILL_OPENED_KEY, TILL_OPENED_TYPE,
                request.branchId(),
                Map.of("tillSessionId", session.getId().toString(),
                       "openingFloatPaisa", session.getOpeningFloatPaisa(),
                       "cashierId", cashierId.toString()));

        return toDto(session);
    }

    @Override
    public TillSessionDto closeTill(UUID tillId, CloseTillRequest request) {
        UUID tenantId = tenantContext.requireTenantId();

        TillSession session = tillSessionRepository.findById(tillId)
                .filter(s -> tenantId.equals(s.getTenantId()))
                .orElseThrow(() -> new PosExceptions.TillNotFoundException(tillId.toString()));

        boolean hasOpenOrders = orderRepository.findByTillSessionId(tillId).stream()
                .anyMatch(order -> !TERMINAL_STATUSES.contains(order.getStatus()));

        if (hasOpenOrders) {
            throw new PosExceptions.TillHasOpenOrdersException(tillId.toString());
        }

        long cashPaymentsTotal = orderRepository.findByTillSessionId(tillId).stream()
                .flatMap(order -> paymentRepository.findByOrderId(order.getId()).stream())
                .filter(payment -> PaymentMethod.CASH.equals(payment.getMethod()))
                .mapToLong(p -> p.getAmountPaisa())
                .sum();

        long expectedClosing = session.getOpeningFloatPaisa() + cashPaymentsTotal;

        session.setExpectedClosingPaisa(expectedClosing);
        session.setDeclaredClosingPaisa(request.declaredClosingPaisa());
        session.setStatus(TillStatus.CLOSED);
        session.setClosedAt(Instant.now());
        tillSessionRepository.saveAndFlush(session);

        // Refresh to get DB-computed variance
        TillSession refreshed = tillSessionRepository.findById(tillId)
                .orElseThrow(() -> new PosExceptions.TillNotFoundException(tillId.toString()));

        long variance = request.declaredClosingPaisa() - expectedClosing;

        eventPublisher.publish(POS_EXCHANGE, TILL_CLOSED_KEY, TILL_CLOSED_TYPE,
                refreshed.getBranchId(),
                Map.of("tillSessionId", refreshed.getId().toString(),
                       "expectedCashPaisa", expectedClosing,
                       "countedCashPaisa", request.declaredClosingPaisa(),
                       "variancePaisa", variance,
                       "cashierId", refreshed.getCashierId().toString()));

        return toDto(refreshed);
    }

    @Override
    @Transactional(readOnly = true)
    public TillSessionDto getTill(UUID tillId) {
        UUID tenantId = tenantContext.requireTenantId();
        TillSession session = tillSessionRepository.findById(tillId)
                .filter(s -> tenantId.equals(s.getTenantId()))
                .orElseThrow(() -> new PosExceptions.TillNotFoundException(tillId.toString()));
        return toDto(session);
    }

    @Override
    @Transactional(readOnly = true)
    public List<TillSessionDto> listTills(UUID cashierId, String status) {
        if (status != null && cashierId != null) {
            TillStatus tillStatus = TillStatus.valueOf(status);
            return tillSessionRepository.findByCashierIdAndStatus(cashierId, tillStatus)
                    .map(s -> List.of(toDto(s)))
                    .orElse(List.of());
        }
        if (cashierId != null) {
            TillStatus open = TillStatus.OPEN;
            return tillSessionRepository.findByCashierIdAndStatus(cashierId, open)
                    .map(s -> List.of(toDto(s)))
                    .orElse(List.of());
        }
        return List.of();
    }

    private TillSessionDto toDto(TillSession s) {
        return new TillSessionDto(
                s.getId(),
                s.getBranchId(),
                s.getCashierId(),
                s.getOpeningFloatPaisa(),
                s.getExpectedClosingPaisa(),
                s.getDeclaredClosingPaisa(),
                s.getVariancePaisa(),
                s.getStatus(),
                s.getOpenedAt(),
                s.getClosedAt()
        );
    }
}
