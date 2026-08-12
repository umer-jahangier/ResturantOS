package io.restaurantos.pos.service;

import io.restaurantos.pos.authz.PosAuthorizationService;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.domain.model.OrderPayment;
import io.restaurantos.pos.domain.model.OrderRefund;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.RefundRequest;
import io.restaurantos.shared.event.payload.PosEventContract;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.repository.OrderPaymentRepository;
import io.restaurantos.pos.repository.OrderRefundRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.idempotency.IdempotencyService;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
@Transactional
public class RefundServiceImpl implements RefundService {

    private static final String POS_EXCHANGE = "pos.topic";
    private static final String ORDER_REFUNDED_KEY = "pos.order.refunded";
    private static final String ORDER_REFUNDED_TYPE = "ORDER_REFUNDED";

    /**
     * States from which no refund is possible (S0-01). Everything else — OPEN, SENT_TO_KDS,
     * PARTIAL_READY, READY, SERVED, CLOSED — is refundable IF money was taken, and that "if" is
     * the real gate. DRAFT is a client-side cart that never held a payment; VOIDED and REFUNDED
     * are terminal.
     */
    private static final Set<OrderStatus> UNREFUNDABLE =
            EnumSet.of(OrderStatus.DRAFT, OrderStatus.VOIDED, OrderStatus.REFUNDED);

    private final OrderRepository orderRepository;
    private final OrderRefundRepository refundRepository;
    private final OrderPaymentRepository paymentRepository;
    private final PosAuthorizationService posAuthorizationService;
    private final IdempotencyService idempotencyService;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;
    private final OrderStateMachine stateMachine;
    private final TableService tableService;

    public RefundServiceImpl(OrderRepository orderRepository,
                             OrderRefundRepository refundRepository,
                             OrderPaymentRepository paymentRepository,
                             PosAuthorizationService posAuthorizationService,
                             IdempotencyService idempotencyService,
                             EventPublisher eventPublisher,
                             TenantContext tenantContext,
                             OrderStateMachine stateMachine,
                             TableService tableService) {
        this.orderRepository = orderRepository;
        this.refundRepository = refundRepository;
        this.paymentRepository = paymentRepository;
        this.posAuthorizationService = posAuthorizationService;
        this.idempotencyService = idempotencyService;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
        this.stateMachine = stateMachine;
        this.tableService = tableService;
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

        // ── S0-01: refundability is decided by MONEY, not by status ─────────────────────
        // The old gate was `status != CLOSED -> 409`. An order only reaches CLOSED once it is
        // fully Paid AND fully Served, so the ordinary settled check — cash taken, food still on
        // the pass, status SENT_TO_KDS — could never be refunded. Its operator was left with
        // Void as the only working control, and a void leaves the payment row live with no
        // reversing entry. Refund is now available wherever money was actually taken, which is
        // the same predicate voidOrder refuses on: the two operations partition the space
        // instead of overlapping on the destructive one.
        if (UNREFUNDABLE.contains(order.getStatus())) {
            throw new StateInvalidException(
                    "Cannot refund an order in status " + order.getStatus()
                            + ". A refund reverses a recorded payment; this order can hold none.");
        }

        // OPA authorization with refund amount threshold check. Runs BEFORE the money checks
        // below on purpose: an approval-limit denial is about WHO is asking, and a caller who is
        // not allowed to refund this much should be told that rather than handed a reading of the
        // order's payment state.
        posAuthorizationService.authorizeRefund(
                orderId, tenantId, order.getBranchId(),
                order.getCashierId(), order.getStatus().name(), request.refundPaisa());

        List<OrderPayment> payments = paymentRepository.findByOrderId(orderId).stream()
                .sorted(Comparator.comparing(
                        OrderPayment::getRecordedAt, Comparator.nullsLast(Comparator.naturalOrder())))
                .toList();
        long paidPaisa = payments.stream().mapToLong(OrderPayment::getAmountPaisa).sum();
        long alreadyRefundedPaisa = refundRepository.sumRefundedByOrderId(orderId);
        long refundablePaisa = paidPaisa - alreadyRefundedPaisa;

        if (refundablePaisa <= 0) {
            throw new StateInvalidException(
                    "Nothing to refund on order " + order.getOrderNo() + ": "
                            + paidPaisa + " paisa taken, " + alreadyRefundedPaisa
                            + " paisa already refunded. Void it instead if no money changed hands.");
        }
        // Never silently clamp. A cashier who typed 5000 and got 1682 back would believe they
        // handed over 5000 — the same class of error PaymentServiceImpl refuses for non-cash
        // over-tender. Say the number and refuse.
        if (request.refundPaisa() > refundablePaisa) {
            throw new StateInvalidException(
                    "Refund of " + request.refundPaisa() + " paisa exceeds the "
                            + refundablePaisa + " paisa still refundable on order "
                            + order.getOrderNo() + ".");
        }

        UUID refundedBy = tenantContext.getUserId().orElse(null);

        // "Full" is DERIVED, never trusted from the client. The dialog's FULL scope used to send
        // order.totalPaisa, which is not the same number as what was collected on a partly-paid
        // check — sending it made a legitimate full reversal fail the cap above. The order goes
        // REFUNDED exactly when every paisa taken has been given back.
        boolean fullyReversed = (alreadyRefundedPaisa + request.refundPaisa()) >= paidPaisa;
        String scope = fullyReversed ? "FULL" : "PARTIAL";

        // One refund row PER TENDER REVERSED, oldest tender first. The row is the reversing money
        // record the payments history shows next to the original, and its method is what lets the
        // till subtract only the cash that physically left the drawer.
        for (Allocation allocation : allocate(payments, alreadyRefundedPaisa, request.refundPaisa())) {
            OrderRefund refund = new OrderRefund();
            refund.setTenantId(tenantId);
            refund.setOrderId(orderId);
            refund.setRefundPaisa(allocation.amountPaisa());
            refund.setReason(request.reason());
            refund.setRefundedBy(refundedBy);
            refund.setScope(scope);
            refund.setMethod(allocation.method());
            refundRepository.save(refund);
        }

        if (fullyReversed) {
            stateMachine.assertTransition(order.getStatus(), OrderStatus.REFUNDED);
            order.setStatus(OrderStatus.REFUNDED);
            order = orderRepository.save(order);
            // REFUNDED is terminal, so the table has to come back to AVAILABLE exactly as it does
            // on close and on void. Refunding a still-seated SENT_TO_KDS check was impossible
            // before this change, so this path had never needed it — and without it the table
            // would stay OCCUPIED for a guest who has left with their money.
            tableService.syncStatusForOrder(order.getTableId(), order.getBranchId(),
                    order.getStatus(), order.getDerivedStatus());
        }

        // H4: carry the output-tax component of the refund. finance cannot derive it — it sees the
        // refund event, not the original order — so without this it debited the whole amount to a
        // revenue contra account and left account 2200 untouched, and Phase 12's FBR Tax Summary
        // (output tax minus input tax) overstated net payable by the tax on every refund.
        long refundTaxPaisa = apportionTax(order, request.refundPaisa(), fullyReversed);

        var payload = new PosEventContract.OrderRefundedPayload(
                orderId, order.getCustomerId(), request.refundPaisa(), refundTaxPaisa,
                request.reason(), refundedBy);
        eventPublisher.publish(POS_EXCHANGE, ORDER_REFUNDED_KEY, ORDER_REFUNDED_TYPE,
                order.getBranchId(), payload);

        Order finalOrder = order;
        idempotencyService.markComplete(idempotencyKey, finalOrder.getId().toString());
        return toDto(finalOrder);
    }

    /** One slice of a refund, charged back against a specific tender method. */
    private record Allocation(PaymentMethod method, long amountPaisa) {}

    /**
     * Splits {@code refundPaisa} across the order's tenders, oldest first, skipping the
     * {@code alreadyRefundedPaisa} that earlier refunds consumed.
     *
     * <p>FIFO rather than pro-rata on purpose: it is the rule a cashier can reconstruct from the
     * receipt without arithmetic, it keeps every slice a whole paisa (pro-rata needs rounding,
     * and rounding money across N methods is how a 1-paisa hole gets into a drawer count), and
     * for the overwhelmingly common single-tender bill the two rules agree exactly.
     *
     * <p>Callers guarantee {@code refundPaisa <= sum(payments) - alreadyRefundedPaisa}, so the
     * loop always places the whole amount. A payment row with a NULL method cannot exist —
     * the column is NOT NULL — so no defaulting is needed here.
     */
    private static List<Allocation> allocate(List<OrderPayment> payments,
                                             long alreadyRefundedPaisa,
                                             long refundPaisa) {
        List<Allocation> out = new ArrayList<>();
        long toSkip = alreadyRefundedPaisa;
        long remaining = refundPaisa;
        for (OrderPayment payment : payments) {
            if (remaining <= 0) {
                break;
            }
            long available = payment.getAmountPaisa();
            if (toSkip > 0) {
                long consumed = Math.min(toSkip, available);
                toSkip -= consumed;
                available -= consumed;
            }
            if (available <= 0) {
                continue;
            }
            long slice = Math.min(available, remaining);
            out.add(new Allocation(payment.getMethod(), slice));
            remaining -= slice;
        }
        return out;
    }

    /**
     * The output-tax share of a refund.
     *
     * <p>A full refund reverses exactly the tax the order charged — never a re-derived
     * approximation, so a full refund always nets the tax liability back to zero. A partial refund
     * apportions pro-rata on the order total, HALF_UP, matching {@code MoneyUtils}' rounding
     * convention. A zero-total order (fully discounted) apportions nothing rather than dividing by
     * zero.
     */
    private static long apportionTax(Order order, long refundPaisa, boolean isFull) {
        if (isFull) {
            return order.getTaxPaisa();
        }
        if (order.getTotalPaisa() <= 0 || order.getTaxPaisa() <= 0) {
            return 0L;
        }
        return BigDecimal.valueOf(order.getTaxPaisa())
                .multiply(BigDecimal.valueOf(refundPaisa))
                .divide(BigDecimal.valueOf(order.getTotalPaisa()), 0, RoundingMode.HALF_UP)
                .longValueExact();
    }

    private OrderDto toDto(Order order) {
        return new OrderDto(
                order.getId(),
                order.getBranchId(),
                order.getOrderNo(),
                order.getType(),
                order.getStatus(),
                order.getDerivedStatus(),
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
                java.util.List.of(),
                // Items are already empty here (this projection is the refund acknowledgement,
                // not the check); discounts follow the same rule for the same reason.
                java.util.List.of()
        );
    }
}
