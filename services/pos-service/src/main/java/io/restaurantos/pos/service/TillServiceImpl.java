package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.enums.TillStatus;
import io.restaurantos.pos.domain.model.TillSession;
import io.restaurantos.pos.dto.CloseTillRequest;
import io.restaurantos.pos.dto.OpenTillRequest;
import io.restaurantos.pos.dto.TillReconciliationDto;
import io.restaurantos.pos.dto.TillSessionDto;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.domain.model.OrderRefund;
import io.restaurantos.pos.repository.OrderPaymentRepository;
import io.restaurantos.pos.repository.OrderRefundRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.repository.TillSessionRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
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
    private final OrderRefundRepository refundRepository;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;

    public TillServiceImpl(TillSessionRepository tillSessionRepository,
                           OrderRepository orderRepository,
                           OrderPaymentRepository paymentRepository,
                           OrderRefundRepository refundRepository,
                           EventPublisher eventPublisher,
                           TenantContext tenantContext) {
        this.tillSessionRepository = tillSessionRepository;
        this.orderRepository = orderRepository;
        this.paymentRepository = paymentRepository;
        this.refundRepository = refundRepository;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
    }

    /**
     * Cash that left the drawer as refunds against {@code orderIds} (S0-01).
     *
     * <p>Expected closing cash was {@code openingFloat + cashPayments} and stopped there. That was
     * survivable only while refunds were unreachable — they were gated on CLOSED, which a
     * paid-but-unserved check never reaches. Now that a refund is the ONLY way to undo a paid
     * order, every refund would otherwise show up as a shortage in the cashier's count: the money
     * is genuinely gone from the drawer and the expected figure still counted it.
     *
     * <p>A NULL method is a pre-V20 row of unknown tender; treated as CASH, per the migration's
     * note on which direction is safe.
     */
    private long cashRefundedFor(List<UUID> orderIds) {
        if (orderIds.isEmpty()) {
            return 0L;
        }
        return refundRepository.findByOrderIdIn(orderIds).stream()
                .filter(r -> r.getMethod() == null || PaymentMethod.CASH.equals(r.getMethod()))
                .mapToLong(OrderRefund::getRefundPaisa)
                .sum();
    }

    @Override
    public TillSessionDto openTill(OpenTillRequest request) {
        // SECURITY (branch isolation): reject a request-supplied branchId that differs from the
        // caller's verified JWT branch — otherwise a cashier could open a till in another branch
        // (RLS is tenant-only and would not block the cross-branch write).
        requireOwnBranch(request.branchId());

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

        List<UUID> tillOrderIds = orderRepository.findByTillSessionId(tillId).stream()
                .map(io.restaurantos.pos.domain.model.Order::getId)
                .toList();

        long cashPaymentsTotal = orderRepository.findByTillSessionId(tillId).stream()
                .flatMap(order -> paymentRepository.findByOrderId(order.getId()).stream())
                .filter(payment -> PaymentMethod.CASH.equals(payment.getMethod()))
                .mapToLong(p -> p.getAmountPaisa())
                .sum();

        long expectedClosing =
                session.getOpeningFloatPaisa() + cashPaymentsTotal - cashRefundedFor(tillOrderIds);

        session.setExpectedClosingPaisa(expectedClosing);
        session.setDeclaredClosingPaisa(request.declaredClosingPaisa());
        session.setStatus(TillStatus.CLOSED);
        session.setClosedAt(Instant.now());
        session.setNote(request.note());
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

    @Override
    @Transactional(readOnly = true)
    public Page<TillSessionDto> listTillsForBranch(UUID branchId, Pageable pageable) {
        // SECURITY (branch isolation): a client-supplied sibling branchId must not expose another
        // branch's till history within the same tenant — RLS is tenant-only, so guard here.
        requireOwnBranch(branchId);
        return tillSessionRepository.findByBranchIdOrderByOpenedAtDesc(branchId, pageable)
                .map(this::toDto);
    }

    @Override
    @Transactional(readOnly = true)
    public TillReconciliationDto getReconciliation(UUID tillId) {
        UUID tenantId = tenantContext.requireTenantId();
        TillSession session = tillSessionRepository.findById(tillId)
                .filter(s -> tenantId.equals(s.getTenantId()))
                .orElseThrow(() -> new PosExceptions.TillNotFoundException(tillId.toString()));

        List<io.restaurantos.pos.domain.model.Order> orders = orderRepository.findByTillSessionId(tillId);
        long cash = 0L;
        long nonCash = 0L;
        List<TillReconciliationDto.TillOrderLine> lines = new java.util.ArrayList<>();

        for (io.restaurantos.pos.domain.model.Order order : orders) {
            long paid = 0L;
            for (var payment : paymentRepository.findByOrderId(order.getId())) {
                paid += payment.getAmountPaisa();
                if (PaymentMethod.CASH.equals(payment.getMethod())) {
                    cash += payment.getAmountPaisa();
                } else {
                    nonCash += payment.getAmountPaisa();
                }
            }
            lines.add(new TillReconciliationDto.TillOrderLine(
                    order.getId(), order.getOrderNo(), order.getStatus(),
                    order.getTotalPaisa(), paid));
        }

        // Same subtraction as closeTill — the live bar and the close screen must never disagree
        // about how much cash is supposed to be in the drawer.
        long cashRefunded = cashRefundedFor(
                orders.stream().map(io.restaurantos.pos.domain.model.Order::getId).toList());
        long liveExpectedCash = session.getOpeningFloatPaisa() + cash - cashRefunded;
        return new TillReconciliationDto(
                toDto(session), orders.size(), cash - cashRefunded, nonCash, liveExpectedCash, lines);
    }

    /**
     * Defense-in-depth against a client-supplied {@code branchId} that widens scope beyond the
     * caller's JWT branch. Mirrors {@code TableServiceImpl.requireOwnBranch} — {@code branchId}
     * stays an explicit request parameter but must always equal the verified JWT branch.
     * Package-visible so {@link TillReviewService} can reuse the same check.
     */
    void requireOwnBranch(UUID branchId) {
        UUID jwtBranchId = tenantContext.getBranchId()
                .orElseThrow(() -> new PermissionDeniedException("Branch context required"));
        if (!jwtBranchId.equals(branchId)) {
            throw new PermissionDeniedException("Cannot access tills for a different branch");
        }
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
                s.getClosedAt(),
                s.getNote(),
                s.getReviewStatus()
        );
    }
}
